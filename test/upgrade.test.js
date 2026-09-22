const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const pkg = require('../package.json');
const { xy } = require('./helpers/common.js');

const preload = Path.join(__dirname, 'helpers', 'upgrade-preload.js');
const offlineEnv = {
	XYOPS_API_KEY: '',
	XYOPS_BASE_URL: ''
};

function createUpgradeFixture(t, latest) {
	// Each command gets private observation files. The preload records registry
	// and spawn calls without contacting npm or installing anything globally.
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-upgrade-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	
	return {
		requestFile: Path.join(dir, 'request.json'),
		spawnFile: Path.join(dir, 'spawn.json'),
		run(args, options = {}) {
			return xy(['upgrade', ...args], {
				preload: preload,
				fail: options.fail,
				env: {
					...offlineEnv,
					XYCLI_TEST_LATEST_VERSION: latest,
					XYCLI_TEST_REQUEST_FILE: this.requestFile,
					XYCLI_TEST_SPAWN_FILE: this.spawnFile,
					...options.env
				}
			});
		}
	};
}

test('upgrade checks npm and works without xyOps credentials', t => {
	const fixture = createUpgradeFixture(t, pkg.version);
	const output = fixture.run([]);
	const request = JSON.parse(fs.readFileSync(fixture.requestFile, 'utf8'));
	const escaped_version = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	assert.equal(request.url, 'https://registry.npmjs.org/@pixlcore%2Fxycli/latest');
	assert.equal(request.headers.Accept, 'application/json');
	assert.match(request.headers['User-Agent'], /^@pixlcore\/xycli\/v/);
	assert.match(output, new RegExp('Installed Version:\\s+v' + escaped_version));
	assert.match(output, new RegExp('Latest Version:\\s+v' + escaped_version));
	assert.match(output, /Up to date/);
	assert.equal(fs.existsSync(fixture.spawnFile), false);
});

test('upgrade advertises a newer version without installing it', t => {
	const fixture = createUpgradeFixture(t, '99.0.0');
	const output = fixture.run([]);
	
	assert.match(output, /Upgrade available/);
	assert.match(output, /A new xyCLI version is available!/);
	assert.match(output, /--confirm/);
	assert.equal(fs.existsSync(fixture.spawnFile), false);
});

test('confirmed upgrade installs the exact checked version with inherited stdio', t => {
	const fixture = createUpgradeFixture(t, '99.0.0');
	const output = fixture.run(['--confirm']);
	const spawn = JSON.parse(fs.readFileSync(fixture.spawnFile, 'utf8'));
	
	assert.match(output, /Running command:\s+npm install --global @pixlcore\/xycli@99\.0\.0/);
	assert.match(output, /Successfully upgraded xyCLI to v99\.0\.0/);
	assert.equal(spawn.command, 'npm install --global @pixlcore/xycli@99.0.0');
	assert.equal(spawn.shell, true);
	assert.equal(spawn.stdio, 'inherit');
	assert.equal(spawn.windowsHide, false);
});

test('upgrade dry run prints the pinned command without spawning npm', t => {
	const fixture = createUpgradeFixture(t, '99.0.0');
	const output = fixture.run(['--confirm', '--dry']);
	
	assert.match(output, /npm install --global @pixlcore\/xycli@99\.0\.0/);
	assert.match(output, /DRY RUN: The upgrade command was not executed/);
	assert.equal(fs.existsSync(fixture.spawnFile), false);
});

test('upgrade never downgrades a newer local version', t => {
	const fixture = createUpgradeFixture(t, '0.0.1');
	const output = fixture.run(['--confirm']);
	
	assert.match(output, /Installed version is newer than npm/);
	assert.equal(fs.existsSync(fixture.spawnFile), false);
});

test('upgrade rejects malformed registry versions before spawning a shell', t => {
	const fixture = createUpgradeFixture(t, '99.0.0; unwanted-command');
	const output = fixture.run(['--confirm'], { fail: true });
	
	assert.match(output, /Invalid version/);
	assert.equal(fs.existsSync(fixture.spawnFile), false);
});

test('upgrade reports registry and npm process failures', async t => {
	await t.test('registry failure', t => {
		const fixture = createUpgradeFixture(t, '99.0.0');
		const output = fixture.run([], {
			fail: true,
			env: { XYCLI_TEST_FETCH_ERROR: 'fixture network failure' }
		});
		assert.match(output, /Could not contact the npm registry: fixture network failure/);
	});
	
	await t.test('npm failure', t => {
		const fixture = createUpgradeFixture(t, '99.0.0');
		const output = fixture.run(['--confirm'], {
			fail: true,
			env: { XYCLI_TEST_SPAWN_EXIT: '7' }
		});
		assert.match(output, /Upgrade command failed with exit code: 7/);
	});
});
