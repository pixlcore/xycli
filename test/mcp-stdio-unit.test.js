const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { httpRPC, stdioClient } = require('./helpers/mcp.js');

test('STDIO uses the real CLI and SDK with protocol-only stdout and clean EOF', async t => {
	let calls = 0;
	const backend = http.createServer((request, response) => {
		calls++;
		assert.equal(request.headers['x-api-key'], 'fixture-key');
		assert.ok(request.url.startsWith('/api/app/get_event/v1'));
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify({ code: 0, event: { id: 'fixture', revision: 2 } }));
	});
	await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => { backend.close(resolve); backend.closeAllConnections(); }));
	const client = stdioClient(t, { XYOPS_BASE_URL: 'http://127.0.0.1:' + backend.address().port, XYOPS_API_KEY: 'fixture-key', XYOPS_RETRIES: '4' }, ['mcp', 'stdio', '--verbose', '--debug', '--read-only']);
	assert.ok((await client.initialize()).result);
	const listing = await client.request('tools/list');
	assert.equal(listing.result.tools.length, 8);
	assert.equal((await client.call('get_event', { id: 'fixture' })).result.structuredContent.event.revision, 2);
	assert.equal(calls, 1);
	const rejected = await client.call('run_event', { id: 'fixture' });
	assert.ok(rejected.error || rejected.result.isError);
	assert.equal(calls, 1);
	client.child.stdin.end();
	const [code] = await client.exit;
	assert.equal(code, 0);
	assert.ok(client.lines.every(line => JSON.parse(line).jsonrpc === '2.0'));
	assert.ok(!client.stderr().includes('fixture-key'));
});

test('named HTTP options and local help do not contact xyOps', () => {
	for (const args of [['mcp', 'serve', '--help'], ['mcp', '--help']]) {
		const response = spawnSync(process.execPath, ['index.js', ...args], { encoding: 'utf8', env: { ...process.env, XYOPS_API_KEY: '', XYOPS_BASE_URL: '' } });
		assert.equal(response.status, 0);
		assert.match(response.stdout, /--port 8080/);
	}
	const response = spawnSync(process.execPath, ['index.js', 'mcp', 'serve', '8080'], { encoding: 'utf8' });
	assert.equal(response.status, 1);
	assert.equal(response.stdout, '');
	assert.match(response.stderr, /--port/);
});

for (const { host, urlHost } of [{ host: '127.0.0.1', urlHost: '127.0.0.1' }, { host: '::1', urlHost: '[::1]' }]) {
	test('HTTP CLI starts and shuts down on ' + host, { timeout: 15000 }, async t => {
		// Reserve an available port before launching the actual CLI process. Tool
		// calls use the real SDK with no process-wide API key configured.
		const backend = http.createServer((request, response) => {
			response.setHeader('Content-Type', 'application/json');
			const id = new URL(request.url, 'http://fixture').searchParams.get('id');
			assert.equal(request.headers['x-api-key'], id + '-key');
			response.end(JSON.stringify({ code: 0, event: { id } }));
		});
		await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
		t.after(() => new Promise(resolve => { backend.close(resolve); backend.closeAllConnections(); }));
		const reservation = http.createServer();
		try {
			await new Promise((resolve, reject) => {
				reservation.once('error', reject);
				reservation.listen(0, host, resolve);
			});
		}
		catch (err) {
			// Some test hosts have IPv6 disabled. Skip only that explicit case.
			if (host === '::1' && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(err.code)) return t.skip('IPv6 loopback unavailable');
			throw err;
		}
		const port = reservation.address().port;
		await new Promise(resolve => reservation.close(resolve));
		const client = stdioClient(t, {
			XYOPS_BASE_URL: 'http://127.0.0.1:' + backend.address().port, XYOPS_API_KEY: '',
			XYOPS_MCP: JSON.stringify({ host: '127.0.0.1' })
		}, ['mcp', 'serve', '--host', host, '--port', String(port), '--read-only']);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('HTTP startup timeout: ' + client.stderr())), 10000);
			client.child.stderr.on('data', () => {
				if (client.stderr().includes('Listening at ')) { clearTimeout(timer); resolve(); }
			});
			client.exit.then(() => { clearTimeout(timer); reject(new Error('CLI exited before startup: ' + client.stderr())); });
		});
		const url = 'http://' + urlHost + ':' + port + '/mcp';
		assert.ok(client.stderr().includes('Listening at ' + url));
		const listing = await httpRPC(url, 'tools/list', {}, {
			modern: true, headers: { Authorization: 'Bearer fixture-token' }
		});
		assert.equal(listing.result.tools.length, 8);
		assert.equal((await fetch(url)).status, 401);
		// Binding IPv6 must not weaken the Host allowlist.
		const rejectedHost = await new Promise((resolve, reject) => {
			const req = http.get(url, { headers: { Host: 'evil.example', Authorization: 'Bearer fixture-key' } }, response => {
				response.resume();
				resolve(response.statusCode);
			});
			req.on('error', reject);
		});
		assert.equal(rejectedHost, 403);
		const replies = await Promise.all(['first', 'second'].map((id, index) => httpRPC(url, 'tools/call', {
			name: 'get_event', arguments: { id }
		}, { modern: !!index, headers: { Authorization: 'Bearer ' + id + '-key' } })));
		assert.deepEqual(replies.map(reply => reply.result.structuredContent.event.id), ['first', 'second']);
		client.child.kill('SIGTERM');
		const [code, signal] = await client.exit;
		assert.equal(code, 0);
		assert.equal(signal, null);
		assert.deepEqual(client.lines, []);
	});
}

test('ticket and monitoring tools use real SDK routes and validated STDIO inputs', async t => {
	const requests = [];
	const backend = http.createServer((request, response) => {
		let body = '';
		request.on('data', chunk => { body += chunk; });
		request.on('end', () => {
			const url = new URL(request.url, 'http://fixture');
			const name = url.pathname.split('/')[3];
			const params = body ? JSON.parse(body) : Object.fromEntries(url.searchParams);
			requests.push({ name, method: request.method, params });
			assert.equal(request.headers['x-api-key'], 'fixture-key');
			assert.match(request.headers['user-agent'], /xyOps MCP/);
			let result = { code: 0 };
			switch (name) {
				case 'create_ticket':
				case 'update_ticket':
				case 'add_ticket_change':
					result.ticket = { id: 't1', num: 1, subject: 'Test', status: params.status || 'open', changes: params.change ? [{ ...params.change, id: 'c1', username: 'fixture-key', date: 123 }] : [] };
					break;
				case 'delete_ticket': break;
				case 'create_snapshot':
				case 'create_group_snapshot': result.id = 'sn1'; break;
				case 'get_active_servers': result.rows = [{ id: 's1', hostname: 'worker', groups: ['main'], enabled: true }]; result.list = { length: 1 }; break;
				case 'search_alerts':
				case 'search_snapshots': result.rows = [{ id: 'record1' }]; result.list = { length: 1 }; break;
				default: result = { code: 'test', description: 'Unexpected route ' + name };
			}
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify(result));
		});
	});
	await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => { backend.close(resolve); backend.closeAllConnections(); }));
	const client = stdioClient(t, { XYOPS_BASE_URL: 'http://127.0.0.1:' + backend.address().port, XYOPS_API_KEY: 'fixture-key', XYOPS_MCP: '{}' });
	await client.initialize();
	const listing = await client.request('tools/list');
	assert.equal(listing.result.tools.length, 17);
	const invoke = async (name, args) => {
		const reply = await client.call(name, args);
		assert.ok(reply.result && !reply.result.isError, JSON.stringify(reply));
		return reply.result.structuredContent;
	};
	assert.equal((await invoke('create_ticket', { ticket: { subject: 'Test', body: '**Markdown**' } })).ticket.id, 't1');
	assert.deepEqual(requests.at(-1), { name: 'create_ticket', method: 'POST', params: { subject: 'Test', body: '**Markdown**' } });
	await invoke('update_ticket', { id: 't1', changes: { status: 'closed', assignees: [] } });
	assert.deepEqual(requests.at(-1).params, { id: 't1', status: 'closed', assignees: [] });
	assert.equal((await invoke('comment_ticket', { id: 't1', body: 'Comment' })).comment.username, 'fixture-key');
	assert.deepEqual(requests.at(-1).params, { id: 't1', change: { type: 'comment', body: 'Comment' } });
	assert.equal((await invoke('delete_ticket', { id: 't1' })).deleted, true);
	await invoke('search_alerts', { query: 'active:true server:s1', limit: 2 });
	assert.deepEqual(requests.at(-1), { name: 'search_alerts', method: 'GET', params: { query: 'active:true server:s1', offset: '0', limit: '2', sort_by: '_id', sort_dir: '-1' } });
	await invoke('search_snapshots', {});
	assert.ok(!('verbose' in requests.at(-1).params));
	await invoke('search_snapshots', { verbose: true, limit: 1 });
	assert.equal(requests.at(-1).params.verbose, '1');
	assert.equal((await invoke('list_servers', { group: 'main' })).rows[0].id, 's1');
	await invoke('take_snapshot', { server: 's1' });
	assert.deepEqual(requests.at(-1), { name: 'create_snapshot', method: 'POST', params: { server: 's1' } });
	await invoke('take_snapshot', { group: 'main' });
	assert.deepEqual(requests.at(-1), { name: 'create_group_snapshot', method: 'POST', params: { group: 'main' } });
	
	// Validate through the registered protocol schema as well as the registry.
	const count = requests.length;
	for (const [name, args] of [
		['take_snapshot', {}], ['take_snapshot', { server: 's1', group: 'main' }],
		['create_ticket', { ticket: { subject: 'Test', username: 'admin' } }],
		['comment_ticket', { id: 't1', body: ' ' }]
	]) {
		const reply = await client.call(name, args);
		assert.ok(reply.error || reply.result.isError, name);
	}
	assert.equal(requests.length, count);
	client.child.stdin.end();
	assert.equal((await client.exit)[0], 0);
});
