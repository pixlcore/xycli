const { test } = require('node:test');
const assert = require('node:assert/strict');
const { xy } = require('./helpers/common.js');

test('help suggests the closest chapter for a typo', () => {
	const output = xy(['help', 'event', 'udpate'], { fail: true });
	assert.match(output, /Could not find help chapter for "event udpate"\. Did you mean "event update"\?/);
});

test('help does not suggest an unrelated chapter', () => {
	const output = xy(['help', 'completely', 'unrelated', 'words'], { fail: true });
	assert.match(output, /Could not find help chapter for "completely unrelated words"\./);
	assert.doesNotMatch(output, /Did you mean/);
});

test('unknown top-level command suggests the closest command', () => {
	const output = xy(['evnets'], { fail: true });
	assert.match(output, /Unknown command: evnets\. Did you mean "events"\?/);
	assert.match(output, /Available Commands:.*events/);
});

test('unknown top-level command does not suggest an unrelated command', () => {
	const output = xy(['completely_unrelated'], { fail: true });
	assert.match(output, /Unknown command: completely_unrelated/);
	assert.doesNotMatch(output, /Did you mean/);
});
