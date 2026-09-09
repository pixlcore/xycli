const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTestConfig, createCheck, xy, json, call: apiCall } = require('./helpers/common.js');

test('servers', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// These chapters are read-only except for short-lived bootstrap tokens.  No
	// generated installation command is ever executed by this suite.
	const multiple = await apiCall('getMultiple', {
		lists: ['groups'],
		jobs: 1,
		alerts: 1,
		servers: 1,
		serverCache: 1
	});
	const active = Object.values(multiple.servers || {});
	const cached = Object.values(multiple.serverCache || {});
	assert.ok(active.length, 'Server tests require at least one connected Server');
	
	await check('active list combines current and cached Servers without duplicates', () => {
		const rows = json(['servers']);
		const ids = rows.map(row => row.id);
		assert.equal(new Set(ids).size, ids.length);
		active.forEach(server => assert.ok(ids.includes(server.id), 'Connected Server appears in list'));
		cached.filter(server => !active.some(item => item.id == server.id)).forEach(server => {
			assert.ok(ids.includes(server.id), 'Recently offline Server appears in list');
		});
	});
	
	await check('active list is sorted by label or hostname', () => {
		const rows = json(['servers']);
		const labels = rows.map(row => String(row.title || row.hostname || row.id).toLowerCase());
		assert.ok(labels.every((label, idx) => !idx || labels[idx - 1].localeCompare(label) <= 0));
	});
	
	await check('active list supports positional and partial IP filters', () => {
		const server = active[0];
		const by_id = json(['servers', server.id]);
		assert.ok(by_id.length && by_id.every(row => row.id.includes(server.id)));
		
		const ip = String((server.info && server.info.ip) || server.ip || '');
		assert.ok(ip, 'Connected Server has an IP address');
		const partial = ip.slice(0, Math.max(1, Math.floor(ip.length / 2)));
		const by_ip = json(['servers', '--ip', partial]);
		assert.ok(by_ip.length, 'Partial IP filter finds at least one Server');
		assert.ok(by_ip.every(row => String((row.info && row.info.ip) || row.ip || '').toLowerCase().includes(partial.toLowerCase())));
	});
	
	await check('active list supports OS and online filters', () => {
		const server = active[0];
		const os = String((server.info && server.info.os && server.info.os.platform) || (server.info && server.info.platform) || '');
		assert.ok(os, 'Connected Server has an OS platform');
		const rows = json(['servers', '--os', os.toLowerCase(), '--online', 'true']);
		assert.ok(rows.some(row => row.id == server.id));
		assert.ok(rows.every(row => !row.offline));
	});
	
	await check('active list human output supports pagination and suggestions', () => {
		const out = xy(['servers', '--limit', '1', '--page', '1']);
		assert.match(out, /ACTIVE SERVERS/i);
		assert.match(out, /Other Commands:/);
		if ((active.length + cached.length) > 1) assert.match(out, /page 1 of/i);
	});
	
	await check('active list rejects misspelled filters with a suggestion', () => {
		const out = xy(['servers', '--platfrm', 'linux'], { fail: true });
		assert.match(out, /Unsupported Server list option: "--platfrm"/);
		assert.match(out, /Did you mean "--platform"\?/);
	});
	
	await check('dry installer request preserves custom Server metadata', () => {
		const args = [
			'server', 'add', '--platform', 'linux', '--title', 'CLI Bootstrap Test',
			'--enabled', 'false', '--icon', 'mdi-fire-truck', '--expires', '3600', '--dry'
		];
		if (multiple.groups && multiple.groups.length) args.push('--groups', multiple.groups[0].id);
		const request = json(args);
		assert.equal(request.title, 'CLI Bootstrap Test');
		assert.equal(request.enabled, false);
		assert.equal(request.icon, 'fire-truck');
		assert.equal(request.expires, 3600);
		if (multiple.groups && multiple.groups.length) assert.deepEqual(request.groups, [multiple.groups[0].id]);
	});
	
	await check('all installer platforms expand into complete one-line commands', () => {
		const expectations = {
			linux: ['curl ', '/satellite/install?t=', 'sudo sh'],
			macos: ['curl ', '/satellite/install?t=', 'os=macos', 'sudo sh'],
			windows: ['powershell', '/satellite/install?t=', 'os=windows'],
			docker: ['docker run', '/satellite/config?t=', 'ghcr.io']
		};
		
		for (const platform of Object.keys(expectations)) {
			const result = json(['server', 'add', '--platform', platform, '--expires', '60']);
			assert.equal(result.platform, platform);
			assert.equal(typeof(result.command), 'string');
			assert.ok(!result.command.includes('\n'), platform + ' installer stays on one line');
			assert.ok(!result.command.match(/\[(?:base_url|token|image|version|unique)\]/), platform + ' installer expands every macro');
			expectations[platform].forEach(text => {
				assert.ok(result.command.toLowerCase().includes(text.toLowerCase()), platform + ' installer contains ' + text);
			});
		}
	});
	
	await check('installer rejects unsupported platforms and options', () => {
		const platform = xy(['server', 'add', '--platform', 'solaris'], { fail: true });
		assert.match(platform, /Server platform must be one of: linux, macos, windows, docker/);
		
		const option = xy(['server', 'add', '--platform', 'linux', '--titel', 'Typo'], { fail: true });
		assert.match(option, /Unsupported Server add option: --titel/);
	});
	
	await check('historical search supports singular and plural routes', () => {
		const singular = json(['server', 'search', active[0].hostname, '--limit', '5']);
		const plural = json(['servers', 'search', active[0].hostname, '--limit', '5']);
		assert.ok(singular.some(row => row.id == active[0].id));
		assert.deepEqual(plural.map(row => row.id), singular.map(row => row.id));
	});
	
	await check('historical search supports indexed named fields', () => {
		const server = active[0];
		const platform = String((server.info && server.info.os && server.info.os.platform) || (server.info && server.info.platform) || '').toLowerCase();
		const arch = String((server.info && server.info.os && server.info.os.arch) || (server.info && server.info.arch) || '').toLowerCase();
		const rows = json(['server', 'search', '--os_platform', platform, '--os_arch', arch, '--limit', '5']);
		assert.ok(rows.length, 'Indexed OS search returns Servers');
	});
	
	await check('historical search human output supports pagination and suggestions', () => {
		const out = xy(['server', 'search', '--limit', '1', '--page', '1']);
		assert.match(out, /ALL HISTORICAL SERVERS/i);
		assert.match(out, /Other Commands:/);
		assert.match(out, /page 1 of/i);
	});
	
	await check('historical search rejects misspelled fields with a suggestion', () => {
		const out = xy(['server', 'search', '--os_platfrm', 'linux'], { fail: true });
		assert.match(out, /Unsupported Server search option: "--os_platfrm"/);
		assert.match(out, /Did you mean "--os_platform"\?/);
	});
	
	await check('Server help chapters render', () => {
		for (const section of ['servers', 'server', 'server add', 'server search']) {
			assert.match(xy(['help', ...section.split(' ')]), new RegExp('HELP: ' + section.toUpperCase()));
		}
	});
});
