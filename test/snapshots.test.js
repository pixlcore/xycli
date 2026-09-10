const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTestConfig, createCheck, xy, json, call: apiCall } = require('./helpers/common.js');

test('snapshots', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Snapshot tests are intentionally read-only.  Reuse saved records from the
	// local development system instead of creating and deleting test snapshots.
	const search = await apiCall('searchSnapshots', {
		query: '*',
		offset: 0,
		limit: 100,
		sort_by: '_id',
		sort_dir: -1,
		verbose: true
	});
	const serverSnapshot = search.rows.find(item => item.type != 'group');
	const groupSnapshot = search.rows.find(item => item.type == 'group');
	assert.ok(serverSnapshot, 'Snapshot tests require one saved Server snapshot');
	assert.ok(groupSnapshot, 'Snapshot tests require one saved Group snapshot');
	
	await check('list returns newest snapshots with pagination metadata', () => {
		const rows = json(['snapshots', '--limit', '2']);
		assert.ok(rows.length > 0 && rows.length <= 2);
		assert.ok(rows.every(row => row.id && row.type && row.date));
		assert.ok(rows.every((row, idx) => !idx || rows[idx - 1].date >= row.date));
		
		const output = xy(['snapshots', '--limit', '1']);
		assert.match(output, /ALL SNAPSHOTS/);
		assert.match(output, /Snapshot ID/);
		assert.match(output, /Other Commands:/);
	});
	
	await check('list supports source, Server and Group filters', () => {
		const source = json(['snapshots', '--source', serverSnapshot.source, '--limit', '10']);
		assert.ok(source.length);
		assert.ok(source.every(row => row.source == serverSnapshot.source));
		
		const server = json(['snapshots', '--server', serverSnapshot.server, '--limit', '10']);
		assert.ok(server.length);
		assert.ok(server.every(row => row.server == serverSnapshot.server));
		
		const groupID = groupSnapshot.groups[0];
		const group = json(['snapshots', '--group', groupID, '--limit', '10']);
		assert.ok(group.length);
		assert.ok(group.every(row => (row.groups || []).includes(groupID)));
	});
	
	await check('Server snapshot JSON includes saved and related records', () => {
		const result = json(['snapshot', serverSnapshot.id]);
		assert.equal(result.snapshot.id, serverSnapshot.id);
		assert.equal(result.snapshot.type, serverSnapshot.type);
		assert.equal(result.server.id, serverSnapshot.server);
		assert.ok(Array.isArray(result.alerts));
		assert.ok(Array.isArray(result.jobs));
		assert.deepEqual(result.monitors, []);
	});
	
	await check('Group snapshot JSON preserves positional Server data', () => {
		const result = json(['snapshot', groupSnapshot.id]);
		assert.equal(result.snapshot.id, groupSnapshot.id);
		assert.equal(result.snapshot.type, 'group');
		assert.equal(result.group.id, groupSnapshot.group_def.id);
		assert.equal(result.servers.length, groupSnapshot.servers.length);
		assert.ok(Array.isArray(result.alerts));
		assert.ok(Array.isArray(result.jobs));
	});
	
	await check('Server monitor history ends at the snapshot minute', () => {
		const result = json(['snapshot', serverSnapshot.id, '--monitors']);
		const snapshotMinute = Math.floor(result.snapshot.date / 60) * 60;
		const dates = result.monitors.map(row => row.date);
		assert.ok(dates.length, 'Saved Server has historical monitor rows');
		assert.equal(Math.max(...dates), snapshotMinute);
		assert.ok(Math.min(...dates) >= snapshotMinute - (59 * 60));
	});
	
	await check('Group monitor history uses the same trailing window per Server', () => {
		const result = json(['snapshot', groupSnapshot.id, '--monitors']);
		const snapshotMinute = Math.floor(result.snapshot.date / 60) * 60;
		assert.equal(result.monitors.length, result.servers.length);
		
		result.monitors.forEach(item => {
			const dates = item.rows.map(row => row.date);
			if (!dates.length) return;
			assert.equal(Math.max(...dates), snapshotMinute);
			assert.ok(Math.min(...dates) >= snapshotMinute - (59 * 60));
		});
	});
	
	await check('Server human view renders saved point-in-time sections', () => {
		const output = xy(['snapshot', serverSnapshot.id, '--limit', '1']);
		const sections = [
			'SERVER SNAPSHOT - POINT-IN-TIME VIEW',
			'SNAPSHOT SUMMARY',
			'SNAPSHOT JOBS',
			'MEMORY DETAILS',
			'CPU DETAILS',
			'SERVER MONITOR SUMMARY',
			'NETWORK INTERFACES',
			'FILESYSTEMS'
		];
		sections.forEach(section => assert.match(output, new RegExp(section)));
		if (serverSnapshot.quickmon && serverSnapshot.quickmon.length) assert.match(output, /QUICK LOOK - SNAPSHOT MINUTE/);
		assert.match(output, /SNAPSHOT MONITORS/);
		assert.match(output, /SNAPSHOT PROCESSES/);
		assert.match(output, /SNAPSHOT NETWORK CONNECTIONS/);
	});
	
	await check('Group human view renders saved point-in-time sections', () => {
		const output = xy(['snapshot', groupSnapshot.id, '--limit', '1']);
		const sections = [
			'GROUP SNAPSHOT - POINT-IN-TIME VIEW',
			'GROUP SNAPSHOT SUMMARY',
			'GROUP SERVERS',
			'SNAPSHOT JOBS',
			'GROUP MEMORY DETAILS',
			'GROUP CPU DETAILS',
			'GROUP MONITOR SUMMARY'
		];
		sections.forEach(section => assert.match(output, new RegExp(section)));
		if ((groupSnapshot.quickmons || []).some(rows => rows && rows.length)) assert.match(output, /GROUP QUICK LOOK - SNAPSHOT MINUTE/);
	});
	
	await check('optional process and connection tables expand independently', () => {
		const server = xy(['snapshot', serverSnapshot.id, '--processes', '--connections', '--limit', '1']);
		assert.match(server, /SERVER PROCESSES/);
		assert.match(server, /NETWORK CONNECTIONS/);
		
		const group = xy(['snapshot', groupSnapshot.id, '--processes', '--connections', '--limit', '1']);
		assert.match(group, /GROUP PROCESSES/);
		assert.match(group, /GROUP NETWORK CONNECTIONS/);
	});
	
	await check('delete without confirmation is a safe preview', async () => {
		const before = await apiCall('searchSnapshots', { query: '#id:' + serverSnapshot.id, verbose: true, limit: 1 });
		const output = xy(['snapshot', serverSnapshot.id, '--delete']);
		const after = await apiCall('searchSnapshots', { query: '#id:' + serverSnapshot.id, verbose: true, limit: 1 });
		assert.equal(before.rows.length, 1);
		assert.equal(after.rows.length, 1);
		assert.match(output, /DELETE SNAPSHOT/);
		assert.match(output, /--confirm/);
		assert.match(output, /continue/);
	});
	
	await check('commands reject unsupported searches and suggest close options', () => {
		const keyword = xy(['snapshots', 'manual'], { fail: true });
		assert.match(keyword, /HELP: SNAPSHOTS/);
		
		const typo = xy(['snapshots', '--sorce', 'user'], { fail: true });
		assert.match(typo, /Did you mean "--source"\?/);
		
		const source = xy(['snapshots', '--source', 'manual'], { fail: true });
		assert.match(source, /Snapshot source must be one of/);
		
		const missing = xy(['snapshot', 'notarealsnapshotid'], { fail: true });
		assert.match(missing, /Could not find Snapshot/);
	});
	
	await check('Snapshot help chapters render', () => {
		for (const section of ['snapshots', 'snapshot']) {
			assert.match(xy(['help', section]), new RegExp('HELP: ' + section.toUpperCase()));
		}
	});
});
