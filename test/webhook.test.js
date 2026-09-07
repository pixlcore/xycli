const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, json, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('webhook', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Copy the built-in Example Hook destination into a disposable definition.
	// The test API performs real requests, but this fixture is never attached to
	// an Event, Category, Alert, Server Group, or Secret Vault.
	const stamp = Date.now();
	const id = 'cli_hook_test_' + stamp;
	const title = 'CLI Web Hook Test ' + stamp;
	const ids = new Set([id]);
	const temp = createTempDir(t, 'xycli-webhook-test-');
	
	try {
		const original = (await apiCall('getWebHooks')).rows;
		const example = original.find(hook => hook.id === 'example_hook');
		assert.ok(example, 'Built-in example_hook Web Hook required');
		
		const headers = [
			{ name: 'Content-Type', value: 'application/json' },
			{ name: 'User-Agent', value: 'xycli/WebHook-Test' }
		];
		const body = '{\n\t"text": "{{ text }}",\n\t"source": "xycli-test"\n}\n';
		const headersFile = Path.join(temp, 'headers.json');
		const bodyFile = Path.join(temp, 'body.json');
		fs.writeFileSync(headersFile, JSON.stringify(headers));
		fs.writeFileSync(bodyFile, body);
		
		await check('dry creation fills web editor defaults', () => {
			const req = json(['hook', 'create', '--id', id, '--title', title, '--url', example.url, '--dry']);
			assert.equal(req.enabled, true);
			assert.equal(req.method, 'POST');
			assert.equal(req.timeout, 30);
			assert.equal(req.retries, 0);
			assert.equal(req.follow, false);
			assert.equal(req.ssl_cert_bypass, false);
			assert.equal(req.max_per_day, 0);
			assert.deepEqual(req.headers, [
				{ name: 'Content-Type', value: 'application/json' },
				{ name: 'User-Agent', value: 'xyOps/WebHook' }
			]);
		});
		
		await check('dry creation does not persist', () => assert.deepEqual(json(['hooks', '--id', id]), []));
		
		const created = json([
			'hook', 'create', '--id', id, '--title', title, '--url', example.url,
			'--method', 'post', '--headers', '@' + headersFile, '--body', '@' + bodyFile,
			'--timeout', '20', '--retries', '0', '--follow', 'true',
			'--ssl_cert_bypass', 'false', '--max_per_day', '12',
			'--icon', 'mdi-webhook', '--notes', 'First line\nSecond line'
		]);
		
		await check('create persists request and delivery settings', () => {
			assert.equal(created.id, id);
			assert.equal(created.title, title);
			assert.equal(created.enabled, true);
			assert.equal(created.url, example.url);
			assert.equal(created.method, 'POST');
			assert.deepEqual(created.headers, headers);
			assert.equal(created.body, body);
			assert.equal(created.timeout, 20);
			assert.equal(created.retries, 0);
			assert.equal(created.follow, true);
			assert.equal(created.ssl_cert_bypass, false);
			assert.equal(created.max_per_day, 12);
			assert.equal(created.icon, 'webhook');
			assert.equal(created.revision, 1);
		});
		
		await check('short and canonical detail commands are equivalent', () => {
			assert.deepEqual(json(['hook', id]), created);
			assert.deepEqual(json(['webhook', id]), created);
		});
		
		await check('fuzzy title and named ID get', () => {
			assert.equal(json(['hook', 'get', '--title', title.toLowerCase()]).id, id);
			assert.equal(json(['webhook', 'get', '--id', id]).id, id);
		});
		
		await check('short and canonical list aliases support combined filters', () => {
			assert.deepEqual(json(['hooks', title, '--enabled', 'true', '--method', 'post']), [created]);
			assert.deepEqual(json(['webhooks', '--id', id]), [created]);
			assert.deepEqual(json(['hook', 'list', '--id', id]), [created]);
			assert.deepEqual(json(['webhook', 'list', '--id', id]), [created]);
		});
		
		await check('JSON list ignores human pagination arguments', () => {
			assert.deepEqual(json(['hooks', '--id', id, '--limit', '1', '--page', '2']), [created]);
		});
		
		await check('Web Hook list is ordered alphabetically', () => {
			const rows = json(['hooks']);
			assert.ok(rows.every((row, idx) => !idx || rows[idx - 1].title.toLowerCase().localeCompare(row.title.toLowerCase()) <= 0));
		});
		
		await check('human list supports pagination and suggestions', () => {
			const out = xy(['hooks', '--limit', '1', '--page', '1']);
			assert.match(out, /page 1 of/i);
			assert.match(out, /Other Commands:/);
		});
		
		await check('empty filtered Web Hook table', () => {
			assert.match(xy(['hooks', id, '--enabled', 'false']), /No filtered web hooks found/i);
		});
		
		await check('human detail shows headers, exact body, and multiline notes', () => {
			const out = xy(['hook', id]);
			for (const label of ['Web Hook Summary', 'Hook ID', 'Method', 'Timeout', 'Retries', 'Follow Redirects', 'Daily Cap', 'Web Hook Headers', 'Content-Type', 'Web Hook Body', 'Web Hook Notes', 'Second line']) {
				assert.ok(out.toLowerCase().includes(label.toLowerCase()), label);
			}
			assert.ok(out.includes(body), 'Exact multiline body is present');
		});
		
		await check('Hook alias works with portable export', () => {
			const exportFile = Path.join(temp, 'hook-export.json');
			xy(['hook', id, '--export', exportFile]);
			const payload = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
			assert.equal(payload.items[0].type, 'web_hook');
			assert.equal(payload.items[0].data.id, id);
		});
		
		await check('human update shows target and parsed data', () => {
			const out = xy(['hook', 'update', id, '--timeout', '45', '--dry']);
			assert.match(out, /UPDATE WEB HOOK/);
			assert.match(out, new RegExp('Hook ID:\\s+' + id));
			assert.match(out, /UPDATE DATA[\s\S]*"timeout": 45/);
		});
		
		await check('sparse dry update excludes unrelated fields', () => {
			assert.deepEqual(json(['hook', 'update', id, '--timeout', '45', '--dry']), { timeout: 45, id: id });
		});
		
		json([
			'hook', 'update', id,
			'--headers.0.name', 'X-Renamed', '--headers.0.value', 'New Value',
			'--header', '{"name":"X-Added","value":"Added Value"}'
		]);
		
		await check('indexed Header edits and append preserve other settings', () => {
			const row = json(['hook', id]);
			assert.deepEqual(row.headers, [
				{ name: 'X-Renamed', value: 'New Value' },
				headers[1],
				{ name: 'X-Added', value: 'Added Value' }
			]);
			assert.equal(row.url, example.url);
			assert.equal(row.body, body);
			assert.equal(row.revision, 2);
		});
		
		const replacementHeaders = [{ name: 'X-Only', value: 'Only Value' }];
		json(['hook', 'update', id, '--headers', '@-'], {
			input: JSON.stringify(replacementHeaders)
		});
		
		await check('complete Header replacement from stdin', () => {
			assert.deepEqual(json(['hook', id]).headers, replacementHeaders);
		});
		
		const replacementBody = '{\n  "message": "replacement body"\n}\n';
		json(['hook', 'update', id, '--body', '@-'], { input: replacementBody });
		
		await check('JSON-looking body from stdin remains exact text', () => {
			assert.equal(json(['hook', id]).body, replacementBody);
		});
		
		json(['hook', 'update', id, '--json', '@-'], {
			input: JSON.stringify({
				enabled: false,
				timeout: 15,
				retries: 1,
				follow: false,
				ssl_cert_bypass: false,
				max_per_day: 0,
				notes: 'Updated from JSON'
			})
		});
		
		await check('complete JSON update converts native values', () => {
			const row = json(['hook', id]);
			assert.equal(row.enabled, false);
			assert.equal(row.timeout, 15);
			assert.equal(row.retries, 1);
			assert.equal(row.follow, false);
			assert.equal(row.max_per_day, 0);
			assert.equal(row.notes, 'Updated from JSON');
		});
		
		// Simulate a field added by a future xyOps release, then prove that a normal
		// CLI update is sparse and preserves the unknown saved value.
		await apiCall('updateWebHook', { id: id, future_property: { enabled: true } });
		json(['hook', 'update', id, '--notes', 'Future-safe update']);
		
		await check('sparse update preserves future server properties', () => {
			const row = json(['hook', id]);
			assert.equal(row.notes, 'Future-safe update');
			assert.deepEqual(row.future_property, { enabled: true });
		});
		
		const beforeTest = json(['hook', id]);
		await check('dry test previews temporary overrides without sending', () => {
			const req = json([
				'hook', 'test', id, '--enabled', 'true', '--timeout', '10',
				'--header', '{"name":"X-Test-Only","value":"Yes"}', '--dry'
			]);
			assert.equal(req.id, id);
			assert.equal(req.enabled, true);
			assert.equal(req.timeout, 10);
			assert.deepEqual(req.headers.at(-1), { name: 'X-Test-Only', value: 'Yes' });
		});
		
		await check('live test renders the API Markdown report', () => {
			const out = xy(['hook', 'test', id, '--enabled', 'true', '--retries', '0']);
			assert.match(out, /WEB HOOK TEST RESULTS/);
			assert.match(out, /Result:\s+Success \(HTTP 200 OK\)/i);
			assert.match(out, /Method:\s+POST/i);
			assert.match(out, /Response:\s+HTTP 200 OK/i);
			assert.doesNotMatch(out, /\*\*Method:\*\*/);
		});
		
		await check('live test JSON returns code, description, and Markdown details', () => {
			const result = json(['webhook', 'test', id, '--enabled', 'true', '--retries', '0']);
			assert.equal(result.code, 0);
			assert.match(result.description, /HTTP 200 OK/);
			assert.match(result.details, /\*\*Response:\*\* HTTP 200 OK/);
		});
		
		await check('temporary test overrides do not update the saved Hook', () => {
			assert.deepEqual(json(['hook', id]), beforeTest);
		});
		
		const revision = json(['hook', id]).revision;
		await check('unconfirmed delete shows target and warning toast', () => {
			for (const args of [['delete', id], ['delete', id, '--confirm', 'false']]) {
				const out = xy(['hook', ...args]);
				assert.match(out, /DELETE WEB HOOK/);
				assert.match(out, /⚠️[\s\S]*Please confirm the Web Hook delete/);
			}
		});
		
		const rejected = [
			['update', id],
			['update', title, '--notes', 'Wrong selector'],
			['update', id, '--id', 'different', '--notes', 'Wrong ID'],
			['update', id, '--title', ' '],
			['update', id, '--url', 'ftp://example.com'],
			['update', id, '--method', 'OPTIONS'],
			['update', id, '--headers', '{}'],
			['update', id, '--headers', '[{"name":"Bad Header","value":"x"}]'],
			['update', id, '--headers', '[{"name":"X-Test","value":"bad\\nvalue"}]'],
			['update', id, '--headers', '[{"name":"X-Test","value":"x","extra":true}]'],
			['update', id, '--headers.99.name', 'X-Bad'],
			['update', id, '--headers.__proto__.x', 'Bad'],
			['update', id, '--timeout', '-1'],
			['update', id, '--retries', '1000'],
			['update', id, '--max_per_day', '1.5'],
			['update', id, '--follow', 'perhaps'],
			['update', id, '--revision', '99'],
			['update', id, '--notess', 'Typo'],
			['test', title],
			['test', id, '--unknown', 'x'],
			['delete', title, '--confirm'],
			['delete', id, '--confirm', 'maybe']
		];
		
		for (const args of rejected) {
			await check('reject Hook ' + args.slice(0, 4).join(' '), () => xy(['hook', ...args], { fail: true }));
		}
		
		await check('rejected requests leave revision unchanged', () => assert.equal(json(['hook', id]).revision, revision));
		
		await check('duplicate Web Hook ID error is surfaced', () => {
			assert.match(xy(['hook', 'create', '--id', id, '--title', title, '--url', example.url], { fail: true }), /already exists/i);
		});
		
		const auto = json(['hook', 'create', '--title', title + ' Automatic', '--url', example.url]);
		ids.add(auto.id);
		await check('automatic ID uses Web Hook prefix', () => assert.match(auto.id, /^w/));
		
		const humanID = id + '_human';
		ids.add(humanID);
		await check('human creation prints suggested commands', () => {
			assert.match(xy(['hook', 'create', '--id', humanID, '--title', title + ' Human', '--url', example.url]), /Other Commands:/);
		});
		
		// Remove auxiliary definitions before the final primary delete checks.
		for (const hookID of Array.from(ids)) {
			if (hookID === id) continue;
			json(['hook', 'delete', hookID, '--confirm']);
			ids.delete(hookID);
		}
		
		await check('dry delete request contains only the ID', () => {
			assert.deepEqual(json(['hook', 'delete', id, '--confirm', '--dry']), { id: id });
		});
		
		await check('dry delete leaves the Hook intact', () => assert.equal(json(['hook', id]).id, id));
		
		json(['hook', 'delete', id, '--confirm']);
		ids.delete(id);
		
		await check('confirmed delete removes the Hook', () => assert.deepEqual(json(['hooks', '--id', id]), []));
		
		await check('get after deletion fails', () => xy(['hook', id], { fail: true }));
		
		for (const topic of ['hooks', 'hook', 'hook list', 'hook get', 'hook create', 'hook update', 'hook test', 'hook delete', 'webhooks', 'webhook']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
		
		await check('existing Web Hooks remain unchanged', async () => {
			const now = (await apiCall('getWebHooks')).rows;
			for (const hook of original) {
				const current = now.find(item => item.id === hook.id);
				assert.ok(current, 'Existing Web Hook still present: ' + hook.id);
				assert.equal(JSON.stringify(current), JSON.stringify(hook), 'Existing Web Hook unchanged: ' + hook.id);
			}
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'web_hooks', method: 'deleteWebHook', match: item => ids.has(item.id) || item.title.startsWith(title) }
		]);
	}
});
