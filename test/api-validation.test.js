const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const utils = require('../lib/utils.js');
const { loadTestConfig, createCheck, createTempDir, xy, json, call, cleanupFixtures } = require('./helpers/common.js');

function createValidationContext() {
	// The production app mixes every utility into one object.  Reproduce only the
	// fatal-error behavior needed to exercise the validator without starting CLI.
	return {
		...utils,
		die(message) { throw new Error(message); }
	};
}

test('Levenshtein distance handles edits and empty strings', () => {
	assert.equal(utils.getLevenshteinDistance('notes', 'notess'), 1);
	assert.equal(utils.getLevenshteinDistance('kitten', 'sitting'), 3);
	assert.equal(utils.getLevenshteinDistance('title', 'titel'), 2);
	assert.equal(utils.getLevenshteinDistance('', 'event'), 5);
	assert.equal(utils.getLevenshteinDistance('plugin', 'plugin'), 0);
});

test('closest string suggestions require one unambiguous nearby match', () => {
	assert.equal(utils.findClosestString('notess', ['id', 'title', 'notes']), 'notes');
	assert.equal(utils.findClosestString('titel', ['id', 'title', 'notes']), 'title');
	assert.equal(utils.findClosestString('completely_unknown', ['id', 'title', 'notes']), '');
	assert.equal(utils.findClosestString('a', ['b', 'c']), '');
});

test('body arguments always remain opaque strings', t => {
	loadTestConfig();
	const temp = createTempDir(t, 'xycli-body-arg-test-');
	const body = '{\n\t"message": "opaque JSON text"\n}\n';
	const file = Path.join(temp, 'body.json');
	fs.writeFileSync(file, body);

	assert.equal(json(['api', 'unused', '--body', body, '--dry']).body, body);
	assert.equal(json(['api', 'unused', '--body', '@-', '--dry'], { input: body }).body, body);
	assert.equal(json(['api', 'unused', '--body', '@' + file, '--dry']).body, body);
});

test('standard API validation accepts documented and request-only properties', () => {
	const context = createValidationContext();
	const requests = {
		createAlert: { title: 'Alert', expression: '1', message: 'Yes', exclusive_actions: true },
		updateApiKey: { id: 'key', max_per_sec: 5, description: 'Build key' },
		createBucket: { title: 'Bucket', data: { arbitrary_nested_key: true } },
		updateCategory: { id: 'category', actions: [{ arbitrary_nested_key: true }] },
		createChannel: { title: 'Channel', max_per_day: 10 },
		updateEvent: { id: 'event', params: { notess: 'Nested keys are allowed' }, update_state: { cursor: 1234 } },
		createMonitor: { title: 'Monitor', source: 'cpu.currentLoad', divide_by_delta: true },
		updatePlugin: { id: 'plugin', marketplace: { id: 'author/repo', version: 'v1.0.0' } },
		createSecret: { title: 'Vault', fields: [{ name: 'TOKEN', value: 'Opaque nested value' }], web_hooks: ['hook'] },
		updateTag: { id: 'tag', icon: 'tag-outline', notes: 'Tag notes' },
		createTicket: { subject: 'Ticket', status: 'draft', body: '{ "opaque": true }', assignees: ['admin'] },
		createWebHook: { title: 'Hook', url: 'https://example.com', method: 'POST', headers: [{ name: 'X-Test', value: 'yes' }] }
	};
	
	Object.entries(requests).forEach( ([method, request]) => {
		assert.doesNotThrow(() => context.validateStandardAPIRequest(method, request), method);
	});
	
	// APIs outside the create/update CRUD rules retain normal pass-through behavior.
	assert.doesNotThrow(() => context.validateStandardAPIRequest('runEvent', { arbitrary: true }));
});

test('standard API validation rejects unknown properties with careful suggestions', () => {
	const context = createValidationContext();
	assert.throws(
		() => context.validateStandardAPIRequest('updateEvent', { id: 'event', notess: 'Typo' }),
		/Unsupported property for update_event: "notess"\. Did you mean "notes"\?/
	);
	assert.throws(
		() => context.validateStandardAPIRequest('createPlugin', { title: 'Plugin', completely_unknown: true }),
		/^Error: Unsupported property for create_plugin: "completely_unknown"\.$/
	);
	assert.throws(
		() => context.validateStandardAPIRequest('updateEvent', { id: 'event', sync: true }),
		/Unsupported property for update_event: "sync"\./
	);
	assert.throws(
		() => context.validateStandardAPIRequest('updateSecret', { id: 'vault', notess: 'Typo' }),
		/Unsupported property for update_secret: "notess"\. Did you mean "notes"\?/
	);
	assert.throws(
		() => context.validateStandardAPIRequest('createTag', { title: 'Tag', notess: 'Typo' }),
		/Unsupported property for create_tag: "notess"\. Did you mean "notes"\?/
	);
	assert.throws(
		() => context.validateStandardAPIRequest('updateTicket', { id: 'ticket', subjec: 'Typo' }),
		/Unsupported property for update_ticket: "subjec"\. Did you mean "subject"\?/
	);
	assert.throws(
		() => context.validateStandardAPIRequest('updateWebHook', { id: 'hook', notess: 'Typo' }),
		/Unsupported property for update_web_hook: "notess"\. Did you mean "notes"\?/
	);
});

test('event CLI rejects phantom top-level properties before persistence', async t => {
	loadTestConfig();
	const check = createCheck(t);
	const stamp = Date.now();
	const prefix = 'cli_api_validation_' + stamp;
	const invalidID = prefix + '_invalid';
	const eventID = prefix + '_event';
	const title = 'CLI API Validation ' + stamp;
	const eventIDs = new Set([invalidID, eventID]);
	
	try {
		const multiple = await call('getMultiple', { lists: 'all' });
		const category = multiple.categories[0];
		const plugin = multiple.plugins.find( plugin => plugin.type == 'event' );
		const group = multiple.groups[0];
		assert.ok(category && plugin && group, 'Category, Event Plugin and server group required');
		
		const baseArgs = [
			'--title', title, '--enabled', 'false', '--category', category.id,
			'--plugin', plugin.id, '--targets', JSON.stringify([group.id]), '--triggers', '[]',
			'--params.seed', 'Original value'
		];
		
		await check('create typo is rejected with a suggestion', () => {
			const output = xy(['event', 'create', '--id', invalidID, ...baseArgs, '--notess', 'Typo'], { fail: true });
			assert.match(output, /Unsupported property for create_event: "notess"\. Did you mean "notes"\?/);
		});
		
		await check('rejected create persists nothing', async () => {
			const rows = (await call('getEvents', {})).rows;
			assert.ok(!rows.some(event => event.id == invalidID));
		});
		
		xy(['event', 'create', '--id', eventID, ...baseArgs, '--notes', 'Original notes']);
		await call('updateEvent', { id: eventID, future_property: { enabled: true } });
		
		await check('update typo is rejected with a suggestion', () => {
			const output = xy(['event', 'update', eventID, '--notess', 'Replacement notes'], { fail: true });
			assert.match(output, /Unsupported property for update_event: "notess"\. Did you mean "notes"\?/);
		});
		
		await check('rejected update leaves the stored event clean', () => {
			const event = json(['event', eventID]);
			assert.equal(event.notes, 'Original notes');
			assert.ok(!Object.prototype.hasOwnProperty.call(event, 'notess'));
			assert.deepEqual(event.future_property, { enabled: true });
		});
		
		await check('sparse update ignores and preserves future server properties', () => {
			xy(['event', 'update', eventID, '--notes', 'Replacement notes']);
			const event = json(['event', eventID]);
			assert.equal(event.notes, 'Replacement notes');
			assert.deepEqual(event.future_property, { enabled: true });
		});
		
		await check('nested arbitrary properties preserve their saved siblings', () => {
			const request = json(['event', 'update', eventID, '--params.notess', 'Nested value', '--dry']);
			assert.deepEqual(request, {
				params: { seed: 'Original value', notess: 'Nested value' },
				id: eventID
			});
			assert.ok(!Object.prototype.hasOwnProperty.call(request, 'future_property'));
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'events', method: 'deleteEvent', match: event => eventIDs.has(event.id) }
		]);
	}
});
