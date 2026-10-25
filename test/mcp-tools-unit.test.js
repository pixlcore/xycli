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
	assert.equal(tools.size, 9);
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
