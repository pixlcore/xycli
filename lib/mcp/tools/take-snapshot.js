const S = require('../schemas.js');

exports.describe = function() {
	const tool = S.describe('take_snapshot', 'Capture the most recent monitoring data for exactly one server or group. This creates a stored snapshot; it does not start a watch or request a fresh sample. Returns the snapshot ID.', {
		server: S.id, group: S.id
	}, [], false);
	tool.inputSchema.oneOf = [{ required: ['server'] }, { required: ['group'] }];
	return tool;
};

exports.run = async function(args, context) {
	// One public operation dispatches to the appropriate backend API.
	const data = args.server ? await context.callAPI('create_snapshot', { server: args.server }) : await context.callAPI('create_group_snapshot', { group: args.group });
	return { id: data.id, type: args.server ? 'server' : 'group', ...(args.server ? { server: args.server } : { group: args.group }) };
};
