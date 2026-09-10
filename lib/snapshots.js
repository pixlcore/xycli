// Snapshot Management Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

const SNAPSHOT_SOURCES = ['alert', 'user', 'watch', 'job'];
const SNAPSHOT_SEARCH_FILTERS = ['source', 'server', 'group'];

module.exports = {
	
	async cmd_snapshots() {
		// Snapshot history has three exact indexed filters and deliberately does
		// not accept free-form search text.  This keeps the CLI aligned with the
		// focused search controls in the web interface.
		this.prepSearchArgs();
		if (this.args.other.length) return this.dieUsage('snapshots');
		delete this.args.other;
		
		Object.keys(this.args).forEach( key => {
			if (!SNAPSHOT_SEARCH_FILTERS.includes(key)) {
				var suggestion = this.findClosestString(key, SNAPSHOT_SEARCH_FILTERS);
				this.die('Unsupported Snapshot search option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
			}
		});
		
		var query = [];
		if ('source' in this.args) {
			var source = String(this.args.source).toLowerCase();
			if (!SNAPSHOT_SOURCES.includes(source)) this.die('Snapshot source must be one of: ' + SNAPSHOT_SOURCES.join(', ') + '.');
			query.push('source:' + source);
		}
		if ('server' in this.args) query.push('server:' + this.validateSnapshotFilterID(this.args.server, 'Server'));
		if ('group' in this.args) query.push('groups:' + this.validateSnapshotFilterID(this.args.group, 'Group'));
		
		await this.getMultiple();
		await this.printSnapshots({
			query: query.join(' ') || '*'
		});
		if (this.format.match(/json/)) return;
		
		this.printSuggestedCommands({
			'View a snapshot': 'xy snapshot SNAPSHOT_ID',
			'Show user snapshots': 'xy snapshots --source user',
			'Show server snapshots': 'xy snapshots --server SERVER_ID',
			'Show group snapshots': 'xy snapshots --group GROUP_ID'
		});
	},
	
	async cmd_snapshot() {
		// A single route handles both Server and Group snapshots.  Load the saved
		// record first, then dispatch according to its documented type property.
		this.prepSearchArgs();
		var id = this.args.other.shift();
		if (!id || this.args.other.length) return this.dieUsage('snapshot');
		delete this.args.other;
		
		id = this.validateSnapshotID(id);
		var show_monitors = this.verbose || !!this.args.monitors;
		var show_processes = this.verbose || !!this.args.processes;
		var show_connections = this.verbose || !!this.args.connections;
		var deleting = !!this.args.delete;
		
		['monitors', 'processes', 'connections', 'delete'].forEach( key => {
			if ((key in this.args) && (typeof(this.args[key]) != 'boolean')) this.die('Snapshot --' + key + ' must be true or false.');
			delete this.args[key];
		});
		
		if (deleting && (show_monitors || show_processes || show_connections)) {
			this.die('Snapshot --delete cannot be combined with detail view options.');
		}
		if (!deleting && ('confirm' in this.args)) this.die('Snapshot --confirm is only supported with --delete.');
		if (!deleting && Tools.numKeys(this.args)) {
			var key = Tools.firstKey(this.args);
			var choices = ['monitors', 'processes', 'connections', 'delete'];
			var suggestion = this.findClosestString(key, choices);
			this.die('Unsupported Snapshot view option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
		}
		
		await this.getMultiple();
		var snapshot = await this.fetchSnapshot(id);
		this.epoch = snapshot.date || this.epoch;
		
		if (deleting) return this.deleteSnapshotFromCLI(snapshot);
		if (snapshot.type == 'group') {
			return this.printGroupSnapshot(snapshot, {
				monitors: show_monitors,
				processes: show_processes,
				connections: show_connections
			});
		}
		return this.printServerSnapshot(snapshot, {
			monitors: show_monitors,
			processes: show_processes,
			connections: show_connections
		});
	},
	
	validateSnapshotID(value) {
		value = String(value || '');
		if (!value.match(/^[a-z0-9]+$/i)) this.die('Snapshot ID must contain only letters and numbers.');
		return value;
	},
	
	validateSnapshotFilterID(value, label) {
		// Server and Group database IDs use the same conservative alphanumeric
		// formats accepted by their resource commands.  Reject query syntax in
		// option values so these switches can only select their documented field.
		var description = label == 'Group' ? 'letters, numbers, and underscores' : 'letters and numbers';
		var pattern = label == 'Group' ? /^[a-z0-9_]+$/i : /^[a-z0-9]+$/i;
		if ((typeof(value) != 'string') && (typeof(value) != 'number')) this.die(label + ' ID must contain only ' + description + '.');
		value = String(value);
		if (!value.match(pattern)) this.die(label + ' ID must contain only ' + description + '.');
		return value;
	},
	
	async fetchSnapshot(id) {
		cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading snapshot...') });
		var { err, data } = await this.api.searchSnapshots({
			query: '#id:' + id,
			offset: 0,
			limit: 1,
			verbose: true
		});
		cli.progress.end();
		if (err) {
			var message = (typeof(err) == 'object') ? err.message : String(err);
			if (String(message).match(/not found/i)) this.die('Could not find Snapshot: ' + id);
			this.die(err);
		}
		
		var snapshot = (data.rows || [])[0];
		if (!snapshot) this.die('Could not find Snapshot: ' + id);
		return snapshot;
	},
	
	async deleteSnapshotFromCLI(snapshot) {
		var target = snapshot.type == 'group' ?
			this.getNiceGroup(snapshot.group_def || (snapshot.groups || [])[0]) :
			this.getNiceServer(this.getSnapshotServer(snapshot));
		
		this.printMutationSummary({
			title: 'Delete ' + (snapshot.type == 'group' ? 'Group ' : '') + 'Snapshot',
			rows: [
				['Snapshot ID', this.color('theme').bold(snapshot.id)],
				['Type', Tools.ucfirst(snapshot.type || 'server')],
				['Target', target],
				['Source', this.getSnapshotSource(snapshot)],
				['Date / Time', this.getRelativeDateTime(snapshot.date, true)]
			]
		});
		
		if (this.args.confirm !== true) {
			this.toast('\u26a0\ufe0f', 'orange', "This will permanently delete the snapshot. Review it above, then add '--confirm' to continue.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) this.die('Unsupported Snapshot delete option: --' + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('deleteSnapshot', { id: snapshot.id }, { text: 'Deleting snapshot...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		
		this.toast('\u2705', 'green', 'Successfully deleted snapshot: #' + snapshot.id);
		this.printSuggestedCommands({ 'List snapshots': 'xy snapshots' });
	},
	
	async fetchSnapshotRecords(snapshot) {
		// Snapshots store Alert and Job IDs so the associated records can continue
		// to use the standard CLI tables.  Preserve API ordering, and discard only
		// error stubs for records that have since been deleted.
		var alert_ids = snapshot.alerts || [];
		var job_ids = snapshot.jobs || [];
		var requests = [];
		var alerts = [];
		var jobs = [];
		
		if (alert_ids.length) requests.push( this.api.getAlertInvocations({ ids: alert_ids }).then( result => {
			if (result.err) throw result.err;
			alerts = (result.data.alerts || []).filter( item => item && !item.err );
		}) );
		if (job_ids.length) requests.push( this.api.getJobs({ ids: job_ids }).then( result => {
			if (result.err) throw result.err;
			jobs = (result.data.jobs || []).filter( item => item && !item.err );
		}) );
		
		if (requests.length) {
			cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading snapshot jobs and alerts...') });
			try { await Promise.all(requests); }
			catch (error) { cli.progress.end(); this.die(error); }
			cli.progress.end();
		}
		return { alerts: alerts, jobs: jobs };
	},
	
	getSnapshotMonitorRequest(server_id, date) {
		// Historical samples are minute-based.  Request 60 samples ending at the
		// normalized snapshot minute so the snap is the far-right chart point.
		var snapshot_minute = Math.floor(date / 60) * 60;
		return {
			server: server_id,
			sys: 'hourly',
			date: snapshot_minute - (59 * 60),
			limit: 60
		};
	},
	
	async fetchServerSnapshotMonitors(server_id, date) {
		cli.progress.start({ amount: 1, pct: false, text: gray('\u2192 Loading snapshot monitor history...') });
		var { err, data } = await this.api.getHistoricalMonitorData(this.getSnapshotMonitorRequest(server_id, date));
		cli.progress.end();
		if (err) this.die(err);
		return (data.rows || []).filter( row => row && row.date && row.totals );
	},
	
	async fetchGroupSnapshotMonitors(servers, date) {
		// Reuse the Group view's bounded worker pool so a large saved fleet never
		// sends more than six historical requests at once.
		return this.mapGroupServersLimit(servers, async server => {
			var result = await this.api.getHistoricalMonitorData(this.getSnapshotMonitorRequest(server.id, date));
			if (result.err) throw result.err;
			return {
				server: server,
				rows: (result.data.rows || []).filter( row => row && row.date && row.totals )
			};
		}, 'Loading snapshot monitor history...');
	},
	
	getSnapshotServer(snapshot) {
		// Prefer the current/cached label when it still exists, while keeping the
		// captured hostname, groups and hardware data authoritative for the view.
		var current = this.servers[snapshot.server] || this.serverCache[snapshot.server] || {};
		var data = snapshot.data || {};
		var info = Object.assign({}, current.info || {}, {
			ip: snapshot.ip || (current.info || {}).ip,
			arch: data.arch || (current.info || {}).arch,
			platform: data.platform || (current.info || {}).platform,
			release: data.release || (current.info || {}).release,
			os: data.os || (current.info || {}).os,
			memory: data.memory || data.mem || (current.info || {}).memory,
			cpu: data.cpu || (current.info || {}).cpu
		});
		return Object.assign({}, current, {
			id: snapshot.server,
			title: current.title || '',
			hostname: snapshot.hostname || current.hostname || snapshot.server,
			groups: snapshot.groups || current.groups || [],
			info: info,
			offline: false
		});
	},
	
	getGroupSnapshotServers(snapshot) {
		// Group arrays are positional by contract.  Decorate copies of the saved
		// Server definitions with their matching point-in-time monitor data.
		return (snapshot.servers || []).map( (saved_server, idx) => {
			var record = (snapshot.snapshots || [])[idx] || {};
			var data = record.data || {};
			var info = Object.assign({}, saved_server.info || {}, {
				ip: record.ip || (saved_server.info || {}).ip,
				arch: data.arch || (saved_server.info || {}).arch,
				platform: data.platform || (saved_server.info || {}).platform,
				release: data.release || (saved_server.info || {}).release,
				os: data.os || (saved_server.info || {}).os,
				memory: data.memory || data.mem || (saved_server.info || {}).memory,
				cpu: data.cpu || (saved_server.info || {}).cpu,
				booted: snapshot.date - (data.uptime_sec || 0)
			});
			return Object.assign({}, saved_server, {
				groups: record.groups || saved_server.groups || [],
				info: info,
				snapshot_record: record,
				quickmon: (snapshot.quickmons || [])[idx] || []
			});
		}).sort(this.sortGroupServers);
	},
	
	getSnapshotSource(snapshot) {
		var source = Tools.ucfirst(String(snapshot.source || 'unknown').toLowerCase());
		if ((snapshot.source == 'user') && snapshot.username) source += ' (' + snapshot.username + ')';
		return source;
	},
	
	getSnapshotOS(data) {
		var os = data.os || {};
		return [os.distro || os.platform || data.platform, os.release || data.release].filter( item => !!item ).join(' ') || gray('(Unknown)');
	},
	
	getSnapshotIP(ip) {
		return String(ip || '').replace(/^::ffff:/, '') || gray('(Unknown)');
	},
	
	printServerSnapshotSummary(snapshot, server) {
		var data = snapshot.data || {};
		var memory = data.memory || data.mem || {};
		var cpu = data.cpu || {};
		var groups = (snapshot.groups || []).map( id => this.getNiceGroup(id) ).join(', ') || gray('(None)');
		var cpu_type = cpu.combo || [cpu.vendor, cpu.brand].filter( item => !!item ).join(' ') || gray('(Unknown)');
		
		this.printBoxList({
			title: 'Snapshot Summary',
			rows: [
				['Snapshot ID', this.color('theme').bold(snapshot.id)],
				['Server', bold(this.getNiceServer(server))],
				['Source', this.getSnapshotSource(snapshot)],
				['Date / Time', this.getRelativeDateTime(snapshot.date, true)],
				['Groups', groups],
				['IP Address', this.getSnapshotIP(snapshot.ip)],
				['Architecture', data.arch || (data.os || {}).arch || gray('(Unknown)')],
				['Operating System', this.getSnapshotOS(data)],
				['Total RAM', this.formatServerBytes(memory.total || 0)],
				['CPU Cores', Tools.commify(cpu.physicalCores || 0) + ' physical, ' + Tools.commify(cpu.cores || 0) + ' virtual'],
				['CPU Type', cpu_type],
				['Server Uptime', Tools.getTextFromSeconds(data.uptime_sec || 0, false, true)]
			]
		});
	},
	
	printGroupSnapshotSummary(snapshot, group, servers) {
		var info = servers.map( server => this.getServerRecordInfo(server) );
		var unique = values => Array.from(new Set(values.filter( value => !!value ))).join(', ') || gray('(None)');
		var oses = info.map( item => [item.distro || item.platform, item.release].filter( value => !!value ).join(' ') );
		var cpu_types = info.map( item => item.cpu.combo || item.cpu.brand || item.cpu.vendor );
		var virts = info.map( item => item.virt.vendor || item.virt.type || 'None' );
		
		this.printBoxList({
			title: 'Group Snapshot Summary',
			rows: [
				['Snapshot ID', this.color('theme').bold(snapshot.id)],
				['Group', bold(this.getNiceGroup(group))],
				['Source', this.getSnapshotSource(snapshot)],
				['Date / Time', this.getRelativeDateTime(snapshot.date, true)],
				['Hostname Match', group.hostname_match == '(?!)' ? gray('(None)') : group.hostname_match],
				['Servers', Tools.commify(servers.length)],
				['Alert Actions', Tools.commify((group.alert_actions || []).length)],
				['Author', group.username || gray('(Unknown)')],
				['Architectures', unique(info.map( item => item.arch ))],
				['Operating Systems', unique(oses)],
				['CPU Types', unique(cpu_types)],
				['Virtualization', unique(virts)]
			]
		});
	},
	
	printSnapshotAlerts(alerts, group_mode) {
		// Alert tables match the existing Server and Group views.  Server snapshots
		// omit the redundant Server column, while Group snapshots retain it.
		if (!alerts.length) return;
		alerts.sort( (a, b) => (b.date || 0) - (a.date || 0) );
		var header = ['Alert ID', 'Title', 'Message'];
		if (group_mode) header.push('Server');
		header.push('Status', 'Started', 'Duration');
		
		this.printPaginatedBoxTable({
			title: 'Snapshot Alerts',
			header: header,
			rows: alerts.slice(this.offset, this.offset + this.limit),
			list: { length: alerts.length },
			offset: this.offset,
			limit: this.limit
		}, alert => {
			var row = [
				this.color('theme').bold(alert.id || '(Unknown)'),
				this.getNiceAlert(alert.alert),
				alert.message || ''
			];
			if (group_mode) row.push(this.getNiceServer(alert.server));
			row.push(
				this.getNiceAlertStatus(alert),
				alert.date ? this.getNiceDateTime(alert.date) : gray('(Unknown)'),
				Tools.getTextFromSeconds(Math.max(0, (alert.end || this.epoch) - (alert.date || this.epoch)), true, true)
			);
			return row;
		});
	},
	
	printSnapshotJobs(jobs) {
		jobs.sort( (a, b) => (b.started || 0) - (a.started || 0) );
		this.printActiveJobs({
			title: 'Snapshot Jobs',
			rows: jobs.slice(this.offset, this.offset + this.limit)
		});
	},
	
	async printServerSnapshot(snapshot, options) {
		var server = this.getSnapshotServer(snapshot);
		var related = await this.fetchSnapshotRecords(snapshot);
		var monitor_rows = options.monitors ? await this.fetchServerSnapshotMonitors(server.id, snapshot.date) : [];
		var output = {
			snapshot: snapshot,
			server: server,
			alerts: related.alerts,
			jobs: related.jobs,
			monitors: monitor_rows
		};
		if (this.format.match(/json/)) return this.jsonOutput(output);
		
		println('\n ' + green.bold('SERVER SNAPSHOT - POINT-IN-TIME VIEW'));
		this.printServerSnapshotSummary(snapshot, server);
		this.printSnapshotAlerts(related.alerts, false);
		this.printSnapshotJobs(related.jobs);
		if ((snapshot.quickmon || []).length) this.printServerQuickmonCharts(server, snapshot.quickmon, 'QUICK LOOK - MINUTE LEADING TO SNAPSHOT');
		
		var data = snapshot.data || {};
		if (!data.dummy) {
			this.printServerMemory(data);
			this.printServerCPU(data);
			this.printServerMonitorGrid(server, data);
			
			if (options.monitors) this.printServerMonitorCharts(server, monitor_rows, false, 'SERVER MONITORS - HOUR LEADING TO SNAPSHOT');
			else this.printServerExpansionNotice('Snapshot Monitors', '--monitors');
			
			this.printServerContainers(data);
			
			if (options.processes) this.printServerProcesses(data);
			else this.printServerExpansionNotice('Snapshot Processes', '--processes');
			
			if (options.connections) this.printServerConnections(data);
			else this.printServerExpansionNotice('Snapshot Network Connections', '--connections');
			
			this.printServerInterfaces(data);
			this.printServerFilesystems(data);
		}
		
		this.printSuggestedCommands({
			'Show snapshot monitors': options.monitors ? '' : 'xy snapshot ' + snapshot.id + ' --monitors',
			'Show snapshot processes': options.processes ? '' : 'xy snapshot ' + snapshot.id + ' --processes',
			'Show snapshot connections': options.connections ? '' : 'xy snapshot ' + snapshot.id + ' --connections',
			'Show all snapshot details': this.verbose ? '' : 'xy snapshot ' + snapshot.id + ' --verbose',
			'Delete this snapshot': 'xy snapshot ' + snapshot.id + ' --delete',
			'List snapshots': 'xy snapshots'
		});
	},
	
	async printGroupSnapshot(snapshot, options) {
		var group = snapshot.group_def || { id: (snapshot.groups || [])[0], title: (snapshot.groups || [])[0] };
		var servers = this.getGroupSnapshotServers(snapshot);
		var related = await this.fetchSnapshotRecords(snapshot);
		var historical = options.monitors ? await this.fetchGroupSnapshotMonitors(servers, snapshot.date) : [];
		var history_by_server = {};
		historical.forEach( item => { history_by_server[item.server.id] = item.rows; } );
		
		var saved_by_server = {};
		(snapshot.snapshots || []).forEach( record => { saved_by_server[record.server] = record; } );
		var data_rows = servers.map( server => ({
			server: server,
			data: (saved_by_server[server.id] || {}).data || {},
			rows: history_by_server[server.id] || []
		}));
		var quickmon = {};
		servers.forEach( server => { quickmon[server.id] = server.quickmon || []; } );
		
		var output = {
			snapshot: snapshot,
			group: group,
			servers: servers,
			alerts: related.alerts,
			jobs: related.jobs,
			monitors: historical
		};
		if (this.format.match(/json/)) return this.jsonOutput(output);
		
		// The existing Group tables derive counts from these collections.  Replace
		// the live collections with the records captured by this saved snapshot.
		this.activeAlerts = Object.fromEntries(related.alerts.map( item => [item.id, item] ));
		this.activeJobs = Object.fromEntries(related.jobs.map( item => [item.id, item] ));
		
		println('\n ' + green.bold('GROUP SNAPSHOT - POINT-IN-TIME VIEW'));
		this.printGroupSnapshotSummary(snapshot, group, servers);
		this.printGroupServers(servers, false);
		this.printSnapshotAlerts(related.alerts, true);
		this.printSnapshotJobs(related.jobs);
		this.printGroupQuickmonCharts(group, servers, quickmon, 'average', 'GROUP QUICK LOOK - MINUTE LEADING TO SNAPSHOT', true);
		this.printGroupMemory(data_rows, 'average');
		this.printGroupCPU(data_rows, 'average');
		this.printGroupMonitorGrid(group, data_rows, 'average');
		
		if (options.monitors) this.printGroupMonitorCharts(group, data_rows, 'average', 'live', null, 'GROUP MONITORS - HOUR LEADING TO SNAPSHOT');
		else this.printServerExpansionNotice('Snapshot Monitors', '--monitors');
		
		this.printGroupContainers(data_rows);
		
		if (options.processes) this.printGroupProcesses(data_rows);
		else this.printServerExpansionNotice('Snapshot Processes', '--processes');
		
		if (options.connections) this.printGroupConnections(data_rows);
		else this.printServerExpansionNotice('Snapshot Network Connections', '--connections');
		
		this.printSuggestedCommands({
			'Show snapshot monitors': options.monitors ? '' : 'xy snapshot ' + snapshot.id + ' --monitors',
			'Show snapshot processes': options.processes ? '' : 'xy snapshot ' + snapshot.id + ' --processes',
			'Show snapshot connections': options.connections ? '' : 'xy snapshot ' + snapshot.id + ' --connections',
			'Show all snapshot details': this.verbose ? '' : 'xy snapshot ' + snapshot.id + ' --verbose',
			'Delete this snapshot': 'xy snapshot ' + snapshot.id + ' --delete',
			'List snapshots': 'xy snapshots'
		});
	}
	
};
