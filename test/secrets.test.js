const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, json, call: apiCall, cleanupFixtures } = require('./helpers/common.js');

test('secrets', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// These values are disposable test data, but still keep plaintext out of
	// assertion details and API diagnostics to exercise the CLI's safety model.
	const stamp = Date.now();
	const id = 'cli_secret_test_' + stamp;
	const title = 'CLI Secret Test ' + stamp;
	const temp = createTempDir(t, 'xycli-secret-test-');
	const initialFields = [
		{ name: 'CLI_TEST_TOKEN', value: 'token-' + stamp },
		{ name: 'CLI_TEST_MULTILINE', value: 'first-' + stamp + '\nsecond line\n  indented line' }
	];
	const replacementFields = [
		{ name: 'CLI_TEST_REPLACED', value: 'replacement-' + stamp + '\nlast line' }
	];
	const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
	const initialDigest = digest(initialFields);
	const replacementDigest = digest(replacementFields);
	const initialFile = Path.join(temp, 'initial-fields.json');
	fs.writeFileSync(initialFile, JSON.stringify(initialFields));
	
	try {
		const original = (await apiCall('getSecrets')).rows;
		const multi = await apiCall('getMultiple', { lists: 'all' });
		const event = multi.events[0];
		const category = multi.categories[0];
		const plugin = multi.plugins[0];
		const webHook = multi.web_hooks[0];
		assert.ok(event, 'Event required for Secret Vault assignment tests');
		assert.ok(category, 'Category required for Secret Vault assignment tests');
		assert.ok(plugin, 'Plugin required for Secret Vault assignment tests');
		assert.ok(webHook, 'Web Hook required for Secret Vault assignment tests');
		
		await check('dry creation redacts fields and fills defaults', () => {
			const req = json([
				'secret', 'create', '--id', id, '--title', title,
				'--fields', '@' + initialFile, '--dry'
			]);
			assert.equal(req.id, id);
			assert.equal(req.enabled, true);
			assert.deepEqual(req.events, []);
			assert.deepEqual(req.categories, []);
			assert.deepEqual(req.plugins, []);
			assert.deepEqual(req.web_hooks, []);
			assert.deepEqual(req.fields, initialFields.map(field => ({ name: field.name, value: '[REDACTED]' })));
		});
		
		await check('dry creation never prints plaintext', () => {
			const out = xy(['secret', 'create', '--id', id, '--title', title, '--fields', '@' + initialFile, '--dry', '--verbose']);
			assert.match(out, /\[REDACTED\]/);
			for (const field of initialFields) assert.ok(!out.includes(field.value), 'Plaintext is absent from dry output');
		});
		
		await check('dry creation does not persist', () => assert.deepEqual(json(['secrets', '--id', id]), []));
		
		const created = json([
			'secret', 'create', '--id', id, '--title', title,
			'--fields', '@' + initialFile,
			'--events', event.id + ',' + event.id,
			'--category', category.id,
			'--plugin', plugin.id,
			'--hook', webHook.id,
			'--notes', 'Vault notes\nSecond line'
		]);
		
		await check('create persists safe metadata and every assignment type', () => {
			assert.equal(created.id, id);
			assert.equal(created.title, title);
			assert.equal(created.enabled, true);
			assert.deepEqual(created.names, initialFields.map(field => field.name));
			assert.deepEqual(created.events, [event.id]);
			assert.deepEqual(created.categories, [category.id]);
			assert.deepEqual(created.plugins, [plugin.id]);
			assert.deepEqual(created.web_hooks, [webHook.id]);
			assert.ok(!('fields' in created), 'Create response omits plaintext fields');
		});
		
		await check('stored encrypted data matches file input', async () => {
			const data = await apiCall('decryptSecret', { id: id });
			assert.equal(digest(data.fields), initialDigest);
		});
		
		await check('exact and fuzzy metadata get never expose values', () => {
			const exact = json(['secret', id]);
			const fuzzy = json(['secret', 'get', '--title', title.toLowerCase()]);
			assert.equal(exact.id, id);
			assert.equal(fuzzy.id, id);
			assert.ok(!('fields' in exact));
			assert.ok(!('fields' in fuzzy));
		});
		
		await check('human get shows names, assignments, and multiline notes only', () => {
			const out = xy(['secret', id]);
			for (const label of ['Secret Vault Summary', 'Variable Names', 'Events', 'Categories', 'Plugins', 'Web Hooks', 'Secret Vault Notes', 'Second line']) {
				assert.ok(out.toLowerCase().includes(label.toLowerCase()), label);
			}
			for (const field of initialFields) assert.ok(!out.includes(field.value), 'Plaintext is absent from metadata view');
		});
		
		await check('list search and assignment filters return safe metadata', () => {
			const searches = [
				['secrets', title],
				['secret', 'list', '--name', initialFields[0].name],
				['secrets', '--event', event.id, '--category', category.id],
				['secrets', '--plugin', plugin.id, '--hook', webHook.id],
				['secrets', '--web_hook', webHook.id]
			];
			for (const args of searches) {
				const row = json(args).find(item => item.id === id);
				assert.ok(row, 'Secret Vault found by list filter');
				assert.ok(!('fields' in row));
			}
		});
		
		await check('human list supports pagination and suggestions', () => {
			const out = xy(['secrets', '--limit', '1', '--page', '1']);
			assert.match(out, /page 1 of/i);
			assert.match(out, /Other Commands:/);
		});
		
		await check('human update shows target and redacted parsed data', () => {
			const out = xy(['secret', 'update', id, '--fields', '@' + initialFile, '--dry']);
			assert.match(out, /UPDATE SECRET VAULT/);
			assert.match(out, new RegExp('Vault ID:\\s+' + id));
			assert.match(out, /UPDATE DATA[\s\S]*\[REDACTED\]/);
			for (const field of initialFields) assert.ok(!out.includes(field.value), 'Plaintext is absent from update preview');
		});
		
		await check('sparse metadata dry update excludes unrelated data', () => {
			assert.deepEqual(json(['secret', 'update', id, '--enabled', 'false', '--dry']), { enabled: false, id: id });
		});
		
		json(['secret', 'update', id, '--enabled', 'false', '--notes', 'Updated vault notes']);
		
		await check('metadata update preserves encrypted variables', async () => {
			const metadata = json(['secret', id]);
			const data = await apiCall('decryptSecret', { id: id });
			assert.equal(metadata.enabled, false);
			assert.equal(metadata.notes, 'Updated vault notes');
			assert.equal(digest(data.fields), initialDigest);
		});
		
		await check('stdin replacement dry run redacts every value', () => {
			const req = json(['secret', 'update', id, '--fields', '@-', '--dry'], {
				input: JSON.stringify(replacementFields)
			});
			assert.deepEqual(req, {
				fields: replacementFields.map(field => ({ name: field.name, value: '[REDACTED]' })),
				id: id
			});
		});
		
		json(['secret', 'update', id, '--fields', '@-'], {
			input: JSON.stringify(replacementFields)
		});
		
		await check('complete fields array replacement from stdin', async () => {
			const metadata = json(['secret', id]);
			const data = await apiCall('decryptSecret', { id: id });
			assert.deepEqual(metadata.names, replacementFields.map(field => field.name));
			assert.equal(digest(data.fields), replacementDigest);
		});
		
		await check('unconfirmed decrypt shows target and warning without plaintext', () => {
			for (const args of [['decrypt', id], ['decrypt', id, '--confirm', 'false']]) {
				const out = xy(['secret', ...args]);
				assert.match(out, /DECRYPT SECRET VAULT/);
				assert.match(out, /⚠️[\s\S]*confirm decryption/i);
				for (const field of replacementFields) assert.ok(!out.includes(field.value), 'Plaintext is absent without confirmation');
			}
		});
		
		await check('confirmed human decrypt preserves multiline plaintext sections', () => {
			const out = xy(['secret', 'decrypt', id, '--confirm']);
			assert.match(out, new RegExp('SECRET VARIABLE: ' + replacementFields[0].name));
			assert.ok(out.includes(replacementFields[0].value), 'Exact multiline value is present');
		});
		
		await check('confirmed JSON decrypt returns the plaintext fields array', () => {
			const fields = json(['secret', 'decrypt', id, '--confirm']);
			assert.equal(digest(fields), replacementDigest);
		});
		
		await check('verbose decrypt diagnostics stay redacted', () => {
			const out = xy(['secret', 'decrypt', id, '--confirm', '--verbose']);
			assert.match(out, /API RESPONSE:[\s\S]*\[REDACTED\]/);
			assert.ok(out.includes(replacementFields[0].value), 'Final confirmed output contains plaintext');
			const response = out.slice(out.indexOf('API RESPONSE:'), out.indexOf('SECRET VARIABLE:'));
			assert.ok(!response.includes(replacementFields[0].value), 'Diagnostic response omits plaintext');
		});
		
		const rejected = [
			['update', id],
			['update', title, '--notes', 'Wrong selector'],
			['update', id, '--field', '{"name":"BAD","value":"hidden"}'],
			['update', id, '--fields.0.value', 'hidden'],
			['update', id, '--fields', '{}'],
			['update', id, '--fields', '[{"name":"BAD-NAME","value":"hidden"}]'],
			['update', id, '--fields', '[{"name":"SAME","value":"one"},{"name":"SAME","value":"two"}]'],
			['update', id, '--fields', '[{"name":"VALID","value":5}]'],
			['update', id, '--event', 'missing_secret_assignment'],
			['update', id, '--revision', '99'],
			['update', id, '--enabled', 'perhaps'],
			['decrypt', title, '--confirm'],
			['decrypt', id, '--confirm', 'maybe'],
			['delete', title, '--confirm'],
			['delete', id, '--confirm', 'maybe']
		];
		
		for (const args of rejected) {
			await check('reject secret ' + args.slice(0, 4).join(' '), () => xy(['secret', ...args], { fail: true }));
		}
		
		await check('invalid non-array fields are rejected without echoing plaintext', () => {
			const out = xy(['secret', 'update', id, '--fields', '{"password":"must-not-print"}'], { fail: true });
			assert.ok(!out.includes('must-not-print'));
		});
		
		await check('unsupported field alias is rejected without echoing its value', () => {
			const out = xy(['secret', 'update', id, '--field', '{"name":"TOKEN","value":"must-not-print-either"}'], { fail: true });
			assert.ok(!out.includes('must-not-print-either'));
		});
		
		await check('unconfirmed delete shows target and warning', () => {
			for (const args of [['delete', id], ['delete', id, '--confirm', 'false']]) {
				const out = xy(['secret', ...args]);
				assert.match(out, /DELETE SECRET VAULT/);
				assert.match(out, /⚠️[\s\S]*confirm the Secret Vault delete/i);
			}
		});
		
		await check('dry delete request contains only the ID', () => {
			assert.deepEqual(json(['secret', 'delete', id, '--confirm', '--dry']), { id: id });
		});
		
		await check('dry delete leaves the vault intact', () => assert.equal(json(['secret', id]).id, id));
		
		json(['secret', 'delete', id, '--confirm']);
		
		await check('confirmed delete removes the vault', () => assert.deepEqual(json(['secrets', '--id', id]), []));
		
		await check('get after deletion fails', () => xy(['secret', id], { fail: true }));
		
		for (const topic of ['secrets', 'secret', 'secret list', 'secret get', 'secret create', 'secret update', 'secret decrypt', 'secret delete']) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
		
		await check('existing Secret Vault metadata remains unchanged', async () => {
			const now = (await apiCall('getSecrets')).rows;
			for (const secret of original) {
				const current = now.find(item => item.id === secret.id);
				assert.ok(current, 'Existing Secret Vault still present: ' + secret.id);
				assert.equal(JSON.stringify(current), JSON.stringify(secret), 'Existing Secret Vault unchanged: ' + secret.id);
			}
		});
	}
	finally {
		await cleanupFixtures([
			{ list: 'secrets', method: 'deleteSecret', match: item => item.id === id || item.title === title }
		]);
	}
});
