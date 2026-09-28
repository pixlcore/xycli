const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const Path = require('node:path');
const { spawnSync } = require('node:child_process');

function makeTree(t) {
	var dir = fs.mkdtempSync(Path.join(os.tmpdir(), 'xycli-syshook-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function writeSource(dir, name, type, data) {
	var file = Path.join(dir, name);
	fs.mkdirSync(Path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({
		type: 'xypdf', version: '1.0', items: [{ type, data }]
	}));
	return file;
}

function runHook(dir, action, payload, extra = [], use_default_lock = false) {
	// Strip xyOps connection variables to match the conductor's shell-hook
	// environment.  The hook must complete without credentials or API access.
	var env = { ...process.env, HOME: dir };
	for (const key of Object.keys(env)) {
		if (key.startsWith('XYOPS_')) delete env[key];
	}
	
	var args = [Path.join(__dirname, '..', 'index.js'), 'sync', dir, '--syshook', action];
	if (!use_default_lock) args.push('--lock_file', Path.join(dir, '.sync-lock'));
	args.push(...extra);
	
	return spawnSync(process.execPath, args, {
		input: payload === null ? '' : JSON.stringify(payload) + '\n',
		encoding: 'utf8',
		timeout: 10000,
		env
	});
}

function markerCommand(name) {
	var code = `require('node:fs').writeFileSync(${JSON.stringify(name)}, process.cwd())`;
	return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
}

test('syshook deletes only the exact Event and its owned neighbors', t => {
	var dir = makeTree(t);
	var event = writeSource(dir, 'events/Ops/Nightly.json', 'event', {
		id: 'evt_one', title: 'Nightly', params: { script: '(External)' }
	});
	var neighbor = Path.join(dir, 'events/Ops/Nightly-params.script.sh');
	fs.writeFileSync(neighbor, 'echo one\n');
	var other = writeSource(dir, 'events/Ops/Nightly-V2.json', 'event', {
		id: 'evt_two', title: 'Nightly V2', params: { script: '(External)' }
	});
	var other_neighbor = Path.join(dir, 'events/Ops/Nightly-V2-params.script.sh');
	fs.writeFileSync(other_neighbor, 'echo two\n');
	var new_event = writeSource(dir, 'events/Ops/New.json', 'event', { id: 'evt_new', title: 'New' });
	var same_id_plugin = writeSource(dir, 'plugins/Shared.json', 'plugin', { id: 'evt_one', title: 'Shared' });
	var marker = Path.join(dir, 'completed.txt');
	
	var result = runHook(dir, 'event_delete', {
		xy: 1, action: 'event_delete', event: { id: 'evt_one', title: 'Nightly' }
	}, ['--down_cmd', markerCommand('completed.txt')]);
	
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(fs.existsSync(event), false);
	assert.equal(fs.existsSync(neighbor), false);
	assert.equal(fs.existsSync(other), true);
	assert.equal(fs.existsSync(other_neighbor), true);
	assert.equal(fs.existsSync(new_event), true);
	assert.equal(fs.existsSync(same_id_plugin), true);
	assert.equal(fs.readFileSync(marker, 'utf8'), fs.realpathSync(dir));
});

test('syshook uses its default lock without a configured xyOps URL or API Key', t => {
	var dir = makeTree(t);
	var event = writeSource(dir, 'events/Delete-Me.json', 'event', { id: 'evt_no_config' });
	var result = runHook(dir, 'event_delete', {
		xy: 1, action: 'event_delete', event: { id: 'evt_no_config' }
	}, [], true);
	
	assert.equal(result.status, 0, result.stderr);
	assert.equal(fs.existsSync(event), false);
});

test('syshook rejects a mismatched action without deleting files', t => {
	var dir = makeTree(t);
	var file = writeSource(dir, 'plugins/Shared.json', 'plugin', { id: 'plugin_one', title: 'Shared' });
	var result = runHook(dir, 'plugin_delete', {
		xy: 1, action: 'event_delete', plugin: { id: 'plugin_one' }
	}, ['--down_cmd', markerCommand('completed.txt')]);
	
	assert.equal(result.status, 1);
	assert.match(result.stderr, /does not match --syshook plugin_delete/);
	assert.equal(fs.existsSync(file), true);
	assert.equal(fs.existsSync(Path.join(dir, 'completed.txt')), false);
});

test('syshook deletes a matching Plugin without changing another Plugin', t => {
	var dir = makeTree(t);
	var target = writeSource(dir, 'plugins/Shared.json', 'plugin', { id: 'plugin_one', title: 'Shared' });
	var other = writeSource(dir, 'plugins/Other.json', 'plugin', { id: 'plugin_two', title: 'Other' });
	var result = runHook(dir, 'plugin_delete', {
		xy: 1, action: 'plugin_delete', plugin: { id: 'plugin_one' }
	});
	
	assert.equal(result.status, 0, result.stderr);
	assert.equal(fs.existsSync(target), false);
	assert.equal(fs.existsSync(other), true);
});

// Each remaining standard sync type uses the same exact type-and-ID lookup.
// Include another Event with the target ID to catch an accidental ID-only
// match, especially for the API Key action's different spelling.
for (const [action, type] of [
	['alert_delete', 'alert'],
	['apikey_delete', 'api_key'],
	['category_delete', 'category'],
	['channel_delete', 'channel'],
	['group_delete', 'group'],
	['monitor_delete', 'monitor'],
	['tag_delete', 'tag'],
	['web_hook_delete', 'web_hook']
]) {
	test('syshook deletes one ' + type + ' for ' + action, t => {
		var dir = makeTree(t);
		var target = writeSource(dir, type + '/Target.json', type, { id: 'shared_id' });
		var other = writeSource(dir, type + '/Other.json', type, { id: 'other_id' });
		var event = writeSource(dir, 'events/Shared.json', 'event', { id: 'shared_id' });
		var result = runHook(dir, action, {
			xy: 1, action, [type]: { id: 'shared_id' }
		});
		
		assert.equal(result.status, 0, result.stderr);
		assert.equal(fs.existsSync(target), false);
		assert.equal(fs.existsSync(other), true);
		assert.equal(fs.existsSync(event), true);
	});
}

test('syshook rejects bucket deletion and preserves its source', t => {
	var dir = makeTree(t);
	var bucket = writeSource(dir, 'buckets/Shared.json', 'bucket', { id: 'bucket_one' });
	var result = runHook(dir, 'bucket_delete', {
		xy: 1, action: 'bucket_delete', bucket: { id: 'bucket_one' }
	});
	
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Invalid --syshook action/);
	assert.equal(fs.existsSync(bucket), true);
});

test('syshook checks neighboring files before deleting the source', t => {
	var dir = makeTree(t);
	var target = writeSource(dir, 'events/Ops/Nightly.json', 'event', { id: 'evt_one', title: 'Nightly' });
	var unrelated = Path.join(dir, 'events/Ops/Nightly-other.txt');
	fs.writeFileSync(unrelated, 'keep me\n');
	var result = runHook(dir, 'event_delete', {
		xy: 1, action: 'event_delete', event: { id: 'evt_one' }
	});
	
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Neighbor file does not match a string property/);
	assert.equal(fs.existsSync(target), true);
	assert.equal(fs.existsSync(unrelated), true);
});

test('syshook stops on malformed JSON before deleting a matching source', t => {
	var dir = makeTree(t);
	var target = writeSource(dir, 'events/Ops/Nightly.json', 'event', { id: 'evt_one', title: 'Nightly' });
	fs.writeFileSync(Path.join(dir, 'events/Ops/Broken.json'), '{bad json');
	var result = runHook(dir, 'event_delete', {
		xy: 1, action: 'event_delete', event: { id: 'evt_one' }
	});
	
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Failed to parse JSON file/);
	assert.equal(fs.existsSync(target), true);
});

test('syshook refuses duplicate XYPDF sources before changing either file', t => {
	var dir = makeTree(t);
	var data = { id: 'plugin_one', title: 'Shared', script: '(External)' };
	var first = writeSource(dir, 'plugins/First.json', 'plugin', data);
	var second = writeSource(dir, 'plugins/Second.json', 'plugin', data);
	var result = runHook(dir, 'plugin_delete', {
		xy: 1, action: 'plugin_delete', plugin: { id: 'plugin_one' }
	});
	
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Duplicate XYPDF sources/);
	assert.equal(fs.existsSync(first), true);
	assert.equal(fs.existsSync(second), true);
});

test('syshook dry run and absent source never run down_cmd', t => {
	var dir = makeTree(t);
	var file = writeSource(dir, 'plugins/Shared.json', 'plugin', { id: 'plugin_one', title: 'Shared' });
	var command = markerCommand('completed.txt');
	var payload = { xy: 1, action: 'plugin_delete', plugin: { id: 'plugin_one' } };
	var preview = runHook(dir, 'plugin_delete', payload, ['--dry', '--down_cmd', command]);
	
	assert.equal(preview.status, 0, preview.stderr);
	assert.match(preview.stdout, /Would delete:/);
	assert.equal(fs.existsSync(file), true);
	assert.equal(fs.existsSync(Path.join(dir, 'completed.txt')), false);
	
	var absent = runHook(dir, 'plugin_delete', {
		xy: 1, action: 'plugin_delete', plugin: { id: 'other' }
	}, ['--down_cmd', command]);
	assert.equal(absent.status, 0, absent.stderr);
	assert.equal(fs.existsSync(file), true);
	assert.equal(fs.existsSync(Path.join(dir, 'completed.txt')), false);
});

test('syshook reports a failed down_cmd after deleting the matched source', t => {
	var dir = makeTree(t);
	var file = writeSource(dir, 'plugins/Shared.json', 'plugin', { id: 'plugin_one', title: 'Shared' });
	var command = `${JSON.stringify(process.execPath)} -e "process.exit(2)"`;
	var result = runHook(dir, 'plugin_delete', {
		xy: 1, action: 'plugin_delete', plugin: { id: 'plugin_one' }
	}, ['--down_cmd', command]);
	
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Command failed/);
	assert.equal(fs.existsSync(file), false);
});
