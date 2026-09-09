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
		
		var show_monitors = this.verbose || !!this.args.monitors;
		var show_processes = this.verbose || !!this.args.processes;
		var show_connections = this.verbose || !!this.args.connections;
		var pid = this.args.pid;
		
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
			var choices = ['monitors', 'processes', 'connections', 'pid'];
			var suggestion = this.findClosestString(key, choices);
			this.die('Unsupported Server view option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
		}
		
		await this.getMultiple();
		var local_server = this.findLocalServer(selector);
		var id = local_server ? local_server.id : selector;
		
		cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading Server...') });
		var { err, data: response } = await this.api.getServer({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		
		var server = response.server;
		var snapshot = response.data || {};
		var online = !!response.online;
		var live_data = snapshot.data || {};
		
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
			cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading Server monitoring data...') });
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
			'Search server history': 'xy server search ' + server.hostname
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
				this.die('Unsupported Server list option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
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
				this.die('Unknown Server Group ID: "' + id + '".' + (suggestion ? ' Did you mean "' + suggestion + '"?' : ''));
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
		if (Tools.numKeys(this.args)) return this.die('Unsupported Server add option: --' + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('getSatelliteToken', params, { text: 'Generating Server install command...' });
		if (this.dry) return;
		
		var template_key = SERVER_PLATFORMS[platform];
		var templates = (this.config.ui && this.config.ui.satellite_install_commands) || {};
		var template = templates[template_key];
		if (!template) this.die('No Server install command is configured for platform: ' + platform);
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
				this.die('Unsupported Server search option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
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
			var data = rows.filter( row => row.date && row.totals ).map( row => {
				return { x: row.date, y: ((row.totals[def.id] || 0) / (row.count || 1)) };
			});
			
			// A partial final delta bucket cannot be averaged reliably.
			if (def.delta && (rows.length > 1) && (rows[rows.length - 1].count < rows[rows.length - 2].count)) data.pop();
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
		if (!process) this.die('Could not find process ID ' + pid + ' in the latest Server data.');
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
		if (!group) this.die('Could not find Server Group: ' + selector);
		return group.id;
	},
	
	quoteServerQueryValue(value) {
		value = String(value);
		return value.match(/\s/) ? '"' + value.replace(/"/g, '\\"') + '"' : value;
	}
	
};
