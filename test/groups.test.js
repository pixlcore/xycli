const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTestConfig, createCheck, xy, json, call, cleanupFixtures } = require('./helpers/common.js');

test('groups', async t => {
	loadTestConfig();
	const check = createCheck(t);
	const id = 'cli_group_test_' + Date.now();
	const title = 'CLI Group Test ' + id;
	const groups = new Set([id]);
	
	try {
		const action = {
			type: 'web_hook',
			enabled: true,
			condition: 'alert_new',
			web_hook: 'example_hook',
			text: ''
		};
		let preview = json(['group', 'create', '--id', id, '--title', title, '--max_jobs_per_server', '2', '--action', JSON.stringify(action), '--dry']);
		
		await check('dry create applies defaults and action syntax', () => {
			assert.equal(preview.id, id);
			assert.equal(preview.hostname_match, '(?!)');
			assert.equal(preview.max_jobs_per_server, 2);
			assert.deepEqual(preview.alert_actions, [action]);
		});
		
		await check('dry create makes no Group', () => assert.equal(json(['groups', '--id', id]).length, 0));
		
		const created = json([
			'group', 'create', '--id', id, '--title', title,
			'--hostname_match', '^cli-group-no-server$', '--icon', 'mdi-server-network',
			'--notes', 'Hello Group', '--max_jobs_per_server', '3', '--action', JSON.stringify(action)
		]);
		
		await check('create persists the complete Group definition', () => {
			assert.equal(created.id, id);
			assert.equal(created.title, title);
			assert.equal(created.hostname_match, '^cli-group-no-server$');
			assert.equal(created.icon, 'server-network');
			assert.equal(created.notes, 'Hello Group');
			assert.equal(created.max_jobs_per_server, 3);
			assert.deepEqual(created.alert_actions, [action]);
		});
		
		await check('list supports positional and named filters', () => {
			assert.equal(json(['groups', title]).length, 1);
			assert.equal(json(['groups', '--hostname_match', 'no-server']).length, 1);
			assert.equal(json(['group', 'list', '--id', id]).length, 1);
		});
		
		await check('detail accepts an exact ID and fuzzy title', () => {
			assert.equal(json(['group', id]).group.id, id);
			assert.equal(json(['group', 'get', title.toLowerCase()]).group.id, id);
		});
		
		await check('human detail renders the stable sections and expansion hints', () => {
			const output = xy(['group', id]);
			assert.match(output, /LIVE GROUP VIEW - Real-time/);
			assert.match(output, /GROUP SUMMARY/);
			assert.match(output, /GROUP NOTES[\s\S]*Hello Group/);
			assert.match(output, /GROUP SERVERS/);
			assert.match(output, /GROUP JOBS/);
			assert.match(output, /GROUP MONITORS\n \(Shown in verbose mode, or add --monitors\.\)/);
			assert.match(output, /GROUP PROCESSES\n \(Shown in verbose mode, or add --processes\.\)/);
			assert.match(output, /GROUP NETWORK CONNECTIONS\n \(Shown in verbose mode, or add --connections\.\)/);
		});
		
		json(['group', 'update', id, '--title', title + ' Updated', '--hostname_match', '', '--alert_actions.0.enabled', 'false', '--max_jobs_per_server', '4']);
		let updated = (await call('getGroup', { id })).group;
		
		await check('update preserves untouched fields and supports dotted actions', () => {
			assert.equal(updated.title, title + ' Updated');
			assert.equal(updated.hostname_match, '(?!)');
			assert.equal(updated.max_jobs_per_server, 4);
			assert.equal(updated.alert_actions[0].enabled, false);
			assert.equal(updated.notes, 'Hello Group');
		});
		
		json(['group', 'update', id, '--action', JSON.stringify({ ...action, enabled: false })]);
		updated = (await call('getGroup', { id })).group;
		
		await check('singular action appends to the saved array', () => assert.equal(updated.alert_actions.length, 2));
		
		for (const args of [
			['update', id, '--alert_actions.99.enabled', 'true'],
			['update', id, '--alert_actions.0.__proto__.polluted', 'true'],
			['update', id, '--hostname_match', '['],
			['update', id, '--max_jobs_per_server', '-1'],
			['update', id, '--alert_actions', '{}'],
			['update', id, '--unknown', 'value'],
			['update', title, '--notes', 'Wrong target'],
			['update', id],
			['delete', title, '--confirm']
		]) {
			await check('reject ' + args.slice(0, 3).join(' '), () => xy(['group', ...args], { fail: true }));
		}
		
		await check('unconfirmed deletion shows the selected Group', () => {
			const output = xy(['group', 'delete', id]);
			assert.match(output, /DELETE SERVER GROUP/);
			assert.match(output, new RegExp('Group ID:\\s+' + id));
			assert.match(output, /Please confirm the server group delete/);
		});
		
		json(['group', 'delete', id, '--confirm', '--dry']);
		await check('dry deletion preserves the Group', async () => assert.equal((await call('getGroup', { id })).group.id, id));
		
		json(['group', 'delete', id, '--confirm']);
		groups.delete(id);
		await check('confirmed deletion removes the Group', () => assert.equal(json(['groups', '--id', id]).length, 0));
		
		// The built-in main Group exercises the combined monitoring views without
		// mutating any Server assignments or monitoring records.
		const multiple = await call('getMultiple', {
			lists: ['groups', 'monitors'],
			jobs: 1,
			alerts: 1,
			servers: 1,
			serverCache: 1
		});
		const group = multiple.groups.find(item => item.id == 'main') || multiple.groups.find(item => {
			return Object.values(multiple.servers || {}).some(server => (server.groups || []).includes(item.id));
		});
		assert.ok(group, 'Group tests require a Group with connected Servers');
		const active = Object.values(multiple.servers || {}).filter(server => (server.groups || []).includes(group.id));
		assert.ok(active.length, 'Group tests require connected Group members');
		
		await check('live view loads one snapshot and timeline per selected Server', () => {
			const result = json(['group', group.id]);
			assert.equal(result.group.id, group.id);
			assert.equal(result.merge, 'average');
			assert.equal(result.snapshots.length, result.servers.length);
			assert.ok(result.snapshots.length >= active.length);
			assert.ok(result.snapshots.every(item => item.data && item.data.memory && Array.isArray(item.rows)));
		});
		
		await check('live view applies Server filters before loading and normalizes merge aliases', () => {
			const server = active[0];
			const ip = String((server.info && server.info.ip) || server.ip || '');
			const partial = ip.slice(0, Math.max(1, Math.floor(ip.length / 2)));
			const result = json(['group', group.id, '--ip', partial, '--merge', 'max']);
			assert.equal(result.merge, 'maximum');
			assert.ok(result.servers.length);
			assert.ok(result.servers.every(item => String((item.info && item.info.ip) || item.ip || '').includes(partial)));
			assert.equal(result.snapshots.length, result.servers.length);
		});
		
		await check('live human view renders merged charts, detail tables, and opt-in sections', () => {
			const output = xy(['group', group.id, '--monitors', '--processes', '--connections', '--merge', 'avg', '--limit', '1']);
			assert.match(output, /GROUP SERVERS/);
			assert.match(output, /GROUP QUICK LOOK - LAST MINUTE/);
			assert.match(output, /Average CPU Load/);
			assert.match(output, /AVERAGE GROUP MEMORY DETAILS/);
			assert.match(output, /AVERAGE GROUP CPU DETAILS/);
			assert.match(output, /GROUP MONITORS - LAST HOUR/);
			assert.match(output, /GROUP PROCESSES/);
			assert.match(output, /GROUP NETWORK CONNECTIONS/);
			assert.doesNotMatch(output, /Shown in verbose mode/);
		});
		
		await check('live view rejects invalid merge modes and misspelled options', () => {
			assert.match(xy(['group', group.id, '--merge', 'median'], { fail: true }), /Group --merge must be one of/);
			const option = xy(['group', group.id, '--proceses'], { fail: true });
			assert.match(option, /Unsupported group view option: "--proceses"/);
			assert.match(option, /Did you mean "--processes"\?/);
		});
		
		const latest = await call('getLatestMonitorData', { server: active[0].id, sys: 'hourly', limit: 1 });
		assert.ok(latest.rows && latest.rows.length, 'Group history tests require recent monitoring data');
		const history_date = new Date(latest.rows[latest.rows.length - 1].date * 1000);
		const pad = number => String(number).padStart(2, '0');
		const history_spec = history_date.getFullYear() + '/' + pad(history_date.getMonth() + 1) + '/' + pad(history_date.getDate()) + '/' + pad(history_date.getHours());
		
		await check('historical view reconstructs membership and loads every Monitor timeline', () => {
			const result = json(['group', 'history', group.id, history_spec, '--merge', 'total', '--limit', '1']);
			assert.equal(result.group.id, group.id);
			assert.equal(result.merge, 'total');
			assert.equal(result.range.mode, 'hourly');
			assert.ok(result.servers.length >= active.length);
			assert.equal(result.monitors.length, result.servers.length);
			assert.ok(result.monitors.every(item => Array.isArray(item.rows)));
			assert.ok(Array.isArray(result.alerts.rows));
			assert.ok(Array.isArray(result.jobs.rows));
			assert.ok(result.alerts.rows.length <= 1);
			assert.ok(result.jobs.rows.length <= 1);
		});
		
		await check('historical human view renders all required sections in order', () => {
			const output = xy(['group', 'history', group.id, history_spec, '--merge', 'min', '--limit', '1']);
			assert.match(output, /HOURLY GROUP HISTORY/);
			assert.ok(output.indexOf('GROUP SUMMARY') < output.indexOf('GROUP SERVERS'));
			assert.ok(output.indexOf('GROUP SERVERS') < output.indexOf('GROUP MONITORS'));
			assert.ok(output.indexOf('GROUP MONITORS') < output.indexOf('GROUP ALERTS'));
			assert.ok(output.indexOf('GROUP ALERTS') < output.indexOf('GROUP JOBS'));
			assert.match(output, /Minimum CPU Load/);
		});
		
		await check('Group help chapters render', () => {
			for (const section of ['groups', 'group', 'group list', 'group get', 'group history', 'group create', 'group update', 'group delete']) {
				assert.match(xy(['help', ...section.split(' ')]), new RegExp('HELP: ' + section.toUpperCase()));
			}
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'groups', method: 'deleteGroup', match: item => groups.has(item.id) || item.title.startsWith(title) }
		]);
	}
});
