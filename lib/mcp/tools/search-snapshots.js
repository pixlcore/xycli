const S = require('../schemas.js');

exports.describe = () => S.describe('search_snapshots', 'Search server or group snapshots. Query examples: type:server, type:group, server:SERVER_ID, groups:GROUP_ID, source:alert, or date:>=today. Newest first by default. Heavy process, connection and group details are omitted unless verbose is true; use small pages for verbose results.', {
	...S.pagination, query: S.text, sort_by: S.text, sort_dir: { type: 'integer', enum: [1, -1] }, verbose: { type: 'boolean', default: false }
});

exports.run = async function(args, context) {
	// The API prunes heavy nested fields by default while retaining metrics.
	const { offset, limit } = S.page(args, context);
	const data = await context.callAPI('search_snapshots', { query: args.query || '*', offset, limit, sort_by: args.sort_by || '_id', sort_dir: args.sort_dir ?? -1, verbose: args.verbose ?? false });
	return { rows: data.rows, total: data.list.length, offset, limit };
};
