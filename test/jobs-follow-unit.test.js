const { test } = require('node:test');
const assert = require('node:assert/strict');
const cli = require('pixl-cli');
const jobs = require('../lib/jobs.js');

cli.global();

function makeFollower(t, records) {
	// Exercise the real command transitions with an offline SDK stub.  Streaming
	// finishes an attempt, but only getJob exposes its additional-job links.
	const streamed = [];
	const results = [];
	const context = {
		...jobs,
		args: { id: records[0].id },
		format: 'json',
		async getMultiple() {},
		api: {
			async getJob({ id }) {
				const job = records.find( item => item.id === id );
				assert.ok(job, 'Unexpected job lookup: ' + id);
				return { data: { job: { ...job } } };
			},
			async streamJob({ id }, callback) {
				const job = records.find( item => item.id === id );
				streamed.push(id);
				job.final = true;
				callback({ id, final: true, code: job.code });
				return {};
			}
		},
		jsonOutput(job) { results.push(job.id); },
		die(message) { throw new Error(message); },
		color() { return cli.chalk.white; },
		printBoxList() {}
	};
	
	// Keep terminal rendering out of these tests, including progress timers.
	for (const name of ['start', 'update', 'end']) t.mock.method(cli.progress, name, () => {});
	for (const name of ['print', 'println', 'verboseln']) t.mock.method(global, name, () => {});
	for (const name of ['getNiceJob', 'getNiceJobEvent', 'getNiceCategory', 'getNicePlugin',
		'getNiceTargets', 'getNiceServer', 'getNiceAlgo', 'getNiceJobSource',
		'getRelativeDateTime', 'getNiceJobState']) {
		context[name] = () => '';
	}
	
	return { context, streamed, results };
}

test('live follow crosses completed and queued retries, ignoring unrelated jobs', async t => {
	const { context, streamed, results } = makeFollower(t, [
		{ id: 'initial', code: 1, jobs: [{ id: 'other', reason: 'action' }, { id: 'retry1', reason: 'retry' }] },
		{ id: 'retry1', final: true, code: 'warning', jobs: [{ id: 'retry2', reason: 'retry' }] },
		{ id: 'retry2', state: 'queued', code: 0 }
	]);
	
	await context.cmd_stream_job();
	assert.deepEqual(streamed, ['initial', 'retry2']);
	assert.deepEqual(results, ['retry2']);
});

test('directly opening an active job also follows its retry', async t => {
	const { context, streamed, results } = makeFollower(t, [
		{ id: 'initial', code: 1, jobs: [{ id: 'retry', reason: 'retry' }] },
		{ id: 'retry', code: 2 }
	]);
	
	await context.cmd_get_job();
	assert.deepEqual(streamed, ['initial', 'retry']);
	assert.deepEqual(results, ['retry']);
});

test('follow catches retries when the initial job finishes before streaming starts', async t => {
	const { context, streamed, results } = makeFollower(t, [
		{ id: 'initial', final: true, code: 1, jobs: [{ id: 'retry', reason: 'retry' }] },
		{ id: 'retry', code: 0 }
	]);
	
	await context.cmd_stream_job();
	assert.deepEqual(streamed, ['retry']);
	assert.deepEqual(results, ['retry']);
});

test('opening a completed job preserves the requested attempt', async t => {
	const { context, streamed, results } = makeFollower(t, [
		{ id: 'initial', final: true, code: 1, jobs: [{ id: 'retry', reason: 'retry' }] }
	]);
	
	await context.cmd_get_job();
	assert.deepEqual(streamed, []);
	assert.deepEqual(results, ['initial']);
});

test('follow stops on success or failure without a valid retry link', async t => {
	for (const record of [
		{ code: 0, jobs: [{ id: 'other', reason: 'retry' }] },
		{ code: 1 },
		{ code: 1, jobs: [] },
		{ code: 1, jobs: {} },
		{ code: 1, jobs: [null, { reason: 'retry' }, { id: 'other', reason: 'action' }] }
	]) {
		const { context, streamed, results } = makeFollower(t, [{ id: 'initial', ...record }]);
		await context.cmd_stream_job();
		assert.deepEqual(streamed, ['initial']);
		assert.deepEqual(results, ['initial']);
	}
});
