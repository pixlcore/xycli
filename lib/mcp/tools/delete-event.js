const S = require('../schemas.js');

exports.describe = () => S.describe('delete_event', 'Delete an event or workflow by exact ID. Historical jobs are retained. xyOps rejects deletion while jobs for this event are active.', { id: S.id }, ['id'], false);

exports.run = async function(args, context) {
	await context.callAPI('delete_event', { id: args.id });
	return { id: args.id, deleted: true, historical_jobs_retained: true };
};
