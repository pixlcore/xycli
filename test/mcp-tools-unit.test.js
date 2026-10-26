const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const { createContext } = require('../lib/mcp/context.js');
const { configuration } = require('../lib/mcp.js');
const { result } = require('../lib/mcp/results.js');
const tools = require('../lib/mcp/registry.js')();

test('tool schemas reject unsafe or ambiguous mutation inputs', async () => {
	const validate = (name, args) => tools.get(name).inputSchema['~standard'].validate(args);
	assert.equal(tools.size, 17);
	assert.ok((await validate('create_event', { event: { title: 'Test', category: 'general', enabled: false } })).issues);
	assert.ok((await validate('update_event', { id: 'test', changes: { title: 'New' } })).issues);
	assert.ok((await validate('update_event', { id: 'test', revision: 0, changes: {} })).issues);
	assert.ok((await validate('run_event', { id: 'test', test: true })).issues);
	assert.ok((await validate('delete_event', { id: 'test', delete_jobs: true })).issues);
	assert.ok((await validate('search_jobs', { limit: 101 })).issues);
	assert.ok(!(await validate('create_event', { event: { title: 'Flow', category: 'general', enabled: false, type: 'workflow', workflow: { nodes: [], connections: [] } } })).issues);
});

test('update submits only supplied changes and the expected revision', async () => {
	let request;
	const context = createContext({ update_event: async params => { request = params; return { data: { code: 0, event: { id: params.id, revision: 3 } } }; } });
	const response = await tools.get('update_event').run({ id: 'event1', revision: 2, changes: { params: { message: 'new' }, triggers: [] } }, context);
	assert.deepEqual(request, { id: 'event1', revision: 2, params: { message: 'new' }, triggers: [] });
	assert.equal(response.event.revision, 3);
});

test('context enforces read-only, cancellation and safe property names before SDK calls', async () => {
	let calls = 0;
	const api = { run_event: async () => { calls++; return { data: { code: 0 } }; } };
	await assert.rejects(createContext(api, { read_only: true }).callAPI('run_event', {}), /read-only/);
	const context = createContext(api);
	await assert.rejects(context.callAPI('run_event', {}, AbortSignal.abort()), /cancelled/);
	await assert.rejects(context.callAPI('run_event', JSON.parse('{"params":{"__proto__":{}}}')), /Unsupported property/);
	await assert.rejects(context.callAPI('admin_update', {}), /Unsupported API/);
	assert.equal(calls, 0);
});

test('transport failure reports uncertain mutations, redacts the key, and never retries', async () => {
	let calls = 0;
	const context = createContext({ run_event: async (params, options) => {
		calls++; assert.equal(options.retries, 0); return { err: 'lost connection secret-key' };
	} }, { api_key: 'secret-key' });
	await assert.rejects(context.callAPI('run_event', {}), error => /uncertain/.test(error.message) && !error.message.includes('secret-key'));
	assert.equal(calls, 1);
	const denied = createContext({ run_event: async () => ({ err: 'denied', data: { code: 'access', description: 'Denied' } }) });
	await assert.rejects(denied.callAPI('run_event'), error => error.message === 'Denied');
});

test('read tools paginate and omit API envelopes and download tokens', async () => {
	const context = createContext({
		get_events: async () => ({ data: { code: 0, rows: [{ id: 'b', title: 'Second', enabled: false }, { id: 'a', title: 'First', enabled: true }] } }),
		get_job: async () => ({ data: { code: 0, token: 'private', job: { id: 'j1', state: 'complete', data: { answer: 42 } } } })
	});
	const events = await tools.get('list_events').run({ limit: 1 }, context);
	assert.equal(events.total, 2);
	assert.equal(events.rows[0].id, 'a');
	const job = await tools.get('get_job').run({ id: 'j1' }, context);
	assert.equal(job.job.data.answer, 42);
	assert.ok(!JSON.stringify(job).includes('private'));
	assert.throws(() => result({ long: 'x'.repeat(100) }, 50), /output limit/);
});

test('configuration validates named options and limits', () => {
	assert.equal(configuration({}, { port: '9000' }).port, 9000);
	assert.equal(configuration({ mcp: { read_only: true }, mcp_port: 9001 }, {}).port, 9001);
	assert.throws(() => configuration({}, { port: 'oops' }), /port/);
	assert.throws(() => configuration({ mcp: { max_page_size: 1000 } }, {}), /max_page_size/);
	assert.throws(() => configuration({ mcp: { tls_cert: 'cert' } }, {}), /both/);
});

test('registry fails on duplicate names, invalid exports and invalid schemas', t => {
	const directory = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-mcp-registry-'));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const load = require('../lib/mcp/registry.js');
	fs.writeFileSync(Path.join(directory, 'bad.js'), 'module.exports = {};');
	assert.throws(() => load(directory), /Invalid MCP tool exports/);
	fs.unlinkSync(Path.join(directory, 'bad.js'));
	const moduleText = 'exports.run = async () => ({}); exports.describe = () => (' + JSON.stringify(tools.get('get_event').description) + ');';
	fs.writeFileSync(Path.join(directory, 'one.js'), moduleText);
	fs.writeFileSync(Path.join(directory, 'two.js'), moduleText);
	assert.throws(() => load(directory), /Duplicate/);
	fs.unlinkSync(Path.join(directory, 'one.js'));
	fs.unlinkSync(Path.join(directory, 'two.js'));
	const invalid = structuredClone(tools.get('get_event').description);
	invalid.inputSchema.properties.id.type = 'not-a-json-type';
	fs.writeFileSync(Path.join(directory, 'schema.js'), 'exports.run = async () => ({}); exports.describe = () => (' + JSON.stringify(invalid) + ');');
	assert.throws(() => load(directory));
});

test('ticket and monitoring schemas reject ambiguous targets and protected metadata', async () => {
	const validate = (name, args) => tools.get(name).inputSchema['~standard'].validate(args);
	const invalid = [
		['create_ticket', { ticket: { subject: '   ' } }],
		['create_ticket', { ticket: { subject: 'Test', username: 'admin' } }],
		['create_ticket', { ticket: { subject: 'Test', changes: [] } }],
		['create_ticket', { ticket: { subject: 'Test', template: 'job', job: 'j1' } }],
		['update_ticket', { id: 't1', changes: {} }],
		['update_ticket', { id: 't1', changes: { id: 't2' } }],
		['update_ticket', { id: 't1', changes: { due: 3600 } }],
		['update_ticket', { id: 't1', changes: { assignees: 'admin' } }],
		['comment_ticket', { id: 't1', body: ' ' }],
		['comment_ticket', { id: 't1', body: 'Hello', username: 'admin' }],
		['delete_ticket', { id: 'bad/id' }],
		['take_snapshot', {}],
		['take_snapshot', { server: 's1', group: 'main' }],
		['take_snapshot', { server: '' }],
		['search_alerts', { limit: 101 }],
		['search_snapshots', { verbose: 'true' }],
		['list_servers', { offset: -1 }]
	];
	for (const [name, args] of invalid) assert.ok((await validate(name, args)).issues, name + ': ' + JSON.stringify(args));
	for (const [name, args] of [
		['create_ticket', { ticket: { subject: 'Test', type: 'custom', status: 'custom' } }],
		['update_ticket', { id: 't1', changes: { due: 0, server: '', category: '', assignees: [], tags: [] } }],
		['update_ticket', { id: 't1', changes: { due: 1800000000 } }],
		['take_snapshot', { server: 's1' }], ['take_snapshot', { group: 'main' }]
	]) assert.ok(!(await validate(name, args)).issues, name + ': ' + JSON.stringify(args));
});

test('ticket mutations preserve partial updates and keep history out of summaries', async () => {
	const requests = [];
	const api = {};
	for (const name of ['create_ticket', 'update_ticket', 'delete_ticket', 'add_ticket_change']) {
		api[name] = async params => {
			requests.push({ name, params });
			return { data: { code: 0, ticket: { id: 't1', num: 1, subject: 'Test', body: 'Large body', changes: [{ body: 'Old history' }, { id: 'c1', type: 'comment', body: 'New comment', username: 'key1', date: 123 }] } } };
		};
	}
	const context = createContext(api);
	const created = await tools.get('create_ticket').run({ ticket: { subject: 'Test', body: 'Markdown' } }, context);
	assert.equal(created.ticket.id, 't1');
	assert.ok(!('body' in created.ticket) && !('changes' in created.ticket));
	await tools.get('update_ticket').run({ id: 't1', changes: { tags: [], server: '', due: 0 } }, context);
	assert.deepEqual(requests[1], { name: 'update_ticket', params: { id: 't1', tags: [], server: '', due: 0 } });
	const comment = await tools.get('comment_ticket').run({ id: 't1', body: 'New comment' }, context);
	assert.deepEqual(requests[2].params, { id: 't1', change: { type: 'comment', body: 'New comment' } });
	assert.equal(comment.comment.id, 'c1');
	assert.equal(comment.comment.username, 'key1');
	assert.ok(!JSON.stringify(comment).includes('Old history'));
	assert.deepEqual(await tools.get('delete_ticket').run({ id: 't1' }, context), { id: 't1', deleted: true });
});

test('monitoring reads preserve queries, bound pages and filter authorized server summaries', async () => {
	const requests = [];
	const api = {
		get_active_servers: async () => ({ data: { code: 0, rows: [
			{ id: 's3', hostname: 'WEB-3', groups: ['main'], enabled: false, socket_id: 'internal' },
			{ id: 's2', hostname: 'web-2', groups: ['other'], enabled: false },
			{ id: 's1', hostname: 'web-1', groups: ['main'], enabled: false },
			{ id: 's4', hostname: 'web-4', groups: ['main'], enabled: true }
		] } })
	};
	for (const name of ['search_alerts', 'search_snapshots']) api[name] = async params => {
		requests.push({ name, params });
		return { data: { code: 0, rows: [{ id: 'record1', data: { cpu: 42 } }], list: { length: 50 } } };
	};
	const context = createContext(api, { max_page_size: 2 });
	const alerts = await tools.get('search_alerts').run({ query: 'active:true server:s1', offset: 4, limit: 10, sort_by: 'start', sort_dir: 1 }, context);
	assert.deepEqual(requests[0].params, { query: 'active:true server:s1', offset: 4, limit: 2, sort_by: 'start', sort_dir: 1 });
	assert.equal(alerts.total, 50);
	assert.equal(alerts.limit, 2);
	const snapshots = await tools.get('search_snapshots').run({}, context);
	assert.deepEqual(requests[1].params, { query: '*', offset: 0, limit: 2, sort_by: '_id', sort_dir: -1, verbose: false });
	assert.equal(snapshots.rows[0].data.cpu, 42);
	await tools.get('search_snapshots').run({ verbose: true, limit: 1 }, context);
	assert.equal(requests[2].params.verbose, true);
	const servers = await tools.get('list_servers').run({ hostname: 'WeB', group: 'main', enabled: false, offset: 1, limit: 1 }, context);
	assert.equal(servers.total, 2);
	assert.equal(servers.rows[0].id, 's3');
	assert.ok(!('socket_id' in servers.rows[0]));
});

test('all new write APIs enforce read-only, key scoping and uncertain outcomes', async () => {
	const mutations = [
		['create_ticket', { ticket: { subject: 'Test' } }, 'create_ticket'],
		['update_ticket', { id: 't1', changes: { status: 'closed' } }, 'update_ticket'],
		['delete_ticket', { id: 't1' }, 'delete_ticket'],
		['comment_ticket', { id: 't1', body: 'Test' }, 'add_ticket_change'],
		['take_snapshot', { server: 's1' }, 'create_snapshot'],
		['take_snapshot', { group: 'main' }, 'create_group_snapshot']
	];
	for (const [name, args, method] of mutations) {
		let calls = 0;
		const api = { [method]: async (params, options) => {
			calls++;
			assert.equal(options.retries, 0);
			assert.equal(options.headers['X-API-Key'], 'client-key');
			return { err: 'lost connection client-key' };
		} };
		assert.equal(tools.get(name).description.annotations.readOnlyHint, false);
		await assert.rejects(tools.get(name).run(args, createContext(api, { read_only: true })), /read-only/);
		assert.equal(calls, 0);
		const scoped = createContext(api, { api_key: 'server-key' }).withApiKey('client-key');
		await assert.rejects(tools.get(name).run(args, scoped), error => /uncertain/.test(error.message) && !error.message.includes('client-key'));
		assert.equal(calls, 1);
		api[method] = async () => ({ data: { code: 'access', description: 'Permission denied' } });
		await assert.rejects(tools.get(name).run(args, scoped), error => error.message === 'Permission denied');
	}
});

test('take_snapshot dispatches server and group requests without starting watches', async () => {
	const context = createContext({
		create_snapshot: async params => { assert.deepEqual(params, { server: 's1' }); return { data: { code: 0, id: 'sn1' } }; },
		create_group_snapshot: async params => { assert.deepEqual(params, { group: 'main' }); return { data: { code: 0, id: 'sn2' } }; }
	});
	assert.deepEqual(await tools.get('take_snapshot').run({ server: 's1' }, context), { id: 'sn1', type: 'server', server: 's1' });
	assert.deepEqual(await tools.get('take_snapshot').run({ group: 'main' }, context), { id: 'sn2', type: 'group', group: 'main' });
});
