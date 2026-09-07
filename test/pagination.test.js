const { test } = require('node:test');
const fs = require('node:fs');
const Path = require('node:path');
const assert = require('node:assert/strict');
const { loadTestConfig, createCheck, createTempDir, runCLI } = require('./helpers/common.js');

test('pagination', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// End-to-end, read-only checks for search pagination and mutation dry runs.
	const traceFile = Path.join(createTempDir(t, 'xycli-page-test-'), 'trace.jsonl');
	
	function run(args) {
		fs.writeFileSync(traceFile, '');
		const output = runCLI(args, {
			preload: Path.join(__dirname, 'helpers/pagination-preload.cjs'),
			env: { XYOPS_SUGGEST: 'false', XYCLI_PAGINATION_TRACE: traceFile }
		});
		
		const trace = fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
		return { output, trace };
	}
	
	function json(args) {
		const result = run([...args, '--format', 'jsonc']);
		return JSON.parse(result.output.split('\n').find(line => /^[\[{]/.test(line)));
	}
	
	function search(args, method, offset = 2, limit = 2) {
		const result = run([...args, '--limit', String(limit), '--page', '2']);
		const call = result.trace.find(row => row.method === method);
		assert.ok(call, JSON.stringify(result.trace));
		assert.equal(call.offset, offset);
		assert.equal(call.limit, limit);
		assert.ok(!call.query || !/\b(limit|offset|page):/.test(call.query), call.query);
		return result;
	}
	
	for (const command of ['categories', 'buckets', 'keys', 'alerts']) {
		await check(command + ' pagination stays out of local filters', () => {
			const base = json([command]);
			assert.deepEqual(json([command, '--limit', '1', '--page', '2']), base);
			const result = run([command, '--limit', '1', '--page', '2']);
			assert.ok(!result.output.includes('FILTERED'), result.output);
			if (base.length > 1) assert.match(result.output, /page 2 of/);
		});
	}
	
	await check('jobs search page arithmetic and query isolation', () => search(['jobs'], 'searchJobs'));
	
	await check('jobs explicit offset', () => {
		const result = run(['jobs', '--limit', '3', '--offset', '4']);
		assert.deepEqual(result.trace.find(row => row.method === 'searchJobs'), { method: 'searchJobs', query: '*', offset: 4, limit: 3 });
	});
	
	await check('page takes precedence over offset', () => search(['jobs', '--offset', '80'], 'searchJobs'));
	
	await check('alert search pagination and query isolation', () => search(['alerts', 'search'], 'searchAlerts'));
	
	await check('singular alert search alias', () => search(['alert', 'search'], 'searchAlerts'));
	
	const events = json(['events']);
	const event = events.find(event => !event.workflow) || events[0];
	
	if (event) {
		await check('event completed variant', () => search(['event', event.id, '--completed'], 'searchJobs'));
		
		await check('event queued variant', () => search(['event', event.id, '--queued'], 'getActiveJobs'));
		
		await check('event queue alias', () => search(['event', event.id, '--queue'], 'getActiveJobs'));
	}
	else await t.test('event detail pagination', { skip: 'No saved events on this server.' }, () => {});
	
	const upcoming = [['dashboard', '--upcoming'], ['dashboard', 'upcoming'], ['upcoming'], ['jobs', '--upcoming'], ['jobs', 'upcoming']];
	if (event) upcoming.push(['event', event.id, '--upcoming']);
	
	for (const args of upcoming) {
		await check(args.join(' ') + ' paginates predictions', () => {
			const result = run([...args, '--limit', '1', '--page', '2']);
			assert.match(result.output, /UPCOMING JOBS/);
			const section = result.output.slice(result.output.indexOf('UPCOMING JOBS'));
			if (section.includes('items found')) assert.match(section, /page 2 of/);
		});
	}
	
	const jobRows = (() => {
		const result = run(['api', 'searchJobs', '--query', '*', '--limit', '1', '--offset', '0', '--format', 'jsonc']);
		const lines = result.output.split('\n').filter(line => line.startsWith('{'));
		return JSON.parse(lines[lines.length - 1]).rows;
	})();
	if (jobRows.length) {
		await check('job details paginate every related search', () => {
			const result = run(['job', jobRows[0].id, '--limit', '2', '--page', '2']);
			for (const method of ['searchAlerts', 'searchSnapshots']) {
				const call = result.trace.find(row => row.method === method);
				assert.equal(call.offset, 2);
				assert.equal(call.limit, 2);
			}
		});
	}
	else await t.test('job detail pagination', { skip: 'No completed jobs on this server.' }, () => {});
	
	const invocations = json(['alerts', 'search', '--limit', '1']);
	if (invocations.length) {
		await check('alert invocation details prepare related-record pagination', () => {
			const result = run(['alert', invocations[0].id, '--limit', '2', '--page', '2']);
			const call = result.trace.find(row => row.method === 'searchSnapshots');
			
			// Alert detail intentionally anchors embedded sections at offset zero.
			assert.equal(call.offset, 0);
			assert.equal(call.limit, 2);
		});
	}
	else await t.test('alert invocation pagination', { skip: 'No alert history on this server.' }, () => {});
	
	await check('generic API retains raw pagination properties', () => {
		const payload = json(['api', 'searchJobs', '--offset', '7', '--limit', '3', '--page', '4', '--dry']);
		assert.deepEqual(payload, { offset: 7, limit: 3, page: 4 });
	});
	
	const resourceLimit = { type: 'time', enabled: true, duration: 300 };
	for (const command of ['category', 'event']) {
		await check(command + ' resource limit survives creation', () => {
			const payload = json([command, 'create', '--title', 'Pagination dry test', '--limit', JSON.stringify(resourceLimit), '--dry']);
			assert.ok(payload.limits.some(item => item.duration === 300));
		});
	}
	
	await check('mutation pagination properties reach CRUD validation', () => {
		for (const [key, value] of [['offset', '7'], ['page', '3']]) {
			const output = runCLI(['event', 'create', '--title', 'Pagination dry test', '--' + key, value, '--dry'], { fail: true });
			assert.match(output, new RegExp('Unsupported property for create_event: "' + key + '"'));
		}
	});
	
	await check('category color remains a resource property', () => assert.equal(json(['category', 'create', '--title', 'Color dry test', '--color', 'blue', '--dry']).color, 'blue'));
});
