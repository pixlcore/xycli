// Server Management Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

const SERVER_PLATFORMS = {
	linux: 'standard',
	macos: 'macos',
	windows: 'windows',
	docker: 'docker'
};

const SERVER_LIST_FILTERS = [
	'id', 'title', 'hostname', 'ip', 'os', 'platform', 'os_platform',
	'distro', 'os_distro', 'release', 'os_release', 'arch', 'os_arch',
	'cpu', 'satellite', 'group', 'groups', 'status', 'online', 'enabled'
];

const SERVER_SEARCH_FIELDS = [
	'groups', 'os_platform', 'os_distro', 'os_release', 'os_arch',
	'cpu_virt', 'cpu_brand', 'cpu_cores', 'created', 'modified'
];

// Server records use a few camelCase properties internally, but the public CLI
// favors readable snake_case switches and the friendlier "label" terminology.
const SERVER_UPDATE_ALIASES = {
	label: 'title',
	title: 'title',
	enabled: 'enabled',
	icon: 'icon',
	groups: 'groups',
	max_jobs: 'maxJobs',
	maxJobs: 'maxJobs',
	user_data: 'userData',
	userData: 'userData'
};

const SERVER_HISTORY_SYSTEMS = {
	hourly: { parts: 4, epoch_div: 60 },
	daily: { parts: 3, epoch_div: 120 },
	monthly: { parts: 2, epoch_div: 3600 },
	yearly: { parts: 1, epoch_div: 43200 }
};

module.exports = {
	
	async cmd_servers() {
		// The plural form normally shows live and recently offline servers.  Keep
		// the database-search spelling available here as a convenient alias.
		if (this.args.other[0] == 'search') {
			this.args.other.shift();
			return this.cmd_search_servers();
		}
		await this.cmd_get_servers();
	},
	
	async cmd_server() {
		// Most Server commands use a named subcommand, while the common detail
		// view accepts a Server ID directly for convenient day-to-day use.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('server');
		
		switch (cmd) {
			case 'list': await this.cmd_get_servers(); break;
			case 'get': await this.cmd_get_server(); break;
			case 'add': await this.cmd_add_server(); break;
			case 'search': await this.cmd_search_servers(); break;
			case 'history': await this.cmd_server_history(); break;
			default:
				this.args.other.unshift(cmd);
				await this.cmd_get_server();
			break;
		}
	},
	
	async cmd_get_server() {
		// Fetch the Server definition and its latest monitoring snapshot.  The
		// heavier timelines are opt-in, while Quick Look is live-only.
		this.prepSearchArgs();
		var selector = this.args.other.shift();
		if (!selector || this.args.other.length) return this.dieUsage('server get');
		delete this.args.other;
		
		var command = this.getServerCommand();
		var show_monitors = false;
		var show_processes = false;
		var show_connections = false;
		var pid;
		
		if (!command) {
			show_monitors = this.verbose || !!this.args.monitors;
			show_processes = this.verbose || !!this.args.processes;
			show_connections = this.verbose || !!this.args.connections;
			pid = this.args.pid;
			
			if ((pid !== undefined) && !String(pid).match(/^\d+$/)) this.die('Server process ID must be a positive integer.');
			if ((pid !== undefined) && (Number(pid) < 1)) this.die('Server process ID must be a positive integer.');
			if (('monitors' in this.args) && (typeof(this.args.monitors) != 'boolean')) this.die('Server --monitors must be true or false.');
			if (('processes' in this.args) && (typeof(this.args.processes) != 'boolean')) this.die('Server --processes must be true or false.');
			if (('connections' in this.args) && (typeof(this.args.connections) != 'boolean')) this.die('Server --connections must be true or false.');
			
			delete this.args.monitors;
			delete this.args.processes;
			delete this.args.connections;
			delete this.args.pid;
			if (Tools.numKeys(this.args)) {
				var key = Tools.firstKey(this.args);
				var choices = ['monitors', 'processes', 'connections', 'pid', 'snapshot', 'watch', 'delete'].concat(Object.keys(SERVER_UPDATE_ALIASES));
				var suggestion = this.findClosestString(key, choices);
				this.die('Unsupported server view option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
			}
		}
		
		await this.getMultiple();
		var local_server = this.findLocalServer(selector);
		var id = local_server ? local_server.id : selector;
		
		cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading server...') });
		var { err, data: response } = await this.api.getServer({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		
		var server = response.server;
		var snapshot = response.data || {};
		var online = !!response.online;
		var live_data = snapshot.data || {};
		
		// Mutating commands share Server selection and loading with the detail view,
		// but stop here so no dashboard sections are printed after the operation.
		if (command) return this.runServerCommand(command, server, online);
		
		// Process inspection is deliberately its own focused page.  Do not fetch
		// timelines or render the much larger general Server view around it.
		if (pid !== undefined) {
			var detail = this.getServerProcessDetailData(live_data, Number(pid));
			if (this.format.match(/json/)) {
				return this.jsonOutput({
					server: { id: server.id, hostname: server.hostname, title: server.title },
					process: detail.process,
					family: detail.family
				});
			}
			this.printServerProcessDetail(live_data, Number(pid), detail);
			return;
		}
		
		var supports_quickmon = !!(online && server && server.info && server.info.quickmon && !live_data.dummy);
		var quickmon = [];
		var monitor_rows = [];
		var requests = [];
		
		if (supports_quickmon) {
			requests.push( this.api.getQuickmonData({ server: server.id }).then( result => {
				if (result.err) throw result.err;
				quickmon = (result.data.servers && result.data.servers[server.id]) || [];
			}) );
		}
		if (show_monitors && !live_data.dummy) {
			requests.push( this.api.getLatestMonitorData({ server: server.id, sys: 'hourly', limit: 60 }).then( result => {
				if (result.err) throw result.err;
				monitor_rows = result.data.rows || [];
			}) );
		}
		
		if (requests.length) {
			cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading server monitoring data...') });
			try { await Promise.all(requests); }
			catch (error) { cli.progress.end(); this.die(error); }
			cli.progress.end();
		}
		
		var result = {
			server: server,
			data: snapshot,
			online: online,
			quickmon: quickmon,
			monitors: monitor_rows
		};
		if (this.format.match(/json/)) return this.jsonOutput(result);
		
		// Give the normal Server view a clear page-level identity above its sections.
		if (online) println('\n ' + green.bold('LIVE SERVER VIEW - Real-time'));
		else println('\n ' + yellow.bold('OFFLINE SERVER - Last Known State'));
		
		this.printServerSummary(server, snapshot, online);
		this.printServerAlerts(server, snapshot, online);
		if (online) this.printServerJobs(server);
		if (supports_quickmon && quickmon.length) this.printServerQuickmonCharts(server, quickmon);
		
		if (!live_data.dummy) {
			this.printServerMemory(live_data);
			this.printServerCPU(live_data);
			this.printServerMonitorGrid(server, live_data);
			
			if (show_monitors) this.printServerMonitorCharts(server, monitor_rows, online);
			else this.printServerExpansionNotice('Server Monitors', '--monitors');
			
			this.printServerContainers(live_data);
			
			if (show_processes) this.printServerProcesses(live_data);
			else this.printServerExpansionNotice('Server Processes', '--processes');
			
			if (show_connections) this.printServerConnections(live_data);
			else this.printServerExpansionNotice('Network Connections', '--connections');
			
			this.printServerInterfaces(live_data);
			this.printServerFilesystems(live_data);
		}
		
		this.printSuggestedCommands({
			'Show server monitors': show_monitors ? '' : 'xy server ' + server.id + ' --monitors',
			'Show server processes': show_processes ? '' : 'xy server ' + server.id + ' --processes',
			'Show process details': 'xy server ' + server.id + ' --pid 1234',
			'Show network connections': show_connections ? '' : 'xy server ' + server.id + ' --connections',
			'Show all server details': this.verbose ? '' : 'xy server ' + server.id + ' --verbose',
			'Edit server label': 'xy server ' + server.id + ' --label "New Label"',
			'Take a server snapshot': online ? 'xy server ' + server.id + ' --snapshot' : '',
			'Set a five-minute watch': online ? 'xy server ' + server.id + ' --watch 300' : '',
			'Delete this server': 'xy server ' + server.id + ' --delete',
			'Search server history': 'xy server search ' + server.hostname
		});
	},
	
	getServerCommand() {
		// Action switches are mutually exclusive, and editing cannot be combined
		// with a snapshot, watch or delete in the same invocation.
		var actions = ['snapshot', 'watch', 'delete'].filter( key => key in this.args );
		var edit_keys = Object.keys(this.args).filter( key => key in SERVER_UPDATE_ALIASES );
		if (actions.length > 1) this.die('Specify only one server action at a time: --' + actions.join(', --') + '.');
		if (actions.length && edit_keys.length) this.die('Server edits cannot be combined with --' + actions[0] + '.');
		return actions[0] || (edit_keys.length ? 'update' : '');
	},
	
	async runServerCommand(command, server, online) {
		switch (command) {
			case 'update': return this.updateServerFromCLI(server, online);
			case 'snapshot': return this.createServerSnapshotFromCLI(server, online);
			case 'watch': return this.watchServerFromCLI(server, online);
			case 'delete': return this.deleteServerFromCLI(server, online);
		}
	},
	
	getServerCommandSummaryRows(server, online) {
		// Keep the target visible before every mutation, especially when a hostname
		// or custom label was used to select the Server instead of its internal ID.
		return [
			['Server ID', this.color('theme').bold(server.id)],
			['Hostname', server.hostname || gray('(Unknown)')],
			server.title ? ['Label', bold(server.title)] : null,
			['Status', online ? green('Online') : gray('Offline')]
		];
	},
	
	async updateServerFromCLI(server, online) {
		this.printMutationSummary({
			title: 'Update Server',
			rows: this.getServerCommandSummaryRows(server, online)
		});
		if (!Tools.numKeys(this.args)) return this.die('No updates specified for server.');
		this.printUpdateData(this.args);
		
		var params = { id: server.id };
		Object.keys(this.args).forEach( key => {
			var api_key = SERVER_UPDATE_ALIASES[key];
			if (!api_key) {
				var suggestion = this.findClosestString(key, Object.keys(SERVER_UPDATE_ALIASES));
				this.die('Unsupported server update option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
			}
			if (api_key in params) this.die('Duplicate server update options for: ' + api_key + '.');
			params[api_key] = this.args[key];
		});
		
		if ('title' in params) {
			if (typeof(params.title) != 'string') this.die('Server label must be text.');
			params.title = params.title.trim();
		}
		if ('enabled' in params) params.enabled = this.parseServerBoolean(params.enabled, 'enabled');
		if ('icon' in params) {
			if (typeof(params.icon) != 'string') this.die('Server icon must be text.');
			params.icon = params.icon.trim().replace(/^mdi\-/, '');
		}
		if ('groups' in params) {
			params.groups = this.parseServerList(params.groups, 'groups');
			params.groups.forEach( id => {
				if (Tools.findObject(this.groups, { id: id })) return;
				var suggestion = this.findClosestString(id, this.groups.map( group => group.id ));
				this.die('Unknown server Group ID: "' + id + '".' + (suggestion ? ' Did you mean "' + suggestion + '"?' : ''));
			});
			params.autoGroup = !params.groups.length;
		}
		if ('maxJobs' in params) {
			if (!Number.isInteger(params.maxJobs) || (params.maxJobs < 0)) this.die('Server --max_jobs must be a non-negative integer.');
		}
		if (('userData' in params) && !Tools.isaHash(params.userData)) this.die('Server --user_data must be a JSON object.');
		
		var data = await this.callStandardAPI('updateServer', params, { text: 'Updating server...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', 'Successfully updated server: #' + server.id);
	},
	
	async createServerSnapshotFromCLI(server, online) {
		if (this.args.snapshot !== true) this.die('Server --snapshot must be specified without a value.');
		delete this.args.snapshot;
		if (Tools.numKeys(this.args)) this.die('Unsupported server snapshot option: --' + Tools.firstKey(this.args));
		if (!online) this.die('Cannot create a snapshot for an offline server.');
		
		this.printMutationSummary({
			title: 'Create Server Snapshot',
			rows: this.getServerCommandSummaryRows(server, online)
		});
		var data = await this.callStandardAPI('createSnapshot', { server: server.id }, { text: 'Creating server snapshot...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', 'Successfully created server snapshot: #' + data.id);
		this.printSuggestedCommands({
			'View server details': 'xy server ' + server.id,
			'Set a five-minute watch': 'xy server ' + server.id + ' --watch 300'
		});
	},
	
	async watchServerFromCLI(server, online) {
		var duration = this.args.watch;
		delete this.args.watch;
		if (Tools.numKeys(this.args)) this.die('Unsupported server watch option: --' + Tools.firstKey(this.args));
		if (!Number.isInteger(duration) || (duration < 0)) this.die('Server --watch must be a non-negative integer number of seconds.');
		if (!online) this.die('Cannot set or remove a watch on an offline server.');
		
		this.printMutationSummary({
			title: duration ? 'Set Server Watch' : 'Remove Server Watch',
			rows: this.getServerCommandSummaryRows(server, online).concat([
				['Duration', duration ? Tools.getTextFromSeconds(duration, false, true) : gray('Disabled')]
			])
		});
		var data = await this.callStandardAPI('watchServer', {
			id: server.id,
			duration: duration
		}, { text: duration ? 'Setting server watch...' : 'Removing server watch...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', duration ? 'Successfully set server watch for ' + Tools.getTextFromSeconds(duration, false, true) + '.' : 'Successfully removed server watch.');
	},
	
	async deleteServerFromCLI(server, online) {
		if (this.args.delete !== true) this.die('Server --delete must be specified without a value.');
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) this.die('Server delete --confirm must be true or false.');
		var confirmed = this.args.confirm === true;
		delete this.args.delete;
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) this.die('Unsupported server delete option: --' + Tools.firstKey(this.args));
		
		this.printMutationSummary({
			title: 'Delete Server',
			rows: this.getServerCommandSummaryRows(server, online).concat([
				online ? ['xySat', red('Uninstall')] : null,
				['Server Record', red('Delete')],
				['Monitoring History', red('Delete')],
				['Snapshots', red('Delete')]
			])
		});
		if (!confirmed) {
			this.toast('⚠️', 'orange', "This will permanently delete the server record, all monitoring history, and all snapshots" + (online ? ', and uninstall xySat' : '') + ". Review the server above, then add '--confirm' to continue.");
			return;
		}
		
		var data = await this.callStandardAPI('deleteServer', {
			id: server.id,
			history: true
		}, { text: 'Deleting server and monitoring history...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', 'Server deletion has started in the background: #' + server.id);
	},
	
	async cmd_server_history() {
		// Historical views always cover exactly one hour, day, month or year.  The
		// global page and limit options apply only to the alert and job tables.
		this.prepSearchArgs();
		var selector = this.args.other.shift();
		var date_spec = this.args.other.shift();
		if (!selector || !date_spec || this.args.other.length) return this.dieUsage('server history');
		delete this.args.other;
		if (Tools.numKeys(this.args)) {
			this.die('Unsupported server history option: "--' + Tools.firstKey(this.args) + '".');
		}
		
		var range = this.parseServerHistoryRange(date_spec);
		await this.getMultiple();
		var local_server = this.findLocalServer(selector);
		var id = local_server ? local_server.id : selector;
		var alert_query = 'server:' + id + ' start:<' + range.end + ' end:>=' + range.start;
		var job_query = 'server:' + id + ' date:>=' + range.start + ' date:<' + range.end;
		
		cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading historical server data...') });
		var [server_result, monitor_result, alert_result, job_result] = await Promise.all([
			this.api.getServer({ id: id }),
			this.api.getHistoricalMonitorData({
				server: id,
				sys: range.mode,
				date: range.monitor_start,
				limit: range.monitor_limit
			}),
			this.api.searchAlerts({
				query: alert_query,
				offset: this.offset,
				limit: this.limit,
				sort_by: '_id',
				sort_dir: -1,
				ttl: 1
			}),
			this.api.searchJobs({
				query: job_query,
				offset: this.offset,
				limit: this.limit
			})
		]);
		cli.progress.end();
		
		var failed = [server_result, monitor_result, alert_result, job_result].find( result => result.err );
		if (failed) this.die(failed.err);
		
		var server_response = server_result.data;
		var server = server_response.server;
		var snapshot = server_response.data || {};
		var monitor_rows = monitor_result.data.rows || [];
		var alert_rows = alert_result.data.rows || [];
		var job_rows = job_result.data.rows || [];
		var alerts = {
			rows: alert_rows,
			list: alert_result.data.list || { length: alert_rows.length }
		};
		var jobs = {
			rows: job_rows,
			list: job_result.data.list || { length: job_rows.length }
		};
		
		var output = {
			server: server,
			data: snapshot,
			online: !!server_response.online,
			range: range,
			monitors: monitor_rows,
			alerts: alerts,
			jobs: jobs
		};
		if (this.format.match(/json/)) return this.jsonOutput(output);
		
		println('\n ' + green.bold(range.mode.toUpperCase() + ' SERVER HISTORY - ' + range.title));
		this.printServerHistoricalSummary(server, snapshot);
		this.printServerHistoricalMonitorCharts(server, monitor_rows, range);
		this.printServerHistoricalAlerts(alerts, range);
		this.printServerHistoricalJobs(jobs, range);
		
		var prefix = 'xy server history ' + server.id + ' ';
		this.printSuggestedCommands({
			'View live or last-known state': 'xy server ' + server.id,
			'View hourly history': range.mode == 'hourly' ? '' : prefix + range.examples.hourly,
			'View daily history': range.mode == 'daily' ? '' : prefix + range.examples.daily,
			'View monthly history': range.mode == 'monthly' ? '' : prefix + range.examples.monthly,
			'View yearly history': range.mode == 'yearly' ? '' : prefix + range.examples.yearly
		});
	},
	
	async cmd_get_servers() {
		// getMultiple contains both currently connected servers and the recent
		// offline cache.  Merge copies locally so neither shared collection is
		// modified while decorating cached records for display.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var servers = [];
		var active_ids = {};
		Object.values(this.servers || {}).filter( item => !!item ).forEach( item => {
			active_ids[item.id] = true;
			servers.push( Object.assign({}, item) );
		});
		Object.values(this.serverCache || {}).filter( item => !!item ).forEach( item => {
			if (!active_ids[item.id]) servers.push( Object.assign({}, item, { offline: true }) );
		});
		
		var is_filtered = !!this.args.other.length;
		if (is_filtered) {
			var search = this.args.other.join(' ').trim();
			servers = servers.filter( server => this.getServerSearchText(server).includes(search.toLowerCase()) );
		}
		delete this.args.other;
		
		Object.keys(this.args).forEach( key => {
			if (!SERVER_LIST_FILTERS.includes(key)) {
				var suggestion = this.findClosestString(key, SERVER_LIST_FILTERS);
				this.die('Unsupported server list option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
			}
			
			servers = this.filterActiveServers(servers, key, this.args[key]);
			is_filtered = true;
		});
		
		servers.sort( function(a, b) {
			var a_label = String(a.title || a.hostname || a.id).toLowerCase();
			var b_label = String(b.title || b.hostname || b.id).toLowerCase();
			return a_label.localeCompare(b_label) || String(a.id).localeCompare(String(b.id));
		});
		
		if (this.format.match(/json/)) return this.jsonOutput(servers);
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Servers' : 'Active Servers',
			header: ['Server ID', 'Server', 'Status', 'IP Address', 'OS', 'Arch', 'Groups', 'CPUs', 'RAM', 'Jobs', 'Alerts'],
			rows: servers.slice(this.offset, this.offset + this.limit),
			list: { length: servers.length },
			offset: this.offset,
			limit: this.limit
		}, server => this.getServerTableRow(server, true));
		
		this.printSuggestedCommands({
			'Add a Linux server': 'xy server add --platform linux',
			'Search server history': 'xy server search SEARCH_TEXT',
			'Filter by operating system': 'xy servers --os linux'
		});
	},
	
	filterActiveServers(servers, key, value) {
		// Named filters are ANDed together by the caller.  Text fields use friendly
		// case-insensitive substring matching because this view is entirely local.
		if ((key == 'online') || (key == 'enabled')) {
			var expected = this.parseServerBoolean(value, key);
			return servers.filter( server => {
				return key == 'online' ? !server.offline === expected : !!server.enabled === expected;
			});
		}
		
		var aliases = {
			platform: 'os_platform',
			distro: 'os_distro',
			release: 'os_release',
			arch: 'os_arch',
			group: 'groups'
		};
		var field = aliases[key] || key;
		var values = this.parseServerList(value, key);
		if (!values.length) this.die('Server list option cannot be empty: --' + key);
		
		return servers.filter( server => {
			var info = this.getServerRecordInfo(server);
			var fields = {
				id: server.id,
				title: server.title,
				hostname: server.hostname,
				ip: info.ip,
				os: [info.platform, info.distro, info.release].join(' '),
				os_platform: info.platform,
				os_distro: info.distro,
				os_release: info.release,
				os_arch: info.arch,
				cpu: [info.cpu.brand, info.cpu.combo].join(' '),
				satellite: info.satellite,
				groups: this.getServerGroupSearchText(server),
				status: server.offline ? 'offline' : (server.enabled ? 'online' : 'disabled')
			};
			var haystack = String(fields[field] || '').toLowerCase();
			return values.every( item => haystack.includes(String(item).toLowerCase()) );
		});
	},
	
	async cmd_add_server() {
		// Generate a short-lived bootstrap token, then expand the UI's canonical
		// one-line installer template.  The CLI never executes the resulting code.
		if (this.args.other.length) return this.dieUsage('server add');
		var platform = String(this.args.platform || '').toLowerCase();
		if (!platform) return this.dieUsage('server add');
		if (!SERVER_PLATFORMS[platform]) this.die('Server platform must be one of: ' + Object.keys(SERVER_PLATFORMS).join(', ') + '.');
		
		var params = {};
		if ('title' in this.args) {
			if (typeof(this.args.title) != 'string') this.die('Server title must be text.');
			params.title = this.args.title.trim();
		}
		if ('enabled' in this.args) params.enabled = this.parseServerBoolean(this.args.enabled, 'enabled');
		if ('icon' in this.args) {
			if ((typeof(this.args.icon) != 'string') || !this.args.icon.trim()) this.die('Server icon must be text.');
			params.icon = this.args.icon.trim().replace(/^mdi\-/, '');
		}
		if ('groups' in this.args) {
			params.groups = this.parseServerList(this.args.groups, 'groups');
			await this.getMultiple();
			params.groups.forEach( id => {
				if (Tools.findObject(this.groups, { id: id })) return;
				var suggestion = this.findClosestString(id, this.groups.map( group => group.id ));
				this.die('Unknown server Group ID: "' + id + '".' + (suggestion ? ' Did you mean "' + suggestion + '"?' : ''));
			});
		}
		if ('expires' in this.args) {
			if (!Number.isInteger(this.args.expires) || (this.args.expires < 1)) this.die('Server token expiration must be a positive integer number of seconds.');
			params.expires = this.args.expires;
		}
		
		delete this.args.other;
		delete this.args.platform;
		delete this.args.title;
		delete this.args.enabled;
		delete this.args.icon;
		delete this.args.groups;
		delete this.args.expires;
		if (Tools.numKeys(this.args)) return this.die('Unsupported server add option: --' + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('getSatelliteToken', params, { text: 'Generating server install command...' });
		if (this.dry) return;
		
		var template_key = SERVER_PLATFORMS[platform];
		var templates = (this.config.ui && this.config.ui.satellite_install_commands) || {};
		var template = templates[template_key];
		if (!template) this.die('No server install command is configured for platform: ' + platform);
		var install = Tools.sub(template, Object.assign({}, data, {
			unique: 'd' + Date.now().toString(36)
		}));
		var result = { platform: platform, command: install };
		if (this.format.match(/json/)) return this.jsonOutput(result);
		
		this.printBoxList({
			title: 'Add Server',
			rows: [
				['Platform', platform],
				params.title ? ['Title', params.title] : null,
				('enabled' in params) ? ['Enabled', params.enabled ? green('Yes') : gray('No')] : null,
				params.icon ? ['Icon', params.icon] : null,
				params.groups ? ['Groups', params.groups.length ? params.groups.join(', ') : gray('(Automatic)')] : null,
				['Token Valid For', Tools.getTextFromSeconds(params.expires || 86400, false, true)]
			]
		});
		println('\n ' + this.color('theme').bold('SERVER INSTALL COMMAND') + '\n\n ' + install);
		
		this.printSuggestedCommands({
			'List active servers': 'xy servers',
			'Generate a Windows installer': 'xy server add --platform windows',
			'Generate a Docker installer': 'xy server add --platform docker',
			'Search server history': 'xy server search'
		});
	},
	
	async cmd_search_servers() {
		// Database search uses Unbase query syntax.  Positional text is preserved as
		// a raw query, while named options provide a safer shorthand for indexed
		// fields documented by xyOps.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var query_parts = [];
		if (this.args.other.length) query_parts.push(this.args.other.join(' ').trim());
		delete this.args.other;
		if ('query' in this.args) {
			if ((typeof(this.args.query) != 'string') || !this.args.query.trim()) this.die('Server search query must be a non-empty string.');
			query_parts.push(this.args.query.trim());
			delete this.args.query;
		}
		
		var aliases = {
			group: 'groups',
			os: 'os_platform',
			platform: 'os_platform',
			distro: 'os_distro',
			release: 'os_release',
			arch: 'os_arch',
			virt: 'cpu_virt',
			cpu: 'cpu_brand'
		};
		Object.keys(this.args).forEach( key => {
			var field = aliases[key] || key;
			if (!SERVER_SEARCH_FIELDS.includes(field)) {
				var choices = SERVER_SEARCH_FIELDS.concat(Object.keys(aliases), ['query']);
				var suggestion = this.findClosestString(key, choices);
				this.die('Unsupported server search option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
			}
			
			var values = this.parseServerList(this.args[key], key);
			if (!values.length) this.die('Server search option cannot be empty: --' + key);
			if (field == 'groups') values = values.map( value => this.resolveServerGroup(value) );
			if ((field == 'created') || (field == 'modified')) {
				values.forEach( value => query_parts.push(this.getDateRangeQuery(field, value) || (field + ':' + value)) );
			}
			else {
				query_parts.push(field + ':' + values.map( this.quoteServerQueryValue ).join('|'));
			}
		});
		
		var query = query_parts.filter( part => !!part ).join(' ').trim() || '*';
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Searching Servers...') });
		var { err, data } = await this.api.searchServers({
			query: query,
			offset: this.offset,
			limit: this.limit
		});
		cli.progress.end();
		if (err) this.die(err);
		
		var rows = (data.rows || []).map( server => {
			return this.servers[server.id] ? Object.assign({}, server) : Object.assign({}, server, { offline: true });
		});
		if (this.format.match(/json/)) return this.jsonOutput(rows);
		
		this.printPaginatedBoxTable({
			title: query == '*' ? 'All Historical Servers' : 'Server Search Results',
			header: ['Server ID', 'Server', 'Status', 'IP Address', 'OS', 'Arch', 'Groups', 'Created', 'Modified'],
			rows: rows,
			list: data.list || { length: rows.length },
			offset: this.offset,
			limit: this.limit
		}, server => this.getServerTableRow(server, false));
		
		this.printSuggestedCommands({
			'Search by operating system': 'xy server search --os_platform linux',
			'Search by architecture': 'xy server search --os_arch arm64',
			'List active servers': 'xy servers'
		});
	},
	
	printServerHistoricalSummary(server, snapshot) {
		// Historical pages use the compact three-row summary from the web UI.
		// Hardware values come from the latest stored Server monitor record.
		var info = this.getServerRecordInfo(server);
		var data = snapshot.data || {};
		var memory = data.memory || data.mem || info.memory || {};
		var cpu = data.cpu || info.cpu || {};
		var os_data = data.os || {};
		var os = [os_data.distro || os_data.platform || data.platform || info.distro || info.platform, os_data.release || data.release || info.release].filter( item => !!item ).join(' ') || gray('(Unknown)');
		var groups = (server.groups || []).map( id => this.getNiceGroup(id) ).join(', ') || gray('(None)');
		var cpu_type = cpu.combo || cpu.brand || cpu.vendor || gray('(Unknown)');
		var virt = info.virt.vendor || info.virt.type || gray('(None)');
		
		this.printBoxList({
			title: 'Server Summary',
			rows: [
				['Server ID', this.color('theme').bold(server.id)],
				['Server Hostname', server.hostname || gray('(Unknown)')],
				['Server IP', info.ip || snapshot.ip || gray('(Unknown)')],
				['Server Label', server.title || 'n/a'],
				['Groups', groups],
				['Architecture', data.arch || os_data.arch || info.arch || gray('(Unknown)')],
				['Operating System', os],
				['Server Uptime', Tools.getTextFromSeconds(data.uptime_sec || 0, false, true)],
				['Total RAM', this.formatServerBytes(memory.total || 0)],
				['CPU Cores', Tools.commify(cpu.physicalCores || 0) + ' physical, ' + Tools.commify(cpu.cores || 0) + ' virtual'],
				['CPU Type', cpu_type],
				['Virtualization', virt]
			]
		});
	},
	
	printServerHistoricalMonitorCharts(server, rows, range) {
		// Unlike the live one-hour monitor view, the historical API has already
		// selected the exact requested range, so no additional pruning is needed.
		var monitors = this.getVisibleServerMonitors(server);
		println('\n ' + this.color('theme').bold('SERVER MONITORS - ' + range.title.toUpperCase()));
		if (!monitors.length) {
			println(' ' + gray('No visible monitors apply to this server.'));
			return;
		}
		if (!rows.length) {
			println(' ' + gray('No monitoring data found in the selected range.'));
			return;
		}
		
		monitors.forEach( (def, idx) => {
			var data = this.getServerMonitorChartData(rows, def);
			println('\n' + cli.chart({
				title: def.title,
				data: data,
				dataType: def.data_type,
				dataSuffix: def.suffix || '',
				minVertScale: def.min_vert_scale || 0,
				delta: !!def.delta,
				deltaMinValue: def.delta_min_value ?? false,
				divideByDelta: !!def.divide_by_delta,
				height: 10,
				indent: 1,
				color: this.getServerChartColor(idx)
			}));
		});
	},
	
	printServerHistoricalAlerts(result, range) {
		if (!result.rows.length) {
			println('\n ' + this.color('theme').bold(('Server Alerts - ' + range.title).toUpperCase()));
			println(' ' + gray('No server alerts found in the selected range.'));
			return;
		}
		
		this.printPaginatedBoxTable({
			title: 'Server Alerts - ' + range.title,
			header: ['Alert ID', 'Title', 'Message', 'Server', 'Status', 'Started', 'Duration'],
			rows: result.rows,
			list: result.list,
			offset: this.offset,
			limit: this.limit
		}, alert => {
			var completed = alert.active ? this.epoch : (alert.modified || alert.date);
			var message = String(alert.message || '').replace(/\s+/g, ' ').trim();
			return [
				this.color('theme').bold(alert.id),
				this.getNiceAlert(alert.alert),
				message,
				this.getNiceServer(alert.server),
				this.getNiceAlertStatus(alert),
				this.getRelativeDateTime(alert.date, true),
				Tools.getTextFromSeconds(Math.max(0, completed - alert.date), true, true)
			];
		});
	},
	
	printServerHistoricalJobs(result, range) {
		if (!result.rows.length) {
			println('\n ' + this.color('theme').bold(('Server Jobs - ' + range.title).toUpperCase()));
			println(' ' + gray('No completed server jobs found in the selected range.'));
			return;
		}
		
		this.printPaginatedBoxTable({
			title: 'Server Jobs - ' + range.title,
			header: ['Job ID', 'Server', 'Source', 'Started', 'Elapsed', 'Avg CPU/Mem', 'Result'],
			rows: result.rows,
			list: result.list,
			offset: this.offset,
			limit: this.limit
		}, job => {
			var avg_cpu = (job.cpu && job.cpu.count) ? (job.cpu.total / job.cpu.count) : 0;
			var avg_mem = (job.mem && job.mem.count) ? (job.mem.total / job.mem.count) : 0;
			return [
				this.color('theme').bold(this.getNiceJob(job)),
				this.getNiceServer(job.server),
				this.getNiceJobSource(job),
				this.getRelativeDateTime(job.started, true),
				this.getNiceJobElapsedTime(job, true, true),
				this.formatServerPercent(avg_cpu) + ' / ' + this.formatServerBytes(avg_mem),
				this.getNiceJobResult(job)
			];
		});
	},
	
	printServerSummary(server, snapshot, online) {
		// Match the four rows of the web UI summary while adapting them to a
		// compact terminal definition list.
		var info = this.getServerRecordInfo(server);
		var data = snapshot.data || {};
		var day = (((this.stats || {}).currentDay || {}).servers || {})[server.id] || {};
		var completed = day.job_complete || 0;
		var success = day.job_success || 0;
		var groups = (server.groups || []).map( id => this.getNiceGroup(id) ).join(', ') || gray('(None)');
		var cpu_type = info.cpu.combo || info.cpu.brand || info.cpu.vendor || gray('(Unknown)');
		var virt = info.virt.vendor || info.virt.type || gray('(None)');
		var os = [info.distro || info.platform, info.release].filter( item => !!item ).join(' ') || gray('(Unknown)');
		var status = online ? green('Online (Live)') : gray('Offline (Last Known State)');
		
		this.printBoxList({
			title: 'Server Summary',
			rows: [
				['Status', status],
				!online && snapshot.date ? ['Last Updated', this.getRelativeDateTime(snapshot.date, true)] : null,
				['Server ID', this.color('theme').bold(server.id)],
				server.title ? ['Title', bold(server.title)] : null,
				['Server Hostname', server.hostname || gray('(Unknown)')],
				['Server IP', info.ip || gray('(Unknown)')],
				['xySat Version', info.satellite ? ('v' + info.satellite.replace(/^v/, '')) : gray('(Unknown)')],
				['Groups (' + (server.autoGroup ? 'Auto' : 'Manual') + ')', groups],
				['Architecture', info.arch || gray('(Unknown)')],
				['Operating System', os],
				['Uptime', Tools.getTextFromSeconds(data.uptime_sec || 0, false, true)],
				['Total RAM', this.formatServerBytes(info.memory.total || 0)],
				['CPU Cores', Tools.commify(info.cpu.physicalCores || 0) + ' physical, ' + Tools.commify(info.cpu.cores || 0) + ' virtual'],
				['CPU Type', cpu_type],
				['Virtualization', virt],
				['Alerts Today', Tools.commify(day.alert_new || 0)],
				['Jobs Today', Tools.commify(completed)],
				['Jobs Failed Today', Tools.commify(day.job_error || 0)],
				['Job Success Rate', Tools.pct(success / (completed || 1))]
			]
		});
	},
	
	printServerAlerts(server, snapshot, online) {
		// Offline snapshots can preserve the alerts that were active when the
		// Server disappeared.  Live views use the current getMultiple collection.
		var alerts = online ? Object.values(this.activeAlerts || {}).filter( alert => alert.server == server.id ) : (snapshot.alerts || []).filter( alert => alert.server == server.id );
		alerts.sort( (a, b) => (b.date || 0) - (a.date || 0) );
		
		this.printPaginatedBoxTable({
			title: 'Server Alerts',
			header: ['Alert ID', 'Title', 'Message', 'Status', 'Started', 'Duration'],
			rows: alerts.slice(this.offset, this.offset + this.limit),
			list: { length: alerts.length },
			offset: this.offset,
			limit: this.limit
		}, alert => [
			this.color('theme').bold(alert.id || '(Unknown)'),
			this.getNiceAlert(alert.alert, false),
			alert.message || '',
			this.getNiceAlertStatus(alert),
			alert.date ? this.getNiceDateTime(alert.date) : gray('(Unknown)'),
			Tools.getTextFromSeconds(Math.max(0, (alert.end || this.epoch) - (alert.date || this.epoch)), true, true)
		]);
	},
	
	printServerJobs(server) {
		// Active jobs are already decorated by getMultiple, so reuse the standard
		// job renderer for consistent event, category and progress formatting.
		var jobs = Object.values(this.activeJobs || {}).filter( job => job.server == server.id );
		jobs.sort( (a, b) => (b.started || 0) - (a.started || 0) );
		this.printActiveJobs({ title: 'Server Jobs', rows: jobs.slice(this.offset, this.offset + this.limit) });
	},
	
	printServerQuickmonCharts(server, rows) {
		var definitions = (this.config.quick_monitors || []).filter( def => {
			return !def.groups || !def.groups.length || this.includesAny(server.groups || [], def.groups);
		});
		if (!definitions.length) return;
		
		println('\n ' + this.color('theme').bold('QUICK LOOK - LAST MINUTE'));
		definitions.forEach( (def, idx) => {
			var data = rows.map( row => {
				// Current xyOps rows are keyed by monitor ID.  The source fallback also
				// supports unflattened samples and custom monitor implementations.
				var value = Tools.getPath(row, def.source);
				if (typeof(value) != 'number') value = row[def.id];
				return { x: row.date, y: (typeof(value) == 'number') ? value : 0 };
			});
			println('\n' + cli.chart({
				title: def.title,
				data: data,
				dataType: def.type,
				dataSuffix: def.suffix || '',
				minVertScale: def.min_vert_scale || 0,
				delta: !!def.delta,
				deltaMinValue: def.delta_min_value ?? false,
				divideByDelta: !!def.divide_by_delta,
				height: 10,
				indent: 1,
				color: this.getServerChartColor(idx)
			}));
		});
	},
	
	printServerMemory(data) {
		var memory = data.memory || data.mem || {};
		var total = memory.total || 0;
		var metrics = [
			['Memory Used', 'used'],
			['Memory Active', 'active'],
			['Memory Available', 'available'],
			['Memory Free', 'free'],
			['Memory Buffered', 'buffers'],
			['Memory Cached', 'cached']
		];
		
		this.printBoxTable({
			title: 'Memory Details',
			header: ['Metric', 'Value', 'Visual'],
			rows: total ? metrics.map( metric => {
				var value = Math.max(0, memory[metric[1]] || 0);
				return [metric[0], this.formatServerBytes(value), cli.progress.bar({ amount: value, max: total || 1, width: 30, pct: false })];
			}) : []
		});
	},
	
	printServerCPU(data) {
		var cpu = data.cpu || {};
		var cpus = cpu.cpus || [];
		
		this.printBoxTable({
			title: 'CPU Details',
			header: ['CPU #', 'User %', 'System %', 'Nice %', 'I/O Wait %', 'Hard IRQ %', 'Soft IRQ %', 'Total %'],
			rows: cpus.map( (item, idx) => {
				var total = Math.max(0, Math.min(100, 100 - (item.idle || 0)));
				return [
					'#' + (idx + 1),
					this.formatServerPercent(item.user),
					this.formatServerPercent(item.system),
					this.formatServerPercent(item.nice),
					this.formatServerPercent(item.iowait),
					this.formatServerPercent(item.irq),
					this.formatServerPercent(item.softirq),
					cli.progress.bar({ amount: total, max: 100, width: 20, pct: true })
				];
			})
		});
	},
	
	printServerMonitorGrid(server, data) {
		var monitors = this.getVisibleServerMonitors(server);
		if (!monitors.length) return;
		var units = monitors.map( def => {
			var value = def.delta ? ((data.deltas || {})[def.id] || 0) : ((data.monitors || {})[def.id] || 0);
			return [this.getServerMonitorLabel(def.title), this.formatServerMetric(value, def.data_type, def.suffix)];
		});
		
		println('\n ' + this.color('theme').bold('SERVER MONITOR SUMMARY'));
		println('' + cli.dashGrid(units, {
			minCols: 3,
			maxCols: 6,
			gap: 1,
			indent: 1,
			valueStyles: ['bold', 'green']
		}));
	},
	
	printServerMonitorCharts(server, rows, online) {
		var monitors = this.getVisibleServerMonitors(server);
		if (!monitors.length) return;
		var min_epoch = rows.length ? rows[rows.length - 1].date - 3600 : 0;
		rows = rows.filter( row => !min_epoch || (row.date >= min_epoch) );
		
		println('\n ' + this.color('theme').bold('SERVER MONITORS - ' + (online ? 'LAST HOUR' : 'LAST KNOWN STATE')));
		monitors.forEach( (def, idx) => {
			var data = this.getServerMonitorChartData(rows, def);
			println('\n' + cli.chart({
				title: def.title,
				data: data,
				dataType: def.data_type,
				dataSuffix: def.suffix || '',
				minVertScale: def.min_vert_scale || 0,
				delta: !!def.delta,
				deltaMinValue: def.delta_min_value ?? false,
				divideByDelta: !!def.divide_by_delta,
				height: 10,
				indent: 1,
				color: this.getServerChartColor(idx)
			}));
		});
	},
	
	printServerContainers(data) {
		var containers = Tools.getPath(data, 'docker.containers') || [];
		if (!containers.length) return;
		containers.sort( (a, b) => (b.cpu || 0) - (a.cpu || 0) );
		
		this.printPaginatedBoxTable({
			title: 'Server Containers',
			header: ['Container Name', 'ID', 'CPU', 'Mem Usage', 'Mem Total', 'Net In', 'Net Out', 'Disk Read', 'Disk Write'],
			rows: containers.slice(this.offset, this.offset + this.limit),
			list: { length: containers.length },
			offset: this.offset,
			limit: this.limit
		}, item => [
			bold(item.name || '(Unknown)'),
			item.id || '',
			this.formatServerPercent(item.cpu),
			this.formatServerBytes(item.mem_usage || 0),
			this.formatServerBytes(item.mem_total || 0),
			this.formatServerBytes(item.net_read || 0),
			this.formatServerBytes(item.net_write || 0),
			this.formatServerBytes(item.disk_read || 0),
			this.formatServerBytes(item.disk_write || 0)
		]);
	},
	
	printServerProcesses(data) {
		var processes = ((data.processes || {}).list || []).slice(0);
		processes.sort( (a, b) => (b.cpu || 0) - (a.cpu || 0) );
		
		this.printPaginatedBoxTable({
			title: 'Server Processes',
			header: ['Command', 'User', 'PID', 'Parent', 'CPU', 'Memory', 'Age', 'State'],
			rows: processes.slice(this.offset, this.offset + this.limit),
			list: { length: processes.length },
			offset: this.offset,
			limit: this.limit
		}, process => [
			bold(this.getServerProcessName(process)),
			process.user || '-',
			process.pid,
			process.parentPid || 'n/a',
			this.formatServerPercent(process.cpu),
			this.formatServerBytes(process.memRss || 0),
			Tools.getTextFromSeconds(process.age || 0, true, true),
			this.getServerTitleCase(process.state || 'unknown')
		]);
	},
	
	printServerProcessDetail(data, pid, detail) {
		detail = detail || this.getServerProcessDetailData(data, pid);
		var process = detail.process;
		var command = (process.path ? process.path.replace(/[\\\/]$/, '') + '/' : '') + (process.command || '');
		if (process.params) command += ' ' + process.params;
		
		this.printBoxList({
			title: 'Process Details',
			rows: [
				['Command', command],
				process.server ? ['Server', this.getNiceServer(process.server)] : null,
				['Process ID', process.pid],
				process.parentPid ? ['Parent PID', process.parentPid] : null,
				['User', process.user || 'n/a'],
				['Group', process.group || 'n/a'],
				['CPU', this.formatServerPercent(process.cpu)],
				['Memory', this.formatServerPercent(process.mem)],
				['Virtual Memory', this.formatServerBytes(process.memVsz || 0)],
				['Resident Memory', this.formatServerBytes(process.memRss || 0)],
				['Age', Tools.getTextFromSeconds(process.age || 0, false, true)],
				['State', this.getServerTitleCase(process.state || 'unknown')],
				['TTY', process.tty || 'n/a'],
				['Priority', (process.priority === undefined) ? 'n/a' : process.priority],
				['Nice', (process.nice === undefined) ? 'n/a' : process.nice],
				['Threads', (process.threads === undefined) ? 'n/a' : process.threads],
				process.job ? ['Job ID', this.getNiceJob(process.job)] : null,
				process.job ? ['Total I/O', this.formatServerBytes(process.disk || 0)] : null,
				process.job ? ['Net Connections', Tools.commify(process.conns || 0)] : null,
				process.job ? ['Net Throughput', this.formatServerBytes(process.net || 0) + '/sec'] : null
			]
		});
		
		var family = detail.family;
		this.printBoxTable({
			title: 'Process Family',
			header: ['Command', 'User', 'PID'],
			rows: family.map( item => [
				' '.repeat((item.indent || 0) * 2) + ((item.indent || 0) ? '\u2514 ' : '') + (item.pid == pid ? bold(this.getServerProcessName(item)) : this.getServerProcessName(item)),
				item.user || '-',
				item.pid
			])
		});
	},
	
	printServerConnections(data) {
		var processes = ((data.processes || {}).list || []);
		var connections = (data.conns || []).slice(0);
		connections.sort( (a, b) => String(a.state || '').localeCompare(String(b.state || '')) );
		
		this.printPaginatedBoxTable({
			title: 'Network Connections',
			header: ['State', 'Protocol', 'Local Address', 'Remote Address', 'Process', 'Bytes In', 'Bytes Out'],
			rows: connections.slice(this.offset, this.offset + this.limit),
			list: { length: connections.length },
			offset: this.offset,
			limit: this.limit
		}, connection => {
			var process = connection.pid ? Tools.findObject(processes, { pid: connection.pid }) : null;
			return [
				this.getServerTitleCase(connection.state || 'unknown'),
				String(connection.type || '').toUpperCase(),
				connection.local_addr || '',
				connection.remote_addr || '',
				process ? this.getServerProcessName(process) : (connection.pid || gray('(None)')),
				this.formatServerBytes(connection.bytes_in || 0),
				this.formatServerBytes(connection.bytes_out || 0)
			];
		});
	},
	
	printServerInterfaces(data) {
		var interfaces = Object.values(data.interfaces || {});
		interfaces.sort( (a, b) => String(a.iface || '').localeCompare(String(b.iface || '')) );
		
		this.printPaginatedBoxTable({
			title: 'Network Interfaces',
			header: ['Name', 'IPv4', 'IPv6', 'State', 'Type', 'Speed', 'Bytes In', 'Bytes Out'],
			rows: interfaces.slice(this.offset, this.offset + this.limit),
			list: { length: interfaces.length },
			offset: this.offset,
			limit: this.limit
		}, item => [
			item.iface || '',
			item.ip4 || 'n/a',
			item.ip6 || 'n/a',
			this.getServerTitleCase(item.operstate || 'unknown'),
			this.getServerTitleCase(item.type || 'unknown'),
			this.formatServerInterfaceSpeed(item.speed),
			this.formatServerBytes(item.rx_sec || 0) + '/sec',
			this.formatServerBytes(item.tx_sec || 0) + '/sec'
		]);
	},
	
	printServerFilesystems(data) {
		var mounts = Object.values(data.mounts || {});
		mounts.sort( (a, b) => String(a.mount || '').localeCompare(String(b.mount || '')) );
		
		this.printPaginatedBoxTable({
			title: 'Filesystems',
			header: ['Mount Point', 'Type', 'Device', 'Total Size', 'Used', 'Available', 'Use %'],
			rows: mounts.slice(this.offset, this.offset + this.limit),
			list: { length: mounts.length },
			offset: this.offset,
			limit: this.limit
		}, item => [
			item.mount || '',
			item.type || '',
			item.fs || '',
			this.formatServerBytes(item.size || 0),
			this.formatServerBytes(item.used || 0),
			this.formatServerBytes(item.available || item.avail || 0),
			cli.progress.bar({ amount: item.use || 0, max: 100, width: 20, pct: true })
		]);
	},
	
	printServerExpansionNotice(title, option) {
		println('\n ' + this.color('theme').bold(title.toUpperCase()));
		println(' ' + gray('(Shown in verbose mode, or add ') + yellow.bold(option) + gray('.)'));
	},
	
	findLocalServer(selector) {
		// Hostname and label resolution are intentionally limited to the two
		// in-memory lists returned by getMultiple.  Historical searches remain explicit.
		if (this.servers[selector]) return this.servers[selector];
		if (this.serverCache[selector]) return this.serverCache[selector];
		var name = String(selector).toLowerCase();
		var matches = server => {
			return (String(server.hostname || '').toLowerCase() == name) || (String(server.title || '').toLowerCase() == name);
		};
		return Object.values(this.servers || {}).find(matches) || Object.values(this.serverCache || {}).find(matches);
	},
	
	parseServerHistoryRange(value) {
		// Parse the compact YYYY[/MM[/DD[/HH]]] syntax in local Server time.
		// JavaScript's calendar constructor handles variable month lengths and DST.
		value = String(value || '');
		if (!value.match(/^\d{4}(?:\/\d{1,2}){0,3}$/)) {
			this.die('Server history date must use YYYY, YYYY/MM, YYYY/MM/DD, or YYYY/MM/DD/HH format.');
		}
		var parts = value.split('/').map( part => parseInt(part) );
		var system = Object.keys(SERVER_HISTORY_SYSTEMS).map( key => Object.assign({ mode: key }, SERVER_HISTORY_SYSTEMS[key]) ).find( item => item.parts == parts.length );
		var year = parts[0];
		var month = parts[1] || 1;
		var day = parts[2] || 1;
		var hour = (parts[3] === undefined) ? 0 : parts[3];
		if ((year < 1970) || (year > 9999) || (month < 1) || (month > 12) || (day < 1) || (day > 31) || (hour < 0) || (hour > 23)) {
			this.die('Invalid server history date: ' + value);
		}
		
		var start_date = new Date(year, month - 1, day, hour, 0, 0, 0);
		if ((start_date.getFullYear() != year) || (start_date.getMonth() != month - 1) || (start_date.getDate() != day) || (start_date.getHours() != hour)) {
			this.die('Invalid server history date: ' + value);
		}
		
		var end_date = null;
		switch (system.mode) {
			case 'yearly': end_date = new Date(year + 1, 0, 1, 0, 0, 0, 0); break;
			case 'monthly': end_date = new Date(year, month, 1, 0, 0, 0, 0); break;
			case 'daily': end_date = new Date(year, month - 1, day + 1, 0, 0, 0, 0); break;
			case 'hourly': end_date = new Date(year, month - 1, day, hour + 1, 0, 0, 0); break;
		}
		
		var start = Math.floor(start_date.getTime() / 1000);
		var end = Math.floor(end_date.getTime() / 1000);
		var monitor_start = Math.ceil(start / system.epoch_div) * system.epoch_div;
		var pad = number => String(number).padStart(2, '0');
		var timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		return {
			mode: system.mode,
			input: value,
			title: this.formatServerHistoryTitle(start, system.mode, timezone),
			timezone: timezone,
			start: start,
			end: end,
			monitor_start: monitor_start,
			monitor_limit: Math.max(1, Math.ceil((end - monitor_start) / system.epoch_div)),
			examples: {
				hourly: year + '/' + pad(month) + '/' + pad(day) + '/' + pad(hour),
				daily: year + '/' + pad(month) + '/' + pad(day),
				monthly: year + '/' + pad(month),
				yearly: String(year)
			}
		};
	},
	
	formatServerHistoryTitle(epoch, mode, timezone) {
		var options = { year: 'numeric', timeZone: timezone };
		if (mode != 'yearly') options.month = 'long';
		if ((mode == 'daily') || (mode == 'hourly')) options.day = 'numeric';
		if (mode == 'hourly') options.hour = 'numeric';
		options = this.getDateOptions(options);
		var locale = options.locale;
		delete options.locale;
		return new Intl.DateTimeFormat(locale, options).format( new Date(epoch * 1000) );
	},
	
	getServerMonitorChartData(rows, def) {
		var data = rows.filter( row => row.date && row.totals ).map( row => {
			return { x: row.date, y: ((row.totals[def.id] || 0) / (row.count || 1)) };
		});
		
		// A partial final delta bucket cannot be averaged reliably.
		if (def.delta && (rows.length > 1) && (rows[rows.length - 1].count < rows[rows.length - 2].count)) data.pop();
		return data;
	},
	
	getVisibleServerMonitors(server) {
		return (this.monitors || []).filter( def => {
			return def.display && (!def.groups || !def.groups.length || this.includesAny(def.groups, server.groups || []));
		}).sort( (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.title).localeCompare(String(b.title)) );
	},
	
	getServerMonitorLabel(title) {
		return String(title || '')
			.replace(/\bTotal\b/g, '')
			.replace(/\bAverage\b/g, 'Avg')
			.replace(/\bOperations\b/g, 'Ops')
			.replace(/\bConnections\b/g, 'Conns')
			.replace(/\bAvailable\b/g, 'Avail')
			.replace(/\bMemory\b/g, 'Mem')
			.replace(/\(.+\)/g, '')
			.replace(/%/g, '')
			.replace(/\s+/g, ' ').trim();
	},
	
	formatServerMetric(value, type, suffix) {
		value = Math.max(0, Number(value) || 0);
		var output = '';
		switch (type) {
			case 'integer': output = this.formatServerCompactNumber(value); break;
			case 'float': output = this.formatServerNumber(value); break;
			case 'bytes': output = this.formatServerCompactBytes(value); break;
			case 'seconds': output = Tools.getTextFromSeconds(value, false, true); break;
			case 'milliseconds': output = (value < 1000) ? (this.formatServerNumber(value) + ' ms') : Tools.getTextFromSeconds(value / 1000, false, true); break;
			default: output = this.formatServerNumber(value); break;
		}
		if (suffix) output += String(suffix).replace(/^\s*\/(\w)\w+$/, '/$1');
		return output;
	},
	
	formatServerBytes(value) {
		return Tools.getTextFromBytes(Math.max(0, Number(value) || 0), 1).replace(/bytes/i, 'B');
	},
	
	formatServerCompactBytes(value) {
		var units = ['B', 'K', 'M', 'G', 'T', 'P'];
		value = Math.max(0, Number(value) || 0);
		var idx = 0;
		while ((value >= 1024) && (idx < units.length - 1)) { value /= 1024; idx++; }
		return this.formatServerNumber(value) + units[idx];
	},
	
	formatServerCompactNumber(value) {
		var units = ['', 'K', 'M', 'B', 'T'];
		value = Math.max(0, Number(value) || 0);
		var idx = 0;
		while ((value >= 1000) && (idx < units.length - 1)) { value /= 1000; idx++; }
		return this.formatServerNumber(value) + units[idx];
	},
	
	formatServerNumber(value) {
		return String(Math.round((Number(value) || 0) * 100) / 100);
	},
	
	formatServerPercent(value) {
		return this.formatServerNumber(value) + '%';
	},
	
	formatServerInterfaceSpeed(speed) {
		if (!speed) return 'n/a';
		if (speed >= 1000000) return Math.floor(speed / 1000000) + ' Tb';
		if (speed >= 1000) return Math.floor(speed / 1000) + ' Gb';
		return speed + ' Mb';
	},
	
	getServerChartColor(idx) {
		var colors = ['green', 'cyan', 'yellow', 'magenta', 'blue', 'red'];
		return colors[idx % colors.length];
	},
	
	getServerProcessName(process) {
		if (process.name) {
			if ((process.name == 'svchost.exe') && process.command && process.command.match(/\s+\-s\s+(\S+)/)) return RegExp.$1;
			return process.name;
		}
		var command = String(process.command || '');
		command = command.replace(/\s[\-\(\/\*].*$/, '');
		if (command.match(/^\w:\\/)) command = command.replace(/\\$/, '').replace(/^(.*)\\([^\\]+)$/, '$2');
		else if (command.match(/^\//)) command = command.replace(/\/$/, '').replace(/^.*\//, '');
		if ((command.length > 32) && command.match(/\s/)) command = command.replace(/:?\s.*$/, '');
		return command.replace(/:\s+.*/, '') || '(Unknown)';
	},
	
	getServerProcessFamily(processes, selected) {
		var rows = [Object.assign({}, selected)];
		var visited = { [selected.pid]: true };
		var add_children = (parent, indent) => {
			processes.filter( item => item.parentPid == parent.pid ).forEach( item => {
				if (visited[item.pid]) return;
				visited[item.pid] = true;
				rows.push( Object.assign({}, item, { indent: indent }) );
				add_children(item, indent + 1);
			});
		};
		add_children(selected, 1);
		
		var process = selected;
		while (process.parentPid) {
			var parent = Tools.findObject(processes, { pid: process.parentPid });
			if (!parent || visited[parent.pid]) break;
			visited[parent.pid] = true;
			rows.forEach( item => { item.indent = (item.indent || 0) + 1; } );
			rows.unshift( Object.assign({}, parent) );
			process = parent;
		}
		return rows;
	},
	
	getServerProcessDetailData(data, pid) {
		var processes = ((data.processes || {}).list || []);
		var process = Tools.findObject(processes, { pid: pid });
		if (!process) this.die('Could not find process ID ' + pid + ' in the latest server data.');
		return {
			process: process,
			family: this.getServerProcessFamily(processes, process)
		};
	},
	
	getServerTitleCase(value) {
		return String(value).split(/[_\s]+/).filter( word => !!word ).map( word => word.substring(0, 1).toUpperCase() + word.substring(1).toLowerCase() ).join(' ');
	},
	
	getServerTableRow(server, active_view) {
		var info = this.getServerRecordInfo(server);
		var num_jobs = Object.values(this.activeJobs || {}).filter( job => job.server == server.id ).length;
		var num_alerts = Object.values(this.activeAlerts || {}).filter( alert => alert.server == server.id ).length;
		var status = server.offline ? gray('Offline') : (server.enabled ? green('Online') : yellow('Disabled'));
		var os = [info.distro || info.platform, info.release].filter( item => !!item ).join(' ') || gray('(Unknown)');
		var groups = (server.groups || []).length ? server.groups.map( id => this.getNiceGroup(id) ).join(', ') : gray('(None)');
		var row = [
			this.color('theme').bold(server.id),
			bold(server.title || server.hostname || server.id),
			status,
			info.ip || gray('(Unknown)'),
			os,
			info.arch || gray('(Unknown)'),
			groups
		];
		
		if (active_view) {
			row.push(
				Tools.commify(info.cpu.cores || 0),
				Tools.getTextFromBytes(info.memory.total || 0, 1).replace(/bytes/, 'B'),
				Tools.commify(num_jobs),
				Tools.commify(num_alerts)
			);
		}
		else {
			row.push(
				this.getRelativeDateTime(server.created, true),
				this.getRelativeDateTime(server.modified, true)
			);
		}
		return row;
	},
	
	getServerRecordInfo(server) {
		// Active, cached and indexed server records have evolved slightly over
		// time, so tolerate architecture and IP data in either documented location.
		var info = server.info || {};
		var os = info.os || {};
		return {
			ip: info.ip || server.ip || '',
			platform: os.platform || info.platform || '',
			distro: os.distro || '',
			release: os.release || info.release || '',
			arch: os.arch || info.arch || '',
			cpu: info.cpu || {},
			memory: info.memory || {},
			virt: info.virt || {},
			satellite: info.satellite || ''
		};
	},
	
	getServerGroupSearchText(server) {
		return (server.groups || []).map( id => {
			var group = Tools.findObject(this.groups, { id: id });
			return id + ' ' + (group ? group.title : '');
		}).join(' ');
	},
	
	getServerSearchText(server) {
		var info = this.getServerRecordInfo(server);
		return [
			server.id, server.title, server.hostname, info.ip,
			info.platform, info.distro, info.release, info.arch,
			info.cpu.brand, info.cpu.combo, info.virt.vendor,
			info.satellite, this.getServerGroupSearchText(server)
		].filter( item => !!item ).join(' ').toLowerCase();
	},
	
	parseServerBoolean(value, label) {
		if (typeof(value) != 'boolean') this.die('Server --' + label + ' must be true or false.');
		return value;
	},
	
	parseServerList(value, label) {
		var values = Array.isArray(value) ? value.slice(0) : String(value == null ? '' : value).split(',');
		values = values.map( item => String(item).trim() ).filter( item => !!item );
		return Array.from(new Set(values));
	},
	
	resolveServerGroup(selector) {
		var group = Tools.findObject(this.groups, { id: selector }) || this.findObjectFuzzy(this.groups, { title: selector });
		if (!group) this.die('Could not find server Group: ' + selector);
		return group.id;
	},
	
	quoteServerQueryValue(value) {
		value = String(value);
		return value.match(/\s/) ? '"' + value.replace(/"/g, '\\"') + '"' : value;
	}
	
};
