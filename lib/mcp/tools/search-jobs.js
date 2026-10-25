const S = require('../schemas.js');

exports.describe = () => S.describe('search_jobs', 'Search completed jobs, newest first by default. Query examples: tags:_error, event:EVENT_ID, or date:>=2026-01-01 date:<2027-01-01. Combine terms with spaces. Running jobs are available through get_job. Results respect API-key category and group restrictions.', {
	...S.pagination, query: S.text, sort_by: { type: 'string', enum: ['_id', 'completed', 'elapsed'] }, sort_dir: { type: 'integer', enum: [1, -1] }
});

exports.run = async function(args, context) {
	const { offset, limit } = S.page(args, context);
	const fields = ['id', 'event', 'title', 'category', 'plugin', 'code', 'description', 'completed', 'elapsed'];
	const data = await context.callAPI('search_jobs', { query: args.query || '*', offset, limit, sort_by: args.sort_by || '_id', sort_dir: args.sort_dir ?? -1, select: fields.join(',') });
	return { rows: data.rows.map(job => S.pick(job, fields)), total: data.list.length, offset, limit };
};
