const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, json, call, cleanupFixtures } = require('./helpers/common.js');

test('categories', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Disposable CLI integration checks against the configured local xyOps server.
	const id = 'cli_cat_test_' + Date.now();
	const title = 'CLI Category Test ' + id;
	const temp = createTempDir(t, 'xycli-category-test-');
	const categories = new Set([id]);
	const events = new Set();
	
	async function get() {
		return (await call('getCategory', { id })).category;
	}
	try {
		const action = { type: 'email', enabled: true, condition: 'success', users: ['admin'] };
		const limit = { type: 'time', enabled: true, duration: 300, abort: true };
		let preview = json(['category', 'create', '--id', id, '--title', title, '--color', 'blue', '--limit', JSON.stringify(limit), '--dry']);
		
		await check('dry create retains named color and resource limit', () => {
			assert.equal(preview.color, 'blue');
			assert.deepEqual(preview.limits, [limit]);
		});
		
		await check('dry create makes no category', () => assert.equal(json(['categories', '--id', id]).length, 0));
		
		let created = json(['category', 'create', '--id', id, '--title', title, '--notes', 'Hello', '--color', 'blue', '--icon', 'folder-outline', '--action', JSON.stringify(action), '--limit', JSON.stringify(limit)]);
		
		await check('create persists defaults and complete configuration', () => {
			assert.equal(created.id, id);
			assert.equal(created.enabled, true);
			assert.equal(created.color, 'blue');
			assert.equal(created.notes, 'Hello');
			assert.equal(created.revision, 1);
			assert.deepEqual(created.actions, [action]);
			assert.deepEqual(created.limits, [limit]);
		});
		
		await check('get by exact ID', () => assert.deepEqual(json(['category', id]), created));
		
		await check('get by fuzzy title', () => assert.equal(json(['category', 'get', '--title', title.toLowerCase()]).id, id));
		
		await check('list search and combined filters', () => assert.equal(json(['categories', title, '--enabled', 'true', '--color', 'blue']).length, 1));
		
		await check('list no matches', () => assert.deepEqual(json(['categories', id, '--enabled', 'false']), []));
		
		await check('list sort order', () => {
			const rows = json(['categories']);
			assert.ok(rows.every((row, idx) => !idx || (row.sort_order || 0) >= (rows[idx - 1].sort_order || 0)));
		});
		
		await check('human pagination and suggestions', () => {
			const output = xy(['category', 'list', '--limit', '1', '--page', '2']);
			assert.match(output, /page 2 of/);
			assert.match(output, /Other Commands:/);
		});
		
		let detail = xy(['category', id]);
		fs.writeFileSync(Path.join(temp, 'category-detail.txt'), detail);
		
		await check('human detail renders indexed actions and limits', () => {
			assert.match(detail, /CATEGORY NOTES[\s\S]*Hello/);
			assert.match(detail, /CATEGORY ACTIONS/);
			assert.match(detail, /CATEGORY LIMITS/);
			assert.match(detail, /│ # │/);
			assert.match(detail, /Send Email/);
			assert.match(detail, /Max Run Time/);
		});
		
		await check('human update shows target and parsed data', () => {
			const output = xy(['category', 'update', id, '--notes', 'Preview', '--dry']);
			assert.match(output, /UPDATE CATEGORY/);
			assert.match(output, new RegExp('Category ID:\\s+' + id));
			assert.match(output, /UPDATE DATA[\s\S]*"notes": "Preview"/);
		});
		
		preview = json(['category', 'update', id, '--notes', 'Preview', '--dry']);
		
		await check('sparse update request excludes unrelated metadata', () => assert.deepEqual(preview, { id, notes: 'Preview' }));
		
		await check('dry update leaves revision unchanged', () => assert.equal(json(['category', id]).revision, 1));
		
		json(['category', 'update', id, '--enabled', 'false', '--actions.0.condition', 'complete', '--actions.0.enabled', 'true', '--limits.0.duration', '600']);
		let updated = await get();
		
		await check('dotted update preserves other fields and increments revision', () => {
			assert.equal(updated.enabled, false);
			assert.equal(updated.revision, 2);
			assert.equal(updated.created, created.created);
			assert.deepEqual(updated.actions, [{ ...action, condition: 'complete' }]);
			assert.deepEqual(updated.limits, [{ ...limit, duration: 600 }]);
			assert.equal(updated.notes, 'Hello');
		});
		
		json(['category', 'update', id, '--action', JSON.stringify(action), '--limit', JSON.stringify(limit)]);
		updated = await get();
		
		await check('singular append preserves existing entries', () => {
			assert.equal(updated.actions.length, 2);
			assert.equal(updated.limits.length, 2);
			assert.equal(updated.limits[0].duration, 600);
		});
		
		json(['category', 'update', '--id', id, '--action', JSON.stringify(action), '--action', JSON.stringify({ ...action, condition: 'error' }), '--limit', JSON.stringify(limit), '--limit', JSON.stringify({ ...limit, duration: 900 })]);
		updated = await get();
		
		await check('repeated singular appends', () => {
			assert.equal(updated.actions.length, 4);
			assert.equal(updated.limits.length, 4);
			assert.equal(updated.limits[3].duration, 900);
		});
		
		json(['category', 'update', id, '--actions.0.condition', 'warning', '--actions', JSON.stringify([action]), '--limits', '[]']);
		updated = await get();
		
		await check('array replacement precedes dotted edits regardless of order', () => {
			assert.deepEqual(updated.actions, [{ ...action, condition: 'warning' }]);
			assert.deepEqual(updated.limits, []);
		});
		
		json(['category', 'update', id, '--actions', '[]', '--limits', '[]']);
		
		await check('arrays can be cleared', () => assert.deepEqual(json(['category', id]).actions, []));
		
		const actionFile = Path.join(temp, 'action.json');
		fs.writeFileSync(actionFile, JSON.stringify(action));
		json(['category', 'update', id, '--action', '@' + actionFile, '--limit', '@-'], { input: JSON.stringify(limit) });
		
		await check('file action and stdin limit', () => {
			const row = json(['category', id]);
			assert.deepEqual(row.actions, [action]);
			assert.deepEqual(row.limits, [limit]);
		});
		
		json(['category', 'update', id, '--json', '@-'], { input: JSON.stringify({ notes: 'From stdin', color: 'green', sort_order: 10000 }) });
		
		await check('complete stdin request and sort order', () => {
			const row = json(['category', id]);
			assert.equal(row.notes, 'From stdin');
			assert.equal(row.color, 'green');
			assert.equal(row.sort_order, 10000);
		});
		
		json(['category', 'update', id, '--color', 'purple']);
		
		await check('named color survives direct update', () => assert.equal(json(['category', id]).color, 'purple'));
		
		const revision = (await get()).revision;
		await check('unconfirmed delete shows target and warning toast', () => {
			for (const args of [['delete', id], ['delete', id, '--confirm', 'false']]) {
				const output = xy(['category', ...args]);
				assert.match(output, /DELETE CATEGORY/);
				assert.match(output, /⚠️[\s\S]*Please confirm the category delete/);
			}
		});
		
		for (const args of [
			['update', id, '--actions.99.enabled', 'true'],
			['update', id, '--actions.0.__proto__.polluted', 'true'],
			['update', id, '--enabled', 'perhaps'],
			['update', id, '--title', ' '],
			['update', id, '--actions', '{}'],
			['update', id, '--limit', '3'],
			['update', id, '--action', 'garbage'],
			['update', id, '--revision', '900'],
			['update', id, '--sort_order', '-1'],
			['update', id, '--unknown', 'value'],
			['update', id, '--id', 'general', '--notes', 'Wrong target'],
			['update', title, '--enabled', 'true'],
			['update', id],
			['delete', title, '--confirm']
		]) {
			await check('reject ' + args.slice(0, 3).join(' '), () => xy(['category', ...args], { fail: true }));
		}
		
		await check('invalid commands make no changes', () => assert.equal(json(['category', id]).revision, revision));
		
		await check('server action validation is surfaced', () => assert.match(xy(['category', 'update', id, '--action', JSON.stringify({ ...action, condition: 'invalid' })], { fail: true }), /Invalid condition/));
		
		// Keep test events disabled with no triggers so category email actions never fire.
		const eventTitle = 'Category CLI Test Event ' + id;
		const eventID = 'cli_cat_event_' + Date.now();
		events.add(eventID);
		xy(['event', 'create', '--id', eventID, '--title', eventTitle, '--category', id, '--enabled', 'false', '--triggers', '[]', '--params.script', 'echo category-test', '--limit', JSON.stringify(limit)]);
		
		await check('event create --limit regression', () => assert.ok(json(['event', eventID]).limits.some(item => item.duration === 300)));
		
		xy(['event', 'update', eventID, '--limit', JSON.stringify({ ...limit, duration: 1200 })]);
		
		await check('event update --limit regression', () => assert.ok(json(['event', eventID]).limits.some(item => item.duration === 1200)));
		
		await check('category deletion refuses assigned events', () => assert.match(xy(['category', 'delete', id, '--confirm'], { fail: true }), /Still in use/));
		
		await call('deleteEvent', { id: eventID });
		events.delete(eventID);
		json(['category', 'delete', id, '--confirm', '--dry']);
		
		await check('dry deletion preserves category', () => assert.equal(json(['category', id]).id, id));
		
		json(['category', 'delete', id, '--confirm']);
		categories.delete(id);
		
		await check('deleted category disappears', () => assert.deepEqual(json(['categories', '--id', id]), []));
		
		await check('get deleted category fails', () => xy(['category', 'get', id], { fail: true }));
		
		const auto = json(['category', 'create', '--title', title]);
		categories.add(auto.id);
		
		await check('server-generated ID', () => assert.match(auto.id, /^ca[a-z0-9_]+$/));
		
		const requestFile = Path.join(temp, 'category.json');
		fs.writeFileSync(requestFile, JSON.stringify({ title: title + ' imported', enabled: false, actions: [action], limits: [limit] }));
		const imported = json(['category', 'create', '--json', '@' + requestFile]);
		categories.add(imported.id);
		
		await check('complete JSON file creation', () => {
			assert.equal(imported.enabled, false);
			assert.deepEqual(imported.limits, [limit]);
		});
		
		for (const topic of ['categories', 'category', 'category list', 'category get', 'category create', 'category update', 'category delete']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
		
		await check('human create suggestions', () => {
			const humanID = id + '_human';
			categories.add(humanID);
			assert.match(xy(['category', 'create', '--id', humanID, '--title', title]), /Other Commands:/);
		});
	}
	finally {
		// Events must be removed before their category. Titles also catch an
		// auto-generated ID if a create succeeded before its output was parsed.
		await cleanupFixtures([
			{ list: 'events', method: 'deleteEvent', match: item => events.has(item.id) },
			{ list: 'categories', method: 'deleteCategory', match: item => categories.has(item.id) || item.title.startsWith(title) }
		]);
	}
});
