// xyOps Portable Data Format (XYPDF) Import / Export
// Keep the wire format and dependency selection compatible with the web UI.

const fs = require('fs');
const Path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const cli = require('pixl-cli');
const Tools = cli.Tools;

// One registry covers all portable types, including resources whose full CLI
// routers have not been implemented yet.  API names are never taken from files.
const TYPES = {
	alert: { command: 'alert', list: 'alerts', api: 'Alert' },
	api_key: { command: 'key', list: 'api_keys', api: 'ApiKey' },
	bucket: { command: 'bucket', list: 'buckets', api: 'Bucket' },
	category: { command: 'category', list: 'categories', api: 'Category' },
	channel: { command: 'channel', list: 'channels', api: 'Channel' },
	event: { command: 'event', list: 'events', api: 'Event' },
	group: { command: 'group', list: 'groups', api: 'Group' },
	monitor: { command: 'monitor', list: 'monitors', api: 'Monitor' },
	plugin: { command: 'plugin', list: 'plugins', api: 'Plugin' },
	role: { command: 'role', list: 'roles', api: 'Role' },
	tag: { command: 'tag', list: 'tags', api: 'Tag' },
	web_hook: { command: 'webhook', aliases: ['hook'], list: 'web_hooks', api: 'WebHook' }
};
const DEPENDENCIES = ['buckets', 'categories', 'events', 'groups', 'plugins', 'tags', 'web_hooks'];
const AUDIT_FIELDS = ['created', 'modified', 'revision', 'sort_order', 'username'];

module.exports = {
	
	async cmd_export_object(command) {
		// Export is a read-only variant of a singular resource command.  Handle it
		// before normal routing so it cannot become a filter or a mutation field.
		var type = Object.keys(TYPES).find( type => (TYPES[type].command == command) || (TYPES[type].aliases || []).includes(command) );
		if (!type) return this.die("Export requires a singular object command. See 'xy help export'.");
		
		var args = this.args;
		var filename = this.requireTransferFilename(args.export);
		var positionals = args.other.slice(0);
		
		if (positionals[0] == 'get') positionals.shift();
		else if (['list', 'create', 'update', 'delete', 'run', 'test', 'write', 'upload', 'download', 'empty', 'file', 'search'].includes(positionals[0])) {
			return this.die("Use --export with object details, e.g. xy " + command + " OBJECT_ID --export FILE");
		}
		
		Object.keys(args).forEach( key => {
			if (!['other', 'export', 'id', 'title', 'deps', 'overwrite'].includes(key)) this.die("Unsupported export option: --" + key);
		});
		if (('overwrite' in args) && (typeof(args.overwrite) != 'boolean')) return this.die("Export --overwrite must be true or false.");
		
		var selectors = [positionals.join(' '), args.id, args.title].filter( value => value !== undefined && value !== '' );
		if (selectors.length != 1 || typeof(selectors[0]) != 'string') return this.die("Specify one object ID or title to export.");
		
		if (('deps' in args) && (type != 'event')) return this.die("The --deps option is only available for event and workflow exports.");
		var deps = this.parseExportDependencies(args.deps);
		
		await this.getMultiple();
		
		var objects = this[TYPES[type].list];
		var obj = Tools.findObject(objects, { id: selectors[0] }) || this.findObjectFuzzy(objects, { title: selectors[0] });
		if (!obj) return this.die("Could not find " + type + " based on your criteria: " + selectors[0]);
		
		// The in-memory lists contain the complete definitions.  In particular,
		// global/buckets contains metadata only, without fetching data or files.
		var warnings = [];
		var items = this.collectExportItems(type, obj, deps, warnings);
		
		var payload = {
			type: 'xypdf',
			description: 'xyOps Portable Data Object',
			version: '1.0',
			xyops: this.xyopsVersion,
			items: items
		};
		
		if (this.dry) {
			this.jsonOutput({ file: filename, dry_run: true, warnings: warnings, payload: payload });
			return;
		}
		
		var bytes = Buffer.from(JSON.stringify(payload, null, '\t') + '\n');
		if (/\.gz$/i.test(filename)) bytes = zlib.gzipSync(bytes);
		this.writeTransferFile(filename, bytes, args.overwrite === true);
		
		if (this.format.match(/json/)) return this.jsonOutput({ code: 0, file: filename, count: items.length, warnings: warnings });
		
		this.toast('✅', 'green', "Exported " + items.length + " item(s) to: " + filename);
		warnings.forEach( warning => println(yellow(warning)) );
	},
	
	parseExportDependencies(value) {
		// Match the UI's optional dependency groups.  No dependencies by default.
		if (value === undefined) return new Set();
		
		var values = Array.isArray(value) ? value : [value];
		var deps = new Set();
		
		values.forEach( entry => {
			if (typeof(entry) != 'string') this.die("Use --deps all or a comma-separated list of dependency types.");
			
			entry.split(',').forEach( name => {
				name = name.trim();
				
				if (name == 'all') DEPENDENCIES.forEach( dep => deps.add(dep) );
				else if (DEPENDENCIES.includes(name)) deps.add(name);
				else this.die("Unknown export dependency: " + name + ". Choose: " + DEPENDENCIES.join(', ') + ", all");
			});
		});
		
		return deps;
	},
	
	collectExportItems(type, obj, deps, warnings) {
		// Mark each item before descending, so shared dependencies and workflow
		// cycles cannot duplicate items or recurse indefinitely.  Root stays first.
		var items = [];
		var visited = new Set();
		var missing = new Set();
		
		var include = (type, id, skip_stock) => {
			if (!id) return;
			if ((type == 'category' && id == 'general') || (type == 'web_hook' && id == 'example_hook')) return;
			
			var data = Tools.findObject(this[TYPES[type].list], { id: id });
			if (!data) {
				var key = type + ':' + id;
				if (!missing.has(key)) warnings.push("Dependency not found, omitted: " + key);
				missing.add(key);
				return;
			}
			
			if (skip_stock && data.stock) return;
			visit(type, data);
		};
		
		var action = data => {
			if (!data) return;
			
			if (data.type == 'plugin' && deps.has('plugins')) include('plugin', data.plugin_id);
			if (data.type == 'web_hook' && deps.has('web_hooks')) include('web_hook', data.web_hook);
			if (['store', 'fetch'].includes(data.type) && deps.has('buckets')) include('bucket', data.bucket_id);
			if (data.type == 'tag' && deps.has('tags')) include('tag', data.tag_id);
		};
		
		var visit = (type, data) => {
			var key = type + ':' + data.id;
			if (visited.has(key)) return;
			
			visited.add(key);
			items.push({ type: type, data: this.cleanTransferData(data) });
			
			if (type != 'event') return;
			
			if (data.workflow) {
				(data.workflow.nodes || []).forEach( node => {
					var value = node.data || {};
					
					if (node.type == 'event' && deps.has('events')) include('event', value.event);
					if (node.type == 'job' && deps.has('plugins')) include('plugin', value.plugin, true);
					if (node.type == 'action') action(value);
				});
			}
			else if (deps.has('plugins')) include('plugin', data.plugin, true);
			
			if (deps.has('categories')) include('category', data.category);
			
			if (deps.has('groups')) (data.targets || []).forEach( id => {
				// A target may instead be a server ID, which is not portable.
				if (Tools.findObject(this.groups, { id: id })) include('group', id);
			});
			
			if (deps.has('tags')) (data.tags || []).forEach( id => include('tag', id) );
			
			if (deps.has('plugins')) (data.triggers || []).forEach( trigger => {
				if (trigger.type == 'plugin') include('plugin', trigger.plugin_id);
			});
			
			(data.actions || []).forEach(action);
		};
		
		visit(type, obj);
		return items;
	},
	
	cleanTransferData(data) {
		// Strip server-managed metadata without mutating cached or parsed objects.
		var clean = JSON.parse(JSON.stringify(data));
		AUDIT_FIELDS.forEach( key => delete clean[key] );
		if (clean.id === '') delete clean.id;
		
		return clean;
	},
	
	requireTransferFilename(value) {
		if (typeof(value) != 'string' || !value.trim() || value.includes('\0')) this.die("Please specify a file path.");
		
		return Path.resolve(value);
	},
	
	writeTransferFile(filename, bytes, overwrite) {
		// Write privately in the destination directory, then install the complete
		// file atomically.  A hard link gives no-clobber behavior without a race.
		var temp = Path.join(Path.dirname(filename), '.xycli-export-' + crypto.randomBytes(12).toString('hex'));
		
		try {
			fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
			
			if (overwrite) fs.renameSync(temp, filename);
			else fs.linkSync(temp, filename);
		}
		catch (err) {
			// Throw so the cleanup runs before the CLI's fatal error handler exits.
			if (err.code == 'EEXIST') throw new Error("Export file already exists. Add --overwrite to replace it: " + filename);
			throw new Error("Failed to export file: " + err.message);
		}
		finally {
			if (fs.existsSync(temp)) fs.unlinkSync(temp);
		}
	},
	
	async cmd_import() {
		// Parse and validate the whole file before planning any API calls.
		if (this.args.other.length != 1) return this.dieUsage('import');
		var filename = this.requireTransferFilename(this.args.other[0]);
		Object.keys(this.args).forEach( key => {
			if (!['other', 'confirm'].includes(key)) this.die("Unsupported import option: --" + key);
		});
		if (('confirm' in this.args) && typeof(this.args.confirm) != 'boolean') return this.die("Import --confirm must be true or false.");
		
		var payload;
		try {
			var bytes = fs.readFileSync(filename);
			
			// Accept gzip by signature as well as extension, including UI .json.gz.
			if (/\.gz$/i.test(filename) || (bytes[0] == 0x1f && bytes[1] == 0x8b)) bytes = zlib.gunzipSync(bytes);
			
			payload = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
		}
		catch (err) { return this.die("Failed to read XYPDF file: " + err.message); }
		
		this.validateTransferPayload(payload);
		await this.getMultiple();
		
		var plan = payload.items.map( item => {
			var data = this.cleanTransferData(item.data);
			var existing = data.id && Tools.findObject(this[TYPES[item.type].list], { id: data.id });
			var operation = existing ? 'update' : 'create';
			
			return {
				type: item.type,
				operation: operation,
				method: operation + TYPES[item.type].api,
				data: data
			};
		}).reverse(); // The UI imports dependencies from the end of the file first.
		plan = this.orderTransferPlan(plan);
		
		var warnings = [];
		if (plan.some( item => item.operation == 'update' )) warnings.push('Existing IDs will be updated with the imported fields.');
		
		if (plan.some( item => item.type == 'event' && (item.data.triggers || []).some( trigger => trigger.enabled && /^(schedule|interval|single|startup|keyboard)$/.test(trigger.type) ) )) {
			warnings.push('Imported events contain active triggers and may run automatically.');
		}
		
		if (this.dry || this.args.confirm !== true) {
			this.jsonOutput({ file: filename, preview: true, warnings: warnings, items: plan });
			
			if (!this.format.match(/json/)) {
				this.toast('⚠️', 'orange', "Preview only. Review the data above, then use --confirm to apply the import.");
				this.printSuggestedCommands({ "Review this import": "xy import " + this.quoteTransferFilename(filename) });
			}
			
			return;
		}
		
		// APIs are not transactional. Retain every completed result even if a
		// later item fails, and stop at the first error.
		var results = plan.map( item => ({
			type: item.type,
			id: item.data.id || '',
			title: item.data.title,
			operation: item.operation,
			status: 'pending'
		}) );
		var error = null;
		
		for (var idx = 0; idx < plan.length; idx++) {
			var item = plan[idx];
			var result = results[idx];
			
			try {
				if (this.verbose) this.jsonOutput({ method: item.method, data: item.data });
				
				cli.progress.start({ amount: 1, pct: false, text: gray('→ Importing ' + item.type + ': ' + item.data.title) });
				var response = await this.api[item.method](item.data);
				if (response.err) throw response.err;
				
				var data = response.data;
				result.id = (data[item.type] && data[item.type].id) || data.id || item.data.id;
				result.status = item.operation == 'create' ? 'created' : 'updated';
			}
			catch (err) {
				error = result.error = err.message || String(err);
				if (result.status == 'pending') result.status = 'failed';
				break;
			}
			finally { cli.progress.end(); }
		}
		
		var report = { code: error ? 1 : 0, file: filename, warnings: warnings, items: results };
		if (error) {
			report.error = error;
			process.exitCode = 1;
		}
		
		if (this.format.match(/json/)) return this.jsonOutput(report);
		
		warnings.forEach( warning => println(yellow(warning)) );
		
		this.printBoxTable({
			title: 'Import Results',
			header: ['Type', 'ID', 'Title', 'Result'],
			rows: results.map( item => [item.type, item.id || '(New)', item.title, item.status] )
		});
		
		if (error) println("\n " + red('Import stopped: ' + error) + '\n Earlier successful changes remain in place.');
		else this.printSuggestedCommands({
			"List events": "xy events",
			"List categories": "xy categories",
			"List monitors": "xy monitors"
		});
	},
	
	orderTransferPlan(plan) {
		// Reversing the UI's root-first file usually puts dependencies first, but
		// shared nested workflows can break that order. Visit new prerequisites
		// before their consumers, regardless of where they appear in the file.
		var byID = new Map(plan.filter( item => item.data.id ).map( item => [item.type + ':' + item.data.id, item] ));
		var visited = new Set(), visiting = new Set(), ordered = [];
		
		var visit = item => {
			if (visited.has(item)) return;
			if (visiting.has(item)) this.die("Circular dependency among new import objects: " + item.type + ':' + item.data.id);
			
			visiting.add(item);
			
			var need = (type, id) => {
				var dependency = id && byID.get(type + ':' + id);
				
				// Existing definitions already satisfy API reference checks.
				if (dependency && dependency.operation == 'create') visit(dependency);
			};
			
			var each = (list, callback) => {
				if (Array.isArray(list)) list.forEach(callback);
			};
			
			var action = action => {
				if (!action) return;
				
				if (action.type == 'plugin') need('plugin', action.plugin_id);
				if (action.type == 'web_hook') need('web_hook', action.web_hook);
				if (action.type == 'channel') need('channel', action.channel_id);
				if (action.type == 'run_event') need('event', action.event_id);
				if (action.type == 'tag') need('tag', action.tag_id);
				if (['store', 'fetch'].includes(action.type)) need('bucket', action.bucket_id);
			};
			
			var data = item.data;
			each(data.groups, id => need('group', id));
			each(data.roles, id => need('role', id));
			each(data.categories, id => need('category', id));
			each(data.actions, action);
			each(data.alert_actions, action);
			
			if (item.type == 'event') {
				need('category', data.category);
				need('plugin', data.plugin);
				each(data.targets, id => need('group', id));
				each(data.tags, id => need('tag', id));
				
				each(data.triggers, trigger => {
					if (trigger && trigger.type == 'plugin') need('plugin', trigger.plugin_id);
				});
				
				if (data.workflow) each(data.workflow.nodes, node => {
					var value = node.data || {};
					
					if (node.type == 'event') need('event', value.event);
					if (node.type == 'job') need('plugin', value.plugin);
					if (node.type == 'action') action(value);
				});
			}
			
			visiting.delete(item);
			visited.add(item);
			ordered.push(item);
		};
		
		plan.forEach(visit);
		return ordered;
	},
	
	validateTransferPayload(payload) {
		// XYPDF v1.1 added xyops, but the wire version is still "1.0", as in the UI.
		if (!payload || payload.type !== 'xypdf' || payload.version !== '1.0' || !Array.isArray(payload.items) || !payload.items.length) {
			this.die("Unknown format: Expected an XYPDF version 1.0 file with a non-empty items array.");
		}
		
		if (payload.xyops !== undefined && this.compareTransferVersions(payload.xyops, this.xyopsVersion) > 0) this.die("This import requires xyOps v" + payload.xyops + " or higher.");
		
		var seen = new Set();
		
		var checkKeys = obj => {
			if (!obj || typeof(obj) != 'object') return;
			
			Object.keys(obj).forEach( key => {
				if (['__proto__', 'prototype', 'constructor'].includes(key)) this.die("Unsafe property in import data: " + key);
				checkKeys(obj[key]);
			});
		};
		
		payload.items.forEach( (item, idx) => {
			if (!item || !Object.hasOwn(TYPES, item.type)) this.die("Unknown XYPDF object type at item " + (idx + 1));
			
			var data = item.data;
			if (!data || typeof(data) != 'object' || Array.isArray(data)) this.die("Invalid object data at item " + (idx + 1));
			if (typeof(data.title) != 'string' || !data.title.trim()) this.die("Missing title at item " + (idx + 1));
			if (data.id !== undefined && data.id !== '' && (typeof(data.id) != 'string' || !/^[a-z0-9_]+$/.test(data.id))) this.die("Invalid object ID at item " + (idx + 1));
			
			if (data.id) {
				var key = item.type + ':' + data.id;
				if (seen.has(key)) this.die("Duplicate object in import file: " + key);
				seen.add(key);
			}
			
			checkKeys(data);
		});
	},
	
	compareTransferVersions(required, current) {
		// Compare semver components without adding a dependency. Build metadata
		// does not affect precedence; prereleases sort below their final release.
		var parse = value => {
			var match = typeof(value) == 'string' && value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/);
			if (!match) this.die("Invalid xyOps version: " + value);
			return match;
		};
		
		var a = parse(required), b = parse(current);
		
		for (var idx = 1; idx <= 3; idx++) {
			if (Number(a[idx]) != Number(b[idx])) return Number(a[idx]) > Number(b[idx]) ? 1 : -1;
		}
		
		if (a[4] === b[4]) return 0;
		if (!a[4]) return 1;
		if (!b[4]) return -1;
		
		var ap = a[4].split('.'), bp = b[4].split('.');
		
		for (var idx = 0; idx < Math.max(ap.length, bp.length); idx++) {
			if (ap[idx] === bp[idx]) continue;
			if (ap[idx] === undefined) return -1;
			if (bp[idx] === undefined) return 1;
			
			var an = /^\d+$/.test(ap[idx]), bn = /^\d+$/.test(bp[idx]);
			if (an && bn) return Number(ap[idx]) > Number(bp[idx]) ? 1 : -1;
			if (an != bn) return an ? -1 : 1;
			
			return ap[idx] > bp[idx] ? 1 : -1;
		}
		
		return 0;
	},
	
	quoteTransferFilename(filename) {
		// Single-quote suggested shell arguments, including embedded apostrophes.
		return "'" + filename.replace(/'/g, "'\\''") + "'";
	}
	
};
