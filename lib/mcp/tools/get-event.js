const S = require('../schemas.js');

exports.describe = () => S.describe('get_event', 'Read an event or workflow definition before editing it. Pass its revision to update_event. Optional fields limits the returned definition.', { id: S.id, fields: S.strings }, ['id']);

exports.run = async function(args, context) {
	const { event } = await context.callAPI('get_event', { id: args.id });
	return { event: args.fields ? S.pick(event, [...new Set(['id', 'revision', ...args.fields])]) : event };
};
