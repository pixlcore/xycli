// Verify a shared workflow graph can be exported, deleted, and recreated.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, json, call, cleanupFixtures } = require('./helpers/common.js');

test('transfer-workflow', async t => {
	loadTestConfig();
	const check = createCheck(t);
	const prefix = 'cli_transfer_graph_' + Date.now() + '_';
	const temp = createTempDir(t, 'xycli-graph-');
	
	async function cleanup() {
		// Delete workflow consumers first, followed by their shared dependencies.
		await cleanupFixtures([
			{ list: 'events', method: 'deleteEvent' },
			{ list: 'plugins', method: 'deletePlugin' },
			{ list: 'categories', method: 'deleteCategory' },
			{ list: 'groups', method: 'deleteGroup' }
		].map(resource => ({
			...resource,
			match: item => item.id.startsWith(prefix),
			sort: (a, b) => Number(b.type === 'workflow') - Number(a.type === 'workflow')
		})));
	}
	
	try {
		// All events are disabled and have no triggers. The group matches no
		// hosts, so no fixture can accidentally launch a job on a real server.
		await call('createGroup', {
			id: prefix + 'group',
			title: prefix + 'group',
			hostname_match: '^' + prefix + 'no_hosts$',
			alert_actions: []
		});
		
		await call('createCategory', {
			id: prefix + 'category',
			title: prefix + 'category',
			enabled: false,
			actions: [],
			limits: []
		});
		
		await call('createPlugin', {
			id: prefix + 'plugin',
			title: prefix + 'plugin',
			type: 'event',
			command: '/usr/bin/true',
			enabled: false,
			params: []
		});
		
		await call('createEvent', {
			id: prefix + 'leaf',
			title: prefix + 'leaf',
			enabled: false,
			category: prefix + 'category',
			plugin: prefix + 'plugin',
			targets: [prefix + 'group'],
			algo: 'random',
			triggers: []
		});
		
		// Both branches reference the same leaf. Import must create that shared
		// leaf before either consumer, regardless of export traversal order.
		for (const [name, refs] of [['a', ['leaf']], ['b', ['leaf']], ['root', ['a', 'b']]]) {
			await call('createEvent', {
				id: prefix + name,
				title: prefix + name,
				enabled: false,
				type: 'workflow',
				category: prefix + 'category',
				triggers: [],
				workflow: {
					nodes: refs.map((ref, idx) => ({
						id: 'node' + idx,
						type: 'event',
						x: idx * 100,
						y: 0,
						data: { event: prefix + ref, params: {} }
					})),
					connections: []
				}
			});
		}
		
		const filename = Path.join(temp, 'shared-workflow.json.gz');
		await check('export includes all seven graph objects', () => {
			assert.equal(json(['event', prefix + 'root', '--export', filename, '--deps', 'all']).count, 7);
		});
		
		await cleanup();
		
		await check('fresh import orders the shared leaf before both consumers', () => {
			const preview = json(['import', filename]);
			assert.equal(preview.items.length, 7);
			assert.ok(preview.items.every(item => item.operation === 'create'));
			
			const order = preview.items.map(item => item.data.id);
			assert.ok(order.indexOf(prefix + 'leaf') < order.indexOf(prefix + 'b'));
			assert.ok(order.indexOf(prefix + 'leaf') < order.indexOf(prefix + 'a'));
			assert.equal(order[order.length - 1], prefix + 'root');
		});
		
		await check('confirmed import recreates all seven graph objects', () => {
			const result = json(['import', filename, '--confirm']);
			assert.equal(result.items.length, 7);
			assert.ok(result.items.every(item => item.status === 'created'));
		});
		
		await check('restored workflow retains its branches and disabled state', async () => {
			const restored = await call('getMultiple', { lists: 'all' });
			const root = restored.events.find(event => event.id === prefix + 'root');
			assert.equal(root.workflow.nodes.length, 2);
			assert.equal(root.enabled, false);
		});
	}
	finally {
		await cleanup();
	}
});
