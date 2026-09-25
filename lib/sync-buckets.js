// Filesystem sync for storage bucket data and binary files.
// Bucket definitions themselves remain in the ordinary XYPDF sync engine.

const fs = require('fs');
const Path = require('path');
const Crypto = require('crypto');
const Diff = require('diff');
const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	requireBucketSyncVersion() {
		// The replace flag and separate data modification time arrived in 1.1.2.
		// Keep the older minimum version for every other sync resource.
		if (!this.xyopsVersion || this.compareVersions(this.xyopsVersion, '1.1.2') < 0) {
			this.die("Bucket sync requires xyOps v1.1.2 or later (server: " + (this.xyopsVersion || 'unknown') + ").");
		}
	},
	
	getSyncBucketPaths(item) {
		// The local XYPDF source owns its sibling content directory. The bucket ID
		// identifies the remote object, so title edits never move existing files.
		var dir = item.file.replace(/\.json$/i, '');
		return { dir, data: Path.join(dir, 'data.json'), files: Path.join(dir, 'files') };
	},
	
	cleanSyncBucketFilename(filename) {
		// Match xyOps cleanFilename(), which is used for manifest identity. The
		// server's cleanURLFilename() is only for the storage URL component.
		return filename.replace(/[^\w\-\+\.\,\s\(\)\[\]\{\}\'\"\!\&\^\%\$\#\@\*\?\~]+/g, '_');
	},
	
	validateSyncBucketFilename(filename) {
		// A server manifest must never be allowed to escape the bucket files dir.
		if (!filename || (typeof(filename) != 'string') || (filename == '.') || (filename == '..') ||
			filename.includes('/') || filename.includes('\\') || filename.includes('\0') || (Path.basename(filename) != filename)) {
			throw new Error("Unsafe bucket filename: " + filename);
		}
	},
	
	async getSyncBucket(id) {
		// Read both independently stored content records and their timestamps.
		var { err, data } = await this.api.getBucket({ id });
		if (err) throw err;
		if (!data || !Tools.isaHash(data.data) || !Array.isArray(data.files) ||
			!data.meta || (typeof(data.meta.mod) != 'number') || !Number.isFinite(data.meta.mod)) {
			throw new Error("Incomplete bucket data or file manifest: " + id);
		}
		
		var names = new Set();
		data.files.forEach( file => {
			this.validateSyncBucketFilename(file.filename);
			if ((typeof(file.date) != 'number') || !Number.isFinite(file.date) ||
				(typeof(file.size) != 'number') || !Number.isSafeInteger(file.size) || (file.size < 0) ||
				(typeof(file.path) != 'string') || !file.path.startsWith('files/bucket/' + id + '/') ||
				Path.posix.normalize(file.path) != file.path) {
				throw new Error("Invalid file manifest entry in bucket: " + id);
			}
			if (names.has(file.filename)) throw new Error("Duplicate bucket filename in manifest: " + file.filename);
			names.add(file.filename);
		});
		return data;
	},
	
	readSyncBucketLocal(item) {
		// A missing data file or files directory is an incomplete inventory. This
		// is an error even when the remote bucket currently happens to be empty.
		var paths = this.getSyncBucketPaths(item);
		var stat = fs.lstatSync(paths.data);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid bucket data file: " + paths.data);
		var data = JSON.parse(fs.readFileSync(paths.data, 'utf8'));
		if (!Tools.isaHash(data)) throw new Error("Bucket data must be a JSON object: " + paths.data);
		
		var dir_stat = fs.lstatSync(paths.files);
		if (!dir_stat.isDirectory() || dir_stat.isSymbolicLink()) throw new Error("Invalid bucket files directory: " + paths.files);
		
		var files = new Map();
		fs.readdirSync(paths.files, { withFileTypes: true }).forEach( entry => {
			var path = Path.join(paths.files, entry.name);
			if (!entry.isFile()) throw new Error("Bucket files directory must contain only regular files: " + path);
			var name = this.cleanSyncBucketFilename(entry.name);
			this.validateSyncBucketFilename(name);
			if (files.has(name)) throw new Error("Bucket filenames collide after normalization: " + path);
			files.set(name, { path, stat: fs.statSync(path) });
		});
		return { paths, data, data_stat: stat, files };
	},
	
	stampSyncBucketFile(path, epoch) {
		// Keep the access time intact. Server times are Unix seconds; Node accepts
		// the same unit for utimes(), including fractional seconds if provided.
		var stat = fs.statSync(path);
		fs.utimesSync(path, stat.atime, Number(epoch));
	},
	
	printSyncBucketHeading(icon, label, title, id, deleting) {
		// Match the standard sync heading: direction, action, display title and
		// a quiet internal ID. Give destructive operations the existing red style.
		var action = deleting ? cli.chalk.red.bold : cli.chalk.green.bold;
		var name = deleting ? cli.chalk.red.bold : cli.chalk.cyan.bold;
		println( "\n " + cli.emoji(icon) + " " + action(label) + ": " + name(title) + cli.chalk.gray(" (" + id + ")") );
	},
	
	async downloadSyncBucketFile(id, file, destination) {
		// Download to a private sibling first. A failed or partial response must
		// never replace the previous local copy of a bucket file.
		var temp = destination + '.xy-sync-' + Crypto.randomBytes(8).toString('hex') + '.tmp';
		try {
			var { err } = await this.api.file({
				path: file.path.replace(/^files\//, ''),
				download: file.filename
			}, { download: temp });
			if (err) throw err;
			var stat = fs.statSync(temp);
			if (stat.size !== Number(file.size)) throw new Error("Downloaded bucket file size differs from manifest: " + file.filename);
			this.stampSyncBucketFile(temp, file.date);
			fs.renameSync(temp, destination);
		}
		finally {
			if (fs.existsSync(temp)) fs.unlinkSync(temp);
		}
	},
	
	async setupBucketContents(plans, opts) {
		// Fetch every selected bucket before writing any bucket extras. Honor the
		// ordinary setup --force, --new and --dry rules for all content files.
		var prepared = [];
		var paths_seen = new Set();
		for (const item of plans) {
			var paths = this.getSyncBucketPaths(item);
			if (paths_seen.has(paths.dir)) this.die("Bucket setup paths collide: " + paths.dir);
			paths_seen.add(paths.dir);
			for (const dir of [ paths.dir, paths.files ]) {
				if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) {
					this.die("Invalid bucket setup directory: " + dir);
				}
			}
			var snapshot = await this.getSyncBucket(item.id);
			var files = snapshot.files.map( file => ({ file, path: Path.join(paths.files, file.filename) }) );
			if (!opts.force && !opts.dry) {
				if (fs.existsSync(paths.data)) this.die("File exists, add '--force' to overwrite all: " + paths.data);
				files.forEach( entry => {
					if (fs.existsSync(entry.path)) this.die("File exists, add '--force' to overwrite all: " + entry.path);
				});
			}
			prepared.push({ item, paths, snapshot, files });
		}
		
		for (const entry of prepared) {
			// Mirror the setup tree above: a colored folder heading, then short
			// names for the data file and nested uploaded-file directory.
			println( "\n " + cli.emoji('🪣') + " " + cli.chalk.bold.cyan(Path.basename(entry.paths.dir) + '/') );
			println( "    " + cli.emoji('📄') + " " + cli.chalk.bold.green('data.json') );
			println( "    " + cli.emoji('📂') + " " + cli.chalk.bold.cyan('files/') );
			entry.files.forEach( file => {
				println( "        " + cli.emoji('📎') + " " + cli.chalk.bold.yellow(file.file.filename) );
			});
			if (opts.dry) continue;
			Tools.mkdirp.sync(entry.paths.files);
			Tools.writeFileAtomicSync(entry.paths.data, JSON.stringify(entry.snapshot.data, null, '\t') + '\n');
			this.stampSyncBucketFile(entry.paths.data, entry.snapshot.meta.mod);
			for (const file of entry.files) {
				await this.downloadSyncBucketFile(entry.item.id, file.file, file.path);
			}
		}
	},
	
	async syncBucketContents(items, sconfig) {
		if (!items.length || this.errors.length || this.warnings.length) return;
		var prepared = [];
		
		// Preflight every selected local inventory and every remote manifest before
		// applying changes. A missing data.json or unreadable files dir must never
		// turn into a remote deletion candidate.
		try {
			for (const item of items) {
				prepared.push({ item, local: this.readSyncBucketLocal(item), remote: await this.getSyncBucket(item.data.id) });
			}
		}
		catch (err) {
			this.logSyncError("Bucket sync preflight failed: " + err);
			return;
		}
		
		var up = sconfig.up && sconfig.up.includes('buckets');
		var down = sconfig.down && sconfig.down.includes('buckets');
		var delete_files = sconfig.delete && sconfig.delete.includes('buckets');
		var deletes = [];
		
		for (const entry of prepared) {
			var id = entry.item.data.id;
			var local = entry.local;
			var remote = entry.remote;
			var title = (remote.bucket && remote.bucket.title) || entry.item.data.title || id;
			var same_data = Tools.stableStringify(local.data) === Tools.stableStringify(remote.data);
			
			try {
				if (!same_data) {
					var local_time = local.data_stat.mtimeMs / 1000;
					var remote_time = Number(remote.meta.mod);
					if (up && down && local_time == remote_time) throw new Error("Bucket data conflict with equal timestamps: " + id);
					var data_direction = up && down ? (local_time > remote_time ? 'up' : 'down') : (up ? 'up' : 'down');
					var data_changes = Diff.diffLines(
						Tools.stablePrettyStringify(remote.data),
						Tools.stablePrettyStringify(local.data)
					);
					this.printSyncBucketHeading(data_direction == 'up' ? '⬆️' : '⬇️', 'Updating bucket data', title, id);
					println( "\n" + this.markdown(this.formatSyncDiff(data_changes)) );
					if (!this.dry && data_direction == 'up') {
						await this.callStandardAPI('writeBucketData', { id, data: local.data, replace: true }, { text: 'Writing bucket data...', throw: true });
						var updated = await this.getSyncBucket(id);
						if (Tools.stableStringify(updated.data) !== Tools.stableStringify(local.data)) {
							throw new Error("Bucket data changed during upload: " + id);
						}
						if (Tools.stableStringify(JSON.parse(fs.readFileSync(local.paths.data, 'utf8'))) !== Tools.stableStringify(local.data)) {
							throw new Error("Local bucket data changed during upload: " + local.paths.data);
						}
						this.stampSyncBucketFile(local.paths.data, updated.meta.mod);
						this.upSynced = true;
					}
					else if (!this.dry) {
						Tools.writeFileAtomicSync(local.paths.data, JSON.stringify(remote.data, null, '\t') + '\n');
						this.stampSyncBucketFile(local.paths.data, remote.meta.mod);
						this.downSynced = true;
					}
				}
				
				var manifest = new Map(remote.files.map( file => [file.filename, file] ));
				var uploads = [];
				var downloads = [];
				for (const [name, source] of local.files) {
					var target = manifest.get(name);
					if (!target) {
						if (up) uploads.push({ name, source });
						continue;
					}
					var local_time = source.stat.mtimeMs / 1000;
					var remote_time = Number(target.date);
					var size_differs = source.stat.size !== Number(target.size);
					if (up && down) {
						if (local_time > remote_time) uploads.push({ name, source });
						else if (remote_time > local_time) downloads.push({ name, target, path: source.path });
						else if (size_differs) throw new Error("Bucket file size conflict with equal timestamps: " + source.path);
					}
					else if (up && (size_differs || local_time > remote_time)) uploads.push({ name, source });
					else if (down && (size_differs || remote_time > local_time)) downloads.push({ name, target, path: source.path });
				}
				for (const file of remote.files) {
					if (!local.files.has(file.filename)) {
						if (down) downloads.push({ name: file.filename, target: file, path: Path.join(local.paths.files, file.filename) });
						else if (delete_files) deletes.push({ id, title, file });
					}
				}
				
				if (uploads.length) {
					var upload_label = "Uploading " + uploads.length + " bucket " + (uploads.length == 1 ? 'file' : 'files');
					this.printSyncBucketHeading('⬆️', upload_label, title, id);
					uploads.forEach( entry => {
						println( "    " + cli.emoji('📎') + " " + cli.chalk.bold.yellow(Path.basename(entry.source.path)) );
					});
					if (!this.dry) {
						var result = await this.callStandardAPI('uploadBucketFiles', { id }, {
							text: 'Uploading bucket files...', files: uploads.map( entry => entry.source.path ), throw: true
						});
						var updated = new Map((result.files || []).map( file => [file.filename, file] ));
						for (const entry of uploads) {
							var file = updated.get(entry.name);
							if (!file || (typeof(file.date) != 'number') || !Number.isFinite(file.date)) {
								throw new Error("Uploaded bucket file missing or invalid in response: " + entry.name);
							}
							var current = fs.statSync(entry.source.path);
							if ((current.size !== entry.source.stat.size) || (current.mtimeMs !== entry.source.stat.mtimeMs)) {
								throw new Error("Local bucket file changed during upload: " + entry.source.path);
							}
							this.stampSyncBucketFile(entry.source.path, file.date);
						}
						this.upSynced = true;
					}
				}
				for (const entry of downloads) {
					this.printSyncBucketHeading('⬇️', 'Downloading bucket file', title, id);
					println( "    " + cli.emoji('📎') + " " + cli.chalk.bold.yellow(entry.name) );
					if (!this.dry) {
						await this.downloadSyncBucketFile(id, entry.target, entry.path);
						this.downSynced = true;
					}
				}
			}
			catch (err) {
				this.logSyncError("Bucket sync failed for " + id + ": " + err);
			}
		}
		
		// Deletions are the final content phase. Any earlier warning or error
		// suppresses all bucket file deletes, just like whole-object deletion.
		if (deletes.length && (this.errors.length || this.warnings.length)) {
			this.logSyncWarning("Bucket file delete pass skipped because sync encountered warnings or errors.");
			return;
		}
		for (const entry of deletes) {
			this.printSyncBucketHeading('🗑️', 'Deleting bucket file', entry.title, entry.id, true);
			println( "    " + cli.emoji('📎') + " " + cli.chalk.bold.yellow(entry.file.filename) );
			if (this.dry) continue;
			try {
				await this.callStandardAPI('deleteBucketFile', { id: entry.id, path: entry.file.path }, { text: 'Deleting bucket file...', throw: true });
				this.upSynced = true;
			}
			catch (err) {
				this.logSyncError("Bucket file deletion failed: " + err);
				return;
			}
		}
	}
};
