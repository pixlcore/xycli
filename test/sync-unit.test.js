const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const utils = require('../lib/utils.js');

// Run the real sync handler in an isolated process with an in-memory API.
// This verifies its actual exit status without contacting an xyOps server or
// allowing one failed sync to change the test runner's own process.exitCode.
const script = `
	const cli = require('pixl-cli');
	cli.global();
	const options = JSON.parse(process.argv[1]);
	cli.args.quiet = true;
	const calls = [];
	const requests = [];
	const app = {
		...require('./lib/sync.js'),
		args: options.args,
		config: {
			base_url: 'https://fixture.invalid',
			sync: options.config || {},
			ui: {
				list_list: ['categories', 'events', 'plugins'].map(id => ({ id })),
				data_types: { category: { list: 'categories' }, plugin: { list: 'plugins' } }
			}
		},
		state: {},
		categories: options.categories || [],
		events: [],
		plugins: options.plugins || [],
		version: 'test',
		dry: !!options.args.dry,
		color() { return cli.chalk.white; },
		markdown(text) { return text; },
		compareVersions() { return 0; },
		async getMultiple() {},
		die(message) { throw new Error(message); },
		async callStandardAPI(method, data) {
			calls.push(method);
			requests.push({ method, data });
			if (options.failAPI === method) throw new Error('Fixture API failure');
		}
	};
	app.cmd_sync().catch(err => {
		console.error(err.message);
		process.exitCode = 1;
	}).finally(() => {
		console.log(JSON.stringify({ calls, requests, errors: app.errors || [], warnings: app.warnings || [] }));
	});
`;

function runSync(t, options) {
	// Every scan uses a disposable tree, including deletion tests. All remote
	// objects and API calls exist only in the child process's mock adapter.
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-sync-unit-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const args = { other: [dir], ...options.args };
	
	if (options.source) {
		fs.writeFileSync(Path.join(dir, 'Category.json'), JSON.stringify({
			type: 'xypdf',
			version: '1.0',
			items: options.emptyItems ? [] : [{ type: 'category', data: options.source }]
		}));
		if (options.prefixedSource) {
			fs.writeFileSync(Path.join(dir, 'Category-Animals.json'), JSON.stringify({
				type: 'xypdf',
				version: '1.0',
				items: [{ type: 'category', data: options.prefixedSource }]
			}));
		}
		if (options.invalidNeighbor) {
			fs.writeFileSync(Path.join(dir, 'Category-script.js'), 'console.log("not a category property");\n');
		}
		if (options.duplicateSource) {
			fs.copyFileSync(Path.join(dir, 'Category.json'), Path.join(dir, 'Duplicate.json'));
		}
	}
	if (options.missingDir) args.other = [Path.join(dir, 'missing')];
	
	const result = spawnSync(process.execPath, ['-e', script, JSON.stringify({ ...options, args })], {
		cwd: Path.join(__dirname, '..'),
		encoding: 'utf8',
		timeout: 10000
	});
	assert.ifError(result.error);
	assert.equal(result.signal, null);
	const report = JSON.parse(result.stdout.trim().split('\n').pop());
	return { ...result, report };
}

test('sync update guard requires confirmation only for the exact managed object', async () => {
	var warnings = [];
	var loads = 0;
	var context = {
		args: { notes: 'Updated' },
		async getMultiple() {
			loads++;
			this.state = { sync: { 'category-managed': true, 'plugin-shared': true } };
		},
		toast(icon, color, message) {
			warnings.push({ icon, color, message });
		},
		die(message) {
			throw new Error(message);
		}
	};
	
	assert.equal(await utils.confirmSyncUpdate.call(context, 'category', 'managed', 'category'), false);
	assert.equal(loads, 1);
	assert.deepEqual(warnings.map( warning => warning.color ), ['yellow']);
	assert.match(warnings[0].message, /under remote management/);
	assert.match(warnings[0].message, /--confirm/);
	
	warnings.length = 0;
	assert.equal(await utils.confirmSyncUpdate.call(context, 'event', 'shared', 'event'), true);
	assert.deepEqual(warnings, [], 'A matching ID under another type does not block the update');
});

test('sync update guard consumes a valid confirmation before update validation', async () => {
	for (const state of [
		{ sync: { 'category-managed': true } },
		{ sync: {} }
	]) {
		var context = {
			args: { notes: 'Updated', confirm: true },
			state,
			async getMultiple() {},
			toast() {
				throw new Error('Confirmed updates must not warn');
			},
			die(message) {
				throw new Error(message);
			}
		};
		
		assert.equal(await utils.confirmSyncUpdate.call(context, 'category', 'managed', 'category'), true);
		assert.deepEqual(context.args, { notes: 'Updated' });
	}
});

test('sync update guard rejects malformed confirmation values', async () => {
	var context = {
		args: { confirm: 'yes' },
		state: { sync: {} },
		async getMultiple() {},
		toast() {},
		die(message) {
			throw new Error(message);
		}
	};
	
	await assert.rejects(
		utils.confirmSyncUpdate.call(context, 'category', 'managed', 'category'),
		/Update --confirm must be true or false/
	);
});

test('sync rejects deletion with down-only, two-way, or mixed directions before writes', t => {
	for (const args of [
		{ down: 'categories', delete: 'categories' },
		{ up: 'categories', down: 'categories', delete: 'categories', dry: true },
		{ up: 'categories', down: 'events', delete: 'categories' },
		{ up: [], delete: 'categories' }
	]) {
		const result = runSync(t, { args });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Delete mode requires up-only sync/);
		assert.deepEqual(result.report.calls, []);
	}
});

test('sync validates inherited deletion and direction settings after CLI overrides', t => {
	const config = { up: 'categories', down: 'events', delete: 'categories' };
	const blocked = runSync(t, { config, args: {} });
	assert.equal(blocked.status, 1);
	assert.deepEqual(blocked.report.calls, []);
	
	// Explicit false disables the inherited setting rather than adding to it.
	const upOnly = runSync(t, { config, args: { down: false } });
	assert.equal(upOnly.status, 0);
	const noDeletion = runSync(t, { config, args: { delete: false } });
	assert.equal(noDeletion.status, 0);
	const emptyDown = runSync(t, { args: { up: 'all', down: [], delete: true } });
	assert.equal(emptyDown.status, 0);
});

test('sync errors exit nonzero even in quiet mode or a dry run', t => {
	for (const dry of [false, true]) {
		const result = runSync(t, { missingDir: true, args: { up: 'categories', dry, quiet: true } });
		assert.equal(result.status, 1);
		assert.equal(result.report.errors.length, 1);
		assert.deepEqual(result.report.calls, []);
	}
});

test('sync API errors preserve failure status while still sending both notifications', t => {
	const category = { id: 'fixture', title: 'Fixture', notes: 'Remote' };
	for (const failAPI of ['update_category', 'update_global_state', 'delete_category']) {
		const result = runSync(t, {
			categories: [category],
			source: failAPI === 'delete_category' ? undefined : { ...category, notes: 'Local' },
			failAPI,
			args: {
				up: 'categories',
				delete: failAPI === 'delete_category' ? 'categories' : false,
				error_email: 'fixture@example.invalid',
				error_event: 'fixture_error_event'
			}
		});
		assert.equal(result.status, 1);
		assert.equal(result.report.errors.length, 1);
		assert.deepEqual(result.report.calls.slice(-2), ['sendEmail', 'runEvent']);
	}
});

test('sync skips the entire delete pass after an update or state API failure', t => {
	const category = { id: 'fixture', title: 'Fixture', notes: 'Remote' };
	const orphan = { id: 'orphan', title: 'Orphan', notes: 'Delete candidate' };
	
	for (const failAPI of ['update_category', 'update_global_state']) {
		const result = runSync(t, {
			categories: [category, orphan],
			source: { ...category, notes: 'Local' },
			failAPI,
			args: { up: 'categories', delete: 'categories' }
		});
		
		assert.equal(result.status, 1);
		assert.equal(result.report.errors.length, 1);
		assert.match(result.report.warnings[0], /Delete pass skipped/);
		assert.equal(result.report.calls.includes('update_global_state'), true);
		assert.deepEqual(result.report.requests.filter(req => req.method.startsWith('delete_')), []);
	}
});

test('sync completion-command errors also exit nonzero and notify', t => {
	const category = { id: 'fixture', title: 'Fixture', notes: 'Remote' };
	const result = runSync(t, {
		categories: [category],
		source: { ...category, notes: 'Local' },
		args: { up: 'categories', up_cmd: 'exit 2', error_event: 'fixture_error_event' }
	});
	assert.equal(result.status, 1);
	assert.match(result.report.errors[0], /Command failed/);
	assert.equal(result.report.calls.at(-1), 'runEvent');
});

test('successful syncs retain a zero exit status', t => {
	const success = runSync(t, { args: { up: 'categories' } });
	assert.equal(success.status, 0);
	assert.deepEqual(success.report.errors, []);
});

test('scan warnings exit nonzero and allow notifications, except in dry mode', t => {
	// Both missing objects and malformed sources stop the scan before changes.
	// Quiet mode must not hide their failure status, and dry mode still fails
	// validation while deliberately skipping notification actions.
	for (const dry of [false, true]) {
		for (const emptyItems of [false, true]) {
			const result = runSync(t, {
				source: { id: 'missing', title: 'Missing' },
				emptyItems,
				args: {
					up: 'categories', dry, quiet: true,
					error_email: 'fixture@example.invalid',
					error_event: 'fixture_error_event'
				}
			});
			assert.equal(result.status, 1);
			assert.equal(result.report.warnings.length, 1);
			assert.deepEqual(result.report.errors, []);
			assert.deepEqual(result.report.calls, dry ? [] : ['sendEmail', 'runEvent']);
		}
	}
});

test('duplicate-source warnings exit nonzero without applying changes', t => {
	const category = { id: 'fixture', title: 'Fixture', notes: 'Remote' };
	for (const args of [
		{ up: 'categories', delete: 'categories' },
		{ down: 'categories' },
		{ up: 'categories', dry: true }
	]) {
		const result = runSync(t, {
			categories: [category],
			source: { ...category, notes: 'Local' },
			duplicateSource: true,
			args
		});
		assert.equal(result.status, 1);
		assert.match(result.report.warnings[0], /Duplicate source item found/);
		assert.deepEqual(result.report.errors, []);
		assert.deepEqual(result.report.calls, []);
	}
});

test('a prefixed XYPDF source is never loaded as a property neighbor', t => {
	const category = { id: 'general', title: 'General', notes: '' };
	const animals = { id: 'animals', title: 'General Animals', notes: '' };
	const result = runSync(t, {
		categories: [category, animals],
		source: category,
		prefixedSource: animals,
		args: { up: 'categories', dry: true }
	});
	
	assert.equal(result.status, 0);
	assert.deepEqual(result.report.warnings, []);
	assert.deepEqual(result.report.errors, []);
	assert.equal(result.report.requests.some(request => request.method === 'update_category'), false);
});

test('a property neighbor must resolve to an existing string property', t => {
	const category = { id: 'fixture', title: 'Fixture', notes: '' };
	const result = runSync(t, {
		categories: [category],
		source: category,
		invalidNeighbor: true,
		args: { up: 'categories', dry: true }
	});
	
	assert.equal(result.status, 1);
	assert.match(result.report.warnings[0], /does not match an existing string property/);
	assert.deepEqual(result.report.errors, []);
	assert.deepEqual(result.report.calls, []);
});

test('sync deletion ignores stock and Marketplace markers for every selected type', t => {
	// No objects have local sources. Only unmarked, user-owned definitions may
	// become deletion candidates, in either an apply run or a dry-run preview.
	const protectedObjects = [
		{ id: 'stock', title: 'Stock', stock: true },
		{ id: 'marketplace', title: 'Marketplace', marketplace: { id: 'fixture/plugin' } },
		{ id: 'both', title: 'Both', stock: true, marketplace: {} },
		{ id: 'stock-false', title: 'Stock marker present', stock: false },
		{ id: 'marketplace-null', title: 'Marketplace marker present', marketplace: null }
	];
	for (const dry of [false, true]) {
		const result = runSync(t, {
			categories: [...protectedObjects, { id: 'custom-category', title: 'Custom Category' }],
			plugins: [...protectedObjects, { id: 'custom-plugin', title: 'Custom Plugin' }],
			args: {
				up: 'categories,plugins', delete: 'categories,plugins', dry,
				// Setup's inclusion switches must never override deletion protection.
				stock: true, marketplace: true
			}
		});
		assert.equal(result.status, 0);
		assert.deepEqual(result.report.errors, []);
		assert.deepEqual(result.report.warnings, []);
		assert.deepEqual(result.report.requests.filter(req => req.method.startsWith('delete_')), [
			{ method: 'delete_category', data: { id: 'custom-category' } },
			{ method: 'delete_plugin', data: { id: 'custom-plugin' } }
		]);
	}
});

test('sync deletion makes no delete requests when only protected objects exist', t => {
	const result = runSync(t, {
		plugins: [
			{ id: 'shell', title: 'Shell Plugin', stock: true },
			{ id: 'installed', title: 'Installed Plugin', marketplace: { id: 'fixture/plugin' } }
		],
		args: { up: 'plugins', delete: 'plugins' }
	});
	assert.equal(result.status, 0);
	assert.deepEqual(result.report.requests, []);
});

test('sync PID lock rejects an overlapping run and cleans up afterward', async t => {
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-sync-lock-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const lockFile = Path.join(dir, 'sync.pid');
	const holderScript = `
		const cli = require('pixl-cli');
		cli.global();
		const sync = require('./lib/sync.js');
		const app = {
			...sync,
			args: {},
			config: { base_url: 'https://fixture.invalid', sync: { lock_file: process.argv[1] } },
			die(message) { throw new Error(message); }
		};
		app.acquireSyncLock();
		console.log('LOCKED');
		setTimeout(() => { app.releaseSyncLock(); }, 750);
	`;
	const holder = spawn(process.execPath, ['-e', holderScript, lockFile], {
		cwd: Path.join(__dirname, '..'),
		stdio: ['ignore', 'pipe', 'pipe']
	});
	
	await new Promise((resolve, reject) => {
		let output = '';
		const timer = setTimeout(() => reject(new Error('Timed out waiting for lock holder')), 5000);
		holder.stdout.on('data', chunk => {
			output += chunk;
			if (output.includes('LOCKED')) {
				clearTimeout(timer);
				resolve();
			}
		});
		holder.on('error', reject);
		holder.on('exit', code => {
			if (!output.includes('LOCKED')) reject(new Error('Lock holder exited early: ' + code));
		});
	});
	
	const blocked = runSync(t, {
		config: { lock_file: lockFile },
		args: { up: 'categories', quiet: true }
	});
	assert.equal(blocked.status, 1);
	assert.match(blocked.stderr, /Another sync process is already running/);
	assert.deepEqual(blocked.report.calls, []);
	const blockedSetup = runSync(t, {
		config: { lock_file: lockFile },
		args: { other: ['setup', 'categories'], quiet: true }
	});
	assert.equal(blockedSetup.status, 1);
	assert.match(blockedSetup.stderr, /Another sync process is already running/);
	assert.deepEqual(blockedSetup.report.calls, []);
	
	await new Promise((resolve, reject) => {
		holder.on('error', reject);
		holder.on('exit', code => code === 0 ? resolve() : reject(new Error('Lock holder failed: ' + code)));
	});
	assert.equal(fs.existsSync(lockFile), false, 'Owner removed its lock at completion');
	
	const next = runSync(t, { config: { lock_file: lockFile }, args: { up: 'categories' } });
	assert.equal(next.status, 0, 'A new sync starts after the owner exits');
});

test('sync PID lock automatically recovers stale JSON and legacy numeric files', t => {
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-sync-stale-lock-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const lockFile = Path.join(dir, 'sync.pid');
	const deadPID = 2147483647;
	
	for (const contents of [
		JSON.stringify({ pid: deadPID, started: '2000-01-01T00:00:00.000Z', token: 'stale' }),
		'' + deadPID
	]) {
		fs.writeFileSync(lockFile, contents);
		const result = runSync(t, { config: { lock_file: lockFile }, args: { up: 'categories' } });
		assert.equal(result.status, 0);
		assert.equal(fs.existsSync(lockFile), false, 'Stale lock was replaced and the new lock was cleaned up');
	}
});

test('sync PID lock fails closed on malformed lock data', t => {
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-sync-invalid-lock-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const lockFile = Path.join(dir, 'sync.pid');
	fs.writeFileSync(lockFile, 'not a PID');
	
	const result = runSync(t, { config: { lock_file: lockFile }, args: { up: 'categories' } });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Invalid sync lock file/);
	assert.equal(fs.readFileSync(lockFile, 'utf8'), 'not a PID', 'Invalid lock is preserved for manual inspection');
	assert.deepEqual(result.report.calls, []);
});
