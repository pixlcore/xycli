const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTestConfig, createCheck, xy, json } = require('./helpers/common.js');

test('log', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Read-only integration checks for the system log search CLI.
	
	await check('default request selects xyOps and 100 rows', () => assert.deepEqual(json(['log', '--dry']), { log: 'xyOps', rows: 100 }));
	
	await check('positional name and explicit row limit', () => assert.deepEqual(json(['log', 'xyOps', '--rows', '1000', '--dry']), { log: 'xyOps', rows: 1000 }));
	
	await check('named log selector', () => assert.deepEqual(json(['log', '--log', 'xyOps', '--rows', '1', '--dry']), { log: 'xyOps', rows: 1 }));
	
	await check('numeric match becomes text', () => assert.equal(json(['log', '--match', '123', '--dry']).match, '123'));
	
	await check('boolean flags serialize correctly', () => {
		const req = json(['log', '--match', 'error', '--regex', 'false', '--case', 'true', '--dry']);
		assert.equal(req.regex, false);
		assert.equal(req.case, true);
	});
	
	await check('display sort stays out of API request', () => assert.deepEqual(json(['log', '--sort', 'date_desc', '--dry']), { log: 'xyOps', rows: 100 }));
	
	await check('default live search returns at most 100 rows', () => {
		const rows = json(['log']);
		assert.ok(rows.length > 0 && rows.length <= 100);
		for (const key of ['hires_epoch', 'category', 'code', 'msg', 'data']) assert.ok(key in rows[0]);
	});
	
	await check('explicit limit returns latest subset', () => assert.equal(json(['log', 'xyOps', '--rows', '3']).length, 3));
	
	await check('ascending file order', () => {
		const rows = json(['log', '--rows', '5', '--cols', 'hires_epoch']);
		assert.ok(rows.every((row, idx) => !idx || row.hires_epoch >= rows[idx - 1].hires_epoch));
	});
	
	await check('descending display order', () => {
		const rows = json(['log', '--rows', '5', '--cols', 'hires_epoch', '--sort', 'date_desc']);
		assert.ok(rows.every((row, idx) => !idx || row.hires_epoch <= rows[idx - 1].hires_epoch));
	});
	
	await check('CSV columns project JSON output', () => {
		const rows = json(['log', '--rows', '2', '--cols', 'category,code']);
		assert.equal(rows.length, 2);
		assert.deepEqual(Object.keys(rows[0]), ['category', 'code']);
	});
	
	await check('JSON column array', () => {
		const rows = json(['log', '--rows', '1', '--cols', '["msg","data"]']);
		assert.deepEqual(Object.keys(rows[0]), ['msg', 'data']);
		assert.equal(typeof(rows[0].data), 'string');
	});
	
	await check('matching searches fields omitted from output', () => {
		const rows = json(['log', '--rows', '2', '--match', 'debug', '--cols', 'hires_epoch']);
		assert.ok(rows.length);
		assert.deepEqual(Object.keys(rows[0]), ['hires_epoch']);
	});
	
	await check('case insensitive regex match', () => {
		const rows = json(['log', '--rows', '2', '--match', '\\]\\[DeBuG\\]\\[', '--regex', '--cols', 'category']);
		assert.ok(rows.length);
		assert.ok(rows.every(row => row.category === 'debug'));
	});
	
	await check('case sensitive regex match', () => assert.deepEqual(json(['log', '--match', '\\]\\[DeBuG\\]\\[', '--regex', '--case']), []));
	
	await check('literal matching escapes regex syntax', () => assert.deepEqual(json(['log', '--match', '^.*$']), []));
	
	await check('regex matching supports syntax', () => assert.equal(json(['log', '--rows', '2', '--match', '^.*$', '--regex']).length, 2));
	
	await check('missing archive returns an empty array', () => assert.deepEqual(json(['log', '--date', '1900-01-01']), []));
	
	await check('missing log returns an empty array', () => assert.deepEqual(json(['log', 'xycli_nonexistent_log_test']), []));
	
	await check('native log lines, total line count, and suggestions', () => {
		const output = xy(['log', '--rows', '2', '--cols', 'category,code']);
		assert.match(output, /2 rows returned, [\d,]+ total log rows/);
		assert.match(output, /Other Commands:/);
		assert.ok(!output.includes('page 2'));
		assert.equal(output.split('\n').filter(line => /^\[[^\]]*\]\[[^\]]*\]$/.test(line)).length, 2);
	});
	
	await check('empty human output', () => assert.match(xy(['log', '--date', '1900-01-01']), /0 rows returned/));
	
	for (const args of [
		['--rows', '0'], ['--rows', '1001'], ['--rows', '1.5'], ['--rows', 'nope'],
		['--match', '(', '--regex'], ['--regex', 'maybe'], ['--case', 'maybe'],
		['--cols', 'bad_column'], ['--cols', '[]'], ['--cols', '{}'],
		['--date', '2026-02-30'], ['--date', 'yesterday'], ['--date', '2026-13-01'],
		['--sort', 'wrong'], ['--limit', '5'], ['--offset', '1'], ['--page', '2'],
		['../xyOps'], ['xyOps.log'], ['xyOps', 'extra'], ['xyOps', '--log', 'other'], ['--match', '{}']
	]) await check('reject ' + args.join(' '), () => xy(['log', ...args], true));
	
	await check('help documents default of 100 rows', () => {
		const output = xy(['help', 'log']);
		assert.match(output, /defaults to 100/);
		assert.match(output, /--rows/);
	});
});
