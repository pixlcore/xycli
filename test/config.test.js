const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const { spawnSync } = require('node:child_process');
const config = require('../lib/config.js');

function assertPrivateMode(file) {
	// Windows permissions are represented by ACLs, not Unix owner/group/other
	// mode bits.  The file still has to exist, but an exact 0600 assertion only
	// describes the Unix behavior that fs.chmodSync can enforce.
	assert.equal(fs.existsSync(file), true);
	if (process.platform != 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
}

function createConfigFixture(t, initial) {
	// Give each CLI process a disposable home directory.  Config commands exit
	// before contacting xyOps, so these checks need no development server.
	const home_dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-config-'));
	const program_data = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-program-data-'));
	t.after(() => {
		fs.rmSync(home_dir, { recursive: true, force: true });
		fs.rmSync(program_data, { recursive: true, force: true });
	});
	const file = Path.join(home_dir, '.config', 'xyops', 'cli.json');
	
	if (initial) {
		fs.mkdirSync(Path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(initial, null, '\t') + '\n');
	}
	
	return {
		file,
		run(args) {
			const env = {
				...process.env,
				HOME: home_dir,
				USERPROFILE: home_dir,
				ProgramData: program_data,
				XYOPS_API_KEY: 'fixture-key',
				XYOPS_BASE_URL: 'https://fixture.invalid',
				XYOPS_ITEMS_PER_PAGE: '99',
				XYOPS_COLOR: 'false'
			};
			
			// Prove the Windows code path does not receive a compatibility HOME
			// variable from Git Bash, WSL, or the parent test environment.
			if (process.platform == 'win32') delete env.HOME;
			
			const result = spawnSync(process.execPath, [Path.join(__dirname, '..', 'index.js'), 'config', ...args], {
				encoding: 'utf8',
				timeout: 10000,
				windowsHide: true,
				env
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

test('config resolves native Unix and Windows source paths', () => {
	assert.deepEqual(config.getConfigFiles('linux', {}, '/home/nick'), [
		'/etc/xyops/cli.json',
		'/home/nick/.config/xyops/cli.json'
	]);
	assert.deepEqual(config.getConfigFiles('win32', { ProgramData: 'C:\\ProgramData' }, 'C:\\Users\\Nick'), [
		'C:\\ProgramData\\xyops\\cli.json',
		'C:\\Users\\Nick\\.config\\xyops\\cli.json'
	]);
	assert.deepEqual(config.getConfigFiles('win32', { ALLUSERSPROFILE: 'D:\\SharedData' }, 'C:\\Users\\Nick'), [
		'D:\\SharedData\\xyops\\cli.json',
		'C:\\Users\\Nick\\.config\\xyops\\cli.json'
	]);
	assert.deepEqual(config.getConfigFiles('win32', {}, 'C:\\Users\\Nick'), [
		'C:\\Users\\Nick\\.config\\xyops\\cli.json'
	]);
});

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
	assertPrivateMode(fixture.file);
});

test('config creates a missing user file with only supplied settings', t => {
	const fixture = createConfigFixture(t);
	fixture.run(['--items_per_page', '25']);
	
	assert.deepEqual(fixture.read(), { items_per_page: 25 });
	assertPrivateMode(fixture.file);
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
