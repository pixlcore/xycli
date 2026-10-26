const S = require('../schemas.js');

exports.describe = () => S.describe('update_ticket', 'Update a ticket by exact ID. Omitted fields are preserved; supplied arrays replace the entire saved list. Tickets have no revision precondition. May send configured ticket notifications. Returns a summary.', {
	id: S.id, changes: { ...S.input(S.ticketProperties), minProperties: 1 }
}, ['id', 'changes'], false);

exports.run = async function(args, context) {
	// Preserve the API partial-update contract without fetching stale fields.
	const { ticket } = await context.callAPI('update_ticket', { ...args.changes, id: args.id });
	return { ticket: S.pick(ticket, S.ticketSummary) };
};
