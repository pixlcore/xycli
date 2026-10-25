// Thin Node listener: do not read or parse the body before the MCP adapter.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const { createMcpHandler } = require('@modelcontextprotocol/server');
const { toNodeHandler, hostHeaderValidation } = require('@modelcontextprotocol/node');

module.exports = async function startHTTP(factory, options) {
	// Check only the header shape here. xyOps validates the key and enforces
	// privileges when the tool calls its API; there is no separate MCP secret.
	function bearerKey(authorization) {
		return /^Bearer +([A-Za-z0-9._~+\/-]+=*)$/i.exec(authorization || '')?.[1];
	}
	const handler = createMcpHandler(request => {
		const apiKey = bearerKey(request.requestInfo.headers.get('authorization'));
		if (!apiKey) throw new Error('Missing xyOps API key.');
		return factory({ apiKey });
	}, {
		// Auto returns JSON for ordinary calls and preserves streamed messages
		// if a future tool needs progress notifications during its response.
		responseMode: 'auto', maxRequestBodySize: options.max_request_bytes,
		maxSubscriptions: 0, onerror: () => options.log('MCP protocol error on HTTP request.')
	});
	const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: options.max_request_bytes, onerror: () => options.log('MCP HTTP adapter error.') });
	const validateHost = hostHeaderValidation(options.allowed_hosts);
	
	function respond(response, status, text) {
		response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
		response.end(text);
	}
	
	function request(request, response) {
		// Route before dispatch. The SDK owns protocol method/status semantics.
		if (request.url.split('?')[0] !== '/mcp') return respond(response, 404, 'Not found');
		if (!validateHost(request, response)) return;
		const origin = request.headers.origin;
		if (origin && !options.allowed_origins.includes(origin)) return respond(response, 403, 'Origin not allowed');
		if (!bearerKey(request.headers.authorization)) {
			response.setHeader('WWW-Authenticate', 'Bearer');
			return respond(response, 401, 'Supply a xyOps API key as a Bearer token');
		}
		response.setHeader('Cache-Control', 'no-store');
		nodeHandler(request, response).catch(function() {
			options.log('MCP HTTP request failed.');
			if (!response.headersSent) respond(response, 500, 'Internal server error');
			else response.destroy();
		});
	}
	
	const server = options.tls_cert ? https.createServer({ cert: fs.readFileSync(options.tls_cert), key: fs.readFileSync(options.tls_key) }, request) : http.createServer(request);
	server.requestTimeout = 30000;
	server.headersTimeout = 15000;
	server.maxConnections = 100;
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port, options.host, function() {
			server.removeListener('error', reject);
			resolve();
		});
	});
	
	let closing;
	return {
		address: server.address(),
		close() {
			// Stop new requests first, then cancel MCP exchanges and close sockets.
			if (!closing) closing = (async function() {
				const closed = new Promise(resolve => server.close(resolve));
				await handler.close();
				server.closeAllConnections();
				await closed;
			})();
			return closing;
		}
	};
};
