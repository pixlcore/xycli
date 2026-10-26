const S = require('../schemas.js');

exports.describe = () => S.describe('list_servers', 'List connected worker servers visible to the API key, excluding offline servers and conductor peers. Returns compact summaries. Hostname is a case-insensitive substring; group is an exact group ID. Filtering and pagination are local.', {
	...S.pagination, hostname: S.text, group: S.id, enabled: { type: 'boolean' }
});

exports.run = async function(args, context) {
	// Use the authorized worker collection, avoiding internal conductor data.
	const data = await context.callAPI('get_active_servers');
	const rows = data.rows.filter(server =>
		(!args.hostname || (server.hostname || '').toLowerCase().includes(args.hostname.toLowerCase())) &&
		(!args.group || (server.groups || []).includes(args.group)) &&
		(args.enabled === undefined || !!server.enabled === args.enabled)
	).sort((a, b) => a.id.localeCompare(b.id));
	const { offset, limit } = S.page(args, context);
	return { rows: rows.slice(offset, offset + limit).map(server => S.pick(server, ['id', 'hostname', 'title', 'ip', 'enabled', 'groups', 'created', 'modified', 'info'])), total: rows.length, offset, limit };
};
