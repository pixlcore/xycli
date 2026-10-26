const S = require('../schemas.js');

exports.describe = () => S.describe('create_ticket', 'Create a ticket with a subject and optional Markdown body, assignment and classification. Status defaults to open in xyOps. May send configured ticket notifications. Returns a summary; file attachments and automatic templates are not supported.', {
	ticket: S.input(S.ticketProperties, ['subject'])
}, ['ticket'], false);

exports.run = async function(args, context) {
	// Let xyOps assign the ID, number, author and initial change history.
	const { ticket } = await context.callAPI('create_ticket', { ...args.ticket });
	return { ticket: S.pick(ticket, S.ticketSummary) };
};
