const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, json, call, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('channels', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Disposable live CLI lifecycle.  Configure channels without invoking them.
	const id = 'cli_channel_test_' + Date.now();
	const title = 'CLI Channel Test ' + id;
	const ids = new Set([id]);
	const temp = createTempDir(t, 'xycli-channel-test-');
	try {
		const original = (await apiCall('getChannels')).rows;
		const events = (await apiCall('getEvents')).rows;
		const hooks = (await apiCall('getWebHooks')).rows;
		const eventID = events[0] ? events[0].id : '';
		const hookID = hooks[0] ? hooks[0].id : '';
		
		await check('dry creation fills defaults', () => {
			const req = json(['channel', 'create', '--id', id, '--title', title, '--dry']);
			assert.equal(req.enabled, true);
			assert.equal(req.max_per_day, 0);
			assert.deepEqual(req.users, []);
		});
		
		await check('dry creation does not persist', () => assert.deepEqual(json(['channels', '--id', id]), []));
		
		const created = json(['channel', 'create', '--id', id, '--title', title, '--enabled', 'false', '--users', 'admin,oncall', '--user', 'admin', '--user', 'backup', '--email', 'ops@example.invalid,sre@example.invalid', '--web_hook', hookID, '--run_event', eventID, '--sound', 'attention-3.mp3', '--icon', 'bullhorn-outline', '--max_per_day', '25', '--notes', 'Hello']);
		
		await check('create persists all fields and deduplicates users', () => {
			assert.equal(created.id, id);
			assert.equal(created.enabled, false);
			assert.equal(created.revision, 1);
			assert.deepEqual(created.users, ['admin', 'oncall', 'backup']);
			assert.equal(created.max_per_day, 25);
			assert.equal(created.web_hook, hookID);
			assert.equal(created.run_event, eventID);
			assert.equal(created.sound, 'attention-3.mp3');
			assert.equal(created.notes, 'Hello');
			assert.equal(created.icon, 'bullhorn-outline');
		});
		
		await check('exact ID get', () => assert.deepEqual(json(['channel', id]), created));
		
		await check('fuzzy title get', () => assert.equal(json(['channel', 'get', '--title', title.toLowerCase()]).id, id));
		
		await check('named ID get', () => assert.equal(json(['channel', 'get', '--id', id]).id, id));
		
		await check('combined list filters', () => assert.equal(json(['channels', title, '--enabled', 'false', '--user', 'admin']).length, 1));
		
		await check('username filter is exact', () => assert.equal(json(['channels', title, '--user', 'adm']).length, 0));
		
		await check('repeated username filters', () => assert.equal(json(['channel', 'list', title, '--user', 'admin', '--user', 'backup']).length, 1));
		
		await check('JSON list ignores pagination as filters', () => assert.deepEqual(json(['channels', '--id', id, '--limit', '1', '--page', '2']), [created]));
		
		await check('alphabetical list ordering', () => {
			const rows = json(['channels']);
			assert.ok(rows.every((row, idx) => !idx || rows[idx-1].title.toLowerCase().localeCompare(row.title.toLowerCase()) <= 0));
		});
		
		await check('human list pagination and suggestions', () => {
			const out = xy(['channels', '--limit', '1', '--page', '2']);
			assert.match(out, /page 2 of/);
			assert.match(out, /Other Commands:/);
		});
		
		await check('empty human list', () => assert.match(xy(['channels', id, '--enabled', 'true']), /No filtered notification channels found/));
		
		await check('human detail covers configuration', () => {
			const out = xy(['channel', id]);
			fs.writeFileSync(Path.join(temp, 'detail.txt'), out);
			for (const label of ['Notification Channel Summary', 'Users', 'Web Hook', 'Run Event', 'Sound', 'Daily Cap', 'Revision']) assert.ok(out.toLowerCase().includes(label.toLowerCase()));
		});
		
		await check('human update shows target and parsed data', () => {
			const out = xy(['channel', 'update', id, '--notes', 'Preview', '--dry']);
			assert.match(out, /UPDATE NOTIFICATION CHANNEL/);
			assert.match(out, new RegExp('Channel ID:\\s+' + id));
			assert.match(out, /UPDATE DATA[\s\S]*"notes": "Preview"/);
		});
		
		await check('sparse dry update excludes unrelated fields', () => assert.deepEqual(json(['channel', 'update', id, '--notes', 'Preview', '--dry']), { notes: 'Preview', id }));
		
		await check('dry update keeps revision', () => assert.equal(json(['channel', id]).revision, 1));
		
		json(['channel', 'update', id, '--users.1', 'replacement', '--user', 'second', '--user', 'admin', '--enabled', 'true', '--max_per_day', '10']);
		
		await check('indexed edits and appends preserve other fields', () => {
			const row = json(['channel', id]);
			assert.deepEqual(row.users, ['admin', 'replacement', 'backup', 'second']);
			assert.equal(row.revision, 2);
			assert.equal(row.enabled, true);
			assert.equal(row.max_per_day, 10);
			assert.equal(row.notes, 'Hello');
			assert.equal(row.created, created.created);
		});
		
		json(['channel', 'update', id, '--users.0', 'changed', '--users', '["first","second"]', '--user', 'third']);
		
		await check('list replacement precedes indexed edits', () => assert.deepEqual(json(['channel', id]).users, ['changed', 'second', 'third']));
		
		const userFile = Path.join(temp, 'users.json');
		fs.writeFileSync(userFile, '["admin","oncall"]');
		json(['channel', 'update', '--id', id, '--users', '@' + userFile]);
		
		await check('user list from JSON file', () => assert.deepEqual(json(['channel', id]).users, ['admin', 'oncall']));
		
		json(['channel', 'update', id, '--json', '@-'], { input: JSON.stringify({ notes: 'From stdin', max_per_day: 0, enabled: false }) });
		
		await check('complete stdin update', () => {
			const row = json(['channel', id]);
			assert.equal(row.notes, 'From stdin');
			assert.equal(row.max_per_day, 0);
			assert.equal(row.enabled, false);
		});
		
		json(['channel', 'update', id, '--users', '[]', '--email', '', '--web_hook', '', '--run_event', '', '--sound', '', '--icon', '', '--notes', '']);
		
		await check('clear optional recipients and targets', () => {
			const row = json(['channel', id]);
			assert.deepEqual(row.users, []);
			for (const key of ['email', 'web_hook', 'run_event', 'sound', 'icon', 'notes']) assert.equal(row[key], '');
		});
		
		const revision = json(['channel', id]).revision;
		await check('unconfirmed delete shows target and warning toast', () => {
			for (const args of [['delete', id], ['delete', id, '--confirm', 'false']]) {
				const out = xy(['channel', ...args]);
				assert.match(out, /DELETE NOTIFICATION CHANNEL/);
				assert.match(out, /⚠️[\s\S]*Please confirm the notification channel delete/);
			}
		});
		
		for (const args of [
			['update', id, '--users.99', 'admin'], ['update', id, '--users.__proto__.x', 'bad'],
			['update', id, '--users', '{}'], ['update', id, '--users', '[5]'], ['update', id, '--user', ''],
			['update', id, '--title', ' '], ['update', id, '--enabled', 'perhaps'], ['update', id, '--max_per_day', '-1'],
			['update', id, '--max_per_day', '1.5'], ['update', id, '--sound', 'bad.wav'], ['update', id, '--email', 'true'],
			['update', id, '--revision', '99'], ['update', id, '--unknown', 'x'], ['update', id],
			['update', title, '--notes', 'wrong'], ['update', id, '--id', 'sev1', '--notes', 'wrong'],
			['delete', title, '--confirm']
		]) await check('reject ' + args.slice(0,3).join(' '), () => xy(['channel', ...args], { fail: true }));
		
		await check('rejected requests leave revision unchanged', () => assert.equal(json(['channel', id]).revision, revision));
		
		await check('duplicate channel ID error is surfaced', () => assert.match(xy(['channel', 'create', '--id', id, '--title', title], { fail:true }), /already exists/));
		
		const auto = json(['channel', 'create', '--title', title]);
		ids.add(auto.id);
		
		await check('automatic ID and default settings', () => {
			assert.match(auto.id, /^ch/);
			assert.equal(auto.enabled, true);
			assert.equal(auto.max_per_day, 0);
		});
		
		const reqFile = Path.join(temp, 'channel.json');
		fs.writeFileSync(reqFile, JSON.stringify({ title: title + ' file', users: ['admin'], enabled: false }));
		const imported = json(['channel', 'create', '--json', '@' + reqFile]);
		ids.add(imported.id);
		
		await check('complete creation from JSON file', () => {
			assert.deepEqual(imported.users, ['admin']);
			assert.equal(imported.enabled, false);
		});
		
		const humanID = id + '_human';
		ids.add(humanID);
		
		await check('human creation suggestions', () => assert.match(xy(['channel', 'create', '--id', humanID, '--title', title]), /Other Commands:/));
		
		// Remove auxiliary fixtures before checking fuzzy searches after deletion.
		for (const channelID of Array.from(ids)) {
			if (channelID === id) continue;
			json(['channel', 'delete', channelID, '--confirm']);
			ids.delete(channelID);
		}
		
		await check('dry delete request', () => assert.deepEqual(json(['channel', 'delete', id, '--confirm', '--dry']), { id }));
		
		await check('dry delete leaves channel', () => assert.equal(json(['channel', id]).id, id));
		
		json(['channel', 'delete', id, '--confirm']);
		ids.delete(id);
		
		await check('delete removes channel', () => assert.deepEqual(json(['channels', '--id', id]), []));
		
		await check('get after deletion fails', () => xy(['channel', id], { fail:true }));
		
		for (const topic of ['channels', 'channel', 'channel list', 'channel get', 'channel create', 'channel update', 'channel delete']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
		
		await check('existing channels remain unchanged', () => {
			const now = json(['channels']);
			for (const channel of original) assert.deepEqual(now.find(item => item.id === channel.id), channel);
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'channels', method: 'deleteChannel', match: item => ids.has(item.id) || item.title.startsWith(title) }
		]);
	}
});
