const S = require('../schemas.js');

exports.describe = () => S.describe('update_event', 'Update an event using the revision returned by get_event. Omitted fields are preserved. Supplied nested objects and arrays replace existing values, so include all values you want to keep. Event type cannot be changed. A stale revision is rejected.', {
	id: S.id, revision: { type: 'integer', minimum: 1 }, changes: { ...S.input(S.eventProperties), minProperties: 1 }
}, ['id', 'revision', 'changes'], false);

exports.run = async function(args, context) {
	// Submit a partial update with the caller's revision. Do not fetch and merge
	// the entire record, which could overwrite changes made by another caller.
	const { event } = await context.callAPI('update_event', { ...args.changes, id: args.id, revision: args.revision });
	return { event: S.pick(event, ['id', 'title', 'enabled', 'revision']) };
};
