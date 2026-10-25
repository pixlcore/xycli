const S = require('../schemas.js');

exports.describe = () => S.describe('get_job', 'Inspect a running or completed job. Returns status, completion details and output data. Optional fields selects additional job properties. Download tokens are not returned.', { id: S.id, fields: S.strings }, ['id']);

exports.run = async function(args, context) {
	const { job } = await context.callAPI('get_job', { id: args.id });
	return { job: S.pick(job, args.fields ? [...new Set(['id', 'state', 'final', ...args.fields])] : ['id', 'event', 'title', 'state', 'final', 'code', 'description', 'started', 'completed', 'elapsed', 'progress', 'data', 'output']) };
};
