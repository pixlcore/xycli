#!/usr/bin/env node
// Run the integration suites one at a time using Node's native test runner.
const fs = require('node:fs');
const Path = require('node:path');
const { spawn } = require('node:child_process');
const { loadTestConfig } = require('./test/helpers/common.js');

const directory = Path.join(__dirname, 'test');
const suites = fs.readdirSync(directory).filter(name => name.endsWith('.test.js')).sort();
const names = suites.map(name => name.replace(/\.test\.js$/, ''));
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('--list')) {
	console.log('Usage: node test.js [SUITE ...]');
	console.log('Runs all suites sequentially by default. Requires the local xyOps development server.');
	console.log('\nAvailable suites:\n  ' + names.join('\n  '));
}
else {
	try {
		// Resolve names from the inventory rather than accepting arbitrary paths.
		const selected = args.length ? [...new Set(args)] : names;
		for (const name of selected) {
			if (!names.includes(name)) throw new Error('Unknown suite: ' + name + '. Use --list to see available suites.');
		}
		
		loadTestConfig();
		const files = selected.map(name => Path.join(directory, name + '.test.js'));
		
		// Native file isolation keeps SDK/config/global state independent. A failed
		// suite does not prevent the remaining suites from running and reporting.
		const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
			cwd: __dirname,
			stdio: 'inherit',
			windowsHide: true
		});
		
		child.on('error', error => {
			console.error('Could not start the test runner: ' + error.message);
			process.exitCode = 1;
		});
		
		child.on('exit', (code, signal) => {
			process.exitCode = signal ? 1 : (code ?? 1);
		});
	}
	catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
