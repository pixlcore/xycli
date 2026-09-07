const { test } = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../lib/utils.js');

test('markdown renders inline formatting inside list items', () => {
	const output = utils.markdown([
		'- **Node.js** and `npx`',
		'\t- Nested **bold** and `code`'
	].join('\n'));
	
	// Color is disabled in the test process, so rendered styles become plain
	// text.  The important regression check is that Markdown delimiters do not
	// leak through from either the top-level or nested list item.
	assert.match(output, /• Node\.js and npx/);
	assert.match(output, /• Nested bold and code/);
	assert.doesNotMatch(output, /\*\*|`/);
});

test('markdown uses typographic bullets without changing ordered lists', () => {
	const output = utils.markdown([
		'- First item',
		'- Second item',
		'',
		'1. First numbered item',
		'2. Second numbered item'
	].join('\n'));

	assert.match(output, /• First item/);
	assert.match(output, /• Second item/);
	assert.match(output, /1\. First numbered item/);
	assert.match(output, /2\. Second numbered item/);
	assert.doesNotMatch(output, /^\s*\* /m);
});
