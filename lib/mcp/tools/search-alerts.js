const S = require('../schemas.js');

exports.describe = () => S.describe('search_alerts', 'Search active or historical alert invocations, not alert definitions. Query examples: active:true, alert:ALERT_ID, server:SERVER_ID, groups:GROUP_ID, or start:>=today. Combine terms with spaces. Newest first by default; xyOps applies API-key restrictions.', {
	...S.pagination, query: S.text, sort_by: S.text, sort_dir: { type: 'integer', enum: [1, -1] }
});

exports.run = async function(args, context) {
	// Keep the query intact so xyOps owns parsing and permission filtering.
	const { offset, limit } = S.page(args, context);
	const data = await context.callAPI('search_alerts', { query: args.query || '*', offset, limit, sort_by: args.sort_by || '_id', sort_dir: args.sort_dir ?? -1 });
	return { rows: data.rows, total: data.list.length, offset, limit };
};
