const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { loadTestConfig, createCheck, createTempDir, xy, json, call, cleanupFixtures } = require('./helpers/common.js');

test('transfer-apikey', async t => {
	const config = loadTestConfig();
	const check = createCheck(t);
	const verify = (condition, description) => check(description, () => assert.ok(condition, description));
	
	// Live API key portability check. Keep plaintext credentials in memory only.
	const title = 'cli_key_portability_' + Date.now();
	const temp = createTempDir(t, 'xycli-key-portability-');
	
	async function authenticate(secret) {
		// Use only the disposable secret, with no configured admin credentials or
		// session cookies. A protected read verifies actual authentication.
		const response = await fetch(config.base_url.replace(/\/$/, '') + '/api/app/get_events/v1', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-API-Key': secret },
			body: '{}',
			signal: AbortSignal.timeout(10000)
		});
		
		return response.json();
	}
		
	const original = (await call('getApiKeys', {})).rows;
	
	try {
		// Create through the CLI, then retain exactly this original secret for
		// every authentication probe. No replacement secret is ever requested.
		const description = 'First description line.\nSecond description line with enough text to exercise the dedicated display box.';
		const created = json(['key', 'create', '--title', title, '--description', description, '--active', 'true']);
		const id = created.api_key.id;
		const secret = created.plain_key;
		
		await verify(typeof secret === 'string' && secret.length > 0, 'Created disposable key with a plaintext secret');
		
		const detail = xy(['key', id]);
		await verify(/APP DESCRIPTION[\s\S]*First description line\.[\s\S]*Second description line/.test(detail), 'App description has its own multiline section');
		await verify(!/│ Description\s*:/.test(detail.split('APP DESCRIPTION')[0]), 'App description is omitted from the summary box');
		
		await verify((await authenticate(secret)).code === 0, 'Original secret authenticates before export');
		
		for (const extension of ['json', 'json.gz']) {
			const filename = Path.join(temp, 'key.' + extension);
			const exported = json(['key', id, '--export', filename]);
			const bytes = fs.readFileSync(filename);
			const text = (extension.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes).toString();
			const payload = JSON.parse(text);
			const saved = payload.items[0].data;
			const expectedHash = crypto.createHash('sha256').update(secret + id).digest('hex');
			
			await verify(exported.count === 1 && payload.items[0].type === 'api_key', extension + ': exported API key as XYPDF');
			
			await verify(saved.id === id && saved.key === expectedHash && saved.mask === created.api_key.mask, extension + ': export preserves ID, salted hash and mask');
			
			await verify(!text.includes(secret) && !('plain_key' in saved), extension + ': export contains no plaintext secret');
			
			xy(['key', 'delete', id, '--confirm']);
			
			await verify(!(await call('getApiKeys', {})).rows.some(key => key.id === id), extension + ': key deleted');
			const rejected = await authenticate(secret);
			
			await verify(rejected.code !== 0 && /Invalid API Key/i.test(rejected.description || ''), extension + ': original secret rejected after deletion');
			
			const preview = json(['import', filename]);
			
			await verify(preview.preview === true && preview.items.length === 1 && preview.items[0].operation === 'create', extension + ': import preview plans creation');
			
			await verify((await authenticate(secret)).code !== 0, extension + ': preview does not restore access');
			
			const imported = json(['import', filename, '--confirm']);
			
			await verify(imported.code === 0 && imported.items[0].status === 'created' && imported.items[0].id === id, extension + ': confirmed import recreates original ID');
			const restored = (await call('getApiKeys', {})).rows.find(key => key.id === id);
			
			await verify(restored && restored.key === saved.key && restored.mask === saved.mask && !!restored.active, extension + ': restored credential fields and active state match');
			
			await verify((await authenticate(secret)).code === 0, extension + ': SAME original plaintext secret authenticates after import');
		}
		
		const now = (await call('getApiKeys', {})).rows.filter(key => key.title !== title);
		
		await verify(JSON.stringify(now) === JSON.stringify(original), 'Existing API key definitions unchanged');
	}
	finally {
		await cleanupFixtures([
			{ list: 'api_keys', method: 'deleteApiKey', match: item => item.title === title }
		]);
	}
});
