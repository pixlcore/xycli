const S = require('../schemas.js');

exports.describe = () => S.describe('get_event_options', 'Look up categories, target groups and event plugins for creating events. Each collection is paginated. Supply plugin_id to also inspect its parameter definitions.', { ...S.pagination, plugin_id: S.id });

exports.run = async function(args, context) {
	const { offset, limit } = S.page(args, context);
	const output = {};
	// Each API independently enforces the configured key permissions.
	for (const name of ['categories', 'groups', 'plugins']) {
		const data = await context.callAPI('get_' + name);
		const rows = data.rows.filter(item => name !== 'plugins' || item.type === 'event').sort((a, b) => a.id.localeCompare(b.id));
		output[name] = { rows: rows.slice(offset, offset + limit).map(item => S.pick(item, ['id', 'title', 'enabled'])), total: rows.length, offset, limit };
	}
	if (args.plugin_id) {
		const { plugin } = await context.callAPI('get_plugin', { id: args.plugin_id });
		output.plugin = S.pick(plugin, ['id', 'title', 'type', 'params']);
	}
	return output;
};
