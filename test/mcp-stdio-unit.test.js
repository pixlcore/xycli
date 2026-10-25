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
	assert.equal(listing.result.tools.length, 5);
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
		assert.equal(listing.result.tools.length, 5);
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
