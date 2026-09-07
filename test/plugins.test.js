const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, json, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('plugins', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Exercise definitions only. These fixtures are never attached to Events,
	// Actions, Monitors, or Scheduler triggers, and no Plugin test API is invoked.
	const stamp = Date.now();
	const prefix = 'cli_plugin_test_' + stamp;
	const title = 'CLI Plugin Test ' + stamp;
	const ids = new Set();
	const eventID = prefix + '_event';
	const monitorID = prefix + '_monitor';
	const actionID = prefix + '_action';
	const schedulerID = prefix + '_scheduler';
	const temp = createTempDir(t, 'xycli-plugin-test-');
	
	[eventID, monitorID, actionID, schedulerID].forEach(id => ids.add(id));
	
	try {
		const original = (await apiCall('getPlugins')).rows;
		const multi = await apiCall('getMultiple', { lists: 'all' });
		const group = multi.groups[0];
		assert.ok(group, 'Server group required');
		
		const scriptFile = Path.join(temp, 'plugin.js');
		const script = "console.log(JSON.stringify({ xy: 1, code: 0 }));\n";
		fs.writeFileSync(scriptFile, script);
		
		await check('dry Event Plugin creation fills defaults', () => {
			const req = json(['plugin', 'create', '--id', eventID, '--title', title + ' Event', '--command', 'node', '--dry']);
			assert.equal(req.type, 'event');
			assert.equal(req.enabled, true);
			assert.equal(req.kill, 'parent');
			assert.equal(req.runner, false);
			assert.deepEqual(req.params, []);
		});
		
		await check('dry creation does not persist', () => assert.deepEqual(json(['plugins', '--id', eventID]), []));
		
		const createdEvent = json([
			'plugin', 'create', '--id', eventID, '--title', title + ' Event',
			'--type', 'event', '--command', 'node', '--script', '@' + scriptFile,
			'--enabled', 'false', '--kill', 'all', '--runner', 'true',
			'--uid', 'worker', '--gid', 'workers', '--icon', 'code-braces', '--notes', 'Event notes',
			'--param', '{"id":"name","title":"Name","type":"text","variant":"text","value":"World","required":true}',
			'--param', '{"id":"loud","title":"Loud","type":"checkbox","value":false}',
			'--param', '{"id":"tool","title":"Tool","type":"toolset","data":{"tools":[{"id":"sample","title":"Sample Tool","fields":[{"id":"message","title":"Message","type":"text","value":"Hello"}]},{"id":"alternate","title":"Alternate Tool","fields":[{"id":"alternate_count","title":"Alternate Count","type":"text","variant":"number","value":2}]}]}}'
		]);
		
		await check('create Event Plugin persists all settings', () => {
			assert.equal(createdEvent.id, eventID);
			assert.equal(createdEvent.type, 'event');
			assert.equal(createdEvent.enabled, false);
			assert.equal(createdEvent.command, 'node');
			assert.equal(createdEvent.script, script);
			assert.equal(createdEvent.kill, 'all');
			assert.equal(createdEvent.runner, true);
			assert.equal(createdEvent.uid, 'worker');
			assert.equal(createdEvent.gid, 'workers');
			assert.equal(createdEvent.revision, 1);
			assert.deepEqual(createdEvent.params.map(param => param.id), ['name', 'loud', 'tool']);
		});
		
		const createdMonitor = json([
			'plugin', 'create', '--id', monitorID, '--title', title + ' Monitor',
			'--type', 'monitor', '--command', '/bin/sh', '--script', 'echo 42',
			'--plugin_format', 'json', '--groups', group.id, '--group', group.id,
			'--quick', 'true', '--notes', 'Monitor notes'
		]);
		
		await check('create Monitor Plugin uses monitor-only settings', () => {
			assert.equal(createdMonitor.type, 'monitor');
			assert.equal(createdMonitor.format, 'json');
			assert.equal(createdMonitor.quick, true);
			assert.deepEqual(createdMonitor.groups, [group.id]);
			assert.deepEqual(createdMonitor.params, []);
			assert.ok(!('kill' in createdMonitor));
			assert.ok(!('runner' in createdMonitor));
		});
		
		const createdAction = json([
			'plugin', 'create', '--id', actionID, '--title', title + ' Action',
			'--type', 'action', '--command', 'python3', '--script', 'print("ok")',
			'--param', '{"id":"message","title":"Message","type":"textarea","value":"Hello"}'
		]);
		
		await check('create Action Plugin supports parameters', () => {
			assert.equal(createdAction.type, 'action');
			assert.equal(createdAction.params[0].id, 'message');
			assert.ok(!('kill' in createdAction));
			assert.ok(!('quick' in createdAction));
		});
		
		const schedulerFile = Path.join(temp, 'scheduler.json');
		fs.writeFileSync(schedulerFile, JSON.stringify({
			id: schedulerID,
			title: title + ' Scheduler',
			type: 'scheduler',
			command: 'node',
			script: 'console.log("[]")',
			params: [{ id: 'calendar', title: 'Calendar', type: 'select', value: 'Work, Holiday' }],
			notes: 'Scheduler notes'
		}));
		const createdScheduler = json(['plugin', 'create', '--json', '@' + schedulerFile]);
		
		await check('create Scheduler Plugin from JSON file', () => {
			assert.equal(createdScheduler.id, schedulerID);
			assert.equal(createdScheduler.type, 'scheduler');
			assert.equal(createdScheduler.params[0].id, 'calendar');
			assert.deepEqual(createdScheduler.groups, []);
			assert.equal(createdScheduler.format, '');
		});
		
		await check('all four Plugin types were created without Events', async () => {
			const rows = (await apiCall('getPlugins')).rows.filter(plugin => ids.has(plugin.id));
			assert.deepEqual(rows.map(plugin => plugin.type).sort(), ['action', 'event', 'monitor', 'scheduler']);
		});
		
		await check('exact ID get', () => assert.deepEqual(json(['plugin', eventID]), createdEvent));
		
		await check('fuzzy title get', () => assert.equal(json(['plugin', 'get', '--title', (title + ' Action').toLowerCase()]).id, actionID));
		
		await check('named ID get', () => assert.equal(json(['plugin', 'get', '--id', schedulerID]).id, schedulerID));
		
		await check('combined list filters', () => assert.deepEqual(json(['plugins', title, '--type', 'event', '--enabled', 'false']), [createdEvent]));
		
		await check('singular list command', () => assert.equal(json(['plugin', 'list', title, '--type', 'monitor']).length, 1));
		
		await check('JSON list ignores pagination as filters', () => assert.deepEqual(json(['plugins', '--id', eventID, '--limit', '1', '--page', '2']), [createdEvent]));
		
		await check('alphabetical list ordering', () => {
			const rows = json(['plugins', title]);
			assert.ok(rows.every((row, idx) => !idx || rows[idx - 1].title.toLowerCase().localeCompare(row.title.toLowerCase()) <= 0));
		});
		
		await check('human list pagination and suggestions', () => {
			const out = xy(['plugins', '--limit', '1', '--page', '2']);
			assert.match(out, /page 2 of/);
			assert.match(out, /Other Commands:/);
		});
		
		await check('empty filtered Plugin table', () => assert.match(xy(['plugins', eventID, '--enabled', 'true']), /No filtered plugins found/i));
		
		await check('Event Plugin detail covers type-specific settings and parameters', () => {
			const out = xy(['plugin', eventID]);
			fs.writeFileSync(Path.join(temp, 'event-detail.txt'), out);
			for (const label of ['Plugin Summary', 'Command', 'Script', 'Abort Policy', 'Remote Runner', 'Plugin Notes', 'Event notes', 'Plugin Parameters', 'Sample Tool', 'Message', 'Alternate Tool', 'Alternate Count', 'Revision', 'Plugin Script', '(Shown in verbose mode)']) assert.ok(out.toLowerCase().includes(label.toLowerCase()), label);
			assert.ok(!out.includes(script.trim()), 'Normal detail does not print full script');
		});
		
		await check('verbose detail prints highlighted embedded script', () => {
			const out = xy(['plugin', eventID, '--verbose']);
			assert.match(out, /PLUGIN SCRIPT/);
			assert.match(out, /console\.log\(JSON\.stringify/);
			assert.doesNotMatch(out, /\(Shown in verbose mode\)/);
		});
		
		await check('executable language detection mirrors xyOps', () => {
			assert.equal(require('../lib/utils.js').getLangFromBinary('/usr/bin/node --use-strict'), 'javascript');
			assert.equal(require('../lib/utils.js').getLangFromBinary('/usr/bin/python3 -u'), 'python');
			assert.equal(require('../lib/utils.js').getLangFromBinary('/bin/bash'), 'shell');
			assert.equal(require('../lib/utils.js').getLangFromBinary('pwsh -File'), 'powershell');
			assert.equal(require('../lib/utils.js').getLangFromBinary('unknown-binary'), null);
		});
		
		await check('Monitor Plugin detail covers monitor settings', () => {
			const out = xy(['plugin', monitorID]);
			for (const label of ['Groups', 'Format', 'Quick Monitor']) assert.ok(out.includes(label), label);
			assert.ok(!out.includes('PLUGIN PARAMETERS'));
		});
		
		await check('human update shows target and parsed data', () => {
			const out = xy(['plugin', 'update', eventID, '--notes', 'Preview', '--dry']);
			assert.match(out, /UPDATE PLUGIN/);
			assert.match(out, new RegExp('Plugin ID:\\s+' + eventID));
			assert.match(out, /UPDATE DATA[\s\S]*"notes": "Preview"/);
		});
		
		await check('sparse dry update excludes unrelated fields', () => {
			assert.deepEqual(json(['plugin', 'update', eventID, '--notes', 'Preview', '--dry']), { notes: 'Preview', id: eventID });
			assert.deepEqual(json(['plugin', 'update', monitorID, '--notes', 'Preview', '--dry']), { notes: 'Preview', id: monitorID });
		});
		
		await check('dry update leaves revisions unchanged', () => {
			assert.equal(json(['plugin', eventID]).revision, 1);
			assert.equal(json(['plugin', monitorID]).revision, 1);
		});
		
		json([
			'plugin', 'update', eventID,
			'--params.0.title', 'Display Name', '--params.0.required', 'false',
			'--params.1.value', 'true',
			'--param', '{"id":"count","title":"Count","type":"text","variant":"number","value":3}'
		]);
		
		await check('indexed parameter edits and append preserve other settings', () => {
			const row = json(['plugin', eventID]);
			assert.deepEqual(row.params.map(param => param.id), ['name', 'loud', 'tool', 'count']);
			assert.equal(row.params[0].title, 'Display Name');
			assert.equal(row.params[0].required, false);
			assert.equal(row.params[1].value, true);
			assert.equal(row.command, 'node');
			assert.equal(row.kill, 'all');
			assert.equal(row.revision, 2);
		});
		
		json([
			'plugin', 'update', eventID,
			'--params', '[{"id":"first","title":"First","type":"text","value":"one"}]',
			'--params.0.value', 'changed',
			'--param', '{"id":"second","title":"Second","type":"checkbox","value":false}'
		]);
		
		await check('parameter replacement precedes indexed edits and appends', () => {
			const params = json(['plugin', eventID]).params;
			assert.deepEqual(params.map(param => param.id), ['first', 'second']);
			assert.equal(params[0].value, 'changed');
		});
		
		json(['plugin', 'update', eventID, '--params', '@-'], {
			input: JSON.stringify([{ id: 'stdin', title: 'From stdin', type: 'code', value: 'return true;' }])
		});
		
		await check('complete parameter list from stdin', () => {
			const row = json(['plugin', eventID]);
			assert.equal(row.params.length, 1);
			assert.equal(row.params[0].id, 'stdin');
		});
		
		json(['plugin', 'update', monitorID, '--json', '@-'], {
			input: JSON.stringify({ format: 'text' })
		});
		await check('complete JSON request accepts native Monitor Plugin format', () => assert.equal(json(['plugin', monitorID]).format, 'text'));
		
		json(['plugin', 'update', monitorID, '--groups', '[]', '--group', group.id, '--group', group.id, '--plugin_format', 'xml', '--quick', 'false']);
		
		await check('Monitor Plugin list replacement and appends are deterministic', () => {
			const row = json(['plugin', monitorID]);
			assert.deepEqual(row.groups, [group.id]);
			assert.equal(row.format, 'xml');
			assert.equal(row.quick, false);
		});
		
		json(['plugin', 'update', monitorID, '--groups.0', group.id]);
		await check('Monitor Plugin indexed group update', () => assert.deepEqual(json(['plugin', monitorID]).groups, [group.id]));
		
		const eventRevision = json(['plugin', eventID]).revision;
		const monitorRevision = json(['plugin', monitorID]).revision;
		await check('unconfirmed delete shows target and warning toast', () => {
			for (const args of [['delete', eventID], ['delete', eventID, '--confirm', 'false']]) {
				const out = xy(['plugin', ...args]);
				assert.match(out, /DELETE PLUGIN/);
				assert.match(out, /⚠️[\s\S]*Please confirm the Plugin delete/);
			}
		});
		
		const rejected = [
			['update', eventID, '--type', 'action'],
			['update', eventID, '--params.99.title', 'Bad'],
			['update', eventID, '--params.__proto__.x', 'Bad'],
			['update', eventID, '--params', '{}'],
			['update', eventID, '--params', '[5]'],
			['update', eventID, '--param', '{"id":"bad","title":"Bad","type":"bogus","value":"x"}'],
			['update', eventID, '--params', '[{"id":"same","title":"One","type":"text","value":"a"},{"id":"same","title":"Two","type":"text","value":"b"}]'],
			['update', eventID, '--enabled', 'perhaps'],
			['update', eventID, '--kill', 'children'],
			['update', eventID, '--group', group.id],
			['update', actionID, '--runner', 'true'],
			['update', monitorID, '--param', '{"id":"bad","title":"Bad","type":"text","value":"x"}'],
			['update', monitorID, '--kill', 'all'],
			['update', monitorID, '--plugin_format', 'yaml'],
			['update', eventID, '--revision', '99'],
			['update', eventID],
			['update', title + ' Event', '--notes', 'Wrong selector'],
			['update', eventID, '--id', actionID, '--notes', 'Wrong ID'],
			['delete', title + ' Event', '--confirm']
		];
		
		for (const args of rejected) {
			await check('reject ' + args.slice(0, 4).join(' '), () => xy(['plugin', ...args], { fail: true }));
		}
		
		await check('rejected requests leave revisions unchanged', () => {
			assert.equal(json(['plugin', eventID]).revision, eventRevision);
			assert.equal(json(['plugin', monitorID]).revision, monitorRevision);
		});
		
		await check('invalid Plugin type is rejected', () => xy(['plugin', 'create', '--title', title, '--type', 'service', '--command', 'node'], { fail: true }));
		
		await check('missing command is rejected', () => xy(['plugin', 'create', '--title', title], { fail: true }));
		
		await check('duplicate Plugin ID error is surfaced', () => assert.match(xy(['plugin', 'create', '--id', eventID, '--title', title, '--command', 'node'], { fail: true }), /already exists/i));
		
		const auto = json(['plugin', 'create', '--title', title + ' Auto', '--type', 'action', '--command', 'node']);
		ids.add(auto.id);
		await check('automatic ID and Action Plugin defaults', () => {
			assert.match(auto.id, /^p/);
			assert.equal(auto.type, 'action');
			assert.equal(auto.enabled, true);
			assert.deepEqual(auto.params, []);
		});
		
		const humanID = prefix + '_human';
		ids.add(humanID);
		await check('human creation suggestions', () => assert.match(xy(['plugin', 'create', '--id', humanID, '--title', title + ' Human', '--type', 'scheduler', '--command', 'node']), /Other Commands:/));
		
		// Remove auxiliary fixtures before final deletion checks.
		for (const id of Array.from(ids)) {
			if ([eventID, monitorID, actionID, schedulerID].includes(id)) continue;
			json(['plugin', 'delete', id, '--confirm']);
			ids.delete(id);
		}
		
		await check('dry delete request', () => assert.deepEqual(json(['plugin', 'delete', eventID, '--confirm', '--dry']), { id: eventID }));
		
		await check('dry delete leaves Plugin', () => assert.equal(json(['plugin', eventID]).id, eventID));
		
		for (const id of [eventID, monitorID, actionID, schedulerID]) {
			json(['plugin', 'delete', id, '--confirm']);
			ids.delete(id);
		}
		
		await check('delete removes all four Plugin types', () => assert.deepEqual(json(['plugins', title]), []));
		
		await check('get after deletion fails', () => xy(['plugin', eventID], { fail: true }));
		
		for (const topic of ['plugins', 'plugin', 'plugin list', 'plugin get', 'plugin create', 'plugin update', 'plugin delete']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
		
		await check('existing Plugins remain unchanged', async () => {
			const now = (await apiCall('getPlugins')).rows;
			for (const plugin of original) {
				const current = now.find(item => item.id === plugin.id);
				assert.ok(current, 'Existing Plugin still present: ' + plugin.id);
				assert.equal(JSON.stringify(current), JSON.stringify(plugin), 'Existing Plugin unchanged: ' + plugin.id);
			}
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'plugins', method: 'deletePlugin', match: item => ids.has(item.id) || item.title.startsWith(title) }
		]);
	}
});
