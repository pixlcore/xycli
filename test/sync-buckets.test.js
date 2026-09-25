const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { api } = require('@pixlcore/xyops-sdk');
const { loadTestConfig, createCheck, createTempDir, xy, call } = require('./helpers/common.js');

test('bucket filesystem sync', async t => {
	loadTestConfig();
	const check = createCheck(t);
	const temp = createTempDir(t, 'xycli-bucket-sync-live-');
	const setupRoot = Path.join(temp, 'setup');
	const activeRoot = Path.join(temp, 'active');
	const stamp = Date.now();
	const id = 'cli_bucket_sync_test_' + stamp;
	const title = 'CLI Bucket Sync Test ' + stamp;
	const slug = title.replace(/\W+/g, '-').replace(/^-|-$/g, '');
	const seed = Path.join(temp, 'seed.json');
	let originalState = null;
	let created = false;
	
	fs.mkdirSync(setupRoot, { recursive: true });
	fs.mkdirSync(activeRoot, { recursive: true });
	fs.writeFileSync(seed, 'seed');
	
	try {
		await check('create an isolated Bucket fixture', async () => {
			const before = await call('getMultiple', { lists: 'buckets', state: 1 });
			originalState = structuredClone((before.state && before.state.sync) || {});
			
			// --new will skip existing Buckets without downloading their content.
			for (const bucket of before.buckets) {
				fs.writeFileSync(Path.join(setupRoot, 'skip-' + bucket.id + '.json'), JSON.stringify({
					type: 'xypdf', version: '1.0', items: [{ type: 'bucket', data: bucket }]
				}));
			}
			await call('createBucket', { id, title, enabled: false, data: { keep: true, remove: true } });
			created = true;
			const uploaded = await api.uploadBucketFiles({ id }, { files: [seed] });
			assert.ok(!uploaded.err && uploaded.data && uploaded.data.code === 0, 'Seed upload succeeded');
		});
		
		await check('setup exports Bucket data and files', async () => {
			const output = xy(['sync', 'setup', 'buckets', '--new'], { cwd: setupRoot });
			assert.match(output, /🪣.*\/\s*\n/);
			assert.match(output, /📄.*data\.json/);
			assert.match(output, /📂.*files\//);
			assert.match(output, /📎.*seed\.json/);
			assert.doesNotMatch(output, /Bucket content:/);
			const source = Path.join(setupRoot, 'buckets', slug);
			assert.deepEqual(JSON.parse(fs.readFileSync(Path.join(source, 'data.json'), 'utf8')), { keep: true, remove: true });
			assert.equal(fs.readFileSync(Path.join(source, 'files', 'seed.json'), 'utf8'), 'seed');
			fs.mkdirSync(Path.join(activeRoot, 'buckets'), { recursive: true });
			fs.cpSync(source + '.json', Path.join(activeRoot, 'buckets', slug + '.json'));
			fs.cpSync(source, Path.join(activeRoot, 'buckets', slug), { recursive: true });
		});
		
		await check('upsync replaces data and uploads a new file', async () => {
			const content = Path.join(activeRoot, 'buckets', slug);
			// Semicolon exercises filename normalization on Unix and Windows alike.
			const added = Path.join(content, 'files', 'New; File.txt');
			const source = Path.join(activeRoot, 'buckets', slug + '.json');
			const xypdf = JSON.parse(fs.readFileSync(source, 'utf8'));
			xypdf.items[0].data.notes = 'Local Bucket notes';
			fs.writeFileSync(source, JSON.stringify(xypdf));
			fs.writeFileSync(Path.join(content, 'data.json'), JSON.stringify({ keep: 'local' }));
			fs.writeFileSync(added, 'new content');
			const output = xy(['sync', activeRoot, '--up', 'buckets', '--down', 'false', '--delete', 'false']);
			assert.match(output, new RegExp('Updating bucket: ' + title + ' \\(' + id + '\\)'));
			assert.match(output, new RegExp('\\n\\n ⬆️ Updating bucket data: ' + title + ' \\(' + id + '\\)'));
			assert.match(output, /-.*"keep": true/);
			assert.match(output, /\+.*"keep": "local"/);
			assert.match(output, new RegExp('\\n\\n ⬆️ Uploading \\d+ bucket files?: ' + title + ' \\(' + id + '\\)'));
			assert.match(output, /📎.*New; File\.txt/);
			assert.ok(output.indexOf('Updating bucket data:') > output.indexOf('Updating bucket:'), 'Bucket data has its own section after the definition');
			const bucket = await call('getBucket', { id });
			assert.equal(bucket.bucket.notes, 'Local Bucket notes');
			assert.deepEqual(bucket.data, { keep: 'local' });
			const file = bucket.files.find(entry => entry.filename === 'New_ File.txt');
			assert.ok(file, 'Normalized upload is in the manifest');
			assert.equal(Math.floor(fs.statSync(added).mtimeMs / 1000), file.date);
		});
		
		await check('downsync pulls remote data and file changes', async () => {
			await call('updateBucket', { id, notes: 'Remote Bucket notes' });
			await call('writeBucketData', { id, replace: true, data: { keep: 'remote' } });
			fs.writeFileSync(seed, 'remote replacement');
			const uploaded = await api.uploadBucketFiles({ id }, { files: [seed] });
			assert.ok(!uploaded.err && uploaded.data && uploaded.data.code === 0, 'Replacement upload succeeded');
			xy(['sync', activeRoot, '--up', 'false', '--down', 'buckets', '--delete', 'false']);
			const content = Path.join(activeRoot, 'buckets', slug);
			const xypdf = JSON.parse(fs.readFileSync(content + '.json', 'utf8'));
			assert.equal(xypdf.items[0].data.notes, 'Remote Bucket notes');
			assert.deepEqual(JSON.parse(fs.readFileSync(Path.join(content, 'data.json'), 'utf8')), { keep: 'remote' });
			assert.equal(fs.readFileSync(Path.join(content, 'files', 'seed.json'), 'utf8'), 'remote replacement');
		});
		
		await check('two-way sync pushes newer local content and aligns timestamps', async () => {
			const content = Path.join(activeRoot, 'buckets', slug);
			const dataFile = Path.join(content, 'data.json');
			const file = Path.join(content, 'files', 'seed.json');
			const newer = Math.ceil(Date.now() / 1000) + 5;
			fs.writeFileSync(dataFile, JSON.stringify({ keep: 'two-way' }));
			fs.writeFileSync(file, 'two-way file');
			fs.utimesSync(dataFile, newer, newer);
			fs.utimesSync(file, newer, newer);
			const output = xy(['sync', activeRoot, '--up', 'buckets', '--down', 'buckets', '--delete', 'false']);
			assert.match(output, new RegExp('\\n\\n ⬆️ Updating bucket data: ' + title + ' \\(' + id + '\\)'));
			assert.match(output, /-.*"keep": "remote"/);
			assert.match(output, /\+.*"keep": "two-way"/);
			const bucket = await call('getBucket', { id });
			assert.deepEqual(bucket.data, { keep: 'two-way' });
			const remoteFile = bucket.files.find(entry => entry.filename === 'seed.json');
			assert.equal(remoteFile.size, Buffer.byteLength('two-way file'));
			assert.equal(Math.floor(fs.statSync(file).mtimeMs / 1000), remoteFile.date);
			assert.equal(Math.floor(fs.statSync(dataFile).mtimeMs / 1000), bucket.meta.mod);
		});
	}
	finally {
		// Ordinary sync writes a shared management map. Restore it exactly, then
		// delete only this uniquely named Bucket and its content.
		const cleanupErrors = [];
		if (originalState !== null) {
			try { await call('update_global_state', { sync: originalState }); }
			catch (error) { cleanupErrors.push(error); }
		}
		if (created) {
			try { await call('deleteBucket', { id }); }
			catch (error) { cleanupErrors.push(error); }
		}
		if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Bucket sync fixture cleanup failed');
	}
});
