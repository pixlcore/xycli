const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, json, call, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('monitors', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Disposable live lifecycle.  Use constant sources and remove every fixture.
	const id = 'cli_monitor_test_' + Date.now();
	const title = 'CLI Monitor Test ' + id;
	const ids = new Set([id]);
	const temp = createTempDir(t, 'xycli-monitor-test-');
	try {
		const original = (await apiCall('getMonitors')).rows;
		const multi = await apiCall('getMultiple', { lists: 'all', servers: 1 });
		const server = Object.values(multi.servers)[0];
		const group = multi.groups[0];
		assert.ok(server && group, 'Live server and group required');
		
		await check('dry create defaults and numeric constant', () => {
			const req = json(['monitor', 'create', '--id', id, '--title', title, '--source', '0', '--dry']);
			assert.equal(req.source, '0');
			assert.equal(req.display, true);
			assert.equal(req.data_type, 'float');
			assert.equal(req.delta_min_value, false);
			assert.deepEqual(req.groups, []);
		});
		
		await check('dry create does not persist', () => assert.deepEqual(json(['monitors', '--id', id]), []));
		
		const created = json(['monitor', 'create', '--id', id, '--title', title, '--source', '12.5', '--display', 'false', '--groups', group.id, '--group', group.id, '--delta', 'true', '--divide_by_delta', 'true', '--delta_min_value', '0', '--min_vert_scale', '100', '--suffix', '/sec', '--icon', 'chart-line', '--notes', 'Hello']);
		
		await check('create persists configuration and deduplicates groups', () => {
			assert.equal(created.id, id);
			assert.equal(created.source, '12.5');
			assert.equal(created.display, false);
			assert.equal(created.delta, true);
			assert.equal(created.divide_by_delta, true);
			assert.equal(created.delta_min_value, 0);
			assert.equal(created.min_vert_scale, 100);
			assert.equal(created.suffix, '/sec');
			assert.equal(created.notes, 'Hello');
			assert.equal(created.icon, 'chart-line');
			assert.equal(created.revision, 1);
			assert.deepEqual(created.groups, [group.id]);
		});
		
		await check('exact ID detail', () => assert.deepEqual(json(['monitor', id]), created));
		
		await check('fuzzy title detail', () => assert.equal(json(['monitor', 'get', '--title', title.toLowerCase()]).id, id));
		
		await check('named ID detail', () => assert.equal(json(['monitor', 'get', '--id', id]).id, id));
		
		await check('combined filters', () => assert.deepEqual(json(['monitors', title, '--display', 'false', '--delta', 'true', '--divide_by_delta', 'true', '--data_type', 'float']), [created]));
		
		await check('group title lookup', () => assert.equal(json(['monitors', title, '--group', group.title]).length, 1));
		
		await check('JSON list ignores pagination as filters', () => assert.deepEqual(json(['monitor', 'list', '--id', id, '--limit', '1', '--page', '2']), [created]));
		
		await check('human pagination and suggestions', () => {
			const out = xy(['monitors', '--limit', '1', '--page', '2']);
			assert.match(out, /page 2 of/);
			assert.match(out, /Other Commands:/);
		});
		
		await check('empty filtered table', () => assert.match(xy(['monitors', title, '--display', 'true']), /No filtered monitors found/));
		
		await check('human detail includes all settings', () => {
			const out = xy(['monitor', id]);
			fs.writeFileSync(Path.join(temp, 'detail.txt'), out);
			for (const label of ['Monitor Summary', 'Hidden', 'Source', 'Data Match', 'Delta Min', 'Sort Order', 'Revision', 'Monitor Notes', 'Hello']) assert.ok(out.toLowerCase().includes(label.toLowerCase()), label);
		});
		
		await check('human update shows target and parsed data', () => {
			const out = xy(['monitor', 'update', id, '--notes', 'Preview', '--dry']);
			assert.match(out, /UPDATE MONITOR/);
			assert.match(out, new RegExp('Monitor ID:\\s+' + id));
			assert.match(out, /UPDATE DATA[\s\S]*"notes": "Preview"/);
		});
		
		await check('sparse dry update', () => assert.deepEqual(json(['monitor', 'update', id, '--notes', 'Preview', '--dry']), { notes: 'Preview', id }));
		
		await check('dry update leaves revision', () => assert.equal(json(['monitor', id]).revision, 1));
		
		await check('saved test returns absolute value despite delta settings', () => assert.deepEqual(json(['monitor', 'test', id, '--server', server.id]), { code: 0, value: 12.5 }));
		
		await check('test fuzzy monitor and server lookup', () => assert.equal(json(['monitor', 'test', title.toLowerCase(), '--server', server.title || server.hostname]).value, 12.5));
		
		await check('test zero success', () => assert.deepEqual(json(['monitor', 'test', '--id', id, '--server', server.id, '--source', '0']), { code: 0, value: 0 }));
		
		await check('test unresolved expression', () => assert.deepEqual(json(['monitor', 'test', '--server', server.id, '--source', 'missing_monitor_test_field']), { code: 0, fail: true }));
		
		await check('human No Value', () => assert.match(xy(['monitor', 'test', '--server', server.id, '--source', 'missing_monitor_test_field']), /No Value/));
		
		for (const type of ['integer', 'float', 'bytes', 'seconds', 'milliseconds']) {
			await check('test type conversion ' + type, () => assert.equal(json(['monitor', 'test', '--server', server.id, '--source', '12.75', '--data_type', type]).value, type === 'float' ? 12.75 : 12));
		}
		
		await check('human bytes formatting', () => assert.match(xy(['monitor', 'test', '--server', server.id, '--source', '2048', '--data_type', 'bytes']), /2 K/));
		
		await check('regex first capture', () => assert.equal(json(['monitor', 'test', '--server', server.id, '--source', '"42 workers"', '--data_match', '(\\d+)', '--data_type', 'integer']).value, 42));
		
		await check('regex full match', () => assert.equal(json(['monitor', 'test', '--server', server.id, '--source', '"42 workers"', '--data_match', '\\d+']).value, 42));
		
		await check('test dry request includes only evaluator fields', () => assert.deepEqual(json(['monitor', 'test', id, '--server', server.id, '--dry']), { source: '12.5', data_type: 'float', data_match: '', server: server.id }));
		
		await check('test overrides do not change saved definition', () => assert.deepEqual(json(['monitor', id]), created));
		
		json(['monitor', 'update', '--id', id, '--json', '@-'], { input: JSON.stringify({ display: true, delta_min_value: false, notes: 'From stdin' }) });
		
		await check('stdin sparse update and disabled minimum', () => {
			const row = json(['monitor', id]);
			assert.equal(row.display, true);
			assert.equal(row.delta_min_value, false);
			assert.equal(row.notes, 'From stdin');
			assert.equal(row.source, created.source);
			assert.equal(row.created, created.created);
			assert.equal(row.revision, 2);
		});
		
		// Group assignments use IDs; extra IDs are only temporary test definitions.
		json(['monitor', 'update', id, '--groups.0', group.id, '--groups', '["first","second"]', '--group', 'third', '--group', group.id]);
		
		await check('replacement before indexed edits and append', () => assert.deepEqual(json(['monitor', id]).groups, [group.id, 'second', 'third']));
		
		const groupFile = Path.join(temp, 'groups.json');
		fs.writeFileSync(groupFile, JSON.stringify([group.id]));
		json(['monitor', 'update', id, '--groups', '@' + groupFile]);
		
		await check('groups from file', () => assert.deepEqual(json(['monitor', id]).groups, [group.id]));
		
		json(['monitor', 'update', id, '--groups', '[]', '--suffix', '', '--notes', '', '--data_match', '', '--json', '@-'], { input: JSON.stringify({ delta_min_value: -5, sort_order: -1 }) });
		
		await check('clearing settings, numeric minimum and ordering', () => {
			const row = json(['monitor', id]);
			assert.deepEqual(row.groups, []);
			assert.equal(row.suffix, '');
			assert.equal(row.notes, '');
			assert.equal(row.delta_min_value, -5);
			assert.equal(json(['monitors'])[0].id, id);
		});
		
		await check('all-group monitors included in group filter', () => assert.equal(json(['monitors', title, '--group', group.id]).length, 1));
		
		const revision = json(['monitor', id]).revision;
		await check('unconfirmed delete shows target and warning toast', () => {
			for (const args of [['delete', id], ['delete', id, '--confirm', 'false']]) {
				const out = xy(['monitor', ...args]);
				assert.match(out, /DELETE MONITOR/);
				assert.match(out, /⚠️[\s\S]*Please confirm the monitor delete/);
			}
		});
		
		for (const args of [
			['update', id, '--groups.99', group.id], ['update', id, '--groups.__proto__.x', 'bad'],
			['update', id, '--groups', '{}'], ['update', id, '--groups', '[5]'], ['update', id, '--group', ''],
			['update', id, '--title', ' '], ['update', id, '--source', ''], ['update', id, '--source', 'cpu.('],
			['update', id, '--display', 'perhaps'], ['update', id, '--delta_min_value', 'true'],
			['update', id, '--sort_order', '1.5'], ['update', id, '--data_type', 'string'], ['update', id, '--data_match', '['],
			['update', id, '--revision', '99'], ['update', id, '--enabled', 'false'], ['update', id],
			['update', title, '--notes', 'wrong'], ['update', id, '--id', 'cpu_usage', '--notes', 'wrong'],
			['delete', title, '--confirm'],
			['create', '--title', title], ['create', '--title', title, '--source', 'cpu.('],
			['test', id], ['test', '--server', server.id], ['test', id, '--server', 'missing_test_server'],
			['test', id, '--server', server.id, '--source', 'cpu.('],
			['test', id, '--server', server.id, '--data_match', 'never_matches'],
			['test', id, '--server', server.id, '--delta', 'true']
		]) await check('reject ' + args.slice(0,3).join(' '), () => xy(['monitor', ...args], { fail: true }));
		
		await check('reject negative chart range', () => xy(['monitor', 'update', id, '--json', '@-'], { input: '{"min_vert_scale":-1}', fail: true }));
		
		await check('rejected requests preserve revision', () => assert.equal(json(['monitor', id]).revision, revision));
		
		await check('duplicate ID error', () => assert.match(xy(['monitor', 'create', '--id', id, '--title', title, '--source', '0'], { fail: true }), /already exists/));
		
		const reqFile = Path.join(temp, 'monitor.json');
		fs.writeFileSync(reqFile, JSON.stringify({ title: title + ' file', source: '0', data_type: 'integer', display: false }));
		const imported = json(['monitor', 'create', '--json', '@' + reqFile]);
		ids.add(imported.id);
		
		await check('file create with auto ID and integer defaults', () => {
			assert.match(imported.id, /^m/);
			assert.equal(imported.min_vert_scale, 1);
			assert.equal(imported.display, false);
		});
		
		const humanID = id + '_human';
		ids.add(humanID);
		
		await check('human creation suggestions', () => assert.match(xy(['monitor', 'create', '--id', humanID, '--title', title, '--source', '0', '--display', 'false']), /Other Commands:/));
		
		for (const monitorID of Array.from(ids)) {
			if (monitorID === id) continue;
			json(['monitor', 'delete', monitorID, '--confirm']);
			ids.delete(monitorID);
		}
		
		await check('dry delete request', () => assert.deepEqual(json(['monitor', 'delete', id, '--confirm', '--dry']), { id }));
		
		await check('dry delete leaves monitor', () => assert.equal(json(['monitor', id]).id, id));
		
		json(['monitor', 'delete', id, '--confirm']);
		ids.delete(id);
		
		await check('delete removes monitor', () => assert.deepEqual(json(['monitors', '--id', id]), []));
		
		await check('get after delete fails', () => xy(['monitor', id], { fail: true }));
		
		for (const topic of ['monitors', 'monitor', 'monitor list', 'monitor get', 'monitor create', 'monitor update', 'monitor test', 'monitor delete']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
		
		await check('existing monitors remain unchanged', () => {
			const now = json(['monitors']);
			assert.equal(now.length, original.length);
			for (const monitor of original) assert.deepEqual(now.find(item => item.id === monitor.id), monitor);
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'monitors', method: 'deleteMonitor', match: item => ids.has(item.id) || item.title.startsWith(title) }
		]);
	}
});
