const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, json, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('tags', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// These definitions are never attached to Events, Jobs, Tickets, Actions, or
	// Limits.  Track every generated ID so cleanup remains exact after failures.
	const stamp = Date.now();
	const id = 'cli_tag_test_' + stamp;
	const title = 'CLI Tag Test ' + stamp;
	const ids = new Set([id]);
	const temp = createTempDir(t, 'xycli-tag-test-');
	
	try {
		const original = (await apiCall('getTags')).rows;
		
		await check('dry creation fills UI defaults', () => {
			const req = json(['tag', 'create', '--id', id, '--title', title, '--dry']);
			assert.deepEqual(req, {
				icon: 'tag-outline',
				notes: '',
				id: id,
				title: title
			});
		});
		
		await check('dry creation does not persist', () => assert.deepEqual(json(['tags', '--id', id]), []));
		
		const created = json([
			'tag', 'create', '--id', id, '--title', title,
			'--icon', 'mdi-alert-rhombus', '--notes', 'First line\nSecond line'
		]);
		
		await check('create persists all editable fields', () => {
			assert.equal(created.id, id);
			assert.equal(created.title, title);
			assert.equal(created.icon, 'alert-rhombus');
			assert.equal(created.notes, 'First line\nSecond line');
			assert.equal(created.revision, 1);
			assert.ok(created.username);
			assert.ok(created.created);
			assert.equal(created.created, created.modified);
		});
		
		await check('exact ID get', () => assert.deepEqual(json(['tag', id]), created));
		
		await check('fuzzy title get', () => assert.equal(json(['tag', 'get', '--title', title.toLowerCase()]).id, id));
		
		await check('named ID get', () => assert.equal(json(['tag', 'get', '--id', id]).id, id));
		
		await check('list search and icon filter', () => {
			assert.deepEqual(json(['tags', title, '--icon', 'alert-rhombus']), [created]);
			assert.deepEqual(json(['tag', 'list', '--id', id]), [created]);
		});
		
		await check('JSON list ignores human pagination arguments', () => {
			assert.deepEqual(json(['tags', '--id', id, '--limit', '1', '--page', '2']), [created]);
		});
		
		await check('Tag list is ordered alphabetically', () => {
			const rows = json(['tags']);
			assert.ok(rows.every((row, idx) => !idx || rows[idx - 1].title.toLowerCase().localeCompare(row.title.toLowerCase()) <= 0));
		});
		
		await check('human list supports pagination and suggestions', () => {
			const out = xy(['tags', '--limit', '1', '--page', '1']);
			assert.match(out, /page 1 of/i);
			assert.match(out, /Other Commands:/);
		});
		
		await check('empty filtered Tag table', () => {
			assert.match(xy(['tags', id, '--icon', 'tag-outline']), /No filtered tags found/i);
		});
		
		await check('human detail shows summary and multiline notes', () => {
			const out = xy(['tag', id]);
			for (const label of ['Tag Summary', 'Tag ID', 'Icon', 'Events', 'Author', 'Revision', 'Tag Notes', 'First line', 'Second line']) {
				assert.ok(out.toLowerCase().includes(label.toLowerCase()), label);
			}
			assert.match(out, /Other Commands:/);
		});
		
		await check('tagged Event suggestion uses the supported tags filter', () => {
			assert.deepEqual(json(['events', '--tags', id]), []);
		});
		
		await check('human update shows target and parsed data', () => {
			const out = xy(['tag', 'update', id, '--notes', 'Preview', '--dry']);
			assert.match(out, /UPDATE TAG/);
			assert.match(out, new RegExp('Tag ID:\\s+' + id));
			assert.match(out, /UPDATE DATA[\s\S]*"notes": "Preview"/);
		});
		
		await check('sparse dry update excludes unrelated fields', () => {
			assert.deepEqual(json(['tag', 'update', id, '--notes', 'Preview', '--dry']), { notes: 'Preview', id: id });
		});
		
		await check('dry update keeps revision unchanged', () => assert.equal(json(['tag', id]).revision, 1));
		
		// Simulate a property introduced by a future xyOps release.  The CLI must
		// omit unknown saved properties from its sparse update request.
		await apiCall('updateTag', { id: id, future_property: { enabled: true } });
		json(['tag', 'update', id, '--title', title + ' Updated', '--notes', 'Updated notes']);
		
		await check('sparse update preserves a future server property', () => {
			const row = json(['tag', id]);
			assert.equal(row.title, title + ' Updated');
			assert.equal(row.notes, 'Updated notes');
			assert.equal(row.icon, 'alert-rhombus');
			assert.deepEqual(row.future_property, { enabled: true });
			assert.equal(row.revision, 3);
		});
		
		json(['tag', 'update', id, '--json', '@-'], {
			input: JSON.stringify({ icon: '', notes: 'From standard input' })
		});
		
		await check('complete JSON update from stdin', () => {
			const row = json(['tag', id]);
			assert.equal(row.icon, '');
			assert.equal(row.notes, 'From standard input');
			assert.deepEqual(row.future_property, { enabled: true });
		});
		
		const revision = json(['tag', id]).revision;
		await check('unconfirmed delete shows target and warning toast', () => {
			for (const args of [['delete', id], ['delete', id, '--confirm', 'false']]) {
				const out = xy(['tag', ...args]);
				assert.match(out, /DELETE TAG/);
				assert.match(out, /⚠️[\s\S]*Please confirm the Tag delete/);
			}
		});
		
		const rejected = [
			['update', id],
			['update', title + ' Updated', '--notes', 'Wrong selector'],
			['update', id, '--id', 'different', '--notes', 'Wrong ID'],
			['update', id, '--title', ' '],
			['update', id, '--icon', 'true'],
			['update', id, '--notes', 'false'],
			['update', id, '--revision', '99'],
			['update', id, '--notess', 'Typo'],
			['update', id, '--notes.extra', 'Bad path'],
			['delete', title + ' Updated', '--confirm'],
			['delete', id, '--confirm', 'maybe']
		];
		
		for (const args of rejected) {
			await check('reject Tag ' + args.slice(0, 4).join(' '), () => xy(['tag', ...args], { fail: true }));
		}
		
		await check('rejected requests leave revision unchanged', () => assert.equal(json(['tag', id]).revision, revision));
		
		await check('duplicate Tag ID error is surfaced', () => {
			assert.match(xy(['tag', 'create', '--id', id, '--title', title], { fail: true }), /already exists/i);
		});
		
		const auto = json(['tag', 'create', '--title', title + ' Automatic']);
		ids.add(auto.id);
		
		await check('automatic ID and default icon', () => {
			assert.match(auto.id, /^t/);
			assert.equal(auto.icon, 'tag-outline');
			assert.equal(auto.notes, '');
		});
		
		const file = Path.join(temp, 'tag.json');
		fs.writeFileSync(file, JSON.stringify({
			title: title + ' File',
			icon: 'tag-heart-outline',
			notes: 'Created from JSON'
		}));
		const imported = json(['tag', 'create', '--json', '@' + file]);
		ids.add(imported.id);
		
		await check('complete creation from JSON file', () => {
			assert.equal(imported.icon, 'tag-heart-outline');
			assert.equal(imported.notes, 'Created from JSON');
		});
		
		const humanID = id + '_human';
		ids.add(humanID);
		await check('human creation prints suggested commands', () => {
			assert.match(xy(['tag', 'create', '--id', humanID, '--title', title + ' Human']), /Other Commands:/);
		});
		
		// Remove auxiliary definitions before the final primary delete checks.
		for (const tagID of Array.from(ids)) {
			if (tagID === id) continue;
			json(['tag', 'delete', tagID, '--confirm']);
			ids.delete(tagID);
		}
		
		await check('dry delete request contains only the ID', () => {
			assert.deepEqual(json(['tag', 'delete', id, '--confirm', '--dry']), { id: id });
		});
		
		await check('dry delete leaves the Tag intact', () => assert.equal(json(['tag', id]).id, id));
		
		json(['tag', 'delete', id, '--confirm']);
		ids.delete(id);
		
		await check('confirmed delete removes the Tag', () => assert.deepEqual(json(['tags', '--id', id]), []));
		
		await check('get after deletion fails', () => xy(['tag', id], { fail: true }));
		
		for (const topic of ['tags', 'tag', 'tag list', 'tag get', 'tag create', 'tag update', 'tag delete']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
		
		await check('existing Tags remain unchanged', async () => {
			const now = (await apiCall('getTags')).rows;
			for (const tag of original) {
				const current = now.find(item => item.id === tag.id);
				assert.ok(current, 'Existing Tag still present: ' + tag.id);
				assert.equal(JSON.stringify(current), JSON.stringify(tag), 'Existing Tag unchanged: ' + tag.id);
			}
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'tags', method: 'deleteTag', match: item => ids.has(item.id) || item.title.startsWith(title) }
		]);
	}
});
