const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const zlib = require('node:zlib');
const utils = require('../lib/utils.js');
const transfer = require('../lib/transfer.js');
const { loadTestConfig, createCheck, createTempDir, xy, json, call, cleanupFixtures } = require('./helpers/common.js');

test('transfer', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Disposable end-to-end XYPDF lifecycle plus dependency graph checks.
	const prefix = 'cli_transfer_' + Date.now() + '_';
	const temp = createTempDir(t, 'xycli-transfer-');
	const types = {
		event: ['event', 'events', 'Event'],
		alert: ['alert', 'alerts', 'Alert'],
		api_key: ['key', 'api_keys', 'ApiKey'],
		bucket: ['bucket', 'buckets', 'Bucket'],
		category: ['category', 'categories', 'Category'],
		channel: ['channel', 'channels', 'Channel'],
		group: ['group', 'groups', 'Group'],
		monitor: ['monitor', 'monitors', 'Monitor'],
		plugin: ['plugin', 'plugins', 'Plugin'],
		role: ['role', 'roles', 'Role'],
		tag: ['tag', 'tags', 'Tag'],
		web_hook: ['webhook', 'web_hooks', 'WebHook']
	};
	
	function wrap(items) {
		return { type: 'xypdf', version: '1.0', xyops: '1.0.0', items };
	}
	
	function file(name, value) {
		const path = Path.join(temp, name);
		fs.writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
		return path;
	}
	
	function fixture(type, data = {}) {
		return { type, data: { id: prefix + type, title: prefix + type, enabled: false, notes: 'Original', ...data, username: 'old_author', created: 1, modified: 2, revision: 99, sort_order: 99 } };
	}
	
	const original = await call('getMultiple', { lists: 'all' });
	try {
		// Seed an existing API key to cover updates. The separate API key suite
		// covers deletion, recreation, and authentication with the original secret.
		const seedKey = (await call('createApiKey', { title: prefix + 'api_key', active: true, privileges: {}, roles: [] })).api_key;
		
		// Unit graph deliberately has a cycle, shared dependencies and physical
		// server targets. Do not install the cyclic workflow on the live server.
		const ctx = { ...utils, ...transfer, die: message => { throw new Error(message); } };
		for (const [type, meta] of Object.entries(types)) ctx[meta[1]] = [];
		const a = { id: 'a', title: 'A', category: 'general', targets: ['server_id'], workflow: { nodes: [{ type: 'event', data: { event: 'b' } }] } };
		const b = { id: 'b', title: 'B', workflow: { nodes: [{ type: 'event', data: { event: 'a' } }, { type: 'job', data: { plugin: 'custom' } }] }, actions: [{ type: 'plugin', plugin_id: 'custom' }] };
		ctx.events = [a,b];
		ctx.plugins = [{ id: 'custom', title: 'Custom', script: 'literal code' }];
		
		await check('cycle-safe deduplication', () => {
			const warnings = [];
			assert.deepEqual(ctx.collectExportItems('event', a, ctx.parseExportDependencies('all'), warnings).map(item => item.data.id), ['a','b','custom']);
			assert.deepEqual(warnings, []);
			assert.equal(a.category, 'general');
		});
		
		await check('unselected subevents are not traversed', () => assert.equal(ctx.collectExportItems('event', a, ctx.parseExportDependencies('plugins'), []).length, 1));
		
		await check('trigger and action dependency discovery', () => {
			ctx.web_hooks = [{ id: 'hook', title: 'Hook' }];
			ctx.buckets = [{ id: 'bucket', title: 'Bucket' }];
			ctx.tags = [{ id: 'tag', title: 'Tag' }];
			const event = { id: 'c', title: 'C', plugin: 'stock', triggers: [{ type: 'plugin', plugin_id: 'custom' }],
		actions: [{ type: 'web_hook', web_hook: 'hook' }, { type: 'fetch', bucket_id: 'bucket' }, { type: 'tag', tag_id: 'tag' }] };
			ctx.plugins.push({ id: 'stock', title: 'Stock', stock: true });
			assert.deepEqual(ctx.collectExportItems('event', event, ctx.parseExportDependencies('all'), []).map(item => item.data.id), ['c','custom','hook','bucket','tag']);
		});
		
		await check('missing dependency warning', () => {
			const warnings = [];
			ctx.collectExportItems('event', { id:'c', plugin:'missing' }, ctx.parseExportDependencies('plugins'), warnings);
			assert.equal(warnings.length, 1);
		});
		
		await check('semver release and prerelease ordering', () => {
			assert.equal(ctx.compareVersions('1.2.3', '1.2.3+build'), 0);
			assert.equal(ctx.compareVersions('1.2.3-beta.2', '1.2.3-beta.10'), -1);
			assert.equal(ctx.compareVersions('1.2.3', '1.2.3-beta'), 1);
		});
		
		await check('shared new dependencies precede every consumer', () => {
			const node = id => ({ type: 'event', data: { event: id } });
			const make = (id, refs) => ({ type: 'event', operation: 'create', data: { id, workflow: { nodes: refs.map(node) } } });
			const plan = [make('b', ['c']), make('c', []), make('a', ['c']), make('root', ['a','b'])];
			const ids = ctx.orderTransferPlan(plan).map(item => item.data.id);
			assert.ok(ids.indexOf('c') < ids.indexOf('b') && ids.indexOf('c') < ids.indexOf('a'));
			assert.equal(ids[ids.length - 1], 'root');
			assert.throws(() => ctx.orderTransferPlan([make('a', ['b']), make('b', ['a'])]), /Circular dependency/);
			const existing = make('b', ['a']);
			existing.operation = 'update';
			assert.equal(ctx.orderTransferPlan([make('a', ['b']), existing]).length, 2);
		});
		
		// Import must forward stored credentials unchanged through the generic API:
		// no API-key-specific replacement or follow-up requests.
		require('pixl-cli').global();
		let received, contractResult;
		const keyData = { id: 'contract_key', title: 'Contract Key', key: 'stored_hash', mask: 'test****mask', active: false };
		ctx.args = { other: [file('key-contract.json', wrap([{ type: 'api_key', data: keyData }]))], confirm: true };
		ctx.xyopsVersion = '1.0.96';
		ctx.format = 'jsonc';
		ctx.getMultiple = async () => {};
		ctx.jsonOutput = value => { contractResult = value; };
		ctx.api = { createApiKey: async params => { received = params;
		return { data: { code: 0, api_key: params } }; } };
		await ctx.cmd_import();
		
		await check('new API key import uses generic pass-through contract', () => {
			assert.deepEqual(received, keyData);
			assert.equal(contractResult.items[0].id, keyData.id);
			assert.equal(contractResult.code, 0);
		});
		
		const items = [
			fixture('event', { id: prefix + 'workflow', title: prefix + 'workflow', type: 'workflow', category: prefix + 'category', triggers: [], workflow: { nodes: [{ id: 'node1', type: 'event', x: 0, y: 0, data: { event: prefix + 'event', params: {} } }],
		connections: [] } }),
			fixture('event', { category: prefix + 'category', plugin: prefix + 'plugin', targets: [prefix + 'group'], algo: 'random', params: {}, triggers: [],
		tags: [prefix + 'tag'],
		actions: [] }),
			fixture('alert', { expression: '0', message: 'Never triggered', actions: [],
		groups: [] }),
			{ type: 'api_key', data: seedKey },
			fixture('bucket'), fixture('category', { actions: [],
		limits: [] }), fixture('channel', { users: [] }),
			fixture('group', { hostname_match: '^' + prefix + 'no_hosts$', alert_actions: [] }),
			fixture('monitor', { source: '0', data_type: 'float', display: false, groups: [] }),
			fixture('plugin', { type: 'event', command: '/usr/bin/true', script: '', params: [] }),
			fixture('role', { privileges: {} }), fixture('tag'), fixture('web_hook', { method: 'POST', url: 'https://example.invalid', headers: [] })
		];
		const bundle = file('all.json', wrap(items));
		
		await check('preview all types, dependencies first, key fields preserved', () => {
			const plan = json(['import', bundle]);
			assert.equal(plan.preview, true);
			assert.equal(plan.items.length, 13);
			assert.equal(plan.items[0].type, 'web_hook');
			assert.ok(plan.items.every(item => item.operation === (item.type === 'api_key' ? 'update' : 'create') && !('revision' in item.data) && !('username' in item.data)));
			const keyData = plan.items.find(item => item.type === 'api_key').data;
			assert.ok(keyData.key === seedKey.key, 'Stored credential hash preserved');
			assert.equal(keyData.mask, seedKey.mask);
		});
		
		await check('human preview has warning toast and confirmation suggestion', () => {
			const out = xy(['import', bundle]);
			assert.match(out, /⚠️[\s\S]*Preview only\./);
			assert.match(out, /Preview only[\s\S]*--confirm/);
		});
		
		await check('confirm plus dry remains preview', () => assert.equal(json(['import', bundle, '--confirm', '--dry']).preview, true));
		
		const before = await call('getMultiple', { lists: 'all' });
		
		await check('previews do not create anything', () => {
			for (const [,list] of Object.values(types)) assert.ok(JSON.stringify(before[list].filter(item => item.id !== seedKey.id)) === JSON.stringify(original[list]), list + ' unchanged by preview');
		});
		
		const imported = json(['import', bundle, '--confirm']);
		
		await check('create all other types plus workflow and update API key', () => assert.ok(imported.items.length === 13 && imported.items.every(item => item.status === (item.type === 'api_key' ? 'updated' : 'created'))));
		
		const keyResult = imported.items.find(item => item.type === 'api_key');
		
		await check('API key import retains ID', () => assert.equal(keyResult.id, seedKey.id));
		
		const state = await call('getMultiple', { lists: 'all' });
		const key = state.api_keys.find(item => item.id === keyResult.id);
		
		await check('API key import retains credential hash and mask', () => {
			assert.ok(key.key === seedKey.key, 'Stored credential hash preserved');
			assert.equal(key.mask, seedKey.mask);
		});
		
		for (const [type, [command, list]] of Object.entries(types)) {
			const obj = state[list].find(obj => obj.title === prefix + type);
			assert.ok(obj, type);
			const path = Path.join(temp, type + '.json');
			
			await check('export ' + type, () => {
				const result = json([command, obj.id, '--export', path]);
				assert.equal(result.count, 1);
				const payload = JSON.parse(fs.readFileSync(path));
				assert.equal(payload.type, 'xypdf');
				assert.equal(payload.version, '1.0');
				assert.equal(payload.items[0].type, type);
				assert.equal(payload.items[0].data.id, obj.id);
				for (const name of ['created','modified','revision','sort_order','username']) assert.ok(!(name in payload.items[0].data));
				assert.equal(fs.statSync(path).mode & 0o777, 0o600);
				
				if (type === 'api_key') {
					assert.ok(payload.items[0].data.key === seedKey.key, 'Stored credential hash preserved');
					assert.equal(payload.items[0].data.mask, seedKey.mask);
				}
			});
			
			await check('round-trip update ' + type, () => {
				assert.equal(json(['import', path]).items[0].operation, 'update');
				const result = json(['import', path, '--confirm']);
				assert.equal(result.items[0].status, 'updated');
				assert.ok(!('plain_key' in result.items[0]));
			});
		}
		
		const bucketID = prefix + 'bucket';
		await call('writeBucketData', { id: bucketID, data: { sentinel: 'Keep me' } });
		const bucketPath = Path.join(temp, 'bucket-with-data.json');
		json(['bucket', bucketID, '--export', bucketPath]);
		
		await check('bucket export contains metadata only', () => assert.ok(!fs.readFileSync(bucketPath, 'utf8').includes('Keep me')));
		
		json(['import', bucketPath, '--confirm']);
		const bucket = await call('getBucket', { id: bucketID });
		
		await check('bucket import preserves stored data', () => assert.equal(bucket.data.sentinel, 'Keep me'));
		
		const workflowPath = Path.join(temp, "workflow's export.json.gz");
		
		await check('workflow dependencies and gzip', () => {
			const result = json(['event', prefix + 'workflow', '--export', workflowPath, '--deps', 'all']);
			assert.equal(result.count, 6);
			const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(workflowPath)));
			assert.equal(payload.items[0].data.id, prefix + 'workflow');
			assert.equal(json(['import', workflowPath]).items.length, 6);
		});
		
		await check('gzip confirmed import', () => assert.ok(json(['import', workflowPath, '--confirm']).items.every(item => item.status === 'updated')));
		
		await check('export refuses overwrite and leaves no temp file', () => {
			const originalBytes = fs.readFileSync(workflowPath);
			xy(['event', prefix + 'workflow', '--export', workflowPath], true);
			assert.deepEqual(fs.readFileSync(workflowPath), originalBytes);
			assert.ok(!fs.readdirSync(temp).some(name => name.startsWith('.xycli-export-')));
		});
		
		await check('explicit overwrite', () => assert.equal(json(['event', prefix + 'workflow', '--export', workflowPath, '--overwrite']).count, 1));
		
		const dryPath = Path.join(temp, 'dry.json');
		
		await check('dry export and named fuzzy selector', () => {
			assert.equal(json(['monitor', 'get', '--title', prefix + 'monitor', '--export', dryPath, '--dry']).payload.items[0].data.id, prefix + 'monitor');
			assert.ok(!fs.existsSync(dryPath));
		});
		
		for (const args of [
			['events', '--export', dryPath],
			['event', 'update', prefix + 'event', '--export', dryPath],
			['monitor', prefix + 'monitor', '--export', dryPath, '--deps', 'all'],
			['event', prefix + 'event', '--export', dryPath, '--deps', 'invalid'],
			['event', prefix + 'event', '--export']
		]) {
			await check('reject invalid export arguments ' + args.slice(0, 2).join(' '), () => xy(args, true));
		}
		
		const invalidFiles = [
			['missing wrapper', {}],
			['empty items', wrap([])],
			['unsupported format', { ...wrap([items[1]]), version: '2.0' }],
			['newer server required', { ...wrap([items[1]]), xyops: '999.0.0' }],
			['unsupported object type', wrap([{ type: 'job', data: { title: 'Bad' } }])],
			['duplicate IDs', wrap([items[1], items[1]])],
			['invalid ID', wrap([{ type: 'monitor', data: { id: '../bad', title: 'Bad' } }])],
			['unsafe property', JSON.parse('{"type":"xypdf","version":"1.0","items":[{"type":"monitor","data":{"title":"Bad","params":{"__proto__":{"polluted":true}}}}]}')]
		];
		
		for (const [name, payload] of invalidFiles) {
			await check('reject invalid file: ' + name, () => xy(['import', file('invalid.json', payload), '--confirm'], true));
		}
		
		const malformed = Path.join(temp, 'broken.json.gz');
		fs.writeFileSync(malformed, 'broken');
		
		await check('malformed gzip', () => xy(['import', malformed], true));
		
		const active = fixture('event', { triggers: [{ type: 'schedule', enabled: true }] });
		
		await check('preview flags active triggers', () => assert.ok(json(['import', file('active.json', wrap([active]))]).warnings.some(text => /active triggers/.test(text))));
		
		const partial = wrap([fixture('tag', { id: prefix + 'pending' }), fixture('monitor', { id: prefix + 'bad_monitor', source: 'cpu.(', data_type: 'float' }), fixture('tag', { id: prefix + 'completed' })]);
		
		await check('partial failure reports completed, failed and pending', () => {
			const result = json(['import', file('partial.json', partial), '--confirm'], true);
			assert.deepEqual(result.items.map(item => item.status), ['created','failed','pending']);
		});
		
		await check('human success output', () => assert.match(xy(['import', Path.join(temp, 'monitor.json'), '--confirm']), /IMPORT RESULTS[\s\S]*updated/));
		
		for (const topic of ['export','import']) await check('help ' + topic, () => assert.match(xy(['help', topic]), /XYPDF/));
		const now = await call('getMultiple', { lists: 'all' });
		
		await check('existing definitions unchanged', () => {
			for (const [,list] of Object.values(types)) for (const obj of original[list]) assert.ok(JSON.stringify(now[list].find(item => item.id === obj.id)) === JSON.stringify(obj), list + ' original definition unchanged');
		});
	}
	finally {
		// Consumers precede dependencies in this registry. Match titles as well
		// as IDs to catch server-generated IDs when creation partially succeeds.
		await cleanupFixtures(Object.values(types).map(([, list, suffix]) => ({
			list,
			method: 'delete' + suffix,
			match: item => item.id.startsWith(prefix) || (item.title || '').startsWith(prefix),
			sort: (a, b) => Number(b.type === 'workflow') - Number(a.type === 'workflow')
		})));
	}
});
