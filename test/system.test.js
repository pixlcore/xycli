const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const zlib = require('node:zlib');
const { loadTestConfig, createCheck, createTempDir, xy, json, call: apiCall } = require('./helpers/common.js');

test('system', async t => {
	loadTestConfig();
	const check = createCheck(t);
	const temp = createTempDir(t, 'xycli-system-test-');
	
	async function waitForInternalJob(id) {
		// Maintenance APIs return as soon as the background job starts.  Wait for
		// each approved test operation to finish before starting the next one.
		const timeout = Date.now() + 120000;
		while (Date.now() < timeout) {
			const data = await apiCall('getMultiple', { lists: ['tags'], jobs: 1 });
			if (!data.internalJobs || !data.internalJobs[id]) return;
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		throw new Error('Timed out waiting for System job: ' + id);
	}
	
	await check('JSON dashboard contains system, conductor, job, and user data', () => {
		const data = json(['system']);
		assert.ok(data.stats && data.stats.db && data.stats.db.records);
		assert.ok(data.masters && typeof(data.masters) === 'object');
		assert.ok(data.internalJobs && typeof(data.internalJobs) === 'object');
		assert.ok(Array.isArray(data.users));
	});
	
	await check('human dashboard combines statistics, conductors, and connected users', () => {
		const out = xy(['system']);
		for (const label of ['System Status & Maintenance', 'Process CPU', 'DB Disk Size', 'All Conductors', 'All Connected Users', 'Other Commands']) {
			assert.match(out, new RegExp(label.replace(/[&]/g, '\\&'), 'i'), label);
		}
	});
	
	await check('diagnostic command returns a structured JSON snapshot', () => {
		const data = json(['system', 'diagnostic']);
		assert.equal(typeof(data.generated), 'number');
		assert.ok(data.system && data.system.db);
		assert.ok(data.conductors && typeof(data.conductors) === 'object');
		assert.ok(data.workers && typeof(data.workers) === 'object');
		assert.ok(data.state && typeof(data.state) === 'object');
		assert.ok(data.stats && typeof(data.stats) === 'object');
	});
	
	await check('bulk export downloads a complete private gzip archive', () => {
		const file = Path.join(temp, 'tags-export.json.gz');
		const result = json(['system', 'export', file, '--lists', 'tags']);
		assert.equal(result.code, 0);
		assert.equal(result.file, file);
		assert.ok(result.size > 0);
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
		
		const body = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
		assert.match(body, /^# xyOps Data Export v1\.0/m);
		assert.match(body, /^# List: global\/tags$/m);
		assert.match(body, /^# End of file$/m);
	});
	
	await check('broadcast sends an informational message', () => {
		const message = 'xycli System test ' + Date.now();
		const result = json(['system', 'broadcast', message, '--type', 'info']);
		assert.equal(result.code, 0);
	});
	
	await check('rate-limit reset completes successfully', () => {
		const result = json(['system', 'reset', 'rates']);
		assert.equal(result.code, 0);
	});
	
	await check('database optimization starts and completes', async () => {
		const result = json(['system', 'optimize']);
		assert.equal(result.code, 0);
		assert.match(result.id, /^i\w+$/);
		await waitForInternalJob(result.id);
	});
	
	await check('maintenance starts and completes', async () => {
		const result = json(['system', 'maintenance']);
		assert.equal(result.code, 0);
		assert.match(result.id, /^i\w+$/);
		await waitForInternalJob(result.id);
	});
	
	await check('System help chapters render', () => {
		for (const section of ['system', 'system export', 'system maintenance', 'system optimize', 'system reset', 'system diagnostic', 'system broadcast']) {
			assert.match(xy(['help', ...section.split(' ')]), new RegExp('HELP: ' + section.toUpperCase()));
		}
	});
});
