const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('@pixlcore/xyops-sdk');
const { loadTestConfig, createCheck, xy, json, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('jobs', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// This suite launches short-lived Shell Plugin Jobs, waits for each one to
	// become final, and records every Job ID immediately for exact cleanup.
	const stamp = Date.now();
	const eventID = 'cli_job_test_' + stamp;
	const eventTitle = 'CLI Job Test ' + stamp;
	const marker = 'XYCLI_JOB_TEST_' + stamp;
	const script = 'echo "' + marker + '"';
	const jobIDs = new Set();
	let eventCreated = false;
	
	async function loadJob(id) {
		const result = await sdk.api.getJob({ id: id, remove: 'timelines' });
		if (result.err || !result.data || !result.data.job) return null;
		return result.data.job;
	}
	
	async function waitForFinalJob(id, timeout = 20000) {
		const expires = Date.now() + timeout;
		while (Date.now() < expires) {
			const job = await loadJob(id);
			if (job && job.final) return job;
			await new Promise(resolve => setTimeout(resolve, 200));
		}
		throw new Error('Timed out waiting for Job to complete: ' + id);
	}
	
	function launchedJobID(output) {
		const match = output.match(/Successfully launched job: #(\w+)/i);
		assert.ok(match, 'CLI printed the launched Job ID');
		jobIDs.add(match[1]);
		return match[1];
	}
	
	async function cleanupJobs() {
		const errors = [];
		for (const id of jobIDs) {
			try {
				let job = await loadJob(id);
				if (!job) continue;
				if (!job.final) {
					await sdk.api.abortJob({ id: id });
					job = await waitForFinalJob(id, 10000);
				}
				const result = await sdk.api.deleteJob({ id: id });
				if (result.err) throw result.err;
			}
			catch (error) { errors.push(error); }
		}
		if (errors.length) throw new AggregateError(errors, 'Disposable Job cleanup failed.');
	}
	
	try {
		let category;
		let plugin;
		let serverID;
		
		await check('local server can run a Shell Plugin Job', async () => {
			const data = await apiCall('getMultiple', { lists: 'categories,plugins', servers: 1 });
			category = data.categories.find(item => item.enabled) || data.categories[0];
			plugin = data.plugins.find(item => item.id == 'shellplug' && item.enabled);
			serverID = Object.keys(data.servers || {})[0];
			assert.ok(category && category.enabled, 'An enabled Category is required');
			assert.ok(plugin, 'The enabled stock shellplug Event Plugin is required');
			assert.ok(serverID, 'A connected Server is required');
		});
		
		// Mark cleanup eligibility before creation.  This also covers the rare case
		// where the server commits the Event but the client loses the response.
		eventCreated = true;
		await apiCall('createEvent', {
			id: eventID,
			title: eventTitle,
			enabled: true,
			category: category.id,
			plugin: plugin.id,
			params: { script: script },
			fields: [],
			tags: [],
			targets: [serverID],
			algo: 'random',
			notes: 'Disposable CLI Job test Event',
			actions: [],
			limits: [],
			triggers: [{ type: 'manual', enabled: true }]
		});
		
		await check('dry run previews overrides without launching a Job', () => {
			const req = json(['run', eventID, '--params.script', script, '--input.data.marker', marker, '--dry']);
			assert.equal(req.id, eventID);
			assert.equal(req.params.script, script);
			assert.equal(req.input.data.marker, marker);
		});
		
		const launchOutput = xy(['run', eventID, '--params.script', script, '--input.data.marker', marker]);
		const firstJobID = launchedJobID(launchOutput);
		let firstJob = await waitForFinalJob(firstJobID);
		
		await check('run launches a successful Event-backed Job', () => {
			assert.match(launchOutput, /Watch job live:/);
			assert.equal(firstJob.id, firstJobID);
			assert.equal(firstJob.event, eventID);
			assert.equal(firstJob.plugin, plugin.id);
			assert.equal(firstJob.server, serverID);
			assert.equal(firstJob.final, true);
			assert.equal(firstJob.code || 0, 0);
			assert.equal(firstJob.params.script, script);
			assert.equal(firstJob.input.data.marker, marker);
			assert.match(firstJob.output || '', new RegExp(marker));
		});
		
		await check('Job get supports JSON and human reports', () => {
			assert.deepEqual(json(['job', firstJobID]), firstJob);
			const out = xy(['job', firstJobID]);
			assert.match(out, /JOB SUMMARY/);
			assert.match(out, new RegExp(firstJobID));
			assert.match(out, /Job completed successfully/i);
			assert.match(out, /Other Commands:/);
		});
		
		await check('verbose Job detail and Job log include process output', () => {
			assert.match(xy(['job', firstJobID, '--verbose']), new RegExp(marker));
			assert.match(xy(['job', 'log', firstJobID]), new RegExp(marker));
		});
		
		await check('completed Job search finds the launched Job', () => {
			const out = xy(['jobs', '--event', eventID]);
			assert.match(out, /JOB SEARCH RESULTS/);
			assert.match(out, new RegExp(firstJobID));
			assert.match(out, new RegExp(eventTitle));
		});
		
		await check('dry rerun previews the original Job settings', () => {
			const req = json(['job', 'run', firstJobID, '--dry']);
			assert.equal(req.id, eventID);
			assert.equal(req.event, eventID);
			assert.equal(req.params.script, script);
			assert.equal(req.input.data.marker, marker);
		});
		
		const rerunOutput = xy(['job', 'run', firstJobID]);
		const secondJobID = launchedJobID(rerunOutput);
		const secondJob = await waitForFinalJob(secondJobID);
		
		await check('Job rerun launches a distinct successful Job', () => {
			assert.notEqual(secondJob.id, firstJobID);
			assert.equal(secondJob.event, eventID);
			assert.equal(secondJob.code || 0, 0);
			assert.equal(secondJob.params.script, script);
			assert.equal(secondJob.input.data.marker, marker);
			assert.match(secondJob.output || '', new RegExp(marker));
		});
		
		await check('completed Job refuses active-only operations', () => {
			assert.match(xy(['job', 'abort', firstJobID], { fail: true }), /already completed/i);
			assert.match(xy(['job', 'resume', firstJobID], { fail: true }), /already completed/i);
		});
		
		await check('unconfirmed Job delete shows its target and warning', () => {
			const out = xy(['job', 'delete', firstJobID]);
			assert.match(out, /DELETE JOB/);
			assert.match(out, new RegExp(firstJobID));
			assert.match(out, /Please confirm the delete/);
		});
		
		await check('dry Job delete leaves the completed Job intact', async () => {
			assert.deepEqual(json(['job', 'delete', firstJobID, '--confirm', '--dry']), { id: firstJobID });
			assert.ok(await loadJob(firstJobID));
		});
		
		for (const id of [firstJobID, secondJobID]) {
			xy(['job', 'delete', id, '--confirm']);
		}
		
		await check('confirmed Job delete removes both completed Jobs', async () => {
			assert.equal(await loadJob(firstJobID), null);
			assert.equal(await loadJob(secondJobID), null);
			jobIDs.delete(firstJobID);
			jobIDs.delete(secondJobID);
		});
		
		await apiCall('deleteEvent', { id: eventID });
		eventCreated = false;
		
		for (const topic of ['jobs', 'job', 'job get', 'job log', 'job run', 'job resume', 'job abort', 'job delete']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
	}
	finally {
		await cleanupJobs();
		if (eventCreated) {
			await cleanupFixtures([
				{ list: 'events', method: 'deleteEvent', match: item => item.id == eventID || (item.title || '').startsWith(eventTitle) }
			]);
		}
	}
});
