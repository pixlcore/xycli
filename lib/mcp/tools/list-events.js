const S = require('../schemas.js');

exports.describe = () => S.describe('list_events', 'Find events and workflows. Returns summaries, not full definitions. Title is a case-insensitive substring. Pagination is applied locally after fetching authorized events.', {
	...S.pagination, title: S.text, category: S.id, type: { type: 'string', enum: ['event', 'workflow'] }, enabled: { type: 'boolean' }
});

exports.run = async function(args, context) {
	const data = await context.callAPI('get_events');
	const rows = data.rows.filter(event =>
		(!args.title || event.title.toLowerCase().includes(args.title.toLowerCase())) &&
		(!args.category || event.category === args.category) &&
		(!args.type || (event.type || 'event') === args.type) &&
		(args.enabled === undefined || !!event.enabled === args.enabled)
	).sort((a, b) => a.id.localeCompare(b.id));
	const { offset, limit } = S.page(args, context);
	return { rows: rows.slice(offset, offset + limit).map(event => S.pick(event, ['id', 'title', 'type', 'category', 'plugin', 'enabled', 'revision'])), total: rows.length, offset, limit };
};
