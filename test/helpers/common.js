// Shared setup for the live CLI integration tests. No third-party test framework.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const cp = require('node:child_process');
const root = Path.resolve(__dirname, '../..');

function loadTestConfig() {
	// Use the same config files and environment overrides as the CLI. Every
	// suite checks the destination, including when run directly with node --test.
	const app = {};
	require('../../lib/config.js').loadConfig.call(app);
	
	assert.ok(/^http:\/\/localhost:5522\/?$/.test(app.config.base_url || ''),
		'Tests require XYOPS_BASE_URL=http://localhost:5522 (or the equivalent CLI config).');
	assert.ok(app.config.api_key, 'Tests require an administrator API key in the CLI config or XYOPS_API_KEY.');
	
	return app.config;
}

function createCheck(t) {
	// Each check gets its own native test result. Lifecycle steps depend on
	// earlier steps, so stop this suite on failure and let its cleanup run.
	return async function check(name, callback) {
		let passed = false;
		
		await t.test(name, async () => {
			await callback();
			passed = true;
		});
		
		if (!passed) throw new Error('Lifecycle stopped after failed check: ' + name);
	};
}

function createTempDir(t, prefix) {
	// Register immediately so local files are removed even if setup or server
	// cleanup fails. Each suite has a private directory outside the repository.
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), prefix));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	
	return dir;
}

function runCLI(args, options = {}) {
	// These tests deliberately exercise the public executable in fresh processes.
	// Captured output can contain API secrets, so keep it out of failure reports.
	const result = cp.spawnSync(process.execPath, [
		...(options.preload ? ['--require', options.preload] : []),
		Path.join(root, 'index.js'),
		...args
	], {
		// Most suites run from the project root. Filesystem-oriented commands can
		// override this with a private temporary directory while still invoking the
		// real CLI executable by its absolute path.
		cwd: options.cwd || root,
		encoding: 'utf8',
		timeout: 30000,
		maxBuffer: 16 * 1024 * 1024,
		input: options.input,
		windowsHide: true,
		env: {
			...process.env,
			XYOPS_COLOR: 'false',
			XYOPS_SUGGEST: 'true',
			XYOPS_DEBUG: 'false',
			XYOPS_VERBOSE: 'false',
			...options.env
		}
	});
	
	assert.ok(!result.error && result.signal === null, 'CLI process completed: ' + args[0]);
	assert.equal(result.status === 0, !options.fail, 'Unexpected CLI exit status: ' + args.slice(0, 2).join(' '));
	
	return result.stdout + result.stderr;
}

function xy(args, options = {}) {
	// Accept the boolean failure shorthand used by the export and log suites.
	return runCLI(args, typeof options === 'boolean' ? { fail: options } : options);
}

function json(args, options) {
	const output = xy([...args, '--format', 'jsonc'], options);
	const line = output.split('\n').find(line => /^[\[{]/.test(line));
	assert.ok(line, 'CLI returned JSON: ' + args[0]);
	
	return JSON.parse(line);
}

async function call(method, params) {
	const { api } = require('@pixlcore/xyops-sdk');
	const result = await api[method](params);
	assert.ok(!result.err && result.data && result.data.code === 0, 'API request succeeded: ' + method);
	
	return result.data;
}

async function cleanupFixtures(resources) {
	// Match only this run's unique IDs/titles. Continue deleting other fixtures
	// if one deletion fails, then report cleanup failures without response data.
	const data = await call('getMultiple', { lists: 'all' });
	const errors = [];
	
	for (const resource of resources) {
		const objects = data[resource.list].filter(resource.match);
		if (resource.sort) objects.sort(resource.sort);
		
		for (const object of objects) {
			try { await call(resource.method, { id: object.id }); }
			catch (error) { errors.push(error); }
		}
	}
	
	// Verify deletion even when an API returned success. Only names of resource
	// lists appear in failures; never dump complete definitions or credentials.
	const remaining = await call('getMultiple', { lists: 'all' });
	for (const resource of resources) {
		if (remaining[resource.list].some(resource.match)) {
			errors.push(new Error('Disposable fixtures remain in ' + resource.list));
		}
	}
	
	if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed. Check the local server before rerunning.');
}

module.exports = { loadTestConfig, createCheck, createTempDir, runCLI, xy, json, call, cleanupFixtures };
