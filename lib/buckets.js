// Storage Bucket Layer
//
// Bucket definitions, JSON data and files deliberately have separate mutation
// paths in xyOps.  Keep that separation visible in the CLI so writing data or
// uploading files does not advance the bucket's metadata revision.

const fs = require('fs');
const Path = require('path');
const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_buckets() {
		// Collection alias for listing and filtering bucket definitions.
		if (this.args.other[0] == 'list') this.args.other.shift();
		await this.cmd_get_buckets();
	},
	
	async cmd_bucket() {
		// Singular router, e.g. `xy bucket create` or `xy bucket BUCKET_ID`.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('bucket');
		
		switch (cmd) {
			case 'list': await this.cmd_get_buckets(); break;
			case 'get': await this.cmd_get_bucket(); break;
			case 'write': await this.cmd_write_bucket_data(); break;
			case 'upload': await this.cmd_upload_bucket_files(); break;
			case 'download': await this.cmd_download_bucket_file(); break;
			case 'empty': await this.cmd_empty_bucket(); break;
			case 'file': await this.cmd_bucket_file(); break;
			
			case 'create': await this.cmd_create_bucket(); break;
			case 'update': await this.cmd_update_bucket(); break;
			case 'delete': await this.cmd_delete_bucket(); break;
			
			default:
				// A bare ID or fuzzy title opens bucket details.
				this.args.other.unshift(cmd);
				await this.cmd_get_bucket();
			break;
		}
	},
	
	async cmd_bucket_file() {
		// Keep file operations readable without introducing compound flag names.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('bucket file');
		
		switch (cmd) {
			case 'get':
			case 'download': await this.cmd_download_bucket_file(); break;
			case 'delete': await this.cmd_delete_bucket_file(); break;
			default: this.die("Unknown bucket file command: " + cmd);
		}
	},
	
	async cmd_get_buckets() {
		// List bucket definitions from getMultiple.  Data and file lists are only
		// loaded when the user asks for one specific bucket.
		this.prepSearchArgs();
		await this.getMultiple();
		var buckets = this.buckets.slice(0);
		var is_filtered = false;
		
		if (this.args.other.length) {
			var search = this.args.other.join(' ');
			buckets = this.findObjectsFuzzy(buckets, {
				id: search,
				title: search,
				notes: search,
				username: search
			}, 1);
			is_filtered = true;
		}
		delete this.args.other;
		
		if ('enabled' in this.args) {
			var enabled = this.parseBucketBoolean(this.args.enabled, 'enabled');
			buckets = buckets.filter( bucket => !!bucket.enabled === enabled );
			delete this.args.enabled;
			is_filtered = true;
		}
		if ('disabled' in this.args) {
			var disabled = this.parseBucketBoolean(this.args.disabled, 'disabled');
			buckets = buckets.filter( bucket => !bucket.enabled === disabled );
			delete this.args.disabled;
			is_filtered = true;
		}
		
		if (Tools.numKeys(this.args)) {
			// Preserve generic fuzzy filters for new scalar metadata fields.
			buckets = this.findObjectsFuzzy(buckets, this.args);
			is_filtered = true;
		}
		
		buckets.sort( function(a, b) {
			return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
		} );
		
		if (this.format.match(/json/)) return this.jsonOutput(buckets);
		
		var total = buckets.length;
		var rows = buckets.slice(this.offset, this.offset + this.limit);
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Storage Buckets' : 'All Storage Buckets',
			header: ['Bucket ID', 'Title', 'Status', 'Author', 'Modified', 'Revision'],
			rows: rows,
			list: { length: total },
			offset: this.offset,
			limit: this.limit
		}, bucket => {
			return [
				this.color('theme').bold(bucket.id),
				bold(bucket.title),
				this.getNiceEnabled(bucket.enabled),
				bucket.username || gray('(Unknown)'),
				this.getRelativeDateTime(bucket.modified, true),
				bucket.revision || 1
			];
		});
		
		this.printSuggestedCommands({
			"View bucket details": "xy bucket BUCKET_ID_OR_TITLE",
			"Create a bucket": "xy bucket create --title \"My Bucket\"",
			"Write bucket data": "xy bucket write BUCKET_ID --data @data.json",
			"Upload bucket files": "xy bucket upload BUCKET_ID --file FILE"
		});
	},
	
	async cmd_get_bucket() {
		// Resolve an exact ID first, then allow a fuzzy title for read-only views.
		await this.getMultiple();
		if (!this.buckets.length) return this.die("No storage buckets found.");
		
		var selector = '';
		if (this.args.other.length) selector = this.args.other.join(' ');
		else if (this.args.id) selector = this.args.id;
		else if (this.args.title) selector = this.args.title;
		else return this.dieUsage('bucket get');
		
		var bucket = Tools.findObject(this.buckets, { id: selector }) ||
			this.findObjectFuzzy(this.buckets, { title: selector });
		if (!bucket) return this.die("Could not find bucket based on your criteria: " + selector);
		
		var result = await this.fetchBucket(bucket.id);
		if (this.format.match(/json/)) {
			return this.jsonOutput({
				bucket: result.bucket,
				data: result.data,
				files: result.files
			});
		}
		
		this.printBoxList({
			title: 'Bucket Summary',
			rows: [
				[ 'Bucket ID', gray(result.bucket.id) ],
				[ 'Title', this.color('theme').bold(result.bucket.title) ],
				[ 'Status', this.getNiceEnabled(result.bucket.enabled) ],
				[ 'Icon', result.bucket.icon || gray('(None)') ],
				[ 'Author', result.bucket.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(result.bucket.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(result.bucket.modified, true, true) ],
				[ 'Revision', result.bucket.revision || 1 ],
				[ 'Data Keys', Tools.commify(Tools.numKeys(result.data || {})) ],
				[ 'Files', Tools.commify((result.files || []).length) ]
			]
		});
		
		// User notes may contain multiple lines, so keep them out of the summary box.
		if (result.bucket.notes) {
			this.printUserNotes('BUCKET NOTES', result.bucket.notes);
		}
		
		print( "\n " + this.color('theme').bold('BUCKET DATA') );
		this.jsonOutput(result.data || {});
		this.printBucketFiles(result.files || []);
		
		this.printSuggestedCommands({
			"Update bucket metadata": `xy bucket update ${bucket.id} [--KEY VALUE, ...]`,
			"Export bucket metadata": `xy bucket ${bucket.id} --export bucket.json`,
			"Write bucket data": `xy bucket write ${bucket.id} --data @data.json`,
			"Upload files": `xy bucket upload ${bucket.id} --file FILE`,
			"Download a file": result.files.length ? `xy bucket file download ${bucket.id} ${result.files[0].filename}` : '',
			"Delete a file": result.files.length ? `xy bucket file delete ${bucket.id} ${result.files[0].filename} --confirm` : '',
			"Empty bucket contents": `xy bucket empty ${bucket.id} --data --files --confirm`,
			"Delete bucket": `xy bucket delete ${bucket.id} --confirm`
		});
	},
	
	async cmd_create_bucket() {
		// Initial data belongs to revision 1, so create_bucket can safely accept it.
		// Files still use the dedicated multipart upload after creation succeeds.
		await this.getMultiple();
		var files = this.consumeBucketFileArgs();
		var params = {
			enabled: true,
			icon: '',
			notes: '',
			data: {}
		};
		
		this.mergeDotArgs(params, this.args);
		delete params.other;
		this.assertBucketFields(params, ['id', 'title', 'enabled', 'icon', 'notes', 'data']);
		
		if (!params.title || !String(params.title).trim()) return this.dieUsage('bucket create');
		params.title = String(params.title).trim();
		params.enabled = this.parseBucketBoolean(params.enabled, 'enabled');
		this.requireBucketDataObject(params.data);
		this.validateBucketUploadFiles(files);
		
		var result = await this.callStandardAPI('createBucket', params, {
			text: 'Creating storage bucket...'
		});
		if (this.dry) {
			if (files.length) {
				println( "\n " + yellow.bold("DRY RUN: ") + "The new bucket would then receive " + Tools.commify(files.length) + " file(s)." );
				this.jsonOutput({ files: files });
			}
			return;
		}
		
		var uploaded_files = [];
		if (files.length) {
			var upload = await this.callStandardAPI('uploadBucketFiles', { id: result.bucket.id }, {
				text: 'Uploading bucket files...',
				files: files
			});
			uploaded_files = upload.files || [];
		}
		
		if (this.format.match(/json/)) {
			return this.jsonOutput({
				bucket: result.bucket,
				data: params.data,
				files: uploaded_files
			});
		}
		
		this.toast('✅', 'green', "Successfully created storage bucket: #" + result.bucket.id);
		this.printSuggestedCommands({
			"View bucket details": `xy bucket ${result.bucket.id}`,
			"Update bucket metadata": `xy bucket update ${result.bucket.id} [--KEY VALUE, ...]`,
			"Write bucket data": `xy bucket write ${result.bucket.id} --data @data.json`,
			"Upload files": `xy bucket upload ${result.bucket.id} --file FILE`
		});
	},
	
	async cmd_update_bucket() {
		// This command is intentionally metadata-only.  Dedicated content APIs avoid
		// changing revision and modified timestamps for data and file operations.
		await this.getMultiple();
		var id = this.consumeBucketID();
		var bucket = this.requireBucketID(id);
		
		delete this.args.id;
		delete this.args.other;
		
		this.printMutationSummary({
			title: 'Update Storage Bucket',
			rows: [
				[ 'Bucket ID', gray(bucket.id) ],
				[ 'Title', this.color('theme').bold(bucket.title) ]
			]
		});
		
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for storage bucket.");
		this.printUpdateData(this.args);
		
		this.assertBucketFields(this.args, ['title', 'enabled', 'icon', 'notes']);
		
		var params = { id: id };
		Tools.mergeHashInto(params, this.args);
		if ('title' in params) {
			if (!params.title || !String(params.title).trim()) return this.die("Bucket title cannot be empty.");
			params.title = String(params.title).trim();
		}
		if ('enabled' in params) params.enabled = this.parseBucketBoolean(params.enabled, 'enabled');
		
		await this.callStandardAPI('updateBucket', params, {
			text: 'Updating bucket metadata...'
		});
		if (this.dry) return;
		this.toast('✅', 'green', "Successfully updated storage bucket: #" + id);
	},
	
	async cmd_write_bucket_data() {
		// Shallow-merge arbitrary JSON through write_bucket_data.  Fetch the merged
		// object so JSON mode and the human response both show the resulting state.
		await this.getMultiple();
		var id = this.consumeBucketID();
		this.requireBucketID(id);
		delete this.args.id;
		delete this.args.other;
		
		var input = {};
		this.mergeDotArgs(input, this.args);
		this.assertBucketFields(input, ['data']);
		if (!Object.prototype.hasOwnProperty.call(input, 'data')) return this.dieUsage('bucket write');
		this.requireBucketDataObject(input.data);
		
		var result = await this.callStandardAPI('writeBucketData', {
			id: id,
			data: input.data,
			fetch: true
		}, {
			text: 'Writing bucket data...'
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(result.data || {});
		
		this.toast('✅', 'green', "Successfully wrote data to storage bucket: #" + id);
		println( "\n " + this.color('theme').bold('MERGED BUCKET DATA') );
		this.jsonOutput(result.data || {});
	},
	
	async cmd_upload_bucket_files() {
		// Uploading uses the dedicated multipart API and leaves metadata untouched.
		await this.getMultiple();
		var id = this.consumeBucketID();
		this.requireBucketID(id);
		delete this.args.id;
		delete this.args.other;
		
		var files = this.consumeBucketFileArgs();
		if (Tools.numKeys(this.args)) this.assertBucketFields(this.args, []);
		if (!files.length) return this.dieUsage('bucket upload');
		this.validateBucketUploadFiles(files);
		
		var result = await this.callStandardAPI('uploadBucketFiles', { id: id }, {
			text: 'Uploading bucket files...',
			files: files
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(result.files || []);
		
		this.toast('✅', 'green', "Successfully uploaded " + Tools.commify(files.length) + " file(s) to storage bucket: #" + id);
		this.printBucketFiles(result.files || []);
	},
	
	async cmd_delete_bucket_file() {
		// Resolve a file against the authoritative bucket file list, then delete by
		// storage path so similarly named files can never select the wrong object.
		await this.getMultiple();
		var id = this.consumeBucketID(true);
		this.requireBucketID(id);
		var selector = this.args.other.shift() || this.args.filename || this.args.file;
		if (!selector) return this.dieUsage('bucket file delete');
		if (this.args.other.length) return this.die("Unexpected argument after bucket filename: " + this.args.other[0]);
		
		delete this.args.id;
		delete this.args.other;
		delete this.args.filename;
		delete this.args.file;
		if (!this.args.confirm) return this.die("Please confirm the file delete by adding '--confirm'");
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) this.assertBucketFields(this.args, []);
		
		var result = await this.fetchBucket(id);
		var file = this.findBucketFile(result.files, selector);
		if (!file) return this.die("Could not find bucket file from exact filename or File ID: " + selector);
		
		await this.callStandardAPI('deleteBucketFile', {
			id: id,
			path: file.path
		}, {
			text: 'Deleting bucket file...'
		});
		if (this.dry) return;
		this.toast('✅', 'green', "Successfully deleted bucket file: " + file.filename);
	},
	
	async cmd_empty_bucket() {
		// Empty data, files, or both without deleting the bucket definition.
		await this.getMultiple();
		var id = this.consumeBucketID();
		this.requireBucketID(id);
		delete this.args.id;
		delete this.args.other;
		
		var empty_data = ('data' in this.args) ? this.parseBucketBoolean(this.args.data, 'data') : false;
		var empty_files = ('files' in this.args) ? this.parseBucketBoolean(this.args.files, 'files') : false;
		var empty_all = ('all' in this.args) ? this.parseBucketBoolean(this.args.all, 'all') : false;
		delete this.args.data;
		delete this.args.files;
		delete this.args.all;
		if (empty_all) empty_data = empty_files = true;
		if (!empty_data && !empty_files) return this.dieUsage('bucket empty');
		if (!this.args.confirm) return this.die("Please confirm emptying the bucket by adding '--confirm'");
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) this.assertBucketFields(this.args, []);
		
		await this.callStandardAPI('emptyBucket', {
			id: id,
			data: empty_data,
			files: empty_files
		}, {
			text: 'Emptying storage bucket...'
		});
		if (this.dry) return;
		
		var contents = empty_data && empty_files ? 'data and files' : (empty_data ? 'data' : 'files');
		this.toast('✅', 'green', "Successfully emptied bucket " + contents + ": #" + id);
	},
	
	async cmd_delete_bucket() {
		// Bucket deletion removes the definition and all stored contents permanently.
		await this.getMultiple();
		var id = this.consumeBucketID();
		var bucket = this.requireBucketID(id);
		delete this.args.id;
		delete this.args.other;
		this.printMutationSummary({
			title: 'Delete Storage Bucket',
			rows: [
				[ 'Bucket ID', gray(bucket.id) ],
				[ 'Title', this.color('theme').bold(bucket.title) ]
			]
		});
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the storage bucket delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) this.assertBucketFields(this.args, []);
		
		await this.callStandardAPI('deleteBucket', { id: id }, {
			text: 'Deleting storage bucket...'
		});
		if (this.dry) return;
		this.toast('✅', 'green', "Successfully deleted storage bucket and all contents: #" + id);
	},
	
	async cmd_download_bucket_file() {
		// Bucket files are served from their storage path, not a named JSON API.
		// Refuse to overwrite local files so a typo cannot destroy user data.
		await this.getMultiple();
		var id = this.consumeBucketID(true);
		this.requireBucketID(id);
		var selector = this.args.other.shift() || this.args.filename || this.args.file;
		if (!selector) return this.dieUsage('bucket file download');
		var output = this.args.other.shift() || this.args.output || this.args.download;
		if (this.args.other.length) return this.die("Unexpected argument after output filename: " + this.args.other[0]);
		
		delete this.args.id;
		delete this.args.other;
		delete this.args.filename;
		delete this.args.file;
		delete this.args.output;
		delete this.args.download;
		if (Tools.numKeys(this.args)) this.assertBucketFields(this.args, []);
		
		var result = await this.fetchBucket(id);
		var file = this.findBucketFile(result.files, selector);
		if (!file) return this.die("Could not find bucket file from exact filename or File ID: " + selector);
		if (!output || (output === true)) output = file.filename;
		
		var dest_file = Path.resolve(String(output));
		if (fs.existsSync(dest_file)) return this.die("Output file already exists: " + dest_file);
		var request = {
			// The file API prepends its own `files/` storage prefix.
			path: file.path.replace(/^files\//, ''),
			download: file.filename
		};
		
		if (this.dry || this.verbose) {
			println( "\n " + this.color('theme').bold('FILE DOWNLOAD:') );
			this.jsonOutput({
				bucket: id,
				file: file.filename,
				request: request,
				output: dest_file
			});
		}
		if (this.dry) {
			println( "\n " + yellow.bold("DRY RUN: ") + "Exiting without downloading the file." );
			return;
		}
		
		println( "\n " + this.color('theme').bold('BUCKET FILE: ' + file.filename) );
		println( " " + gray("Downloading to file: ") + dest_file );
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Downloading bucket file...') });
		try {
			var { err } = await this.api.file(request, { download: dest_file });
			if (err) throw err;
		}
		catch (err) {
			cli.progress.end();
			// The destination did not exist before this command, so any partial file
			// here belongs to this failed download and is safe to remove.
			if (fs.existsSync(dest_file)) fs.unlinkSync(dest_file);
			return this.die(err);
		}
		cli.progress.end();
		this.toast('✅', 'green', "Successfully downloaded bucket file: " + file.filename);
	},
	
	async fetchBucket(id) {
		// Fetch complete bucket contents and normalize older empty responses.
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading storage bucket...') });
		var { err, data } = await this.api.getBucket({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		data.data = data.data || {};
		data.files = data.files || [];
		return data;
	},
	
	consumeBucketID(allow_extra) {
		// Consume an internal bucket ID from the positional slot or --id.
		var id = this.args.id;
		if (this.args.other && this.args.other.length) id = this.args.other.shift();
		if (!id) this.die("Missing required Bucket ID argument.");
		if (!allow_extra && this.args.other && this.args.other.length) {
			this.die("Unexpected argument after Bucket ID: " + this.args.other[0]);
		}
		return String(id);
	},
	
	requireBucketID(id) {
		// Mutating commands always require an exact internal ID.
		var bucket = Tools.findObject(this.buckets, { id: id });
		if (!bucket) this.die("Could not find bucket from exact ID: " + id);
		return bucket;
	},
	
	consumeBucketFileArgs() {
		// Accept repeated --file, --files with an array, or either spelling alone.
		var files = [];
		if ('file' in this.args) files = files.concat(Tools.alwaysArray(this.args.file));
		if ('files' in this.args) files = files.concat(Tools.alwaysArray(this.args.files));
		delete this.args.file;
		delete this.args.files;
		return files.map( file => String(file) ).filter( file => !!file );
	},
	
	validateBucketUploadFiles(files) {
		// Fail before making a request if any local upload path is unusable.
		files.forEach( file => {
			if (!fs.existsSync(file)) this.die("Upload file not found: " + file);
			var stats = fs.statSync(file);
			if (!stats.isFile()) this.die("Upload path is not a file: " + file);
		});
	},
	
	findBucketFile(files, selector) {
		// Filenames are unique after server normalization; File IDs are also safe.
		selector = String(selector);
		return Tools.findObject(files || [], { filename: selector }) ||
			Tools.findObject(files || [], { id: selector });
	},
	
	requireBucketDataObject(data) {
		// Bucket data is always a JSON hash.  Arrays and scalars would violate the
		// shallow-merge contract of write_bucket_data.
		if (!Tools.isaHash(data)) this.die("Bucket data must be a JSON object.");
		return data;
	},
	
	parseBucketBoolean(value, name) {
		// Accept both normal command-line booleans and a few friendly spellings.
		if ((value === true) || (value === 1) || (value === '1')) return true;
		if ((value === false) || (value === 0) || (value === '0')) return false;
		if (String(value).match(/^(yes|on)$/i)) return true;
		if (String(value).match(/^(no|off)$/i)) return false;
		this.die("Invalid boolean value for '" + name + "': " + value);
	},
	
	assertBucketFields(object, allowed) {
		// Catch typos instead of silently storing accidental metadata properties.
		var unknown = Object.keys(object).filter( key => !allowed.includes(key) );
		if (unknown.length) this.die("Unsupported bucket option: --" + unknown[0]);
	},
	
	getNiceBucketFileSource(file) {
		// Files may originate from a user upload, job, or server-side action.
		if (file.username) return file.username;
		if (file.job) return 'Job #' + file.job;
		if (file.server) return this.getNiceServer(file.server);
		return gray('(Unknown)');
	},
	
	printBucketFiles(files) {
		// File IDs and normalized filenames are both displayed and accepted by file
		// commands.  Keep the ID column free of decorative prefixes for copying.
		files = files.slice(0).sort( function(a, b) {
			return String(a.filename || '').localeCompare(String(b.filename || ''));
		} );
		this.printBoxTable({
			title: 'Bucket Files',
			header: ['File ID', 'Filename', 'Size', 'Source', 'Modified'],
			rows: files.map( file => {
				return [
					this.color('theme').bold(file.id),
					cli.emoji('📄') + ' ' + bold(file.filename),
					Tools.getTextFromBytes(file.size || 0),
					this.getNiceBucketFileSource(file),
					this.getRelativeDateTime(file.date, true)
				];
			})
		});
	}
	
}; // module.exports
