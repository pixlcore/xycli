// Sync Layer

const fs = require('fs');
const Path = require('path');
const os = require('os');
const cp = require('child_process');
const Diff = require('diff');
const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_sync() {
		// Serialize every sync operation for this xyOps instance on this host.
		// Keep the lock through completion commands and notifications, and always
		// release it after the command settles.  The process exit handler covers
		// fatal errors and signals that call process.exit() before finally runs.
		this.acquireSyncLock();
		try {
			return await this.runSyncCommand();
		}
		finally {
			this.releaseSyncLock();
		}
	},
	
	async runSyncCommand() {
		// sync a filesystem of XYPDF files to xyOps resources
		// xy sync --up all --dry
		// xy sync --up "events,plugins" --delete plugins
		await this.getMultiple();
		
		// optionally setup local filesystem for sync
		if (this.args.other && (this.args.other[0] === 'setup')) {
			this.args.other.shift();
			this.args.setup = this.args.other;
		}
		if (this.args.setup) return await this.setupSync();
		
		println( "\n " + cli.emoji('🔄') + ' ' + this.color('theme').bold("XYOPS SYNC ENGINE v1") );
		
		var supported_lists = this.config.ui.list_list.map( list => list.id ).filter( id => !id.match(/^(buckets|secrets|users|roles)$/) );
		
		// allow sync config in config files and/or cli args
		var sconfig = this.sconfig = Tools.mergeHashes( this.config.sync || {}, this.args || {} );
		if (!sconfig.up && !sconfig.down) {
			this.die("Please enable sync up and/or down modes.  Type 'xy help sync' for details.");
		}
		
		// massage up, down, and delete sync lists
		if ((sconfig.up === true) || (sconfig.up === "all")) sconfig.up = [ ...supported_lists ];
		if (sconfig.up && (typeof(sconfig.up) == 'string')) sconfig.up = sconfig.up.split(/\,/);
		if (sconfig.up && !Array.isArray(sconfig.up)) this.die("Invalid sync.up property (must be CSV string, array or true)");
		if (sconfig.up && !Tools.includesAll(supported_lists, sconfig.up)) this.die("Invalid sync.up list: " + sconfig.up.join(', '));
		if (sconfig.up && !sconfig.up.length) sconfig.up = false;
		
		if ((sconfig.down === true) || (sconfig.down === "all")) sconfig.down = [ ...supported_lists ];
		if (sconfig.down && (typeof(sconfig.down) == 'string')) sconfig.down = sconfig.down.split(/\,/);
		if (sconfig.down && !Array.isArray(sconfig.down)) this.die("Invalid sync.down property (must be CSV string, array or true)");
		if (sconfig.down && !Tools.includesAll(supported_lists, sconfig.down)) this.die("Invalid sync.down list: " + sconfig.down.join(', '));
		if (sconfig.down && !sconfig.down.length) sconfig.down = false;
		
		if ((sconfig.delete === true) || (sconfig.delete === "all")) sconfig.delete = [ ...supported_lists ];
		if (sconfig.delete && (typeof(sconfig.delete) == 'string')) sconfig.delete = sconfig.delete.split(/\,/);
		if (sconfig.delete && !Array.isArray(sconfig.delete)) this.die("Invalid sync.delete property (must be CSV string, array or true)");
		if (sconfig.delete && !Tools.includesAll(supported_lists, sconfig.delete)) this.die("Invalid sync.delete list: " + sconfig.delete.join(', '));
		if (sconfig.delete && !sconfig.delete.length) sconfig.delete = false;
		
		// Deletion requires up-only sync, including directions inherited from config.
		// Validate before scanning or applying any changes, even for a dry run.
		if (sconfig.delete && (!sconfig.up || sconfig.down)) {
			this.die("Delete mode requires up-only sync. Enable --up and disable --down.");
		}
		
		this.warnings = [];
		this.errors = [];
		
		// scan all base directories, default to cwd
		var files = [];
		if (!this.args.other || !this.args.other.length) {
			this.args.other = sconfig.base_dirs || ['.'];
		}
		
		println( "\n " + green.bold("Scanning base directories...") );
		
		this.args.other.forEach( dir => {
			dir = Path.normalize(dir).replace(/[\\/]+$/, '');
			if (!fs.existsSync(dir)) {
				this.logSyncError("Sync base dir does not exist: " + dir);
				return;
			}
			println( " " + cli.emoji('🔎') + " Scanning directory: " + dir + "/" );
			files = files.concat( Tools.findFilesSync(dir, { stats: true }) );
		} );
		
		// exit now if any dir errors occurred
		if (this.errors.length) return await this.completeSync();
		
		println( " " + Tools.commify(files.length) + " files found." );
		
		// load all xypdf files
		var items = [];
		
		files.filter( file => !!file.path.match(/\.json$/i) ).forEach( file => {
			// file: { path, size, mtime }
			var dir = Path.dirname(file.path);
			var filename = Path.basename(file.path);
			var stem = filename.replace(/\.\w+$/, '');
			
			// try to parse JSON
			var xypdf = null;
			try { 
				xypdf = Tools.parseJSON( fs.readFileSync(file.path, 'utf8') ); 
			}
			catch (err) {
				this.logSyncWarning("Failed to parse JSON file: " + file.path + ": " + err);
				return;
			}
			
			// make sure we have a real xypdf file here
			// skip silently if file is clearly not xypdf
			if (!xypdf || !Tools.isaHash(xypdf) || !xypdf.type || (xypdf.type !== 'xypdf')) return;
			
			if (!xypdf.version || (xypdf.version !== '1.0')) {
				this.logSyncWarning("File is not a compatible version of XYPDF: " + file.path);
				return;
			}
			if (!xypdf.items || !Array.isArray(xypdf.items) || !xypdf.items.length) {
				this.logSyncWarning("XYPDF file has an empty, malformed or missing items array: " + file.path);
				return;
			}
			
			// xyops minimum version
			if (xypdf.xyops !== undefined && this.compareVersions(xypdf.xyops, this.xyopsVersion) > 0) {
				this.logSyncWarning("Item requires xyOps v" + xypdf.xyops + " or higher: " + file.path);
				return;
			}
			
			// file must have exactly one item
			if (xypdf.items.length > 1) {
				this.logSyncWarning("File with multiple items cannot be a sync source: " + file.path);
				return;
			}
			
			var item = xypdf.items.shift();
			
			// basic validation
			if (!item || !Tools.isaHash(item) || !item.type || (typeof(item.type) != 'string')) {
				this.logSyncWarning("Malformed item type in file: " + file.path);
				return;
			}
			if (item.type.match(/^(bucket|secret|user|role)$/)) {
				this.logSyncWarning("Unsupported item type: " + item.type + " in file: " + file.path);
				return;
			}
			if (!item.data || !Tools.isaHash(item.data)) {
				this.logSyncWarning("Malformed item data in file: " + file.path);
				return;
			}
			if (!item.data.id || (typeof(item.data.id) != 'string')) {
				this.logSyncWarning("Malformed or missing item ID in file: " + file.path);
				return;
			}
			
			var type_def = this.config.ui.data_types[item.type];
			if (!type_def) {
				this.logSyncWarning("Cannot locate internal type definition: " + item.type);
				return;
			}
			
			var list = this[ type_def.list ];
			if (!list) {
				this.logSyncWarning("Cannot locate internal list: " + type_def.list);
				return;
			}
			
			var xy_item = Tools.findObject(list, { id: item.data.id });
			if (!xy_item) {
				this.logSyncWarning("Cannot find " + item.type + " in xyOps: " + item.data.title + " (" + item.data.id + "), will be skipped from sync.");
				return;
			}
			
			if (Tools.findObjectDeep(items, { 'type': item.type, 'data.id': item.data.id })) {
				this.logSyncWarning("Duplicate source item found: " + file.path + " (skipping)");
				return;
			}
			
			// locate any external neighbor prop files
			var neighbor_error = false;
			
			files.forEach( neighbor => {
				if (Path.dirname(neighbor.path) != dir) return; // must be in same dir
				
				var nfilename = Path.basename(neighbor.path);
				var nstem = nfilename.replace(/\.\w+$/, '');
				if (nstem.length <= stem.length) return; // neighbor stem too short
				if (!nstem.startsWith(stem)) return; // no shared stem
				
				var suffix = nstem.substring(stem.length);
				if (!suffix.match(/\-([\w\.\-]+)$/)) return; // not correct format
				var prop_path = RegExp.$1;
				
				try { 
					var result = Tools.setPath(item.data, prop_path, fs.readFileSync(neighbor.path, 'utf8'));
					if (!result) throw "Property not found: " + prop_path;
				}
				catch (err) {
					this.logSyncError("Failed to load neighbor property file: " + neighbor.path + ": " + err);
					neighbor_error = true;
					return;
				}
				
				// compute effective mtime of item including all included neighbors
				if (neighbor.mtime > file.mtime) file.mtime = neighbor.mtime;
				
				// include neighbor metadata for downsync
				if (!item.neighbors) item.neighbors = {};
				item.neighbors[ prop_path ] = neighbor.path;
			} ); // foreach neighbor
			
			// do not include item if neighbor file loading failed
			if (neighbor_error) return;
			
			// include effective mtime in item for two-way sync
			item.mtime = file.mtime;
			
			// include list name for convenience below
			item.list = type_def.list;
			
			// include file for downsync
			item.file = file.path;
			
			// add to sync list
			items.push(item);
		} ); // foreach json file
		
		// exit before sync starts if any warnings or errors occurred
		if (this.errors.length || this.warnings.length) return await this.completeSync();
		
		println( "\n " + this.color('theme').bold("Starting sync...") );
		
		// build state object of all sync flags (for sync up only)
		// the xyops UI uses these flags to display edit warnings
		var state = {};
		
		// iterate over all items
		for (const item of items) {
			var list = this[ item.list ];
			var xy_item = Tools.findObject( list, { id: item.data.id } );
			
			var up_enabled = sconfig.up && sconfig.up.includes(item.list);
			var down_enabled = sconfig.down && sconfig.down.includes(item.list);
			if (!up_enabled && !down_enabled) continue; // no sync direction enabled for this item
			
			// add item id to state for sync up solo mode
			if (up_enabled && !down_enabled) state[ item.type + '-' + item.data.id ] = true;
			
			var changes = this.diffSyncItems(xy_item, item.data);
			if (!changes.some( change => change.added || change.removed )) continue; // identical
			
			// render diff
			var diff = "```diff\n";
			changes.forEach( change => {
				var prefix = change.added ? '+' : change.removed ? '-' : ' ';
				var lines = change.value.replace(/\n$/, '').split(/\n/);
				
				if (!change.added && !change.removed && (lines.length > 2) && !this.verbose) {
					// reduce context lines to 1 above and 1 below, unless in verbose mode
					var top = lines.shift();
					var bottom = lines.pop();
					lines = [ top, "...", bottom ];
				}
				
				lines.forEach( line => {
					diff += prefix + line.trimEnd() + "\n";
				} );
			} );
			diff += "```\n";
			
			// figure out which direction to go
			var direction = false;
			var icon = '';
			
			if (up_enabled && down_enabled) {
				// both directions enabled: use mod date to see which wins
				if (xy_item.modified > item.mtime) { icon = '⬇️'; direction = 'down'; }
				else { icon = '⬆️'; direction = 'up'; }
			}
			else if (up_enabled) {
				// up only
				icon = '⬆️';
				direction = 'up';
			}
			else if (down_enabled) {
				// down only
				icon = '⬇️';
				direction = 'down';
			}
			
			println( "\n " + cli.emoji(icon) + ' ' + green.bold("Updating " + item.type) + ": " + cyan.bold(item.data.title) + gray(" (" + item.data.id + ")") );
			println( "\n" + this.markdown(diff) );
			
			if (direction == 'up') {
				// sync change up to xyops
				try {
					await this.callStandardAPI('update_' + item.type, item.data, { text: "Updating " + item.type + "...", throw: true });
					
					// add flag to run optional command at completion
					this.upSynced = true;
				}
				catch (err) {
					this.logSyncError('' + err);
				}
			}
			else if (direction == 'down') {
				// sync change down to filesystem
				try {
					this.downSyncItem(xy_item, item);
					
					// add flag to run optional command at completion
					this.downSynced = true;
				}
				catch (err) {
					this.logSyncError('' + err);
				}
			}
		} // foreach item
		
		// update state db
		await this.syncState(state);
		
		// now handle deletes
		if (!sconfig.delete) return await this.completeSync();
		
		// (deletes always happen upward, i.e. in xyops)
		var list_data_types = [];
		for (var id in this.config.ui.data_types) {
			var type_def = this.config.ui.data_types[id];
			list_data_types.push({ ...type_def, id: id });
		}
		
		for (const list_name of sconfig.delete) {
			var list = this[list_name];
			if (!list) continue; // sanity
			
			for (const xy_item of list) {
				// Stock and Marketplace objects are never deletion candidates. Check the
				// remote object's markers so missing local exports cannot remove them.
				if (Object.hasOwn(xy_item, 'stock') || Object.hasOwn(xy_item, 'marketplace')) continue;
				
				var type_def = Tools.findObject( list_data_types, { list: list_name } );
				var item = Tools.findObjectDeep( items, { type: type_def.id, 'data.id': xy_item.id } );
				if (item) continue; // still exists
				
				println( "\n " + cli.emoji('🗑️') + ' ' + red.bold("Deleting " + type_def.id) + ": " + red.bold(xy_item.title) + gray(" (" + xy_item.id + ")") );
				
				try {
					await this.callStandardAPI('delete_' + type_def.id, { id: xy_item.id }, { text: "Deleting " + type_def.id + "...", throw: true });
					
					// add flag to run optional command at completion
					this.upSynced = true;
				}
				catch (err) {
					this.logSyncError('' + err);
				}
			}; // foreach item
		}; // foreach delete
		
		await this.completeSync();
	},
	
	getSyncLockFile() {
		// Allow a fixed path for service installations.  Otherwise, serialize all
		// local syncs targeting the exact same configured xyOps base URL.
		var sconfig = Tools.mergeHashes( this.config.sync || {}, this.args || {} );
		if (sconfig.lock_file) return Path.resolve('' + sconfig.lock_file);
		
		var digest = Tools.digestHex( this.config.base_url, 'sha256', 16);
		return Path.join( os.tmpdir(), 'xyops-cli-sync-' + digest + '.pid' );
	},
	
	acquireSyncLock() {
		// Atomically create a PID lock.  If a prior process was killed without
		// cleanup, replace its stale lock and retry acquisition.
		var lock_file = this.getSyncLockFile();
		var token = Tools.generateUniqueID(32);
		var payload = {
			pid: process.pid,
			started: (new Date()).toISOString(),
			base_url: this.config.base_url || '',
			token: token
		};
		
		for (var attempt = 0; attempt < 3; attempt++) {
			var fd = null;
			try {
				// The file contains no credentials.  Keep it readable so another local
				// account can inspect the PID when a shared lock path is configured.
				fd = fs.openSync(lock_file, 'wx', 0o644);
				fs.writeFileSync(fd, JSON.stringify(payload, null, "\t") + "\n");
				fs.closeSync(fd);
				fd = null;
				
				this.syncLock = { file: lock_file, token: token };
				this.syncLockExitHandler = () => { this.releaseSyncLock(); };
				process.once('exit', this.syncLockExitHandler);
				return;
			}
			catch (err) {
				if (fd !== null) {
					try { fs.closeSync(fd); } catch (close_err) {;}
					try { fs.unlinkSync(lock_file); } catch (unlink_err) {;}
				}
				if (err.code !== 'EEXIST') {
					this.die("Failed to create sync lock file: " + lock_file + ": " + err.message);
				}
			}
			
			var raw = '';
			try {
				raw = fs.readFileSync(lock_file, 'utf8').trim();
			}
			catch (err) {
				// The owner may have finished between our open and read attempts.
				if (err.code === 'ENOENT') continue;
				this.die("Failed to read existing sync lock file: " + lock_file + ": " + err.message);
			}
			
			var old_lock = null;
			try { old_lock = raw.match(/^\d+$/) ? { pid: parseInt(raw) } : JSON.parse(raw); }
			catch (err) { this.die("Invalid sync lock file: " + lock_file + ". Verify no sync is running before removing it."); }
			
			var old_pid = old_lock && Number(old_lock.pid);
			if (!Number.isInteger(old_pid) || (old_pid < 1)) {
				this.die("Invalid sync lock PID in: " + lock_file + ". Verify no sync is running before removing it.");
			}
			var alive = false;
			try {
				process.kill(old_pid, 0);
				alive = true;
			}
			catch (err) {
				// EPERM means the process exists but belongs to another account.
				if (err.code === 'EPERM') alive = true;
				else if (err.code !== 'ESRCH') this.die("Failed to inspect sync lock PID " + old_pid + ": " + err.message);
			}
			
			if (alive) {
				this.die("Another sync process is already running (PID " + old_pid + "). Lock file: " + lock_file);
			}
			
			// Serialize stale-file recovery too.  Without this second atomic claim,
			// two starters could both inspect the old PID and one could unlink the
			// fresh lock created by the other.
			var recovery_file = lock_file + '.recover';
			var recovery_fd = null;
			try {
				recovery_fd = fs.openSync(recovery_file, 'wx', 0o644);
				fs.writeFileSync(recovery_fd, '' + process.pid + "\n");
			}
			catch (err) {
				if (recovery_fd !== null) {
					try { fs.closeSync(recovery_fd); } catch (close_err) {;}
					try { fs.unlinkSync(recovery_file); } catch (unlink_err) {;}
				}
				if (err.code === 'EEXIST') {
					this.die("Another process is recovering a stale sync lock. Please retry. Lock file: " + lock_file);
				}
				this.die("Failed to claim stale sync lock file: " + lock_file + ": " + err.message);
			}
			
			var recovery_error = null;
			var retry = false;
			try {
				// Re-read after winning recovery.  If another process already replaced
				// the file, leave its new lock untouched and retry normally.
				var current_raw = fs.readFileSync(lock_file, 'utf8').trim();
				if (current_raw !== raw) retry = true;
				else fs.unlinkSync(lock_file);
			}
			catch (err) {
				if (err.code === 'ENOENT') retry = true;
				else recovery_error = err;
			}
			finally {
				if (recovery_fd !== null) try { fs.closeSync(recovery_fd); } catch (close_err) {;}
				try { fs.unlinkSync(recovery_file); } catch (unlink_err) {;}
			}
			if (recovery_error) {
				this.die("Failed to remove stale sync lock file: " + lock_file + ": " + recovery_error.message);
			}
			if (retry) continue;
		} // attempt
		
		this.die("Failed to acquire sync lock file after multiple attempts: " + lock_file);
	},
	
	releaseSyncLock() {
		// Only the process that created the current lock may remove it.  This
		// prevents late cleanup from deleting a newer process's replacement lock.
		if (!this.syncLock) return;
		var lock = this.syncLock;
		this.syncLock = null;
		
		if (this.syncLockExitHandler) {
			process.removeListener('exit', this.syncLockExitHandler);
			this.syncLockExitHandler = null;
		}
		
		try {
			var current = JSON.parse(fs.readFileSync(lock.file, 'utf8'));
			if (current.token === lock.token) fs.unlinkSync(lock.file);
		}
		catch (err) {
			if (err.code !== 'ENOENT') warnln("Failed to remove sync lock file: " + lock.file + ": " + err.message);
		}
	},
	
	async syncState(new_state) {
		// sync state only if it differs
		var old_state = this.state.sync || {};
		
		if (Tools.stableStringify(new_state) !== Tools.stableStringify(old_state)) {
			try {
				await this.callStandardAPI( 'update_global_state', { sync: new_state }, { text: "Updating state...", throw: true } );
			}
			catch (err) {
				this.logSyncError('' + err);
			}
		}
	},
	
	async completeSync() {
		// send email if we have warnings or errors
		var sconfig = this.sconfig;
		
		println( "\n " + this.color('theme').bold("Sync complete.") );
		
		if (this.dry) return;
		
		// optional shell commands if we synced anything
		if (this.upSynced && sconfig.up_cmd) {
			this.syncFinishCmd(sconfig.up_cmd);
		}
		if (this.downSynced && sconfig.down_cmd) {
			this.syncFinishCmd(sconfig.down_cmd);
		}
		
		if (!this.warnings.length && !this.errors.length) return;
		
		if (sconfig.error_email) {
			// send email on warning / error
			var md = '';
			md += "The sync operation generated the following output:\n";
			
			if (this.errors.length) {
				md += "\n### Errors\n\n";
				this.errors.forEach( error => { md += "- " + error + "\n"; } );
			}
			if (this.warnings.length) {
				md += "\n### Warnings\n\n";
				this.warnings.forEach( warning => { md += "- " + warning + "\n"; } );
			}
			
			md += "\n### Other Information\n\n";
			md += "- **Date/Time:** " + (new Date()).toString() + "\n";
			md += "- **Sync Server:** " + os.hostname() + "\n";
			md += "- **Sync Platform:** " + process.platform + "\n";
			md += "- **Node.js Version:** " + process.version + "\n";
			md += "- **xyCLI Version:** " + this.version + "\n";
			if (process.platform != 'win32') md += "- **Sync User/Group:** " + process.getuid() + "/" + process.getgid() + "\n";
			// md += "- **Sync Command:** `" + process.argv.join(' ') + "`\n";
			
			md += "\n### Sync Command\n";
			md += "\n```\n" + process.argv.join(' ') + "\n```\n";
			
			md += "\n### Sync Configuration\n";
			md += "\n```\n" + JSON.stringify(sconfig, null, "\t") + "\n```\n";
			
			var req = {
				to: sconfig.error_email,
				subject: 'xyOps CLI Sync Results',
				title: 'Sync Results',
				body: md
			};
			
			await this.callStandardAPI('sendEmail', req, { text: "Sending email..." });
		} // email
		
		if (sconfig.error_event) {
			// run event on warning / error
			var req = {
				id: sconfig.error_event,
				input: { 
					data: {
						errors: this.errors,
						warnings: this.warnings
					} 
				}
			};
			
			await this.callStandardAPI('runEvent', req, { text: "Running event..." });
		} // run_event
	},
	
	syncFinishCmd(cmd) {
		// spawn command and log output
		var sconfig = this.sconfig;
		var cwd = this.args.other[0]; // use first base dir as cwd for shell commands
		
		println( "\n " + green.bold("Running completion command: ") + cyan.bold(cmd) );
		
		try {
			const output = cp.execSync(cmd, {
				cwd: cwd,
				timeout: (sconfig.cmd_timeout || 30) * 1000,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
			
			if (output.match(/\S/)) {
				println( "\n" + this.markdown("```\n" + output.trim() + "\n```\n") );
			}
		}
		catch (err) {
			this.logSyncError('Command failed: ' + cmd + ": " + err.message);
			if (err.stdout) console.error('STDOUT:', err.stdout);
			if (err.stderr) console.error('STDERR:', err.stderr);
		}
	},
	
	downSyncItem(xy_item, item) {
		// write changed item back to disk
		var data = Tools.copyHash(xy_item, true);
		
		// process and write out neighbor files
		if (item.neighbors) {
			for (var path in item.neighbors) {
				var file = item.neighbors[path];
				var value = Tools.getPath( data, path ) ?? "";
				
				if (!Tools.setPath( data, path, "(External)" )) {
					throw "External neighbor file path not found: " + file + ": " + path;
				}
				
				if (!this.dry) {
					try { Tools.writeFileAtomicSync(file, value); }
					catch (err) { 
						throw "Failed to write local file: " + file + ": " + err;
					}
				}
			}
		} // neighbors
		
		var xypdf = this.getItemExportData(item.type, data);
		
		if (this.dry || this.verbose) {
			println( "\n " + this.color('theme').bold("WRITING FILE:") );
			this.jsonOutput(xypdf);
		}
		
		if (!this.dry) {
			try { Tools.writeFileAtomicSync( item.file, JSON.stringify(xypdf, null, "\t") + "\n" ); }
			catch (err) {
				throw "Failed to write local file: " + item.file + ": " + err; 
			}
		}
	},
	
	diffSyncItems(a, b) {
		// diff items sans metadata
		var remove_keys = { created: 1, modified: 1, revision: 1, sort_order: 1, username: 1 };
		
		return Diff.diffLines(
			Tools.stablePrettyStringify( Tools.copyHashRemoveKeys(a, remove_keys) ),
			Tools.stablePrettyStringify( Tools.copyHashRemoveKeys(b, remove_keys) )
		);
	},
	
	logSyncWarning(msg) {
		this.warnings.push(msg);
		
		// Scan warnings prevent sync from applying changes, so report failure.
		// Let notifications finish before exiting, including in quiet or dry mode.
		process.exitCode = 1;
		
		warnln( "\n " + cli.emoji('⚠️') + " " + yellow.bold("WARNING: ") + " " + msg );
	},
	
	logSyncError(msg) {
		this.errors.push(msg);
		
		// Report failure to scripts without interrupting completion or notifications.
		// This also covers dry-run errors and failures in completion commands.
		process.exitCode = 1;
		
		warnln( "\n " + cli.emoji('🛑') + " " + red.bold("ERROR: ") + " " + msg );
	},
	
	async setupSync() {
		// export select resources to local XYPDF files in suggested layout
		// xy sync --setup all --file_props "script,params.script"
		// xy sync --setup all --marketplace --stock --force
		var data_types = this.config.ui.data_types;
		var list_data_types = Object.keys(data_types).map( key => {
			return { ...data_types[key], id: key };
		} );
		
		if ((this.args.setup === 'all') || (this.args.setup[0] === 'all')) {
			this.args.setup = this.config.ui.list_list.map( list => list.id ).filter( id => !id.match(/^(buckets|secrets|users|roles)$/) );
		}
		
		if (typeof(this.args.setup) == 'string') this.args.setup = this.args.setup.split(/\,/);
		if (!Array.isArray(this.args.setup)) this.dieUsage('sync setup');
		
		if (Tools.includesAny(this.args.setup, ['buckets', 'secrets', 'users', 'roles'])) {
			this.die("Sorry, the sync engine cannot process buckets, secrets, users, or roles.");
		}
		
		if (!Tools.includesAll(this.config.ui.list_list.map( list => list.id ), this.args.setup)) {
			this.die("One or more specified item types are unknown: " + this.args.setup.join(', ') );
		}
		
		if (!this.args.setup.length) this.die("No item types specified to set up.");
		
		if (this.args.file_props) {
			if (typeof(this.args.file_props) == 'string') this.args.file_props = this.args.file_props.split(/\,/);
			if (!Array.isArray(this.args.file_props)) this.dieUsage('sync setup');
		}
		
		this.printBoxList({
			title: 'Sync Setup',
			rows: [
				['Item Types', this.args.setup.join(', ')],
				['File Props', this.args.file_props ? this.args.file_props.join(', ') : '(None)'],
				this.dry ? ['Dry Run', 'No changes will be made.'] : null
			]
		});
		
		println( "\n " + this.color('theme').bold("WRITING FILES:") );
		
		// split up workflows into their own folder
		if (this.args.setup.includes('events')) {
			this.workflows = this.events.filter( event => event.type == 'workflow' );
			this.events = this.events.filter( event => event.type != 'workflow' );
			this.args.setup.push('workflows');
			list_data_types.push( { id: "event", "list": "workflows" } );
		}
		
		this.args.setup.forEach( (list_name) => {
			var list = this[list_name];
			if (!list || !list.length) return;
			
			var type_def = Tools.findObject( list_data_types, { list: list_name } );
			if (!type_def) return; // sanity
			
			if (!this.dry) Tools.mkdirp.sync( list_name );
			println( "\n " + cli.emoji('📂') + " " + bold.cyan(list_name + '/') );
			
			list.forEach( (item) => {
				// exclude marketplace and stock items
				if (item.marketplace && !this.args.marketplace) return;
				if (item.stock && !this.args.stock) return;
				
				// extract extras first
				var extras = [];
				(this.args.file_props || []).forEach( (path) => {
					var extra = Tools.getPath(item, path);
					if ((typeof(extra) == 'string') && extra.match(/\S/)) {
						extras.push({ path, content: extra });
						
						// we do not need to check the return value of setPath here,
						// because this path is guaranteed to exist at this point
						Tools.setPath( item, path, "(External)" );
					}
				} );
				
				var data = this.getItemExportData(type_def.id, item);
				var title = item.title.replace(/\W+/g, '-').replace(/\-+$/, '').replace(/^\-+/, '');
				var filename = title + '.json';
				var file = Path.join(list_name, filename);
				
				if (!this.dry) {
					if (!this.args.force && fs.existsSync(file)) this.die("File exists, add '--force' to overwrite all: " + file);
					Tools.writeFileAtomicSync( file, JSON.stringify(data, null, "\t") + "\n" );
				}
				println( "    " + cli.emoji('📄') + " " + bold.green(filename) );
				
				// now handle extras
				extras.forEach( (extra) => {
					var command = item.command;
					if (!command && extra.content.match(/^\s*\#\!(.+?)\n/)) command = RegExp.$1;
					
					var ext = 'txt';
					if (command) ext = this.getExtFromBinary(command);
					else if (extra.content.trim().match(/^\{[\S\s]*\}$/) || extra.content.trim().match(/^\[[\S\s]*\]$/)) ext = 'json';
					
					var extra_filename = title + '-' + extra.path + '.' + ext;
					var extra_file = Path.join(list_name, extra_filename);
					
					if (!this.dry) {
						if (!this.args.force && fs.existsSync(extra_file)) this.die("File exists, add '--force' to overwrite all: " + extra_file);
						Tools.writeFileAtomicSync( extra_file, extra.content );
					}
					
					println( "    " + cli.emoji('📜') + " " + bold.yellow(extra_filename) );
				} );
			} ); // foreach item
		} ); // foreach list
		
		println( "\n " + this.color('theme').bold("Setup complete!") );
	},
	
	getItemExportData(type, item) {
		// generate XYPDF for serialization to JSON for export
		var trimmed_item = { ...item };
		
		delete trimmed_item.created;
		delete trimmed_item.modified;
		delete trimmed_item.revision;
		delete trimmed_item.sort_order;
		delete trimmed_item.username;
		
		var data = {
			type: 'xypdf',
			description: "xyOps Portable Data Object",
			version: "1.0",
			xyops: this.xyopsVersion,
			items: [{
				type: type,
				data: trimmed_item
			}]
		};
		
		return data;
	},
	
	getExtFromBinary(bin) {
		// sniff file ext from binary path, e.g. `/bin/sh`
		if ((typeof(bin) != 'string') || !bin.trim()) return 'txt';
		
		// normalize Windows paths, optional arguments and common shebang-style
		// env wrappers before matching the interpreter name
		var cmdline = bin.trim().replace(/\\/g, '/');
		var cmd = cmdline;
		if (cmd.match(/^(?:.*\/)?env(?:\.exe)?\s+(?:\-S\s+)?(\S+)/i)) cmd = RegExp.$1;
		else if (cmd.match(/^"([^"]+)"/)) cmd = RegExp.$1;
		else if (cmd.match(/^'([^']+)'/)) cmd = RegExp.$1;
		else cmd = cmd.replace(/\s+.+$/, '');
		cmd = Path.basename(cmd);
		
		// allow Windows executables and versioned names such as python3.12
		cmd = cmd.replace(/\.exe$/i, '').replace(/\d+(?:\.\d+)*$/, '').toLowerCase();
		var ext = 'txt';
		
		switch (cmd) {
			case 'sh':
			case 'csh':
			case 'ksh':
			case 'tcsh':
			case 'fish':
			case 'zsh':
			case 'bash':
				ext = 'sh';
			break;
			
			case 'node':
			case 'nodejs':
			case 'deno':
			case 'bun':
				ext = 'js';
			break;
			
			case 'ts-node':
			case 'ts-node-esm':
			case 'tsx':
				ext = 'ts';
			break;
			
			case 'pwsh':
			case 'powershell':
				ext = 'ps1';
			break;
			
			case 'cmd':
				ext = 'bat';
			break;
			
			case 'py':
			case 'python':
			case 'pythonw':
			case 'pypy':
				ext = 'py';
			break;
			
			case 'perl':
				ext = 'pl';
			break;
			
			case 'ruby':
				ext = 'rb';
			break;
			
			case 'php':
				ext = 'php';
			break;
			
			case 'lua':
			case 'luajit':
				ext = 'lua';
			break;
			
			case 'r':
			case 'rscript':
				ext = 'R';
			break;
			
			case 'tclsh':
			case 'wish':
				ext = 'tcl';
			break;
			
			case 'julia':
				ext = 'jl';
			break;
			
			case 'groovy':
				ext = 'groovy';
			break;
			
			case 'elixir':
				ext = 'exs';
			break;
		}
		
		return ext;
	}
		
};
