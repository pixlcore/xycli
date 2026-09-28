const { test } = require('node:test');
const assert = require('node:assert/strict');
const Path = require('node:path');
const { spawnSync } = require('node:child_process');
const { xy } = require('./helpers/common.js');

// Deliberately shadow any developer-machine configuration. Help and command
// diagnostics must remain useful before the user connects the CLI to xyOps.
const offlineEnv = {
	XYOPS_API_KEY: '',
	XYOPS_BASE_URL: ''
};

const offlineFailure = { fail: true, env: offlineEnv };
const crlfHelpPreload = Path.join(__dirname, 'helpers', 'crlf-help.js');

test('help is available without server credentials', () => {
	const output = xy(['help'], { env: offlineEnv });
	assert.match(output, /HELP: OVERVIEW/);
});

test('upgrade help is available without server credentials', () => {
	const output = xy(['help', 'upgrade'], { env: offlineEnv });
	assert.match(output, /HELP: UPGRADE/);
	assert.match(output, /xy upgrade --confirm/);
});

test('help parses a document with Windows line endings', () => {
	const output = xy(['help'], { env: offlineEnv, preload: crlfHelpPreload });
	assert.match(output, /HELP: OVERVIEW/);
});

test('help suggests the closest chapter for a typo', () => {
	const output = xy(['help', 'event', 'udpate'], offlineFailure);
	assert.match(output, /Could not find help chapter for "event udpate"\. Did you mean "event update"\?/);
});

test('help does not suggest an unrelated chapter', () => {
	const output = xy(['help', 'completely', 'unrelated', 'words'], offlineFailure);
	assert.match(output, /Could not find help chapter for "completely unrelated words"\./);
	assert.doesNotMatch(output, /Did you mean/);
});

test('unknown top-level command suggests the closest command', () => {
	const output = xy(['evnets'], offlineFailure);
	assert.match(output, /Unknown command: evnets\. Did you mean "events"\?/);
	assert.match(output, /Available Commands:.*events/);
});

test('unknown top-level command does not suggest an unrelated command', () => {
	const output = xy(['completely_unrelated'], offlineFailure);
	assert.match(output, /Unknown command: completely_unrelated/);
	assert.doesNotMatch(output, /Did you mean/);
});

test('quiet mode prints sync diagnostics and bound warnings on stderr', () => {
	// Run the real CLI startup so this checks the warn override and the global
	// binding installed by cli.global(), without contacting a server.
	const script = `
		process.argv = [process.execPath, require.resolve('./index.js'), 'help', '--quiet'];
		process.on('beforeExit', () => {
			const cli = require('pixl-cli');
			cli.warnln('Fixture cli warning');
			warnln('Fixture warning');
			warn('Fixture direct warning\\n');
			const utils = require('./lib/utils.js');
			const context = { colors: { orange: [255, 105, 0], red: [251, 44, 54], green: [0, 201, 80] }, color: utils.color };
			utils.toast.call(context, '⚠️', 'orange', 'Fixture toast warning');
			utils.toast.call(context, '🛑', 'red', 'Fixture toast error');
			utils.toast.call(context, '✅', 'green', 'Fixture success');
			const sync = require('./lib/sync.js');
			sync.logSyncWarning.call({ warnings: [] }, 'Fixture sync warning');
			sync.logSyncError.call({ errors: [] }, 'Fixture sync error');
			println('Routine output');
		});
		require('./index.js');
	`;
	const result = spawnSync(process.execPath, ['-e', script], {
		cwd: Path.join(__dirname, '..'),
		encoding: 'utf8',
		env: { ...process.env, ...offlineEnv },
		windowsHide: true
	});
	
	assert.ifError(result.error);
	assert.equal(result.status, 1);
	assert.equal(result.stdout, '');
	assert.match(result.stderr, /Fixture cli warning/);
	assert.match(result.stderr, /Fixture warning/);
	assert.match(result.stderr, /Fixture direct warning/);
	assert.match(result.stderr, /Fixture toast warning/);
	assert.match(result.stderr, /Fixture toast error/);
	assert.match(result.stderr, /Fixture sync warning/);
	assert.match(result.stderr, /Fixture sync error/);
	assert.doesNotMatch(result.stderr, /Fixture success/);
});

test('quiet invalid usage reports an error on stderr', () => {
	const result = spawnSync(process.execPath, [Path.join(__dirname, '..', 'index.js'), 'upgrade', 'unexpected', '--quiet'], {
		encoding: 'utf8',
		env: { ...process.env, ...offlineEnv },
		windowsHide: true
	});
	
	assert.ifError(result.error);
	assert.equal(result.status, 1);
	assert.equal(result.stdout, '');
	assert.match(result.stderr, /Invalid usage.*xy help upgrade/);
});
