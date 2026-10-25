// Both transports register the same descriptions and invoke the same modules.
const { McpServer } = require('@modelcontextprotocol/server');
const { result, failure } = require('./results.js');
const { checkKeys } = require('./context.js');
const pkg = require('../../package.json');

module.exports = function serverFactory(tools, context) {
	return function buildServer({ apiKey } = {}) {
		// STDIO uses the configured context. HTTP supplies a key for each
		// exchange, shared by all API calls made by that exchange's tools.
		const scoped = apiKey === undefined ? context : context.withApiKey(apiKey);
		const server = new McpServer({ name: 'xyops', version: pkg.version });
		for (const tool of tools.values()) {
			const { name, ...description } = tool.description;
			if (scoped.readOnly && !description.annotations.readOnlyHint) continue;
			server.registerTool(name, { ...description, inputSchema: tool.inputSchema }, async function(args, request) {
				try {
					checkKeys(args);
					const invocation = { ...scoped, signal: request.mcpReq.signal };
					invocation.callAPI = (name, params) => scoped.callAPI(name, params, invocation.signal);
					return result(await tool.run(args, invocation), scoped.limits.max_result_bytes);
				}
				catch (err) { return failure(err, scoped.redact); }
			});
		}
		return server;
	};
};
