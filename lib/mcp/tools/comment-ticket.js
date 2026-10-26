const S = require('../schemas.js');

exports.describe = () => S.describe('comment_ticket', 'Append a Markdown comment to a ticket by exact ID. xyOps assigns the author and timestamp. May send configured ticket notifications. Returns the ticket summary and new comment.', {
	id: S.id, body: { type: 'string', pattern: '\\S', description: 'Comment body in Markdown.' }
}, ['id', 'body'], false);

exports.run = async function(args, context) {
	// Expose comments only, not arbitrary change-history records or authors.
	const { ticket } = await context.callAPI('add_ticket_change', { id: args.id, change: { type: 'comment', body: args.body } });
	return { ticket: S.pick(ticket, S.ticketSummary), comment: S.pick(ticket.changes.at(-1), ['id', 'type', 'body', 'username', 'date']) };
};
