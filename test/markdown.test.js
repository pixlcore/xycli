const { test } = require('node:test');
const assert = require('node:assert/strict');
const cli = require('pixl-cli');
const utils = require('../lib/utils.js');

test('markdown renders inline formatting inside list items', () => {
	const output = utils.markdown([
		'- **Node.js** and `npx`',
		'\t- Nested **bold** and `code`'
	].join('\n'));
	const plain_text = cli.Tools.stripANSI(output);
	
	// Test the visible terminal text, regardless of whether the test runner was
	// launched from a color-capable terminal.  The important regression check is
	// that Markdown delimiters do not leak through from either list item.
	assert.match(plain_text, /• Node\.js and npx/);
	assert.match(plain_text, /• Nested bold and code/);
	assert.doesNotMatch(plain_text, /\*\*|`/);
});

test('markdown uses typographic bullets without changing ordered lists', () => {
	const output = utils.markdown([
		'- First item',
		'- Second item',
		'',
		'1. First numbered item',
		'2. Second numbered item'
	].join('\n'));
	const plain_text = cli.Tools.stripANSI(output);

	assert.match(plain_text, /• First item/);
	assert.match(plain_text, /• Second item/);
	assert.match(plain_text, /1\. First numbered item/);
	assert.match(plain_text, /2\. Second numbered item/);
	assert.doesNotMatch(plain_text, /^\s*\* /m);
});

test('markdown indents list levels by two spaces', () => {
	const output = utils.markdown([
		'- Parent item',
		'    - Nested item'
	].join('\n'));
	const plain_text = cli.Tools.stripANSI(output);

	// The first space is the global Markdown margin.  Each list level then
	// contributes the configured two-space marked-terminal indentation.
	assert.match(plain_text, /^ {3}• Parent item$/m);
	assert.match(plain_text, /^ {5}• Nested item$/m);
});

test('markdown adds a left margin and reserves room for both sides', () => {
	const output = utils.markdown('This is a deliberately long paragraph. '.repeat(12));
	const terminalWidth = Math.min(process.stdout.columns || 80, 120);

	// Every rendered line receives one visible leading space.  marked-terminal
	// reflows against a width reduced by two, leaving the opposite margin free.
	output.split('\n').forEach( line => {
		assert.match(cli.Tools.stripANSI(line), /^ /);
		assert.ok(cli.stringWidth(line) <= terminalWidth - 1);
	});
});
