const S = require('../schemas.js');

exports.describe = () => S.describe('run_event', 'Launch an enabled event or workflow with a manual trigger. Optional params override declared event parameters; input.data passes input data. Returns immediately with a job ID. Use get_job to follow completion. Repeating this call starts another job.', {
	id: S.id, params: S.object, input: S.input({ data: {} })
}, ['id'], false);

exports.run = async function(args, context) {
	const data = await context.callAPI('run_event', args);
	return { id: data.id, started: true };
};
