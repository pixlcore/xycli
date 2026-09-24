const { test } = require('node:test');
const assert = require('node:assert/strict');
const cli = require('pixl-cli');
const utils = require('../lib/utils.js');

cli.global();

test('executable language detection accepts Unix and Windows command forms', () => {
	// Plugin definitions are portable, so exercise both path styles regardless of
	// the operating system running this test.
	assert.equal(utils.getLangFromBinary('/usr/bin/node --use-strict'), 'javascript');
	assert.equal(utils.getLangFromBinary('/usr/bin/python3.12 -u'), 'python');
	assert.equal(utils.getLangFromBinary('/bin/bash'), 'shell');
	assert.equal(utils.getLangFromBinary('/usr/bin/env -S node --use-strict'), 'javascript');
	assert.equal(utils.getLangFromBinary('"C:\\Program Files\\nodejs\\node.exe" --use-strict'), 'javascript');
	assert.equal(utils.getLangFromBinary('C:\\Python312\\python.exe -u'), 'python');
	assert.equal(utils.getLangFromBinary('pwsh.exe -File'), 'powershell');
	assert.equal(utils.getLangFromBinary('powershell.exe -File'), 'powershell');
	assert.equal(utils.getLangFromBinary('cmd.exe /c'), 'dos');
	assert.equal(utils.getLangFromBinary('unknown-binary.exe'), null);
	assert.equal(utils.getLangFromBinary(null), null);
});

test('sync API updates preserve stored properties while manual updates retain typo checks', async () => {
	const calls = [];
	const context = {
		...utils,
		dry: false,
		verbose: false,
		api: {
			async update_plugin(request, opts) {
				calls.push({ method: 'update_plugin', request, opts });
				return { err: null, data: { code: 0 } };
			},
			async update_event(request, opts) {
				calls.push({ method: 'update_event', request, opts });
				return { err: null, data: { code: 0 } };
			}
		},
		die(message) { throw new Error(message); }
	};
	
	for (const [method, request] of [
		['update_plugin', { id: 'legacy_plugin', cwd: '/tmp/legacy' }],
		['update_event', { id: 'legacy_event', custom_field: { enabled: true } }]
	]) {
		// A hand-typed update still rejects an unknown top-level property.
		const prior_calls = calls.length;
		await assert.rejects(context.callStandardAPI(method, request), /Unsupported property/);
		assert.equal(calls.length, prior_calls);
		
		// Sync forwards the complete stored object to xyOps for its own validation.
		await context.callStandardAPI(method, request, { sync: true });
		assert.equal(calls.length, prior_calls + 1);
		assert.deepEqual(calls.at(-1), { method, request, opts: {} });
	}
	
	// The original report failed during dry sync, before any xyOps request.
	// Preview the same Plugin payload and verify that it makes no SDK call.
	const plugin_request = { id: 'legacy_plugin', cwd: '/tmp/legacy' };
	const previews = [];
	const prior_calls = calls.length;
	context.dry = true;
	context.color = () => cli.chalk.white;
	context.jsonOutput = request => { previews.push(request); };
	await context.callStandardAPI('update_plugin', plugin_request, { sync: true });
	assert.deepEqual(previews, [plugin_request]);
	assert.equal(calls.length, prior_calls);
});
