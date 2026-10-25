// Load only the bundled tools. Helpers belong outside the tools directory.
const fs = require('node:fs');
const Path = require('node:path');
const { fromJsonSchema } = require('@modelcontextprotocol/server');

module.exports = function loadTools(directory = Path.join(__dirname, 'tools')) {
	const tools = new Map();
	
	for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.js')).sort()) {
		const tool = require(Path.join(directory, file));
		if (typeof tool.describe !== 'function' || typeof tool.run !== 'function') {
			throw new Error('Invalid MCP tool exports: ' + file);
		}
		const description = tool.describe();
		if (!description || !/^[a-z][a-z0-9_]*$/.test(description.name) || !description.description ||
			!description.inputSchema || description.inputSchema.type !== 'object' ||
			typeof description.annotations?.readOnlyHint !== 'boolean') {
			throw new Error('Invalid MCP tool description: ' + file);
		}
		if (tools.has(description.name)) throw new Error('Duplicate MCP tool: ' + description.name);
		
		// Compile once, rather than rebuilding validators for each HTTP request.
		const inputSchema = fromJsonSchema(description.inputSchema);
		tools.set(description.name, { ...tool, description, inputSchema });
	}
	return tools;
};
