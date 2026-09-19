// Server Group Management Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

const GROUP_REQUEST_CONCURRENCY = 6;

const GROUP_VIEW_FILTERS = [
	'id', 'title', 'hostname', 'ip', 'os', 'platform', 'os_platform',
	'distro', 'os_distro', 'release', 'os_release', 'arch', 'os_arch',
	'cpu', 'satellite', 'group', 'groups', 'status', 'online', 'enabled'
];

const GROUP_MERGE_MODES = {
	avg: 'average',
	average: 'average',
	max: 'maximum',
	maximum: 'maximum',
	min: 'minimum',
	minimum: 'minimum',
	total: 'total'
};

const GROUP_MERGE_TITLES = {
	average: 'Average',
	maximum: 'Maximum',
	minimum: 'Minimum',
	total: 'Total'
};

module.exports = {
	
	async cmd_groups() {
		// The plural command lists the cached Group definitions and never needs a
		// second API request beyond getMultiple.
		await this.cmd_get_groups();
	},
	
	async cmd_group() {
		// Named subcommands handle CRUD and history.  A bare ID or title opens the
		// combined live monitoring view.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('group');
		
		switch (cmd) {
			case 'list': await this.cmd_get_groups(); break;
			case 'get': await this.cmd_get_group(); break;
			case 'create': await this.cmd_create_group(); break;
			case 'update': await this.cmd_update_group(); break;
			case 'delete': await this.cmd_delete_group(); break;
			case 'history': await this.cmd_group_history(); break;
			default:
				this.args.other.unshift(cmd);
				await this.cmd_get_group();
			break;
		}
	},
	
	async cmd_get_groups() {
		this.prepSearchArgs();
		await this.getMultiple();
		var groups = this.groups.slice(0);
		var is_filtered = !!this.args.other.length;
		
		if (is_filtered) {
			var search = this.args.other.join(' ');
			groups = this.findObjectsFuzzy(groups, {
				id: search,
				title: search,
				hostname_match: search,
				notes: search
			}, 1);
		}
		delete this.args.other;
		
		if (Tools.numKeys(this.args)) {
			groups = this.findObjectsFuzzy(groups, this.args);
			is_filtered = true;
		}
		
		groups.sort( function(a, b) {
			return ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.title).localeCompare(String(b.title));
		});
		if (this.format.match(/json/)) return this.jsonOutput(groups);
		
		var server_counts = {};
		Object.values(this.servers || {}).forEach( server => {
			(server.groups || []).forEach( id => { server_counts[id] = (server_counts[id] || 0) + 1; } );
		});
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Server Groups' : 'Server Groups',
			header: ['Group ID', 'Title', 'Servers', 'Hostname Pattern', 'Alert Actions', 'Author', 'Modified'],
			rows: groups.slice(this.offset, this.offset + this.limit),
			list: { length: groups.length },
			offset: this.offset,
			limit: this.limit
		}, group => [
			this.color('theme').bold(group.id),
			bold(group.title),
			Tools.commify(server_counts[group.id] || 0),
			group.hostname_match == '(?!)' ? gray('(None)') : group.hostname_match,
			Tools.commify((group.alert_actions || []).length),
			group.username || gray('(Unknown)'),
			this.getRelativeDateTime(group.modified, true)
		]);
		
		this.printSuggestedCommands({
			'View group details': 'xy group GROUP_ID_OR_TITLE',
			'Create a server group': 'xy group create --title "My Group" --hostname_match ".+"',
			'Filter server groups': 'xy groups SEARCH_TEXT'
		});
	},
	
	async cmd_get_group() {
		// Pagination applies to every list section on the page.  Server filters are
		// evaluated locally before any per-server monitoring requests are started.
		this.prepSearchArgs();
		var selector = this.args.other.shift();
		if (!selector) return this.dieUsage('group get');
		var search = this.args.other.join(' ').trim();
		delete this.args.other;
		
		var merge = this.parseGroupMergeMode(this.args.merge);
		var show_monitors = this.verbose || !!this.args.monitors;
		var show_processes = this.verbose || !!this.args.processes;
		var show_connections = this.verbose || !!this.args.connections;
		var upcoming = !!this.args.upcoming;
		
		['monitors', 'processes', 'connections', 'upcoming'].forEach( key => {
			if ((key in this.args) && (typeof(this.args[key]) != 'boolean')) this.die('Group --' + key + ' must be true or false.');
			delete this.args[key];
		});
		delete this.args.merge;
		
		await this.getMultiple();
		var group = this.findGroup(selector);
		var all_servers = this.getGroupServers(group);
		var servers = all_servers.slice(0);
		var is_filtered = !!search;
		
		if (search) {
			servers = servers.filter( server => this.getServerSearchText(server).includes(search.toLowerCase()) );
		}
		Object.keys(this.args).forEach( key => {
			if (!GROUP_VIEW_FILTERS.includes(key)) {
				var choices = GROUP_VIEW_FILTERS.concat(['merge', 'monitors', 'processes', 'connections', 'upcoming']);
				var suggestion = this.findClosestString(key, choices);
				this.die('Unsupported group view option: "--' + key + '".' + (suggestion ? ' Did you mean "--' + suggestion + '"?' : ''));
			}
			servers = this.filterActiveServers(servers, key, this.args[key]);
			is_filtered = true;
		});
		
		// Upcoming mode is deliberately focused.  It avoids every monitoring API
		// call and shows only the stable Group summary and prediction table.
		if (upcoming) {
			if (this.format.match(/json/)) {
				var upcoming_jobs = await this.getGroupUpcomingJobs(group);
				return this.jsonOutput({ group: group, servers: all_servers, upcoming: upcoming_jobs });
			}
			
			println('\n ' + green.bold('LIVE GROUP VIEW - Real-time'));
			this.printGroupSummary(group, all_servers);
			await this.printUpcomingJobs({
				title: 'Upcoming Group Jobs',
				events: this.getGroupEvents(group)
			});
			return;
		}
		
		var quick_result = { servers: {} };
		var quick_request = servers.some( server => !server.offline ) ? this.api.getQuickmonData({ group: group.id }) : null;
		var snapshots = await this.fetchGroupLatestData(servers);
		
		if (quick_request) {
			var quick_response = await quick_request;
			if (quick_response.err) this.die(quick_response.err);
			quick_result = quick_response.data || quick_result;
		}
		
		var output = {
			group: group,
			merge: merge,
			servers: servers,
			snapshots: snapshots,
			quickmon: quick_result.servers || {}
		};
		if (this.format.match(/json/)) return this.jsonOutput(output);
		
		println('\n ' + green.bold('LIVE GROUP VIEW - Real-time'));
		this.printGroupSummary(group, all_servers);
		this.printGroupServers(servers, is_filtered);
		this.printGroupAlerts(group, servers);
		this.printGroupJobs(group, servers);
		this.printGroupQuickmonCharts(group, servers, quick_result.servers || {}, merge);
		this.printGroupMemory(snapshots, merge);
		this.printGroupCPU(snapshots, merge);
		
		if (show_monitors) this.printGroupMonitorCharts(group, snapshots, merge, 'live');
		else this.printServerExpansionNotice('Group Monitors', '--monitors');
		
		this.printGroupContainers(snapshots);
		
		if (show_processes) this.printGroupProcesses(snapshots);
		else this.printServerExpansionNotice('Group Processes', '--processes');
		
		if (show_connections) this.printGroupConnections(snapshots);
		else this.printServerExpansionNotice('Group Network Connections', '--connections');
		
		this.printSuggestedCommands({
			'Show group monitors': show_monitors ? '' : 'xy group ' + group.id + ' --monitors',
			'Show group processes': show_processes ? '' : 'xy group ' + group.id + ' --processes',
			'Show group connections': show_connections ? '' : 'xy group ' + group.id + ' --connections',
			'Show all group details': this.verbose ? '' : 'xy group ' + group.id + ' --verbose',
			'View upcoming group jobs': 'xy group ' + group.id + ' --upcoming',
			'View group history': 'xy group history ' + group.id + ' YYYY/MM/DD',
			'Update this group': 'xy group update ' + group.id + ' --icon baguette',
			'Delete this group': 'xy group delete ' + group.id
		});
	},
	
	async cmd_create_group() {
		if (this.args.other.length) return this.dieUsage('group create');
		delete this.args.other;
		var params = this.prepareGroupParams({
			hostname_match: '(?!)',
			icon: '',
			alert_actions: [],
			notes: '',
			max_jobs_per_server: 0
		}, this.args, true);
		if (!params.title) return this.dieUsage('group create');
		
		var data = await this.callStandardAPI('createGroup', params, { text: 'Creating server group...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.group);
		this.toast('✅', 'green', 'Successfully created server group: #' + data.group.id);
		this.printSuggestedCommands({
			'View group details': 'xy group ' + data.group.id,
			'Update this group': 'xy group update ' + data.group.id + ' --icon baguette',
			'List server groups': 'xy groups'
		});
	},
	
	async cmd_update_group() {
		var id = this.consumeGroupID();
		var group = await this.fetchGroup(id);
		
		this.printMutationSummary({
			title: 'Update Server Group',
			rows: [
				['Group ID', gray(group.id)],
				['Title', this.color('theme').bold(group.title)]
			]
		});
		if (!await this.confirmSyncUpdate('group', group.id, 'server group')) return;
		if (!Tools.numKeys(this.args)) return this.die('No updates specified for server group.');
		this.printUpdateData(this.args);
		
		var params = this.prepareGroupParams(group, this.args, false);
		params.id = id;
		var data = await this.callStandardAPI('updateGroup', params, { text: 'Updating server group...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', 'Successfully updated server group: #' + id);
	},
	
	async cmd_delete_group() {
		var id = this.consumeGroupID();
		var group = await this.fetchGroup(id);
		
		this.printMutationSummary({
			title: 'Delete Server Group',
			rows: [
				['Group ID', gray(group.id)],
				['Title', this.color('theme').bold(group.title)]
			]
		});
		
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the server group delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die('Unsupported server group delete option: --' + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('deleteGroup', { id: id }, { text: 'Deleting server group...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', 'Successfully deleted server group: #' + id);
	},
	
	async cmd_group_history() {
		// Historical membership comes from the Server index for the selected range,
		// blended with currently active matching Servers and de-duplicated by ID.
		this.prepSearchArgs();
		var selector = this.args.other.shift();
		var date_spec = this.args.other.shift();
		if (!selector || !date_spec || this.args.other.length) return this.dieUsage('group history');
		delete this.args.other;
		
		var merge = this.parseGroupMergeMode(this.args.merge);
		delete this.args.merge;
		if (Tools.numKeys(this.args)) this.die('Unsupported group history option: "--' + Tools.firstKey(this.args) + '".');
		
		var range = this.parseServerHistoryRange(date_spec, 'Group');
		await this.getMultiple();
		var group = this.findGroup(selector);
		var active_servers = Object.values(this.servers || {}).filter( server => {
			return (server.groups || []).includes(group.id) && (!server.created || (server.created < range.end));
		});
		var search_query = 'groups:' + group.id + ' created:<' + range.end + ' modified:>=' + range.start;
		
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Finding historical group servers...') });
		var [server_result, alert_result, job_result] = await Promise.all([
			this.api.searchServers({
				query: search_query,
				offset: 0,
				limit: this.config.max_servers_per_group || 1000
			}),
			this.api.searchAlerts({
				query: 'groups:' + group.id + ' start:<' + range.end + ' end:>=' + range.start,
				offset: this.offset,
				limit: this.limit,
				sort_by: '_id',
				sort_dir: -1,
				ttl: 1
			}),
			this.api.searchJobs({
				query: 'groups:' + group.id + ' date:>=' + range.start + ' date:<' + range.end,
				offset: this.offset,
				limit: this.limit
			})
		]);
		cli.progress.end();
		
		var failed = [server_result, alert_result, job_result].find( result => result.err );
		if (failed) this.die(failed.err);
		
		var server_map = {};
		(server_result.data.rows || []).concat(active_servers).forEach( server => {
			// Active records are appended last, so their current labels and hardware
			// metadata win over an older indexed copy of the same Server.
			server_map[server.id] = Object.assign({}, server, { offline: false });
		});
		var servers = Object.values(server_map).sort( this.sortGroupServers );
		var snapshots = await this.fetchGroupHistoricalData(servers, range);
		var alerts = {
			rows: alert_result.data.rows || [],
			list: alert_result.data.list || { length: (alert_result.data.rows || []).length }
		};
		var jobs = {
			rows: job_result.data.rows || [],
			list: job_result.data.list || { length: (job_result.data.rows || []).length }
		};
		
		var output = {
			group: group,
			merge: merge,
			range: range,
			servers: servers,
			monitors: snapshots,
			alerts: alerts,
			jobs: jobs
		};
		if (this.format.match(/json/)) return this.jsonOutput(output);
		
		println('\n ' + green.bold(range.mode.toUpperCase() + ' GROUP HISTORY - ' + range.title));
		this.printGroupHistoricalSummary(group, servers, range);
		this.printGroupHistoricalServers(servers, range);
		this.printGroupMonitorCharts(group, snapshots, merge, 'history', range);
		this.printGroupHistoricalAlerts(alerts, range);
		this.printGroupHistoricalJobs(jobs, range);
		
		var prefix = 'xy group history ' + group.id + ' ';
		this.printSuggestedCommands({
			'View live group state': 'xy group ' + group.id,
			'View hourly history': range.mode == 'hourly' ? '' : prefix + range.examples.hourly,
			'View daily history': range.mode == 'daily' ? '' : prefix + range.examples.daily,
			'View monthly history': range.mode == 'monthly' ? '' : prefix + range.examples.monthly,
			'View yearly history': range.mode == 'yearly' ? '' : prefix + range.examples.yearly
		});
	},
	
	async fetchGroup(id) {
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading server group...') });
		var { err, data } = await this.api.getGroup({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		return data.group;
	},
	
	consumeGroupID() {
		// Mutations require an exact safe ID so a fuzzy title can never target an
		// unintended Group.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die('Missing required Group ID argument.');
		if (this.args.other.length) this.die('Unexpected argument after Group ID: ' + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die('Conflicting Group ID arguments.');
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die('Invalid Group ID: ' + id);
		delete this.args.other;
		delete this.args.id;
		return id;
	},
	
	prepareGroupParams(group, input, creating) {
		// Whole-array replacement happens before dotted edits, and singular
		// --action values append to alert_actions just like Category actions.
		var params = creating ? Tools.copyHash(group, true) : {};
		var fields = ['title', 'hostname_match', 'icon', 'notes', 'max_jobs_per_server', 'alert_actions', 'action'];
		if (creating) fields.push('id');
		
		Object.keys(input).forEach( key => {
			var root = key.split('.')[0];
			if (!fields.includes(root)) this.die('Unsupported server group option: --' + key);
			if (key.includes('.') && !['alert_actions', 'action'].includes(root)) this.die('Invalid argument path: ' + key);
			var field = root == 'action' ? 'alert_actions' : root;
			if (!creating && (field in group)) params[field] = Tools.copyHash({ value: group[field] }, true).value;
		});
		
		Object.keys(input).filter( key => !key.includes('.') ).forEach( key => { params[key] = input[key]; } );
		var dotted = {};
		Object.keys(input).filter( key => key.includes('.') ).forEach( key => { dotted[key] = input[key]; } );
		this.mergeDotArgs(params, dotted);
		
		if ('action' in params) {
			if (!('alert_actions' in params)) params.alert_actions = [];
			if (!Array.isArray(params.alert_actions)) this.die('Server Group alert_actions must be a JSON array.');
			Tools.alwaysArray(params.action).forEach( action => {
				if (typeof(action) == 'string') {
					try { action = JSON.parse(action); }
					catch (err) { this.die('Server Group --action must contain a JSON object.'); }
				}
				if (!Tools.isaHash(action)) this.die('Server Group --action must contain a JSON object.');
				params.alert_actions.push(action);
			});
			delete params.action;
		}
		if ('alert_actions' in params) {
			if (!Array.isArray(params.alert_actions)) this.die('Server Group alert_actions must be a JSON array.');
			params.alert_actions.forEach( (action, idx) => {
				if (!Tools.isaHash(action)) this.die('Server Group alert_actions.' + idx + ' must be a JSON object.');
			});
		}
		
		if ('title' in params) {
			if ((typeof(params.title) != 'string') || !params.title.trim()) this.die('Server Group title cannot be empty and must be a string.');
			params.title = params.title.trim();
		}
		if ('hostname_match' in params) {
			if (typeof(params.hostname_match) != 'string') this.die('Server Group hostname_match must be a string.');
			params.hostname_match = params.hostname_match || '(?!)';
			try { new RegExp(params.hostname_match); }
			catch (err) { this.die('Invalid server Group hostname_match: ' + err.message); }
		}
		['icon', 'notes'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die('Server Group ' + key + ' must be a string.');
		});
		if ('icon' in params) params.icon = params.icon.replace(/^mdi\-/, '');
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) this.die('Invalid Group ID: ' + params.id);
		if (('max_jobs_per_server' in params) && (!Number.isInteger(params.max_jobs_per_server) || (params.max_jobs_per_server < 0))) {
			this.die('Server Group max_jobs_per_server must be a non-negative integer.');
		}
		return params;
	},
	
	findGroup(selector) {
		var group = Tools.findObject(this.groups, { id: selector }) || this.findObjectFuzzy(this.groups, { title: selector });
		if (!group) this.die('Could not find server Group based on your criteria: ' + selector);
		return group;
	},
	
	getGroupServers(group) {
		// Match the web view exactly: all active members plus cached members updated
		// within the last hour, with active records winning de-duplication.
		var servers = [];
		var active_ids = {};
		Object.values(this.servers || {}).forEach( server => {
			active_ids[server.id] = true;
			if ((server.groups || []).includes(group.id)) servers.push(Object.assign({}, server, { offline: false }));
		});
		Object.values(this.serverCache || {}).forEach( server => {
			if (active_ids[server.id]) return;
			if ((server.modified || 0) <= this.epoch - 3600) return;
			if ((server.groups || []).includes(group.id)) servers.push(Object.assign({}, server, { offline: true }));
		});
		return servers.sort(this.sortGroupServers);
	},
	
	parseGroupMergeMode(value) {
		var input = String(value || 'average').toLowerCase();
		var mode = GROUP_MERGE_MODES[input];
		if (!mode) this.die('Group --merge must be one of: avg, average, max, maximum, min, minimum, total.');
		return mode;
	},
	
	sortGroupServers(a, b) {
		var left = String(a.title || a.hostname || a.id).toLowerCase();
		var right = String(b.title || b.hostname || b.id).toLowerCase();
		return left.localeCompare(right) || String(a.id).localeCompare(String(b.id));
	},
	
	async mapGroupServersLimit(servers, callback, progress_text) {
		// A fixed worker pool prevents large Groups from producing an unbounded
		// number of HTTP requests.  Progress advances only after successful loads.
		if (!servers.length) return [];
		var results = new Array(servers.length);
		var next_idx = 0;
		var completed = 0;
		var failed = null;
		var worker = async () => {
			while (!failed) {
				var idx = next_idx++;
				if (idx >= servers.length) return;
				try {
					results[idx] = await callback(servers[idx], idx);
					completed++;
					cli.progress.update(completed);
				}
				catch (err) {
					failed = err;
				}
			}
		};
		
		cli.progress.start({ amount: 0, max: servers.length, text: gray('→ ' + progress_text) });
		await Promise.all(Array.from({ length: Math.min(GROUP_REQUEST_CONCURRENCY, servers.length) }, worker));
		cli.progress.end();
		if (failed) this.die(failed);
		return results;
	},
	
	async fetchGroupLatestData(servers) {
		return this.mapGroupServersLimit(servers, async server => {
			var result = await this.api.getLatestMonitorData({ server: server.id, sys: 'hourly', limit: 60 });
			if (result.err) throw result.err;
			return {
				server: server,
				data: (result.data.data && result.data.data.data) || {},
				rows: (result.data.rows || []).filter( row => row && row.date && row.totals )
			};
		}, 'Loading group servers...');
	},
	
	async fetchGroupHistoricalData(servers, range) {
		return this.mapGroupServersLimit(servers, async server => {
			var result = await this.api.getHistoricalMonitorData({
				server: server.id,
				sys: range.mode,
				date: range.monitor_start,
				limit: range.monitor_limit
			});
			if (result.err) throw result.err;
			return {
				server: server,
				rows: (result.data.rows || []).filter( row => row && row.date && row.totals )
			};
		}, 'Loading historical group monitors...');
	},
	
	mergeGroupValues(values, mode) {
		values = values.map( value => Number(value) ).filter( value => Number.isFinite(value) );
		if (!values.length) return 0;
		switch (mode) {
			case 'total': return values.reduce( (total, value) => total + value, 0 );
			case 'minimum': return Math.min(...values);
			case 'maximum': return Math.max(...values);
			default: return values.reduce( (total, value) => total + value, 0 ) / values.length;
		}
	},
	
	mergeGroupSeries(layers, mode) {
		// Merge by sample timestamp rather than array index, because individual
		// Server samples may begin or end on different seconds.
		var samples = {};
		layers.forEach( layer => {
			(layer || []).forEach( point => {
				if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return;
				var key = String(Number(point.x));
				if (!samples[key]) samples[key] = [];
				samples[key].push(Number(point.y));
			});
		});
		return Object.keys(samples).map(Number).sort( (a, b) => a - b ).map( x => {
			return { x: x, y: this.mergeGroupValues(samples[String(x)], mode) };
		});
	},
	
	getGroupMergeTitle(mode) {
		return GROUP_MERGE_TITLES[mode] || GROUP_MERGE_TITLES.average;
	},
	
	getGroupChartTitle(title, mode) {
		// Avoid awkward labels such as "Total Total Processes" and "Average CPU
		// Load Average" when the original Monitor title already names an aggregate.
		title = String(title || '').replace(/^Total\s+/i, '').replace(/\s+Average$/i, '');
		return this.getGroupMergeTitle(mode) + ' ' + title;
	},
	
	getVisibleGroupMonitors(group) {
		return (this.monitors || []).filter( def => {
			return def.display && (!def.groups || !def.groups.length || def.groups.includes(group.id));
		}).sort( (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.title).localeCompare(String(b.title)) );
	},
	
	printGroupSummary(group, servers) {
		var stats = ((((this.stats || {}).currentDay || {}).groups || {})[group.id]) || {};
		var info = servers.map( server => this.getServerRecordInfo(server) );
		var unique = values => Array.from(new Set(values.filter( value => !!value ))).join(', ') || gray('(None)');
		var oses = info.map( item => [item.distro || item.platform, item.release].filter( value => !!value ).join(' ') );
		var cpu_types = info.map( item => item.cpu.combo || item.cpu.brand || item.cpu.vendor );
		var virts = info.map( item => item.virt.vendor || item.virt.type || 'None' );
		var completed = stats.job_complete || 0;
		
		this.printBoxList({
			title: 'Group Summary',
			rows: [
				['Group ID', this.color('theme').bold(group.id)],
				['Group Title', bold(group.title)],
				['Created', this.getRelativeDateTime(group.created, true)],
				['Modified', this.getRelativeDateTime(group.modified, true)],
				['Hostname Match', group.hostname_match == '(?!)' ? gray('(None)') : group.hostname_match],
				['Servers', Tools.commify(servers.length)],
				['Alert Actions', Tools.commify((group.alert_actions || []).length)],
				['Max Jobs per Server', group.max_jobs_per_server ? Tools.commify(group.max_jobs_per_server) : gray('(Unlimited)')],
				['Author', group.username || gray('(Unknown)')],
				['Architectures', unique(info.map( item => item.arch ))],
				['Operating Systems', unique(oses)],
				['CPU Types', unique(cpu_types)],
				['Virtualization', unique(virts)],
				['Alerts Today', Tools.commify(stats.alert_new || 0)],
				['Jobs Today', Tools.commify(completed)],
				['Jobs Failed Today', Tools.commify(stats.job_error || 0)],
				['Job Success Rate', completed ? Tools.pct((stats.job_success || 0) / completed) : gray('(n/a)')]
			]
		});
		if (group.notes) this.printUserNotes('GROUP NOTES', group.notes);
	},
	
	printGroupServers(servers, filtered) {
		this.printPaginatedBoxTable({
			title: filtered ? 'Filtered Group Servers' : 'Group Servers',
			header: ['Server ID', 'Server', 'Status', 'IP Address', 'Groups', 'CPUs', 'RAM', 'Arch', 'OS', 'xySat', 'Uptime', 'Jobs', 'Alerts'],
			rows: servers.slice(this.offset, this.offset + this.limit),
			list: { length: servers.length },
			offset: this.offset,
			limit: this.limit
		}, server => {
			var info = this.getServerRecordInfo(server);
			var os = [info.distro || info.platform, info.release].filter( item => !!item ).join(' ') || gray('(Unknown)');
			var groups = (server.groups || []).map( id => this.getNiceGroup(id) ).join(', ') || gray('(None)');
			var jobs = Object.values(this.activeJobs || {}).filter( job => job.server == server.id ).length;
			var alerts = Object.values(this.activeAlerts || {}).filter( alert => alert.server == server.id ).length;
			var status = server.offline ? gray('Offline') : (server.enabled ? green('Online') : yellow('Disabled'));
			var uptime = (!server.offline && server.info && server.info.booted) ? Tools.getTextFromSeconds(this.epoch - server.info.booted, false, true) : gray('(Offline)');
			return [
				this.color('theme').bold(server.id),
				bold(server.title || server.hostname || server.id),
				status,
				info.ip || gray('(Unknown)'),
				groups,
				Tools.commify(info.cpu.cores || 0),
				this.formatServerBytes(info.memory.total || 0),
				info.arch || gray('(Unknown)'),
				os,
				info.satellite ? 'v' + String(info.satellite).replace(/^v/, '') : gray('(Unknown)'),
				uptime,
				jobs ? Tools.commify(jobs) : gray('Idle'),
				alerts ? Tools.commify(alerts) : gray('None')
			];
		});
	},
	
	printGroupAlerts(group, servers) {
		var ids = new Set(servers.map( server => server.id ));
		var alerts = Object.values(this.activeAlerts || {}).filter( alert => ids.has(alert.server) );
		if (!alerts.length) return;
		alerts.sort( (a, b) => (b.date || 0) - (a.date || 0) );
		this.printActiveAlerts({ title: 'Group Alerts', rows: alerts });
	},
	
	printGroupJobs(group, servers) {
		var ids = new Set(servers.map( server => server.id ));
		var jobs = Object.values(this.activeJobs || {}).filter( job => ids.has(job.server) );
		jobs.sort( (a, b) => (b.started || 0) - (a.started || 0) );
		this.printActiveJobs({ title: 'Group Jobs', rows: jobs.slice(this.offset, this.offset + this.limit) });
	},
	
	printGroupQuickmonCharts(group, servers, quickmon, mode, heading, include_offline) {
		var ids = new Set(servers.filter( server => include_offline || !server.offline ).map( server => server.id ));
		var definitions = (this.config.quick_monitors || []).filter( def => {
			return !def.groups || !def.groups.length || def.groups.includes(group.id);
		});
		var has_data = Object.keys(quickmon).some( id => ids.has(id) && (quickmon[id] || []).length );
		if (!definitions.length || !has_data) return;
		
		println('\n ' + this.color('theme').bold(heading || 'GROUP QUICK LOOK - LAST MINUTE'));
		definitions.forEach( (def, idx) => {
			var layers = [];
			ids.forEach( id => {
				var data = (quickmon[id] || []).map( row => {
					var value = Tools.getPath(row, def.source);
					if (typeof(value) != 'number') value = row[def.id];
					return { x: row.date, y: typeof(value) == 'number' ? value : 0 };
				});
				if (data.length) layers.push(data);
			});
			println('\n' + cli.chart({
				title: this.getGroupChartTitle(def.title, mode),
				data: this.mergeGroupSeries(layers, mode),
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
	
	printGroupMemory(snapshots, mode) {
		var keys = [
			['Memory Used', 'used'],
			['Memory Active', 'active'],
			['Memory Available', 'available'],
			['Memory Free', 'free'],
			['Memory Buffered', 'buffers'],
			['Memory Cached', 'cached']
		];
		var memories = snapshots.map( item => item.data.memory || item.data.mem ).filter( item => !!item );
		var total = this.mergeGroupValues(memories.map( item => item.total || 0 ), mode);
		var prefix = this.getGroupMergeTitle(mode);
		
		this.printBoxTable({
			title: prefix + ' Group Memory Details',
			header: ['Metric', 'Value', 'Visual'],
			rows: total ? keys.map( item => {
				var value = this.mergeGroupValues(memories.map( memory => Math.max(0, memory[item[1]] || 0) ), mode);
				return [prefix + ' ' + item[0], this.formatServerBytes(value), cli.progress.bar({ amount: value, max: total || 1, width: 30, pct: false })];
			}) : []
		});
	},
	
	printGroupCPU(snapshots, mode) {
		var keys = [
			['CPU User', 'user'],
			['CPU System', 'system'],
			['CPU Nice', 'nice'],
			['CPU I/O Wait', 'iowait'],
			['CPU Hard IRQ', 'irq'],
			['CPU Soft IRQ', 'softirq']
		];
		var cpus = snapshots.map( item => (item.data.cpu || {}).totals ).filter( item => !!item );
		var total = this.mergeGroupValues(cpus.map( item => 100 ), mode);
		var prefix = this.getGroupMergeTitle(mode);
		
		this.printBoxTable({
			title: prefix + ' Group CPU Details',
			header: ['Metric', 'Value', 'Visual'],
			rows: cpus.length ? keys.map( item => {
				var value = this.mergeGroupValues(cpus.map( cpu => Math.max(0, cpu[item[1]] || 0) ), mode);
				return [prefix + ' ' + item[0], this.formatServerPercent(value), cli.progress.bar({ amount: value, max: total || 1, width: 30, pct: false })];
			}) : []
		});
	},
	
	printGroupMonitorGrid(group, snapshots, mode) {
		// Merge each Server's saved point-in-time values using the same semantics
		// as the Group charts.  This is primarily used by Group Snapshot views.
		var monitors = this.getVisibleGroupMonitors(group);
		if (!monitors.length) return;
		var prefix = this.getGroupMergeTitle(mode);
		var units = monitors.map( def => {
			var values = snapshots.map( item => {
				return def.delta ?
					((item.data.deltas || {})[def.id] || 0) :
					((item.data.monitors || {})[def.id] || 0);
			});
			var value = this.mergeGroupValues(values, mode);
			return [this.getServerMonitorLabel(prefix + ' ' + def.title), this.formatServerMetric(value, def.data_type, def.suffix)];
		});
		
		println('\n ' + this.color('theme').bold('GROUP MONITOR SUMMARY'));
		println('' + cli.dashGrid(units, {
			minCols: 3,
			maxCols: 6,
			gap: 1,
			indent: 1,
			valueStyles: ['bold', 'green']
		}));
	},
	
	printGroupMonitorCharts(group, snapshots, mode, view, range, heading) {
		var monitors = this.getVisibleGroupMonitors(group);
		heading = heading || (view == 'history' ? 'GROUP MONITORS - ' + range.title.toUpperCase() : 'GROUP MONITORS - LAST HOUR');
		println('\n ' + this.color('theme').bold(heading));
		if (!monitors.length) {
			println(' ' + gray('No visible monitors apply to this server group.'));
			return;
		}
		if (!snapshots.some( item => item.rows.length )) {
			println(' ' + gray(view == 'history' ? 'No monitoring data found in the selected range.' : 'No recent monitoring data found.'));
			return;
		}
		
		monitors.forEach( (def, idx) => {
			var layers = snapshots.map( item => this.getServerMonitorChartData(item.rows, def) ).filter( data => data.length );
			println('\n' + cli.chart({
				title: this.getGroupChartTitle(def.title, mode),
				data: this.mergeGroupSeries(layers, mode),
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
	
	printGroupContainers(snapshots) {
		var rows = [];
		snapshots.filter( item => !item.server.offline ).forEach( item => {
			(Tools.getPath(item.data, 'docker.containers') || []).forEach( container => {
				rows.push(Object.assign({}, container, { server: item.server.id }));
			});
		});
		if (!rows.length) return;
		rows.sort( (a, b) => (b.cpu || 0) - (a.cpu || 0) );
		
		this.printPaginatedBoxTable({
			title: 'Group Containers',
			header: ['Container Name', 'ID', 'Server', 'CPU', 'Mem Usage', 'Mem Total', 'Net In', 'Net Out', 'Disk Read', 'Disk Write'],
			rows: rows.slice(this.offset, this.offset + this.limit),
			list: { length: rows.length },
			offset: this.offset,
			limit: this.limit
		}, item => [
			bold(item.name || '(Unknown)'),
			item.id || '',
			this.getNiceServer(item.server),
			this.formatServerPercent(item.cpu),
			this.formatServerBytes(item.mem_usage || 0),
			this.formatServerBytes(item.mem_total || 0),
			this.formatServerBytes(item.net_read || 0),
			this.formatServerBytes(item.net_write || 0),
			this.formatServerBytes(item.disk_read || 0),
			this.formatServerBytes(item.disk_write || 0)
		]);
	},
	
	printGroupProcesses(snapshots) {
		var rows = [];
		snapshots.filter( item => !item.server.offline ).forEach( item => {
			(((item.data.processes || {}).list) || []).forEach( process => {
				rows.push(Object.assign({}, process, { server: item.server.id }));
			});
		});
		rows.sort( (a, b) => (b.cpu || 0) - (a.cpu || 0) );
		
		this.printPaginatedBoxTable({
			title: 'Group Processes',
			header: ['Command', 'Server', 'User', 'PID', 'Parent', 'CPU', 'Memory', 'Age', 'State'],
			rows: rows.slice(this.offset, this.offset + this.limit),
			list: { length: rows.length },
			offset: this.offset,
			limit: this.limit
		}, process => [
			bold(this.getServerProcessName(process)),
			this.getNiceServer(process.server),
			process.user || '-',
			process.pid,
			process.parentPid || 'n/a',
			this.formatServerPercent(process.cpu),
			this.formatServerBytes(process.memRss || 0),
			Tools.getTextFromSeconds(process.age || 0, true, true),
			this.getServerTitleCase(process.state || 'unknown')
		]);
	},
	
	printGroupConnections(snapshots) {
		var rows = [];
		snapshots.filter( item => !item.server.offline ).forEach( item => {
			var processes = ((item.data.processes || {}).list) || [];
			(item.data.conns || []).forEach( connection => {
				var process = connection.pid ? Tools.findObject(processes, { pid: connection.pid }) : null;
				rows.push(Object.assign({}, connection, {
					server: item.server.id,
					process_name: process ? this.getServerProcessName(process) : (connection.pid || '')
				}));
			});
		});
		rows.sort( (a, b) => String(a.state || '').localeCompare(String(b.state || '')) );
		
		this.printPaginatedBoxTable({
			title: 'Group Network Connections',
			header: ['State', 'Server', 'Protocol', 'Local Address', 'Remote Address', 'Process', 'Bytes In', 'Bytes Out'],
			rows: rows.slice(this.offset, this.offset + this.limit),
			list: { length: rows.length },
			offset: this.offset,
			limit: this.limit
		}, connection => [
			this.getServerTitleCase(connection.state || 'unknown'),
			this.getNiceServer(connection.server),
			String(connection.type || '').toUpperCase(),
			connection.local_addr || '',
			connection.remote_addr || '',
			connection.process_name || gray('(None)'),
			this.formatServerBytes(connection.bytes_in || 0),
			this.formatServerBytes(connection.bytes_out || 0)
		]);
	},
	
	printGroupHistoricalSummary(group, servers, range) {
		var info = servers.map( server => this.getServerRecordInfo(server) );
		var unique = values => Array.from(new Set(values.filter( value => !!value ))).join(', ') || gray('(None)');
		var oses = info.map( item => [item.distro || item.platform, item.release].filter( value => !!value ).join(' ') );
		var cpu_types = info.map( item => item.cpu.combo || item.cpu.brand || item.cpu.vendor );
		var virts = info.map( item => item.virt.vendor || item.virt.type || 'None' );
		
		this.printBoxList({
			title: 'Group Summary - ' + range.title,
			rows: [
				['Group ID', this.color('theme').bold(group.id)],
				['Group Title', bold(group.title)],
				['Created', this.getRelativeDateTime(group.created, true)],
				['Modified', this.getRelativeDateTime(group.modified, true)],
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
	
	printGroupHistoricalServers(servers, range) {
		this.printPaginatedBoxTable({
			title: 'Group Servers - ' + range.title,
			header: ['Server ID', 'Server', 'IP Address', 'Groups', 'CPUs', 'RAM', 'Arch', 'OS', 'xySat', 'Uptime', 'Jobs', 'Alerts'],
			rows: servers.slice(this.offset, this.offset + this.limit),
			list: { length: servers.length },
			offset: this.offset,
			limit: this.limit
		}, server => {
			var info = this.getServerRecordInfo(server);
			var os = [info.distro || info.platform, info.release].filter( item => !!item ).join(' ') || gray('(Unknown)');
			var groups = (server.groups || []).map( id => this.getNiceGroup(id) ).join(', ') || gray('(None)');
			var uptime = (server.info && server.info.booted) ? Tools.getTextFromSeconds(this.epoch - server.info.booted, false, true) : gray('(n/a)');
			return [
				this.color('theme').bold(server.id),
				bold(server.title || server.hostname || server.id),
				info.ip || gray('(Unknown)'),
				groups,
				Tools.commify(info.cpu.cores || 0),
				this.formatServerBytes(info.memory.total || 0),
				info.arch || gray('(Unknown)'),
				os,
				info.satellite ? 'v' + String(info.satellite).replace(/^v/, '') : gray('(Unknown)'),
				uptime,
				gray('n/a'),
				gray('n/a')
			];
		});
	},
	
	printGroupHistoricalAlerts(result, range) {
		this.printPaginatedBoxTable({
			title: 'Group Alerts - ' + range.title,
			header: ['Alert ID', 'Title', 'Message', 'Server', 'Status', 'Started', 'Duration'],
			rows: result.rows,
			list: result.list,
			offset: this.offset,
			limit: this.limit
		}, alert => {
			var completed = alert.active ? this.epoch : (alert.modified || alert.date);
			return [
				this.color('theme').bold(alert.id),
				this.getNiceAlert(alert.alert),
				String(alert.message || '').replace(/\s+/g, ' ').trim(),
				this.getNiceServer(alert.server),
				this.getNiceAlertStatus(alert),
				this.getRelativeDateTime(alert.date, true),
				Tools.getTextFromSeconds(Math.max(0, completed - alert.date), true, true)
			];
		});
	},
	
	printGroupHistoricalJobs(result, range) {
		this.printPaginatedBoxTable({
			title: 'Group Jobs - ' + range.title,
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
	
	getGroupEvents(group) {
		return (this.events || []).filter( event => (event.targets || []).includes(group.id) );
	},
	
	async getGroupUpcomingJobs(group) {
		return new Promise( resolve => {
			this.predictUpcomingJobs({
				events: this.getGroupEvents(group),
				duration: 86400 * 32,
				burn: 16,
				max: 1000,
				callback: resolve
			});
		});
	}
	
}; // module.exports
