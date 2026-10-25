// Small wire-level MCP clients keep the tests independent of another SDK dep.
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const readline = require('node:readline');
const Path = require('node:path');

async function decode(response) {
	const body = await response.text();
	if (response.headers.get('content-type')?.includes('text/event-stream')) {
		const line = body.split('\n').find(line => line.startsWith('data: '));
		return JSON.parse(line.slice(6));
	}
	return JSON.parse(body);
}

async function httpRPC(url, method, params = {}, options = {}) {
	const modern = options.modern;
	if (modern) params = { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } };
	const response = await fetch(url, {
		method: 'POST', signal: AbortSignal.timeout(10000),
		headers: {
			'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
			...(modern ? { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(params.name ? { 'Mcp-Name': params.name } : {}) } : {}),
			...options.headers
		}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	});
	return decode(response);
}

function stdioClient(t, env = {}, args = ['mcp', 'stdio']) {
	const child = spawn(process.execPath, [Path.resolve(__dirname, '../../index.js'), ...args], {
		stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env }
	});
	let stderr = '';
	const lines = [];
	const pending = new Map();
	let id = 0;
	child.stderr.on('data', data => { stderr += data; });
	const exit = once(child, 'exit');
	const reader = readline.createInterface({ input: child.stdout });
	reader.on('line', line => {
		lines.push(line);
		let message;
		try { message = JSON.parse(line); }
		catch (err) {
			for (const call of pending.values()) call.reject(new Error('Non-JSON stdout: ' + line));
			return;
		}
		pending.get(message.id)?.resolve(message);
	});
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
		await exit;
	});
	
	return {
		child, lines, exit, stderr: () => stderr,
		request(method, params = {}) {
			const requestId = ++id;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('MCP response timeout: ' + method + '; ' + stderr)); }, 10000);
				pending.set(requestId, {
					resolve(value) { clearTimeout(timer); pending.delete(requestId); resolve(value); },
					reject(error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
				});
				child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
			});
		},
		async initialize() {
			return this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'xycli-test', version: '1' } });
		},
		async call(name, args) {
			return this.request('tools/call', { name, arguments: args });
		}
	};
}

module.exports = { decode, httpRPC, stdioClient };
