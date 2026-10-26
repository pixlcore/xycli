const S = require('../schemas.js');

exports.describe = () => S.describe('delete_ticket', 'Permanently delete a ticket by exact ID. References from jobs and alerts are cleaned up by xyOps background maintenance.', { id: S.id }, ['id'], false);

exports.run = async function(args, context) {
	await context.callAPI('delete_ticket', { id: args.id });
	return { id: args.id, deleted: true };
};
