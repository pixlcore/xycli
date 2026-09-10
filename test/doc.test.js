const { test } = require('node:test');
const assert = require('node:assert/strict');
const doc = require('../lib/doc.js');
const utils = require('../lib/utils.js');
const { loadTestConfig, xy } = require('./helpers/common.js');

function createDocContext() {
	return {
		...utils,
		...doc,
		die(message) { throw new Error(message); }
	};
}

test('documentation chapter extraction includes descendants and ignores code fences', () => {
	const context = createDocContext();
	const markdown = [
		'# Example',
		'## Selected Chapter',
		'Chapter introduction.',
		'### Child Section',
		'Child text.',
		'```md',
		'## Not A Real Heading',
		'```',
		'#### Grandchild Section',
		'Grandchild text.',
		'## Next Chapter',
		'Excluded text.'
	].join('\n');
	const selected = context.extractDocChapter(markdown, 'example', 'selected-chapter');
	
	assert.match(selected, /^## Selected Chapter/);
	assert.match(selected, /### Child Section/);
	assert.match(selected, /## Not A Real Heading/);
	assert.match(selected, /#### Grandchild Section/);
	assert.doesNotMatch(selected, /## Next Chapter|Excluded text/);
});

test('internal documentation links become copyable doc commands', () => {
	const context = createDocContext();
	const markdown = [
		'[Plugins](plugins.md), [Output](#output-data), and [Website](https://example.com).',
		'```md',
		'[Example Link](example.md)',
		'```'
	].join('\n');
	const prepared = context.prepareDocMarkdown(markdown, 'events');
	
	assert.match(prepared, /Plugins \(`xy doc plugins`\)/);
	assert.match(prepared, /Output \(`xy doc events\/output-data`\)/);
	assert.match(prepared, /\[Website\]\(https:\/\/example\.com\)/);
	assert.match(prepared, /\[Example Link\]\(example\.md\)/);
});

test('doc command renders the index, full documents, and slash or space chapters', () => {
	loadTestConfig();
	const index = xy(['doc']);
	const full = xy(['doc', 'plugins']);
	const slash = xy(['doc', 'plugins/output-data']);
	const space = xy(['doc', 'plugins', 'output-data']);
	
	assert.match(index, /Documentation Index/i);
	assert.match(index, /xy doc plugins/);
	assert.match(full, /Plugins/i);
	assert.match(full, /Plugin Types/i);
	assert.match(slash, /Output Data/i);
	assert.match(slash, /arbitrary data output/i);
	assert.doesNotMatch(slash, /Output Files/i);
	assert.match(space, /Output Data/i);
	assert.match(space, /arbitrary data output/i);
});

test('doc command rejects unsafe names, missing chapters, and search', () => {
	loadTestConfig();
	assert.match(xy(['doc', '../plugins'], { fail: true }), /Invalid documentation name/);
	assert.match(xy(['doc', 'plugins/not-a-real-chapter'], { fail: true }), /Could not find documentation chapter/);
	assert.match(xy(['doc', 'search'], { fail: true }), /Documentation search is not supported/);
});

test('doc help chapter renders', () => {
	loadTestConfig();
	assert.match(xy(['help', 'doc']), /HELP: DOC/);
});
