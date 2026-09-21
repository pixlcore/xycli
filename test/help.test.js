const { test } = require('node:test');
const assert = require('node:assert/strict');
const { xy } = require('./helpers/common.js');

// Deliberately shadow any developer-machine configuration. Help and command
// diagnostics must remain useful before the user connects the CLI to xyOps.
const offlineEnv = {
	XYOPS_API_KEY: '',
	XYOPS_BASE_URL: ''
};

const offlineFailure = { fail: true, env: offlineEnv };

test('help is available without server credentials', () => {
	const output = xy(['help'], { env: offlineEnv });
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
