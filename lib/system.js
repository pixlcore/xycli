// System Status and Administration Layer

const fs = require('fs');
const Path = require('path');
const crypto = require('crypto');
const cli = require('pixl-cli');
const Tools = cli.Tools;

const BROADCAST_TYPES = ['info', 'warning', 'error', 'critical'];

module.exports = {
	
	async cmd_system() {
		// Route all admin dashboard and maintenance operations through one compact
		// command family.  A bare `xy system` always opens the read-only dashboard.
		var cmd = this.args.other.shift();
		if (!cmd) return this.cmd_system_dashboard();
		
		switch (cmd) {
			case 'dashboard': await this.cmd_system_dashboard(); break;
			case 'import': await this.cmd_system_import(); break;
			case 'export': await this.cmd_system_export(); break;
			case 'delete': await this.cmd_system_delete(); break;
			case 'maintenance':
			case 'maint': await this.cmd_system_maintenance(); break;
			case 'optimize': await this.cmd_system_optimize(); break;
			case 'reset': await this.cmd_system_reset(); break;
			case 'restart': await this.cmd_system_conductor_command('restart'); break;
			case 'shutdown': await this.cmd_system_conductor_command('shutdown'); break;
			case 'upgrade': await this.cmd_system_upgrade(); break;
			case 'email': await this.cmd_system_email(); break;
			case 'diagnostic':
			case 'diagnostics':
			case 'diag': await this.cmd_system_diagnostic(); break;
			case 'broadcast': await this.cmd_system_broadcast(); break;
			default: this.dieUsage('system'); break;
		}
	},
	
	async loadSystemStats() {
		// getMultiple supplies live application state.  Refresh server and conductor
		// status separately because the bootstrap copy may have been cached locally.
		await this.getMultiple();
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading system statistics...') });
		var [stats_result, servers_result] = await Promise.all([
			this.api.adminStats({}),
			this.api.getServers({})
		]);
		cli.progress.end();
		if (stats_result.err) this.die(stats_result.err);
		if (servers_result.err) this.die(servers_result.err);
		this.masters = servers_result.data.masters || {};
		this.servers = servers_result.data.servers || {};
		return stats_result.data.stats || {};
	},
	
	async cmd_system_dashboard() {
		if (this.args.other.length) return this.die("Unexpected System dashboard argument: " + this.args.other[0]);
		delete this.args.other;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System dashboard option: --" + Tools.firstKey(this.args));
		
		var data = await this.loadSystemStats();
		var sockets = (data.sockets || []).filter( socket => socket.type == 'user' );
		
		if (this.format.match(/json/)) {
			return this.jsonOutput({
				stats: data,
				masters: this.masters || {},
				internalJobs: this.internalJobs || {},
				users: sockets
			});
		}
		
		var stats = this.stats || {};
		var cache = data.cache;
		var records = (data.db && data.db.records) || {};
		var memory = stats.memoryUsage || {};
		
		println("\n " + this.color('theme').bold("SYSTEM STATUS & MAINTENANCE"));
		println("" + dashGrid([
			["Process CPU", Math.round(stats.cpu || 0) + '%'],
			["Process Memory", Tools.getTextFromBytes(stats.mem || 0, 1).replace(/bytes/, 'B')],
			["DB Memory", Tools.getTextFromBytes(memory.external || 0, 1).replace(/bytes/, 'B')],
			["Cache Memory", cache ? Tools.getTextFromBytes(cache.bytes || 0, 1).replace(/bytes/, 'B') : 'n/a'],
			["Cache Objects", cache ? Tools.commify(cache.count || 0) : 'n/a'],
			["Cache Utilization", cache ? cache.full : 'n/a'],
			["DB Disk Size", data.db && data.db.sqlite ? Tools.getTextFromBytes(data.db.sqlite, 1).replace(/bytes/, 'B') : 'n/a'],
			["Job DB Rows", Tools.commify(records.jobs || 0)],
			["Server DB Rows", Tools.commify(records.servers || 0)],
			["Snapshot DB Rows", Tools.commify(records.snapshots || 0)],
			["Alert DB Rows", Tools.commify(records.alerts || 0)],
			["Activity DB Rows", Tools.commify(records.activity || 0)]
		], {
			minCols: 3,
			maxCols: 6,
			gap: 1,
			indent: 1,
			valueStyles: ['bold', 'green']
		}));
		
		this.printInternalJobs({ title: 'Internal System Jobs' });
		this.printSystemConductors();
		this.printSystemUsers(sockets);
		
		this.printSuggestedCommands({
			"Export system data": "xy system export xyops-export.json.gz",
			"Run maintenance": "xy system maintenance",
			"Generate diagnostics": "xy system diagnostic",
			"Broadcast a message": 'xy system broadcast "System maintenance begins soon"',
			"View System help": "xy help system"
		});
	},
	
	printSystemConductors() {
		// Keep the useful columns from the dedicated web UI page, omitting only its
		// browser action buttons.  Offline peers retain their identity and status.
		var masters = Object.values(this.masters || {}).sort( function(a, b) {
			return String(a.id).toLowerCase().localeCompare(String(b.id).toLowerCase());
		});
		
		this.printBoxTable({
			title: 'All Conductors',
			header: ['Host ID', 'Status', 'xyOps', 'Load Avg', 'Ping', 'Uptime'],
			rows: masters.map( item => {
				var stats = item.stats || {};
				var status = item.online ? (item.master ? green('Primary') : this.color('blue')('Online')) : gray('Offline');
				return [
					this.color('theme').bold(item.id),
					status,
					item.online && item.version ? 'v' + String(item.version).replace(/^v/, '') : '-',
					item.online ? this.formatSystemNumber(stats.load || 0) : '-',
					item.online ? (Tools.commify(item.ping || 0) + ' ms') : '-',
					item.online && item.date ? Tools.getTextFromSeconds(Math.max(0, this.epoch - item.date), true, true) : 'n/a'
				];
			})
		});
	},
	
	printSystemUsers(sockets) {
		// adminStats includes every WebSocket type.  This table intentionally shows
		// only interactive user sessions, matching the System page in the web UI.
		sockets.sort( function(a, b) { return (a.timeStart < b.timeStart) ? 1 : -1; });
		
		this.printBoxTable({
			title: 'All Connected Users',
			header: ['Username', 'Socket ID', 'IP Address', 'Location', 'Duration', 'Ping'],
			rows: sockets.map( socket => {
				var loc = socket.loc;
				if (loc && (typeof(loc) == 'object')) loc = loc.loc || loc.id || '';
				return [
					bold(socket.username || '(Unknown)'),
					this.color('theme').bold(socket.id),
					socket.ip || 'n/a',
					loc ? ('#' + loc) : 'n/a',
					Tools.getTextFromSeconds(Math.max(0, this.epoch - (socket.timeStart || this.epoch)), true, true),
					Tools.commify(socket.ping || 0) + ' ms'
				];
			})
		});
	},
	
	formatSystemNumber(value) {
		value = Number(value) || 0;
		return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
	},
	
	parseSystemCSV(value, label, opts) {
		// CLI users can supply comma-separated text, repeat a JSON array through
		// --json, or use the friendly `all` / `none` selectors where appropriate.
		opts = opts || {};
		var values = Array.isArray(value) ? value.slice(0) : ((typeof(value) == 'string') ? value.split(',') : []);
		values = values.map( item => String(item).trim() ).filter( item => !!item );
		values = Array.from(new Set(values));
		if (!values.length && !opts.empty) this.die(label + " must contain at least one item.");
		if (values.includes('all') && values.length > 1) this.die(label + " cannot combine 'all' with other items.");
		if (values.includes('none') && values.length > 1) this.die(label + " cannot combine 'none' with other items.");
		if (values[0] == 'none') return [];
		return values;
	},
	
	validateSystemSelection(values, allowed, label) {
		if (values.length == 1 && values[0] == 'all') return;
		var invalid = values.find( item => !allowed.includes(item) );
		if (invalid) {
			var suggestion = this.findClosestString(invalid, allowed);
			this.die("Unknown " + label + ': "' + invalid + '".' + (suggestion ? ' Did you mean "' + suggestion + '"?' : ''));
		}
	},
	
	async cmd_system_export() {
		var filename = this.args.other.shift();
		if (!filename || this.args.other.length) return this.dieUsage('system export');
		filename = this.requireSystemFilename(filename);
		
		var list_defs = (this.config.ui && this.config.ui.list_list) || [];
		var index_defs = (this.config.ui && this.config.ui.database_list) || [];
		var extra_defs = (this.config.ui && this.config.ui.extra_list) || [];
		var lists = this.parseSystemCSV(('lists' in this.args) ? this.args.lists : 'all', 'Export lists', { empty: true });
		var indexes = this.parseSystemCSV(('indexes' in this.args) ? this.args.indexes : (this.args.tables || 'none'), 'Export indexes', { empty: true });
		var extras = this.parseSystemCSV(('extras' in this.args) ? this.args.extras : 'none', 'Export extras', { empty: true });
		var overwrite = this.args.overwrite === true;
		
		this.validateSystemSelection(lists, list_defs.map( item => item.id ), 'export list');
		this.validateSystemSelection(indexes, index_defs.map( item => item.id ), 'export index');
		this.validateSystemSelection(extras, extra_defs.map( item => item.id ), 'export extra');
		if (lists.length == 1 && lists[0] == 'all') lists = list_defs.map( item => item.id );
		if (indexes.length == 1 && indexes[0] == 'all') indexes = index_defs.map( item => item.id );
		if (extras.length == 1 && extras[0] == 'all') extras = extra_defs.map( item => item.id );
		if (!lists.length && !indexes.length && !extras.length) this.die("Select at least one list, index, or extra to export.");
		if (('overwrite' in this.args) && (typeof(this.args.overwrite) != 'boolean')) this.die("System export --overwrite must be true or false.");
		
		delete this.args.other;
		delete this.args.lists;
		delete this.args.indexes;
		delete this.args.tables;
		delete this.args.extras;
		delete this.args.overwrite;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System export option: --" + Tools.firstKey(this.args));
		if (fs.existsSync(filename) && !overwrite) return this.die("Export file already exists. Add --overwrite to replace it: " + filename);
		
		var request = { lists: lists, indexes: indexes, extras: extras };
		if (this.dry || this.verbose) {
			println("\n " + this.color('theme').bold('SYSTEM DATA EXPORT:'));
			this.jsonOutput({ request: request, output: filename, overwrite: overwrite });
		}
		if (this.dry) {
			this.toast('⚠️', 'orange', bold("DRY RUN: ") + "Exiting without downloading data.");
			return;
		}
		
		var temp_file = Path.join(Path.dirname(filename), '.xycli-system-export-' + crypto.randomBytes(12).toString('hex'));
		
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Exporting system data...') });
		try {
			// Create the partial download privately before handing it to the SDK.  The
			// completed archive can contain API Keys, Secret metadata, and user data.
			fs.writeFileSync(temp_file, '', { flag: 'wx', mode: 0o600 });
			var { err } = await this.api.adminExportData(request, { download: temp_file });
			if (err) throw new Error(err);
			fs.chmodSync(temp_file, 0o600);
			if (overwrite) fs.renameSync(temp_file, filename);
			else {
				fs.linkSync(temp_file, filename);
				fs.unlinkSync(temp_file);
			}
		}
		catch (err) {
			cli.progress.end();
			if (fs.existsSync(temp_file)) fs.unlinkSync(temp_file);
			return this.die("Failed to export system data: " + err.message);
		}
		cli.progress.end();
		
		var result = { code: 0, file: filename, size: fs.statSync(filename).size };
		if (this.format.match(/json/)) return this.jsonOutput(result);
		this.toast('✅', 'green', "System data exported to: " + filename);
	},
	
	requireSystemFilename(value) {
		if ((typeof(value) != 'string') || !value.trim() || value.includes('\0')) this.die("Please specify a valid file path.");
		return Path.resolve(value);
	},
	
	async cmd_system_import() {
		var filename = this.args.other.shift();
		if (!filename || this.args.other.length) return this.dieUsage('system import');
		filename = this.requireSystemFilename(filename);
		if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) this.die("Import file not found: " + filename);
		
		var source = this.args.source || 'xyops';
		if (!['xyops', 'cronicle'].includes(source)) this.die("System import --source must be 'xyops' or 'cronicle'.");
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) this.die("System import --confirm must be true or false.");
		
		delete this.args.other;
		delete this.args.source;
		var confirmed = this.args.confirm === true;
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System import option: --" + Tools.firstKey(this.args));
		
		this.printMutationSummary({
			title: 'Import System Data',
			rows: [
				['File', filename],
				['Size', Tools.getTextFromBytes(fs.statSync(filename).size)],
				['Source Format', source == 'xyops' ? 'xyOps' : 'Cronicle']
			]
		});
		if (!confirmed) {
			this.toast('⚠️', 'orange', "Bulk import can replace data, stop jobs, clear the queue, and pause the scheduler. Add '--confirm' to continue.");
			return;
		}
		
		var data = await this.callStandardAPI('adminImportData', { format: source }, {
			files: [filename],
			text: 'Uploading system data...'
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "The system import job has started" + (data.id ? ': #' + data.id : '.'));
	},
	
	buildSystemDeleteItems(selection) {
		var list_defs = (this.config.ui && this.config.ui.list_list) || [];
		var index_defs = (this.config.ui && this.config.ui.database_list) || [];
		var list_ids = list_defs.map( item => item.id );
		var index_ids = index_defs.map( item => item.id );
		var lists = [];
		var indexes = [];
		
		if (selection.length == 1 && selection[0] == 'all') {
			lists = list_ids.slice(0);
			indexes = index_ids.slice(0);
		}
		else {
			selection.forEach( name => {
				if (name.match(/^list:(.+)$/)) {
					var list = RegExp.$1;
					if (!list_ids.includes(list) && list != 'stats') this.die('Unknown system data list: "' + list + '".');
					lists.push(list);
				}
				else if (name.match(/^(db|index):(.+)$/)) {
					var index = RegExp.$2;
					if (!index_ids.includes(index)) this.die('Unknown system database index: "' + index + '".');
					indexes.push(index);
				}
				else if (name == 'alerts') {
					// Alert definitions and Alert history share the same friendly name.
					lists.push('alerts');
					indexes.push('alerts');
				}
				else if (list_ids.includes(name) || (name == 'stats')) lists.push(name);
				else if (index_ids.includes(name)) indexes.push(name);
				else {
					var allowed = Array.from(new Set(list_ids.concat(index_ids, ['stats'])));
					var suggestion = this.findClosestString(name, allowed);
					this.die('Unknown system data selection: "' + name + '".' + (suggestion ? ' Did you mean "' + suggestion + '"?' : ''));
				}
			});
		}
		
		lists = Array.from(new Set(lists));
		indexes = Array.from(new Set(indexes));
		var items = [];
		
		// Delete dependent binary/encrypted data before deleting its metadata list.
		if (lists.includes('users')) items.push({ type: 'users' });
		if (lists.includes('buckets')) items.push({ type: 'bucketData' }, { type: 'bucketFiles' });
		if (lists.includes('secrets')) items.push({ type: 'secretData' });
		lists.forEach( list => items.push({ type: 'list', key: 'global/' + list }));
		indexes.forEach( index => items.push({ type: 'index', index: index }));
		return { items: items, lists: lists, indexes: indexes };
	},
	
	async cmd_system_delete() {
		var selection = this.parseSystemCSV(this.args.other.shift(), 'System delete selection');
		if (this.args.other.length) this.die("Unexpected System delete argument: " + this.args.other[0]);
		var plan = this.buildSystemDeleteItems(selection);
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) this.die("System delete --confirm must be true or false.");
		var confirmed = this.args.confirm === true;
		
		delete this.args.other;
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System delete option: --" + Tools.firstKey(this.args));
		
		this.printMutationSummary({
			title: 'Delete System Data',
			rows: [
				['Storage Lists', plan.lists.join(', ') || '(None)'],
				['Database Indexes', plan.indexes.join(', ') || '(None)'],
				['Operations', Tools.commify(plan.items.length)]
			]
		});
		if (!confirmed) {
			var warning = selection.includes('all') ?
				"This will permanently delete ALL xyOps system data. Add '--confirm' to continue." :
				"This will permanently delete the selected xyOps system data. Add '--confirm' to continue.";
			this.toast('⚠️', 'orange', warning);
			return;
		}
		
		var data = await this.callStandardAPI('adminDeleteData', { items: plan.items }, { text: 'Starting bulk deletion...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "The system data deletion job has started" + (data.id ? ': #' + data.id : '.'));
	},
	
	async cmd_system_maintenance() {
		this.requireEmptySystemArgs('maintenance');
		var data = await this.callStandardAPI('adminRunMaintenance', {}, { text: 'Starting system maintenance...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "The maintenance job has started" + (data.id ? ': #' + data.id : '.'));
	},
	
	async cmd_system_optimize() {
		this.requireEmptySystemArgs('optimize');
		var data = await this.callStandardAPI('adminRunOptimization', {}, { text: 'Starting database optimization...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "The database optimization job has started" + (data.id ? ': #' + data.id : '.'));
	},
	
	requireEmptySystemArgs(command) {
		if (this.args.other.length) this.die("Unexpected System " + command + " argument: " + this.args.other[0]);
		delete this.args.other;
		if (Tools.numKeys(this.args)) this.die("Unsupported System " + command + " option: --" + Tools.firstKey(this.args));
	},
	
	async cmd_system_reset() {
		var target = this.args.other.shift();
		if (!target || this.args.other.length) return this.dieUsage('system reset');
		if (!['daily', 'rates', 'sync'].includes(target)) this.die("System reset target must be 'daily', 'rates', or 'sync'.");
		
		var id = this.args.id;
		delete this.args.other;
		delete this.args.id;
		if (id && target != 'rates') this.die("The --id option is only available for rate limit resets.");
		
		// Sync governance covers every up-only managed definition, so resetting it
		// requires a deliberate confirmation. Daily and rate resets retain their
		// existing immediate behavior.
		var confirmed = false;
		if (target == 'sync') {
			if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) this.die("System reset sync --confirm must be true or false.");
			confirmed = this.args.confirm === true;
			delete this.args.confirm;
		}
		
		if (Tools.numKeys(this.args)) return this.die("Unsupported System reset option: --" + Tools.firstKey(this.args));
		
		if (target == 'sync') {
			this.printMutationSummary({
				title: 'Reset Sync State',
				rows: [
					['Target', 'All remote-management flags'],
					['New State', 'Empty sync map']
				]
			});
			if (!confirmed) {
				this.toast('⚠️', 'orange', "This will clear all sync state flags and remove their edit warnings. Add '--confirm' to continue.");
				return;
			}
			
			var data = await this.callStandardAPI('update_global_state', { sync: {} }, { text: 'Resetting sync state flags...' });
			if (this.dry) return;
			if (this.format.match(/json/)) return this.jsonOutput(data);
			this.toast('✅', 'green', "The sync state flags have been reset.");
			return;
		}
		
		var method = target == 'daily' ? 'adminResetDailyStats' : 'adminResetJobRateLimits';
		var request = id ? { id: id } : {};
		var data = await this.callStandardAPI(method, request, { text: 'Resetting ' + (target == 'daily' ? 'daily statistics' : 'rate limit windows') + '...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', target == 'daily' ? "The daily statistics have been reset." : "The job rate limit windows have been reset.");
	},
	
	async cmd_system_conductor_command(action) {
		// Conductor shutdown uses the underlying control script's "stop" command,
		// while the friendlier public CLI command remains "shutdown".
		var kind = this.args.other.shift();
		var host = this.args.other.shift();
		if (!kind || !host || this.args.other.length) return this.dieUsage('system ' + action);
		if (kind != 'conductor') this.die("System " + action + " target type must be 'conductor'.");
		if ((typeof(host) != 'string') || !host.match(/^[\w\-.]+$/)) this.die("Conductor hostname is invalid.");
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) this.die("System " + action + " --confirm must be true or false.");
		var confirmed = this.args.confirm === true;
		
		delete this.args.other;
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System " + action + " option: --" + Tools.firstKey(this.args));
		
		// Resolve the exact hostname against the current conductor inventory before
		// displaying a preview or allowing the destructive request to proceed.
		await this.getMultiple();
		var conductors = Object.values(this.masters || {});
		var conductor = conductors.find( item => item.id == host );
		if (!conductor) {
			var suggestion = this.findClosestString(host, conductors.map( item => item.id ));
			this.die("Conductor hostname not found: \"" + host + "\"." + (suggestion ? " Did you mean \"" + suggestion + "\"?" : ''));
		}
		
		this.printMutationSummary({
			title: action + ' Conductor',
			rows: [
				['Hostname', host],
				['Action', action]
			]
		});
		if (!confirmed) {
			this.toast('⚠️', 'orange', "This will " + action + " the conductor and may interrupt service. Review the hostname above, then add '--confirm' to continue.");
			return;
		}
		
		var command = action == 'shutdown' ? 'stop' : 'restart';
		var data = await this.callStandardAPI('masterCommand', {
			host: host,
			commands: [command]
		}, { text: 'Sending conductor ' + action + ' request...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "The " + action + " request was successfully sent to conductor '" + host + "'.");
	},
	
	async cmd_system_upgrade() {
		var kind = this.args.other.shift();
		var target_value = this.args.other.shift();
		if (!kind || !target_value || this.args.other.length) return this.dieUsage('system upgrade');
		if (kind == 'masters') kind = 'conductors';
		if (kind == 'servers') kind = 'workers';
		if (!['conductors', 'workers'].includes(kind)) this.die("System upgrade target type must be 'conductors' or 'workers'.");
		
		var targets = this.parseSystemCSV(target_value, 'Upgrade targets');
		var release = this.args.version || this.args.release || 'latest';
		var stagger = ('stagger' in this.args) ? this.args.stagger : 60;
		if ((typeof(release) != 'string') || !release.match(/^[\w\-.]+$/)) this.die("Upgrade version is invalid.");
		if (!Number.isInteger(stagger) || stagger < 0) this.die("Upgrade --stagger must be a non-negative integer number of seconds.");
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) this.die("System upgrade --confirm must be true or false.");
		var confirmed = this.args.confirm === true;
		
		delete this.args.other;
		delete this.args.version;
		delete this.args.release;
		delete this.args.stagger;
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System upgrade option: --" + Tools.firstKey(this.args));
		
		this.printMutationSummary({
			title: 'Upgrade ' + kind,
			rows: [
				['Targets', targets.join(', ')],
				['Version', release],
				['Stagger', Tools.getTextFromSeconds(stagger, false, true)]
			]
		});
		if (!confirmed) {
			this.toast('⚠️', 'orange', "Server upgrades can interrupt service. Review the targets above, then add '--confirm' to continue.");
			return;
		}
		
		var method = kind == 'conductors' ? 'adminUpgradeMasters' : 'adminUpgradeWorkers';
		var data = await this.callStandardAPI(method, { targets: targets, release: release, stagger: stagger }, { text: 'Starting ' + kind + ' upgrade...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "The " + kind + " upgrade job has started.");
	},
	
	async cmd_system_email() {
		var to = this.args.other.shift() || this.args.to;
		if (!to || this.args.other.length) return this.dieUsage('system email');
		delete this.args.other;
		delete this.args.to;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System email option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('adminSendTestEmail', { to: to }, { text: 'Sending test email...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		
		println("\n " + this.color('theme').bold('TEST EMAIL RESULTS'));
		println("\n" + this.markdown("**Result:** " + data.description + "\n\n" + (data.details || '')).trimEnd());
	},
	
	async cmd_system_diagnostic() {
		this.requireEmptySystemArgs('diagnostic');
		var data = await this.loadSystemStats();
		
		// Diagnostics are deliberately structured data rather than a second copy of
		// the browser's Markdown report generator.  This also makes the result easy
		// to save, filter, compare, and attach to a support request.
		this.jsonOutput({
			generated: this.epoch,
			timezone: this.config.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
			system: data,
			conductors: this.masters || {},
			workers: this.servers || {},
			internalJobs: this.internalJobs || {},
			activeJobs: this.activeJobs || {},
			activeAlerts: this.activeAlerts || {},
			state: this.state || {},
			stats: this.stats || {}
		});
	},
	
	async cmd_system_broadcast() {
		var positional = this.args.other.join(' ').trim();
		var message = this.args.message || positional;
		if (!message || ((typeof(message) == 'string') && !message.trim())) return this.dieUsage('system broadcast');
		if (positional && this.args.message && positional != this.args.message) this.die("Conflicting broadcast messages.");
		if (typeof(message) != 'string') this.die("Broadcast message must be plain text.");
		
		var type = String(this.args.type || 'info').toLowerCase();
		if (!BROADCAST_TYPES.includes(type)) this.die("Broadcast --type must be one of: " + BROADCAST_TYPES.join(', '));
		var request = { type: type, message: message.trim() };
		if (this.args.sound) {
			if (typeof(this.args.sound) != 'string') this.die("Broadcast --sound must be a filename.");
			request.sound = this.args.sound;
		}
		
		delete this.args.other;
		delete this.args.message;
		delete this.args.type;
		delete this.args.sound;
		if (Tools.numKeys(this.args)) return this.die("Unsupported System broadcast option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('adminBroadcastMessage', request, { text: 'Broadcasting message...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Message broadcast to all connected users.");
	}
	
};
