const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const bucketSync = require('../lib/sync-buckets.js');
const sync = require('../lib/sync.js');
const utils = require('../lib/utils.js');

// The bucket pass uses the ordinary sync logging functions, whose output is
// provided by pixl-cli in production. Keep the test output quiet and local.
global.println = () => {};

function fixture(t, options = {}) {
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-bucket-sync-unit-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const item = { type: 'bucket', data: { id: 'bucket_unit', title: 'Changed Title' }, file: Path.join(dir, 'custom', 'Original-Name.json') };
	const paths = bucketSync.getSyncBucketPaths(item);
	fs.mkdirSync(paths.files, { recursive: true });
	fs.writeFileSync(item.file, '{}');
	fs.writeFileSync(paths.data, JSON.stringify(options.localData || { keep: true, removed: true }));
	fs.utimesSync(paths.data, 100, options.localDataTime || 100);
	
	const remote = {
		bucket: { id: item.data.id, title: item.data.title },
		data: options.remoteData || { keep: false, server: true },
		meta: { mod: options.remoteDataTime || 90 },
		files: options.remoteFiles || []
	};
	const bytes = options.remoteBytes || {};
	const calls = [];
	const app = {
		...bucketSync,
		...sync,
		compareVersions: utils.compareVersions,
		xyopsVersion: options.version || '1.1.2',
		dry: !!options.dry,
		errors: [],
		warnings: [],
		api: {
			async getBucket() { return { data: structuredClone(remote) }; },
			async file(request, settings) {
				const path = 'files/' + request.path;
				if (!Object.hasOwn(bytes, path)) return { err: new Error('Missing remote bytes') };
				fs.writeFileSync(settings.download, bytes[path]);
				return { data: {} };
			}
		},
		async callStandardAPI(method, request, settings = {}) {
			calls.push({ method, request, settings });
			if (method == 'writeBucketData') {
				remote.data = structuredClone(request.data);
				remote.meta.mod = 120;
				return {};
			}
			if (method == 'uploadBucketFiles') {
				settings.files.forEach(path => {
					const name = app.cleanSyncBucketFilename(Path.basename(path));
					let file = remote.files.find(entry => entry.filename == name);
					if (!file) {
						file = { filename: name, path: 'files/bucket/bucket_unit/new/' + name };
						remote.files.push(file);
					}
					file.size = fs.statSync(path).size;
					file.date = 130;
				});
				return { files: structuredClone(remote.files) };
			}
			if (method == 'deleteBucketFile') {
				remote.files = remote.files.filter(file => file.path != request.path);
				return {};
			}
			throw new Error('Unexpected API: ' + method);
		},
		logSyncError(message) { this.errors.push(message); },
		logSyncWarning(message) { this.warnings.push(message); },
		markdown(text) { return text; },
		die(message) { throw new Error(message); }
	};
	return { dir, item, paths, remote, calls, app };
}

test('bucket sync rejects xyOps versions older than 1.1.2', t => {
	const current = fixture(t);
	assert.doesNotThrow(() => current.app.requireBucketSyncVersion());
	current.app.xyopsVersion = '1.1.1';
	assert.throws(() => current.app.requireBucketSyncVersion(), /v1\.1\.2 or later/);
});

test('bucket setup writes data and binary files with server mtimes beside the XYPDF source', async t => {
	const file = { filename: 'Sample.JSON', path: 'files/bucket/bucket_unit/key/Sample.JSON', size: 8, date: 80 };
	const env = fixture(t, { remoteFiles: [file], remoteBytes: { [file.path]: 'not json' } });
	fs.rmSync(env.paths.dir, { recursive: true, force: true });
	await env.app.setupBucketContents([{ id: env.item.data.id, file: env.item.file }], { dry: false, force: false });
	assert.deepEqual(JSON.parse(fs.readFileSync(env.paths.data, 'utf8')), env.remote.data);
	assert.equal(fs.readFileSync(Path.join(env.paths.files, 'Sample.JSON'), 'utf8'), 'not json');
	assert.equal(fs.statSync(env.paths.data).mtimeMs / 1000, 90);
	assert.equal(fs.statSync(Path.join(env.paths.files, 'Sample.JSON')).mtimeMs / 1000, 80);
});

test('upsync replaces data, normalizes manifest names, batches uploads, and deletes missing files last', async t => {
	const removed = { filename: 'old.txt', path: 'files/bucket/bucket_unit/old/old.txt', size: 3, date: 60 };
	const env = fixture(t, { remoteFiles: [removed] });
	const upload = Path.join(env.paths.files, 'New: File.txt');
	fs.writeFileSync(upload, 'new');
	fs.utimesSync(upload, 110, 110);
	await env.app.syncBucketContents([env.item], { up: ['buckets'], delete: ['buckets'] });
	assert.deepEqual(env.calls.map(call => call.method), ['writeBucketData', 'uploadBucketFiles', 'deleteBucketFile']);
	assert.equal(env.calls[0].request.replace, true);
	assert.deepEqual(env.remote.data, { keep: true, removed: true });
	assert.equal(env.remote.files[0].filename, 'New_ File.txt');
	assert.equal(fs.statSync(upload).mtimeMs / 1000, 130);
	assert.equal(fs.statSync(env.paths.data).mtimeMs / 1000, 120);
});

test('downsync replaces changed files and preserves the server timestamp', async t => {
	const file = { filename: 'same.txt', path: 'files/bucket/bucket_unit/key/same.txt', size: 6, date: 140 };
	const env = fixture(t, { remoteFiles: [file], remoteBytes: { [file.path]: 'remote' }, remoteDataTime: 150 });
	const localFile = Path.join(env.paths.files, file.filename);
	fs.writeFileSync(localFile, 'old');
	fs.utimesSync(localFile, 100, 100);
	await env.app.syncBucketContents([env.item], { down: ['buckets'] });
	assert.equal(fs.readFileSync(localFile, 'utf8'), 'remote');
	assert.equal(fs.statSync(localFile).mtimeMs / 1000, 140);
	assert.deepEqual(JSON.parse(fs.readFileSync(env.paths.data, 'utf8')), env.remote.data);
	assert.equal(fs.statSync(env.paths.data).mtimeMs / 1000, 150);
});

test('two-way sync chooses the newer data and file copies independently', async t => {
	const old = { filename: 'remote.txt', path: 'files/bucket/bucket_unit/key/remote.txt', size: 6, date: 140 };
	const env = fixture(t, {
		localDataTime: 160,
		remoteDataTime: 150,
		remoteFiles: [old],
		remoteBytes: { [old.path]: 'remote'
		}
	});
	const localFile = Path.join(env.paths.files, old.filename);
	fs.writeFileSync(localFile, 'stale');
	fs.utimesSync(localFile, 100, 100);
	await env.app.syncBucketContents([env.item], { up: ['buckets'], down: ['buckets'] });
	assert.deepEqual(env.calls.map(call => call.method), ['writeBucketData']);
	assert.equal(fs.readFileSync(localFile, 'utf8'), 'remote');
	assert.equal(fs.statSync(localFile).mtimeMs / 1000, 140);
	assert.deepEqual(env.remote.data, env.app.readSyncBucketLocal(env.item).data);
});

test('two-way sync reports equal-time content conflicts instead of guessing', async t => {
	const env = fixture(t, { remoteDataTime: 100 });
	await env.app.syncBucketContents([env.item], { up: ['buckets'], down: ['buckets'] });
	assert.equal(env.app.errors.length, 1);
	assert.match(env.app.errors[0], /equal timestamps/);
	assert.deepEqual(env.calls, []);
});

test('invalid local data blocks every bucket mutation including file deletion', async t => {
	const removed = { filename: 'old.txt', path: 'files/bucket/bucket_unit/old/old.txt', size: 3, date: 60 };
	const env = fixture(t, { remoteFiles: [removed] });
	fs.writeFileSync(env.paths.data, '{invalid');
	await env.app.syncBucketContents([env.item], { up: ['buckets'], delete: ['buckets'] });
	assert.equal(env.app.errors.length, 1);
	assert.deepEqual(env.calls, []);
});

test('bucket dry runs leave data, files, and server records unchanged', async t => {
	const removed = { filename: 'old.txt', path: 'files/bucket/bucket_unit/old/old.txt', size: 3, date: 60 };
	const env = fixture(t, { remoteFiles: [removed], dry: true });
	const added = Path.join(env.paths.files, 'new.txt');
	fs.writeFileSync(added, 'new');
	const originalTime = fs.statSync(env.paths.data).mtimeMs;
	await env.app.syncBucketContents([env.item], { up: ['buckets'], delete: ['buckets'] });
	assert.deepEqual(env.calls, []);
	assert.equal(env.remote.files.length, 1);
	assert.deepEqual(env.remote.data, { keep: false, server: true });
	assert.equal(fs.statSync(env.paths.data).mtimeMs, originalTime);
});

test('a failed download keeps the previous local file intact', async t => {
	const file = { filename: 'same.txt', path: 'files/bucket/bucket_unit/key/same.txt', size: 6, date: 140 };
	const env = fixture(t, { remoteFiles: [file] });
	const localFile = Path.join(env.paths.files, file.filename);
	fs.writeFileSync(localFile, 'before');
	fs.utimesSync(localFile, 100, 100);
	await env.app.syncBucketContents([env.item], { down: ['buckets'] });
	assert.equal(env.app.errors.length, 1);
	assert.equal(fs.readFileSync(localFile, 'utf8'), 'before');
});
