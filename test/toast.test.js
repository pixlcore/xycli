const { test } = require('node:test');
const assert = require('node:assert/strict');
const cli = require('pixl-cli');
const utils = require('../lib/utils.js');

cli.global();

test('toast wraps within the terminal width without ellipsis', () => {
	const originalWidth = cli.width;
	const originalWrite = process.stdout.write;
	const originalColor = cli.chalk.enabled;
	let output = '';
	
	try {
		cli.width = function() { return 40; };
		cli.chalk.enabled = false;
		process.stdout.write = function(chunk) {
			output += chunk;
			return true;
		};
		
		utils.toast.call({
			colors: { orange: [255, 105, 0] },
			color: utils.color
		}, '⚠️', 'orange', 'Preview only. Review the Plugin data above, then use --confirm to install it.');
	}
	finally {
		cli.width = originalWidth;
		cli.chalk.enabled = originalColor;
		process.stdout.write = originalWrite;
	}
	
	const box_lines = output.split('\n').filter( line => line.match(/[┌│└]/) );
	const plain_text = cli.Tools.stripANSI(output).replace(/[┌─┐│└┘]/g, ' ').replace(/\s+/g, ' ');
	assert.ok(box_lines.length > 5, 'Long toast wrapped onto multiple content lines');
	assert.ok(box_lines.every( line => cli.stringWidth(line) <= 40 ), 'Toast stayed within terminal width');
	assert.doesNotMatch(output, /\.\.\./);
	assert.match(plain_text, /Preview only\. Review the Plugin data above, then use --confirm to install it\./);
});

test('user notes preserve explicit lines and wrap within the terminal width', () => {
	const originalWidth = cli.width;
	const originalWrite = process.stdout.write;
	const originalColor = cli.chalk.enabled;
	let output = '';
	
	try {
		cli.width = function() { return 40; };
		cli.chalk.enabled = false;
		process.stdout.write = function(chunk) {
			output += chunk;
			return true;
		};
		
		utils.printUserNotes.call({
			colors: { theme: [0, 0, 0] },
			color: utils.color
		}, 'THING NOTES', 'First line\nSecond line that is intentionally very long so it wraps around the terminal width.');
	}
	finally {
		cli.width = originalWidth;
		cli.chalk.enabled = originalColor;
		process.stdout.write = originalWrite;
	}
	
	const box_lines = output.split('\n').filter( line => line.match(/[┌│└]/) );
	const plain_text = cli.Tools.stripANSI(output);
	assert.match(plain_text, /THING NOTES/);
	assert.match(plain_text, /First line/);
	assert.match(plain_text, /Second line that is intentionally/);
	assert.ok(box_lines.length > 4, 'Long notes wrapped onto multiple content lines');
	assert.ok(box_lines.every( line => cli.stringWidth(line) <= 40 ), 'Notes stayed within terminal width');
});
