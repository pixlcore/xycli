const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const { spawnSync } = require('node:child_process');

function createConfigFixture(t, initial) {
	// Give each CLI process a disposable home directory.  Config commands exit
	// before contacting xyOps, so these checks need no development server.
	const home_dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-config-'));
	t.after(() => fs.rmSync(home_dir, { recursive: true, force: true }));
	const file = Path.join(home_dir, '.config', 'xyops', 'cli.json');
	
	if (initial) {
		fs.mkdirSync(Path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(initial, null, '\t') + '\n');
	}
	
	return {
		file,
		run(args) {
			const result = spawnSync(process.execPath, [Path.join(__dirname, '..', 'index.js'), 'config', ...args], {
				encoding: 'utf8',
				timeout: 10000,
				env: {
					...process.env,
					HOME: home_dir,
					XYOPS_API_KEY: 'fixture-key',
					XYOPS_BASE_URL: 'https://fixture.invalid',
					XYOPS_ITEMS_PER_PAGE: '99',
					XYOPS_COLOR: 'false'
				}
			});
			
			// Keep captured CLI output out of assertion messages, since a config
			// command may display settings inherited from the real system file.
			assert.ifError(result.error);
			assert.equal(result.status, 0, 'Config command should succeed');
			return result.stdout;
		},
		read() { return JSON.parse(fs.readFileSync(file, 'utf8')); }
	};
}

test('config updates only requested user settings without saving inherited overrides', t => {
	const fixture = createConfigFixture(t, {
		items_per_page: 10,
		base_url: 'https://saved.invalid',
		suggest: true,
		sync: { up: ['events'], down: false }
	});
	fixture.run(['--items_per_page', '25']);
	
	// The environment deliberately conflicts with saved values.  Saving one
	// preference must preserve the original user layer and exclude inherited
	// credentials, display settings, and any machine-wide configuration.
	assert.deepEqual(fixture.read(), {
		items_per_page: 25,
		base_url: 'https://saved.invalid',
		suggest: true,
		sync: { up: ['events'], down: false }
	});
	assert.equal(fs.statSync(fixture.file).mode & 0o777, 0o600);
});

test('config creates a missing user file with only supplied settings', t => {
	const fixture = createConfigFixture(t);
	fixture.run(['--items_per_page', '25']);
	
	assert.deepEqual(fixture.read(), { items_per_page: 25 });
	assert.equal(fs.statSync(fixture.file).mode & 0o777, 0o600);
});

test('config dotted updates preserve sibling user settings and explicit false or zero values', t => {
	const fixture = createConfigFixture(t, {
		sync: { up: ['events'], down: ['plugins'], error_email: 'ops@example.com' },
		suggest: true
	});
	fixture.run(['--sync.down', 'false', '--sync.cmd_timeout', '0', '--suggest', 'false']);
	
	assert.deepEqual(fixture.read(), {
		sync: { up: ['events'], down: false, error_email: 'ops@example.com', cmd_timeout: 0 },
		suggest: false
	});
});

test('config display shows effective environment overrides without writing the user file', t => {
	const fixture = createConfigFixture(t, { items_per_page: 10 });
	const original = fs.readFileSync(fixture.file, 'utf8');
	const output = fixture.run([]);
	
	assert.match(output, /"items_per_page": 99/);
	assert.doesNotMatch(output, /fixture-key/);
	assert.equal(fs.readFileSync(fixture.file, 'utf8'), original);
});
