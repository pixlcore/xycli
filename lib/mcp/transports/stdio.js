// The SDK exclusively owns stdin/stdout. Diagnostics always use stderr.
const { serveStdio, StdioServerTransport } = require('@modelcontextprotocol/server/stdio');

module.exports = function startStdio(factory, options) {
	const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: options.max_request_bytes });
	return serveStdio(factory, { transport, maxSubscriptions: 0, onerror: () => options.log('MCP protocol error on stdin.') });
};
