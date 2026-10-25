const S = require('../schemas.js');

exports.describe = function() {
	const definition = S.input({ ...S.eventProperties, id: S.id, type: { type: 'string', enum: ['event', 'workflow'] } }, ['title', 'enabled', 'category']);
	// A workflow owns its graph; an ordinary event selects a plugin and worker.
	definition.allOf = [{
		if: { properties: { type: { const: 'workflow' } }, required: ['type'] },
		then: { required: ['workflow'] },
		else: { required: ['plugin', 'targets', 'algo'], properties: { targets: { ...S.strings, minItems: 1 } } }
	}];
	return S.describe('create_event', 'Create an event or workflow. Use get_event_options for valid IDs and plugin parameters. Specify enabled explicitly and supply triggers explicitly when needed. Returns the created ID and revision.', { event: definition }, ['event'], false);
};

exports.run = async function(args, context) {
	const { event } = await context.callAPI('create_event', args.event);
	return { event: S.pick(event, ['id', 'title', 'enabled', 'revision']) };
};
