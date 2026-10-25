// Explicit live suite. Only this test's disposable records may be modified.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTestConfig, call, cleanupFixtures } = require('./helpers/common.js');
const { stdioClient, httpRPC } = require('./helpers/mcp.js');
const { configuration } = require('../lib/mcp.js');

test('MCP live event/job lifecycle and API-key permissions', async t => {
	const config = loadTestConfig();
	const stamp = Date.now();
	const eventID = 'cli_mcp_' + stamp;
	const keyID = 'cli_mcp_key_' + stamp;
	const sdk = require('@pixlcore/xyops-sdk');
	const jobs = new Set();
	const client = stdioClient(t);
	await client.initialize();
	
	async function invoke(name, args) {
		const reply = await client.call(name, args);
		assert.ok(reply.result && !reply.result.isError, reply.result?.content?.[0]?.text || 'Tool failed: ' + name);
		return reply.result.structuredContent;
	}
	
	async function finished(id) {
		const deadline = Date.now() + 30000;
		while (Date.now() < deadline) {
			const { job } = await invoke('get_job', { id });
			if (job.final) return job;
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		throw new Error('Disposable MCP job did not finish');
	}
	
	// Check connectivity before creating fixtures, so an unavailable server
	// reports the original failure rather than a secondary cleanup failure.
	const data = await call('getMultiple', { lists: 'categories,plugins', servers: 1 });
	try {
		const options = await invoke('get_event_options', { plugin_id: 'shellplug' });
		assert.equal(options.plugin.id, 'shellplug');
		const category = data.categories.find(item => item.enabled);
		const target = Object.keys(data.servers)[0];
		assert.ok(category && target, 'Live test requires an enabled category and connected server');
		const created = await invoke('create_event', { event: {
			id: eventID, title: 'Disposable MCP Test ' + stamp, enabled: true,
			category: category.id, plugin: 'shellplug', targets: [target], algo: 'random',
			params: { script: 'echo XYCLI_MCP_TEST_' + stamp },
			triggers: [{ type: 'manual', enabled: true }], actions: [], limits: []
		} });
		assert.equal(created.event.id, eventID);
		const read = await invoke('get_event', { id: eventID });
		const updated = await invoke('update_event', { id: eventID, revision: read.event.revision, changes: { notes: 'Updated through MCP' } });
		assert.ok(updated.event.revision > read.event.revision);
		const stale = await client.call('update_event', { id: eventID, revision: read.event.revision, changes: { notes: 'Must not apply' } });
		assert.equal(stale.result.isError, true);
		assert.match(stale.result.content[0].text, /Revision mismatch/);
		const preserved = await invoke('get_event', { id: eventID });
		assert.equal(preserved.event.params.script, read.event.params.script);
		assert.equal(preserved.event.notes, 'Updated through MCP');
		assert.equal((await invoke('list_events', { title: 'Disposable MCP Test ' + stamp })).total, 1);
		
		// A genuinely restricted xyOps key can inspect and run, but cannot edit.
		const key = await call('createApiKey', { id: keyID, title: keyID, active: true, privileges: { run_jobs: true } });
		const restricted = stdioClient(t, { XYOPS_API_KEY: key.plain_key });
		await restricted.initialize();
		assert.ok(!(await restricted.call('get_event', { id: eventID })).result.isError);
		const denied = await restricted.call('update_event', { id: eventID, revision: updated.event.revision, changes: { notes: 'Forbidden' } });
		assert.equal(denied.result.isError, true);
		const launched = await restricted.call('run_event', { id: eventID });
		assert.ok(!launched.result.isError, 'Restricted key should be able to run the fixture');
		const jobID = launched.result.structuredContent.id;
		jobs.add(jobID);
		const job = await finished(jobID);
		assert.equal(job.code, 0);
		const results = await invoke('search_jobs', { query: 'event:' + eventID });
		assert.ok(results.rows.some(row => row.id === jobID));
		
		// Use the HTTP transport against the same live API and compare results.
		const context = require('../lib/mcp/context.js').createContext(sdk.api, { api_key: config.api_key });
		const factory = require('../lib/mcp/server.js')(require('../lib/mcp/registry.js')(), context);
		const service = await require('../lib/mcp/transports/http.js')(factory, { ...configuration({}, {}), port: 0, log() {} });
		try {
			const response = await httpRPC('http://127.0.0.1:' + service.address.port + '/mcp', 'tools/call', { name: 'get_event', arguments: { id: eventID } }, { modern: true, headers: { Authorization: 'Bearer ' + key.plain_key } });
			assert.deepEqual(response.result.structuredContent.event, preserved.event);
			const url = 'http://127.0.0.1:' + service.address.port + '/mcp';
			// The process has admin credentials, but each HTTP caller must use
			// only its supplied key, even while requests overlap.
			const updates = await Promise.all([
				{ key: config.api_key, notes: 'HTTP admin update' },
				{ key: key.plain_key, notes: 'Forbidden HTTP update' },
				{ key: 'invalid-fixture-key', notes: 'Invalid key update' }
			].map(item => httpRPC(url, 'tools/call', { name: 'update_event', arguments: {
				id: eventID, revision: updated.event.revision, changes: { notes: item.notes }
			} }, { modern: true, headers: { Authorization: 'Bearer ' + item.key } })));
			assert.ok(!updates[0].result.isError);
			assert.equal(updates[1].result.isError, true);
			assert.equal(updates[2].result.isError, true);
			// These must be authentication/permission failures, not revision
			// conflicts caused by the concurrent administrator update.
			assert.match(updates[1].result.content[0].text, /does not have the .* privilege/);
			assert.match(updates[2].result.content[0].text, /Invalid API Key/);
			assert.equal((await fetch(url)).status, 401);
			assert.equal((await invoke('get_event', { id: eventID })).event.notes, 'HTTP admin update');
		}
		finally { await service.close(); }
		
		await invoke('delete_event', { id: eventID });
		assert.equal((await invoke('get_job', { id: jobID })).job.id, jobID, 'Event deletion retains historical jobs');
		assert.equal((await client.call('get_event', { id: eventID })).result.isError, true);
	}
	finally {
		// Cleanup is allowed to delete only IDs owned by this test invocation.
		const errors = [];
		for (const id of jobs) {
			try {
				const { job } = await call('getJob', { id });
				if (!job.final) { await call('abortJob', { id }); await finished(id); }
				await call('deleteJob', { id });
			}
			catch (err) { errors.push(err); }
		}
		try { await cleanupFixtures([
			{ list: 'events', method: 'deleteEvent', match: item => item.id === eventID },
			{ list: 'api_keys', method: 'deleteApiKey', match: item => item.id === keyID }
		]); }
		catch (err) { errors.push(err); }
		if (errors.length) throw new AggregateError(errors, 'MCP fixture cleanup failed');
	}
});
