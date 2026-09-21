const { test } = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../lib/utils.js');

test('executable language detection accepts Unix and Windows command forms', () => {
	// Plugin definitions are portable, so exercise both path styles regardless of
	// the operating system running this test.
	assert.equal(utils.getLangFromBinary('/usr/bin/node --use-strict'), 'javascript');
	assert.equal(utils.getLangFromBinary('/usr/bin/python3.12 -u'), 'python');
	assert.equal(utils.getLangFromBinary('/bin/bash'), 'shell');
	assert.equal(utils.getLangFromBinary('/usr/bin/env -S node --use-strict'), 'javascript');
	assert.equal(utils.getLangFromBinary('"C:\\Program Files\\nodejs\\node.exe" --use-strict'), 'javascript');
	assert.equal(utils.getLangFromBinary('C:\\Python312\\python.exe -u'), 'python');
	assert.equal(utils.getLangFromBinary('pwsh.exe -File'), 'powershell');
	assert.equal(utils.getLangFromBinary('powershell.exe -File'), 'powershell');
	assert.equal(utils.getLangFromBinary('cmd.exe /c'), 'dos');
	assert.equal(utils.getLangFromBinary('unknown-binary.exe'), null);
	assert.equal(utils.getLangFromBinary(null), null);
});
