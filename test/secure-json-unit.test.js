const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const cli = require('pixl-cli');
const Tools = cli.Tools;
const utils = require('../lib/utils.js');
const transfer = require('../lib/transfer.js');
const upgrade = require('../lib/upgrade.js');

// Keep these as JSON text so JavaScript's object literal syntax cannot consume
// __proto__ before the input reaches the actual CLI boundary under test.
const unsafe = [
	'{"nested":[{"__proto__":{"polluted":true}}]}',
	'{"nested":[{"constructor":{"prototype":{"polluted":true}}}]}',
	'{"nested":[{"\\u005f_proto__":{"polluted":true}}]}'
];

function fixture(t) {
	// Each subprocess gets a private config, cache and SDK stub. Any attempted
	// API call leaves a marker, without contacting a real xyOps server.
	const dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-secure-json-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const marker = Path.join(dir, 'api-called');
	const preload = Path.join(dir, 'preload.js');
	fs.writeFileSync(preload, `
		const fs = require('node:fs');
		const sdk = require(${JSON.stringify(require.resolve('@pixlcore/xyops-sdk'))});
		sdk.api = new Proxy({}, {
			get() { return async function() {
				fs.writeFileSync(${JSON.stringify(marker)}, 'called');
				return { data: { config: {}, masters: [], version: '99.0.0' } };
			}; }
		});
	`);
	const env = { ...process.env, HOME: dir, USERPROFILE: dir, ProgramData: dir };
	for (const key of Object.keys(env)) {
		if (key.startsWith('XYOPS_')) delete env[key];
	}
	Object.assign(env, {
		XYOPS_API_KEY: 'fixture-key', XYOPS_BASE_URL: 'https://fixture.invalid',
		XYOPS_TEMP_DIR: dir, XYOPS_COLOR: 'false'
	});
	
	return {
		dir, marker, env,
		run(args, input) {
			const result = spawnSync(process.execPath, [
				'--require', preload, Path.join(__dirname, '..', 'index.js'), ...args
			], { env, input, encoding: 'utf8', timeout: 10000 });
			assert.ifError(result.error);
			assert.equal(result.signal, null);
			return result;
		}
	};
}

test('untrusted argument JSON is rejected before API access', t => {
	const env = fixture(t);
	const file = Path.join(env.dir, 'input.json');
	for (const payload of unsafe) {
		fs.writeFileSync(file, payload);
		for (const [args, input] of [
			[['--params', payload]],
			[['--json', '@-'], payload],
			[['--json', '@' + file]]
		]) {
			const result = env.run(['api', 'run_event', ...args], input);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /forbidden prototype property/);
			assert.equal(fs.existsSync(env.marker), false);
		}
	}
});

test('config files and environment JSON reject forbidden properties', t => {
	const env = fixture(t);
	const file = Path.join(env.dir, '.config', 'xyops', 'cli.json');
	fs.mkdirSync(Path.dirname(file), { recursive: true });
	for (const payload of unsafe) {
		fs.writeFileSync(file, payload);
		assert.equal(env.run(['config']).status, 1);
		assert.equal(fs.readFileSync(file, 'utf8'), payload);
		fs.unlinkSync(file);
		
		env.env.XYOPS_SYNC = payload;
		const result = env.run(['config']);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Failed to parse JSON from environment variable: XYOPS_SYNC/);
		delete env.env.XYOPS_SYNC;
	}
});

test('cached API JSON rejects forbidden properties before returning data', async t => {
	const env = fixture(t);
	const config = { base_url: 'https://fixture.invalid' };
	const file = Path.join(env.dir, 'config-' + Tools.digestHex(config.base_url, 'sha256', 16) + '.json');
	const context = { config, tempDir: env.dir };
	for (const payload of unsafe) {
		fs.writeFileSync(file, payload);
		await assert.rejects(utils.cacheAPI.call(context, 'config', {}), /forbidden prototype property/);
	}
});

test('plain and gzip imports reject forbidden properties before planning API calls', async t => {
	const env = fixture(t);
	for (const payload of unsafe) {
		const text = '{"type":"xypdf","version":"1.0","items":[{"type":"event","data":' + payload + '}]}';
		for (const gzip of [false, true]) {
			const file = Path.join(env.dir, gzip ? 'input.json.gz' : 'input.json');
			fs.writeFileSync(file, gzip ? zlib.gzipSync(text) : text);
			const context = {
				args: { other: [file] },
				requireTransferFilename: transfer.requireTransferFilename,
				die(message) { throw new Error(message); },
				async getMultiple() { assert.fail('Import must reject JSON before loading resources'); }
			};
			await assert.rejects(transfer.cmd_import.call(context), /Failed to read XYPDF file: .*forbidden prototype property/);
		}
	}
});

test('npm registry objects are scanned before accepting a version', async t => {
	const fetch = global.fetch;
	t.after(() => { global.fetch = fetch; });
	const context = {
		cli: { progress: { start() {}, end() {} } },
		color() { return text => text; },
		die(message) { throw new Error(message); }
	};
	for (const payload of unsafe) {
		global.fetch = async () => ({ ok: true, async json() {
			return { version: '99.0.0', extra: JSON.parse(payload) };
		} });
		await assert.rejects(upgrade.getLatestXYCLIVersion.call(context), /Could not parse the npm registry response: .*forbidden prototype property/);
	}
});
