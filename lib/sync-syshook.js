// Local XYPDF deletion for xyOps System Hooks.
// This command never updates definitions or queries the remote server.

const fs = require('fs');
const Path = require('path');
const cli = require('pixl-cli');
const Tools = cli.Tools;

const MAX_HOOK_BYTES = 64 * 1024 * 1024;

// Map each supported xyOps deletion activity to both its STDIN payload key
// and its XYPDF item type.  API Keys use "apikey" in the activity name but
// "api_key" in the payload; workflows are stored as Event definitions.
// Buckets are excluded because their data and uploaded files need separate
// deletion handling beyond the single XYPDF source and its property files.
const HOOK_TYPES = {
	alert_delete: 'alert',
	apikey_delete: 'api_key',
	category_delete: 'category',
	channel_delete: 'channel',
	event_delete: 'event',
	group_delete: 'group',
	monitor_delete: 'monitor',
	plugin_delete: 'plugin',
	tag_delete: 'tag',
	web_hook_delete: 'web_hook'
};

async function readHookPayload() {
	// System Hooks send one JSON activity object followed by a newline.  Read
	// until EOF so a partial pipe write cannot be mistaken for a valid event.
	if (process.stdin.isTTY) throw new Error("System Hook sync requires an activity payload on STDIN.");
	
	var chunks = [];
	var size = 0;
	for await (const chunk of process.stdin) {
		var buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_HOOK_BYTES) throw new Error("System Hook activity payload is too large.");
		chunks.push(buffer);
	}
	
	if (!size) throw new Error("System Hook activity payload is empty.");
	
	try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
	catch (err) { throw new Error("Invalid System Hook activity JSON: " + err.message); }
}

function listLocalFiles(dir) {
	// Match ordinary sync's visible-file scan, but never follow symbolic links.
	// A local delete must not cross into an unrelated tree through a link.
	var files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		var file = Path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...listLocalFiles(file));
		else if (entry.isFile()) files.push(file);
	}
	return files;
}

function isInsideDir(file, dir) {
	var relative = Path.relative(dir, file);
	return !!relative && (relative != '..') && !relative.startsWith('..' + Path.sep) && !Path.isAbsolute(relative);
}

function scanSources(files) {
	// Index every valid XYPDF stem, not only the target item.  A source named
	// "Foo" must not claim property files belonging to "Foo-V2".
	var sources = [];
	var bucket_dirs = [];
	var parse_errors = [];
	for (const file of files.filter( file => file.match(/\.json$/i) )) {
		var raw = null;
		try { raw = fs.readFileSync(file, 'utf8'); }
		catch (err) { throw new Error("Failed to read JSON file: " + file + ": " + err.message); }
		
		var xypdf = null;
		try { xypdf = JSON.parse(raw); }
		catch (err) {
			parse_errors.push({ file, err });
			continue;
		}
		if (!xypdf || (xypdf.type !== 'xypdf')) continue;
		
		var stem = Path.basename(file).replace(/\.json$/i, '');
		var item = Array.isArray(xypdf.items) && (xypdf.items.length === 1) ? xypdf.items[0] : null;
		if (item && (item.type === 'bucket')) bucket_dirs.push(file.replace(/\.json$/i, ''));
		sources.push({ file, stem, xypdf, item });
	}
	
	// Bucket uploaded files are opaque content even when named *.json.  They
	// must not participate in this definition source inventory.
	for (const entry of parse_errors) {
		if (bucket_dirs.some( dir => isInsideDir(entry.file, dir) )) continue;
		throw new Error("Failed to parse JSON file: " + entry.file + ": " + entry.err.message);
	}
	
	return sources.filter( source => !bucket_dirs.some( dir => isInsideDir(source.file, dir) ) );
}

function findOwnedNeighbors(app, files, sources, source) {
	var dir = Path.dirname(source.file);
	var stem = source.stem;
	var source_stems = sources.filter( item => Path.dirname(item.file) === dir )
		.map( item => item.stem ).sort( (a, b) => b.length - a.length );
	var neighbors = [];
	
	for (const file of files) {
		if (Path.dirname(file) !== dir || file === source.file) continue;
		var name = Path.basename(file);
		var name_stem = name.replace(/\.\w+$/, '');
		if (!name_stem.startsWith(stem + '-')) continue;
		
		// The longest XYPDF prefix owns a neighboring property file.  Another
		// XYPDF is always its own source, even if its name looks like a neighbor.
		var owner = source_stems.find( other => name_stem.startsWith(other + '-') );
		if (owner && (owner !== stem)) continue;
		if (sources.some( other => other.file === file )) continue;
		
		var prop_path = name_stem.substring(stem.length + 1);
		if (!prop_path.match(/^[\w\.\-]+$/) ||
			(typeof(app.getSyncPropByPath(source.item.data, prop_path)) !== 'string')) {
			throw new Error("Neighbor file does not match a string property: " + file);
		}
		neighbors.push(file);
	}
	return neighbors;
}

module.exports = {
	
	async runSyncSyshook() {
		// The argument is an exact activity action, not a general sync direction.
		// Ignore saved up/down/delete settings by never entering ordinary sync.
		var action = this.args.syshook;
		var type = HOOK_TYPES[action];
		if (!type) this.die("Invalid --syshook action (use one of: " + Object.keys(HOOK_TYPES).join(', ') + ").");
		if (['up', 'down', 'delete', 'setup', 'new'].some( key => key in this.args )) {
			this.die("--syshook cannot be combined with ordinary sync modes.");
		}
		if (!this.args.other || (this.args.other.length !== 1)) {
			this.die("--syshook requires exactly one sync directory.");
		}
		if (this.args.down_cmd && (typeof(this.args.down_cmd) !== 'string')) {
			this.die("--down_cmd must be a shell command.");
		}
		
		var dir = Path.resolve(this.args.other[0]);
		var stat = null;
		try { stat = fs.statSync(dir); }
		catch (err) { this.die("Sync directory is not accessible: " + dir + ": " + err.message); }
		if (!stat.isDirectory()) this.die("Sync path is not a directory: " + dir);
		this.args.other = [dir]; // completion commands run from this directory
		this.sconfig = Tools.mergeHashes(this.config.sync || {}, this.args);
		this.warnings = [];
		this.errors = [];
		
		var payload = null;
		try { payload = await readHookPayload(); }
		catch (err) { this.die(err.message); }
		if (!payload || (typeof(payload) !== 'object') || Array.isArray(payload) ||
			(payload.xy !== 1) || (payload.action !== action)) {
			this.die("System Hook activity does not match --syshook " + action + ".");
		}
		var object = payload[type];
		if (!object || (typeof(object) !== 'object') || Array.isArray(object) ||
			(typeof(object.id) !== 'string') || !object.id.match(/^[a-z0-9_]+$/)) {
			this.die("System Hook activity is missing a valid " + type + " ID.");
		}
		
		// Identify the single local source by its stored type and ID, never by
		// title or filename.  Read the entire local inventory before changing it.
		var files = [];
		var sources = [];
		try {
			files = listLocalFiles(dir);
			sources = scanSources(files);
		}
		catch (err) { this.die("Failed to scan sync directory: " + err.message); }
		var matches = sources.filter( source => source.item && (source.item.type === type) &&
			source.item.data && (source.item.data.id === object.id) );
		if (matches.length > 1) this.die("Duplicate XYPDF sources for " + type + " ID " + object.id + ".");
		if (!matches.length) {
			println("No local XYPDF source found for " + type + " ID " + object.id + ".");
			return;
		}
		var source = matches[0];
		if (source.xypdf.version !== '1.0') this.die("Cannot delete incompatible XYPDF source: " + source.file);
		
		var neighbors = [];
		try { neighbors = findOwnedNeighbors(this, files, sources, source); }
		catch (err) { this.die(err.message); }
		var targets = [...neighbors, source.file]; // keep JSON last for safe retries
		
		for (const file of targets) {
			println((this.dry ? "Would delete: " : "Deleting: ") + file);
			if (this.dry) continue;
			try { fs.unlinkSync(file); }
			catch (err) { this.die("Failed to delete local file: " + file + ": " + err.message); }
		}
		
		// A dry run and a missing local source never trigger Git commands.  Run
		// only the explicitly supplied down_cmd after a real local deletion.
		if (!this.dry && this.args.down_cmd) this.syncFinishCmd(this.args.down_cmd);
	}
};
