// Handwritten public contracts, independent of the underlying API inventory.
const id = { type: 'string', pattern: '^[a-z0-9_]+$', description: 'Exact xyOps ID; use a list tool to discover IDs.' };
const text = { type: 'string' };
const object = { type: 'object', additionalProperties: true };
const objects = { type: 'array', items: object };
const strings = { type: 'array', items: text };
const pagination = {
	offset: { type: 'integer', minimum: 0, default: 0 },
	limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }
};
const workflow = {
	type: 'object', required: ['nodes', 'connections'], additionalProperties: false,
	properties: {
		nodes: { ...objects, description: 'Workflow nodes, each with id, type and type-specific settings. Inspect an existing workflow for examples.' },
		connections: { ...objects, description: 'Directed workflow connections between node IDs.' },
		start: text
	}
};
const eventProperties = {
	title: { type: 'string', pattern: '\\S' }, enabled: { type: 'boolean' }, category: id,
	plugin: id, targets: strings, algo: { ...text, description: 'Server selection algorithm, such as random, round_robin or least_cpu.' },
	params: { ...object, description: 'Plugin parameters. A supplied object replaces the saved parameter object on update.' },
	fields: objects, triggers: { ...objects, description: 'Trigger definitions. For manual execution use {type: "manual", enabled: true}.' },
	actions: objects, limits: objects, tags: strings, notes: text, icon: text,
	expression: text, workflow
};

function input(properties, required = []) {
	return { type: 'object', properties, required, additionalProperties: false };
}

function describe(name, description, properties, required = [], readOnly = true) {
	return {
		name, description, inputSchema: input(properties, required),
		annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true }
	};
}

function page(args, context) {
	return { offset: args.offset ?? 0, limit: Math.min(args.limit ?? 25, context.limits.max_page_size) };
}

function pick(value, fields) {
	return Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}

module.exports = { id, text, object, objects, strings, pagination, eventProperties, input, describe, page, pick };
