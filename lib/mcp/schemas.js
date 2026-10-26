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

// Ticket types and statuses are configurable in xyOps, so do not freeze them
// into enums here. Empty category/server strings explicitly clear a link.
const ticketProperties = {
	subject: { type: 'string', pattern: '\\S' },
	body: { ...text, description: 'Ticket body in Markdown.' },
	type: { ...text, minLength: 1, description: 'Configured ticket type, such as issue or question.' },
	status: { ...text, minLength: 1, description: 'Configured ticket status, such as open, closed or draft.' },
	category: { type: 'string', pattern: '^[a-z0-9_]*$' },
	server: { type: 'string', pattern: '^[a-z0-9_]*$' },
	assignees: { ...strings, description: 'Assignee usernames. Replaces the entire list.' },
	cc: { ...strings, description: 'Usernames to receive ticket updates. Replaces the entire list.' },
	notify: { ...strings, description: 'Email addresses to receive ticket updates. Replaces the entire list.' },
	tags: { ...strings, description: 'Existing tag IDs. Replaces the entire list.' },
	// xyOps interprets small positive values as relative offsets. Accept only
	// absolute dates here, plus zero to remove the due date.
	due: { type: 'integer', anyOf: [{ const: 0 }, { minimum: 315532800 }], description: 'Absolute Unix timestamp in seconds (1980 or later), or 0 to clear.' }
};
const ticketSummary = ['id', 'num', 'subject', 'type', 'status', 'category', 'server', 'assignees', 'cc', 'notify', 'tags', 'due', 'created', 'modified'];

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

module.exports = { id, text, object, objects, strings, pagination, eventProperties, ticketProperties, ticketSummary, input, describe, page, pick };
