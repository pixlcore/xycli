const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const { spawnSync } = require('node:child_process');

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
