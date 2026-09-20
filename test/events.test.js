const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTestConfig, createCheck, xy, json, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('events', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Keep the Event disabled for its entire lifecycle.  Its schedule, actions,
	// limits, and source are saved definitions only and can never launch a Job.
	const stamp = Date.now();
	const id = 'cli_event_test_' + stamp;
	const title = 'CLI Event Test ' + stamp;
	const action = { type: 'email', enabled: true, condition: 'success', users: ['admin'] };
	const limit = { type: 'time', enabled: true, duration: 300, abort: true };
	const field = { id: 'message', title: 'Message', type: 'text', value: 'Hello' };
	const script = 'echo "Event fixture ' + stamp + '"';
	let category;
	let plugin;
	let group;
	
	try {
		await check('local server has Event dependencies', async () => {
			const data = await apiCall('getMultiple', { lists: 'categories,plugins,groups' });
			category = data.categories.find(item => item.enabled) || data.categories[0];
			plugin = data.plugins.find(item => item.id == 'shellplug') || data.plugins.find(item => item.type == 'event');
			group = data.groups[0];
			assert.ok(category, 'At least one Category is required');
			assert.ok(plugin, 'At least one Event Plugin is required');
			assert.ok(group, 'At least one Server Group is required');
		});
		
		await check('dry creation builds a complete Event request', () => {
			const req = json([
				'event', 'create', '--id', id, '--title', title,
				'--enabled', 'false', '--category', category.id, '--plugin', plugin.id,
				'--targets', JSON.stringify([group.id]), '--algo', 'random',
				'--notes', 'Original notes', '--params.script', script,
				'--cron', '15 4 * * *', '--action', JSON.stringify(action),
				'--limit', JSON.stringify(limit), '--field', JSON.stringify(field), '--dry'
			]);
			assert.equal(req.id, id);
			assert.equal(req.enabled, false);
			assert.equal(req.category, category.id);
			assert.equal(req.plugin, plugin.id);
			assert.deepEqual(req.targets, [group.id]);
			assert.equal(req.params.script, script);
			assert.ok(req.triggers.some(trigger => trigger.type == 'manual' && trigger.enabled));
			assert.ok(req.triggers.some(trigger => trigger.type == 'schedule' && trigger.enabled));
			assert.deepEqual(req.actions.at(-1), action);
			assert.deepEqual(req.limits.at(-1), limit);
			assert.deepEqual(req.fields.at(-1), field);
		});
		
		await check('dry creation does not persist', () => assert.deepEqual(json(['events', '--id', id]), []));
		
		xy([
			'event', 'create', '--id', id, '--title', title,
			'--enabled', 'false', '--category', category.id, '--plugin', plugin.id,
			'--targets', JSON.stringify([group.id]), '--algo', 'random',
			'--notes', 'Original notes', '--params.script', script,
			'--cron', '15 4 * * *', '--action', JSON.stringify(action),
			'--limit', JSON.stringify(limit), '--field', JSON.stringify(field)
		]);
		const created = json(['event', id]);
		
		await check('create persists the complete Event definition', () => {
			assert.equal(created.id, id);
			assert.equal(created.title, title);
			assert.equal(created.enabled, false);
			assert.equal(created.category, category.id);
			assert.equal(created.plugin, plugin.id);
			assert.deepEqual(created.targets, [group.id]);
			assert.equal(created.params.script, script);
			assert.equal(created.notes, 'Original notes');
			assert.equal(created.revision, 1);
			assert.deepEqual(created.actions.at(-1), action);
			assert.deepEqual(created.limits.at(-1), limit);
			assert.deepEqual(created.fields.at(-1), field);
		});
		
		await check('exact ID, named ID, and fuzzy title get the Event', () => {
			assert.deepEqual(json(['event', id]), created);
			assert.equal(json(['event', 'get', '--id', id]).id, id);
			assert.equal(json(['event', 'get', '--title', title.toLowerCase()]).id, id);
		});
		
		await check('search and dependency filters find only the fixture', () => {
			assert.deepEqual(json(['events', title, '--category', category.id, '--plugin', plugin.id, '--target', group.id]), [created]);
			assert.deepEqual(json(['event', 'list', id, '--enabled', 'true']), []);
		});
		
		await check('human list and detail render Event configuration', () => {
			const list = xy(['events', title]);
			const detail = xy(['event', id]);
			assert.match(list, /FILTERED EVENTS/);
			assert.match(list, /Other Commands:/);
			for (const label of ['Event Summary', 'Event ID', 'Event Notes', 'Original notes', 'Triggers', 'Actions', 'Limits', 'User Parameters']) {
				assert.ok(detail.toLowerCase().includes(label.toLowerCase()), label);
			}
		});
		
		await check('dry update is sparse and preserves the saved revision', () => {
			assert.deepEqual(json(['event', 'update', id, '--notes', 'Preview', '--dry']), { notes: 'Preview', id: id });
			assert.equal(json(['event', id]).revision, 1);
		});
		
		const actionIndex = created.actions.length - 1;
		const limitIndex = created.limits.length - 1;
		const fieldIndex = created.fields.length - 1;
		const updatedScript = 'echo "Updated Event fixture ' + stamp + '"';
		xy([
			'event', 'update', id, '--title', title + ' Updated',
			'--notes', 'Updated notes', '--params.script', updatedScript,
			'--actions.' + actionIndex + '.condition', 'complete',
			'--limits.' + limitIndex + '.duration', '600',
			'--fields.' + fieldIndex + '.value', 'Updated'
		]);
		let updated = json(['event', id]);
		
		await check('dotted update preserves untouched Event settings', () => {
			assert.equal(updated.title, title + ' Updated');
			assert.equal(updated.notes, 'Updated notes');
			assert.equal(updated.params.script, updatedScript);
			assert.equal(updated.actions[actionIndex].condition, 'complete');
			assert.equal(updated.actions[actionIndex].users[0], 'admin');
			assert.equal(updated.limits[limitIndex].duration, 600);
			assert.equal(updated.fields[fieldIndex].value, 'Updated');
			assert.equal(updated.enabled, false);
			assert.equal(updated.revision, 2);
		});
		
		const originalTriggerCount = updated.triggers.length;
		const delay = { type: 'delay', enabled: true, duration: 60 };
		xy(['event', 'update', id, '--trigger', JSON.stringify(delay)]);
		updated = json(['event', id]);
		
		await check('singular trigger appends to the saved trigger list', () => {
			assert.equal(updated.triggers.length, originalTriggerCount + 1);
			assert.deepEqual(updated.triggers.at(-1), delay);
		});
		
		const revision = updated.revision;
		for (const args of [
			['update', id],
			['update', id, '--actions.99.enabled', 'true'],
			['update', id, '--actions.0.__proto__.polluted', 'true'],
			['update', id, '--unknown', 'value'],
			['delete', title + ' Updated', '--confirm']
		]) {
			await check('reject Event ' + args.slice(0, 4).join(' '), () => xy(['event', ...args], { fail: true }));
		}
		
		await check('rejected requests leave the Event unchanged', () => assert.equal(json(['event', id]).revision, revision));
		
		await check('duplicate Event ID error is surfaced', () => {
			assert.match(xy(['event', 'create', '--id', id, '--title', title, '--enabled', 'false', '--params.script', script], { fail: true }), /already exists/i);
		});
		
		await check('unconfirmed delete shows the Event and warning toast', () => {
			for (const args of [['delete', id], ['delete', id, '--confirm', 'maybe']]) {
				const out = xy(['event', ...args]);
				assert.match(out, /DELETE EVENT/);
				assert.match(out, new RegExp(id));
				assert.match(out, /Please confirm the delete/);
			}
		});
		
		await check('dry delete sends only the Event ID', () => {
			assert.deepEqual(json(['event', 'delete', id, '--confirm', '--dry']), { id: id });
			assert.equal(json(['event', id]).id, id);
		});
		
		xy(['event', 'delete', id, '--confirm']);
		await check('confirmed delete removes the Event', () => assert.deepEqual(json(['events', '--id', id]), []));
		await check('get after deletion fails', () => xy(['event', id], { fail: true }));
		
		for (const topic of ['events', 'event', 'event get', 'event create', 'event update', 'event delete', 'event run', 'run']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
	}
	finally {
		await cleanupFixtures([
			{ list: 'events', method: 'deleteEvent', match: item => item.id == id || (item.title || '').startsWith(title) }
		]);
	}
});
