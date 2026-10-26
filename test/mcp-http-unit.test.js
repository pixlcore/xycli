const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const Path = require('node:path');
const { configuration } = require('../lib/mcp.js');
const { createContext } = require('../lib/mcp/context.js');
const factory = require('../lib/mcp/server.js');
const start = require('../lib/mcp/transports/http.js');
const tools = require('../lib/mcp/registry.js')();
const { httpRPC } = require('./helpers/mcp.js');

test('HTTP serves both protocol generations, validates calls and rejects unauthorized access', async t => {
	let calls = 0;
	const context = createContext({ get_event: async (params, options) => { calls++; assert.equal(options.headers['X-API-Key'], 'test-token'); return { data: { code: 0, event: { id: params.id, revision: 1 } } }; } }, { read_only: true, api_key: 'server-key-must-not-be-used' });
	const options = { ...configuration({}, {}), port: 0, log() {} };
	const service = await start(factory(tools, context), options);
	t.after(() => service.close());
	const url = 'http://127.0.0.1:' + service.address.port + '/mcp';
	const headers = { Authorization: 'Bearer test-token' };
	for (const authorization of ['', 'Basic abc', 'Bearer', 'Bearer ', 'Bearer key extra']) {
		assert.equal((await fetch(url, { headers: { Authorization: authorization } })).status, 401);
	}
	assert.equal(calls, 0);
	assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
	assert.equal((await fetch(url + '/other', { headers })).status, 404);
	
	for (const modern of [false, true]) {
		const listing = await httpRPC(url, 'tools/list', {}, { headers, modern });
		assert.equal(listing.result.tools.length, 8);
		assert.ok(listing.result.tools.every(tool => tool.annotations.readOnlyHint));
		const response = await httpRPC(url, 'tools/call', { name: 'get_event', arguments: { id: 'e1' } }, { headers, modern });
		assert.equal(response.result.structuredContent.event.id, 'e1');
	}
	assert.equal(calls, 2);
	const invalid = await httpRPC(url, 'tools/call', { name: 'get_event', arguments: { id: 'bad/id' } }, { headers });
	assert.ok(invalid.error || invalid.result.isError);
	const forbidden = await httpRPC(url, 'tools/call', { name: 'delete_event', arguments: { id: 'e1' } }, { headers });
	assert.ok(forbidden.error || forbidden.result.isError);
	assert.equal(calls, 2);
	const malformed = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{broken' });
	assert.equal(malformed.status, 400);
	// Send the declared size first: the adapter can reject it before reading a
	// body, without racing a megabyte upload against the closed connection.
	const oversizedStatus = await new Promise((resolve, reject) => {
		const req = http.request(url, { method: 'POST', headers: { ...headers, 'Content-Length': options.max_request_bytes + 1 } }, response => {
			response.resume();
			response.on('end', () => { resolve(response.statusCode); req.destroy(); });
		});
		req.on('error', reject);
		req.flushHeaders();
	});
	assert.equal(oversizedStatus, 413);
	
	// Exercise the real Host header instead of trusting URL-only validation.
	const status = await new Promise((resolve, reject) => {
		const req = http.get(url, { headers: { ...headers, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
		req.on('error', reject);
	});
	assert.equal(status, 403);
	await service.close();
});

test('concurrent HTTP tools keep their keys across multiple API calls', async t => {
	const calls = [];
	const context = createContext({ get_event: async (params, options) => {
		assert.equal(options.headers['X-API-Key'], params.id + '-key');
		calls.push(options.headers['X-API-Key']);
		await new Promise(resolve => setTimeout(resolve, params.id === 'slow' ? 25 : 1));
		return { data: { code: 0, event: { id: params.id } } };
	} }, { api_key: 'server-key-must-not-be-used' });
	const custom = new Map(tools);
	const original = tools.get('get_event');
	custom.set('get_event', { ...original, async run(args, invocation) {
		await original.run(args, invocation);
		return original.run(args, invocation);
	} });
	const service = await start(factory(custom, context), { ...configuration({}, {}), port: 0, log() {} });
	t.after(() => service.close());
	const url = 'http://127.0.0.1:' + service.address.port + '/mcp';
	const replies = await Promise.all(['slow', 'fast'].map(id => httpRPC(url, 'tools/call', { name: 'get_event', arguments: { id } }, { headers: { Authorization: 'Bearer ' + id + '-key' } })));
	assert.deepEqual(replies.map(reply => reply.result.structuredContent.event.id), ['slow', 'fast']);
	assert.deepEqual(calls.sort(), ['fast-key', 'fast-key', 'slow-key', 'slow-key']);
});

test('HTTP tool errors redact the requesting client key', async t => {
	const context = createContext({ get_event: async (params, options) => ({
		err: 'Rejected key: ' + options.headers['X-API-Key']
	}) }, { api_key: 'server-default' });
	const service = await start(factory(tools, context), { ...configuration({}, {}), port: 0, log() {} });
	t.after(() => service.close());
	const url = 'http://127.0.0.1:' + service.address.port + '/mcp';
	const response = await httpRPC(url, 'tools/call', { name: 'get_event', arguments: { id: 'fixture' } }, {
		headers: { Authorization: 'Bearer client-secret' }
	});
	assert.equal(response.result.isError, true);
	assert.match(response.result.content[0].text, /\[redacted\]/);
	assert.doesNotMatch(JSON.stringify(response), /client-secret|server-default/);
});

test('HTTPS uses the same handler and verifies the configured certificate', async t => {
	const cert = Path.join(__dirname, 'fixtures/mcp/localhost.crt');
	const key = Path.join(__dirname, 'fixtures/mcp/localhost.key');
	const service = await start(factory(tools, createContext({})), {
		...configuration({}, {}), port: 0, tls_cert: cert, tls_key: key, log() {}
	});
	t.after(() => service.close());
	const response = await new Promise((resolve, reject) => {
		const request = https.request({
			hostname: '127.0.0.1', port: service.address.port, path: '/mcp', method: 'POST',
			ca: fs.readFileSync(cert), headers: { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
		}, response => {
			let body = '';
			response.on('data', chunk => { body += chunk; });
			response.on('end', () => resolve({ status: response.statusCode, body }));
		});
		request.on('error', reject);
		request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
	});
	assert.equal(response.status, 200);
	assert.match(response.body, /create_event/);
});

test('HTTP disconnect cancels the tool context before its next upstream call', async t => {
	let entered;
	const entering = new Promise(resolve => { entered = resolve; });
	let cancelled;
	const cancellation = new Promise(resolve => { cancelled = resolve; });
	let calls = 0;
	const context = createContext({ get_event: async () => { calls++; return { data: { code: 0 } }; } });
	const custom = new Map(tools);
	const original = tools.get('get_event');
	custom.set('get_event', { ...original, async run(args, invocation) {
		entered();
		await new Promise(resolve => invocation.signal.addEventListener('abort', resolve, { once: true }));
		await assert.rejects(invocation.callAPI('get_event', { id: args.id }), /cancelled/);
		cancelled();
		return {};
	} });
	const service = await start(factory(custom, context), { ...configuration({}, {}), port: 0, log() {} });
	t.after(() => service.close());
	const request = http.request({
		hostname: '127.0.0.1', port: service.address.port, path: '/mcp', method: 'POST',
		headers: { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
	});
	request.on('error', () => {});
	request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_event', arguments: { id: 'e1' } } }));
	await entering;
	request.destroy();
	await Promise.race([cancellation, new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Cancellation did not reach the tool')), 2000); timer.unref(); })]);
	assert.equal(calls, 0);
});

test('new HTTP mutations use each client key and read-only mode rejects every write tool', async t => {
	const calls = [];
	const context = createContext({ update_ticket: async (params, options) => {
		const key = options.headers['X-API-Key'];
		calls.push({ key, params });
		if (key === 'restricted-key') return { data: { code: 'access', description: 'Permission denied' } };
		return { data: { code: 0, ticket: { id: params.id, status: params.status } } };
	} }, { api_key: 'server-key' });
	const service = await start(factory(tools, context), { ...configuration({}, {}), port: 0, log() {} });
	t.after(() => service.close());
	const url = 'http://127.0.0.1:' + service.address.port + '/mcp';
	const replies = await Promise.all(['allowed-key', 'restricted-key'].map(key => httpRPC(url, 'tools/call', {
		name: 'update_ticket', arguments: { id: 't1', changes: { status: 'closed' } }
	}, { modern: true, headers: { Authorization: 'Bearer ' + key } })));
	assert.equal(replies[0].result.structuredContent.ticket.status, 'closed');
	assert.equal(replies[1].result.isError, true);
	assert.match(replies[1].result.content[0].text, /Permission denied/);
	assert.deepEqual(calls.map(call => call.key).sort(), ['allowed-key', 'restricted-key']);
	
	let forbiddenCalls = 0;
	const readOnly = createContext(new Proxy({}, { get() { return async () => { forbiddenCalls++; throw new Error('Must not call the SDK'); }; } }), { read_only: true });
	const readonlyService = await start(factory(tools, readOnly), { ...configuration({}, {}), port: 0, log() {} });
	t.after(() => readonlyService.close());
	const readonlyURL = 'http://127.0.0.1:' + readonlyService.address.port + '/mcp';
	const headers = { Authorization: 'Bearer readonly-key' };
	const listing = await httpRPC(readonlyURL, 'tools/list', {}, { headers });
	assert.deepEqual(listing.result.tools.map(tool => tool.name).sort(), ['get_event', 'get_event_options', 'get_job', 'list_events', 'list_servers', 'search_alerts', 'search_jobs', 'search_snapshots']);
	for (const tool of tools.values()) {
		if (tool.description.annotations.readOnlyHint) continue;
		const reply = await httpRPC(readonlyURL, 'tools/call', { name: tool.description.name, arguments: {} }, { headers });
		assert.ok(reply.error || reply.result.isError, tool.description.name);
	}
	assert.equal(forbiddenCalls, 0);
});
