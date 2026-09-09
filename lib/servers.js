// Server List, Bootstrap and Search Layer

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
		// Server detail, history and mutation routes are added in later chapters.
		// For now, expose the two complete command families implemented here.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('server');
		
		switch (cmd) {
			case 'list': await this.cmd_get_servers(); break;
			case 'add': await this.cmd_add_server(); break;
			case 'search': await this.cmd_search_servers(); break;
			default: this.dieUsage('server'); break;
		}
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
			'Add a Linux Server': 'xy server add --platform linux',
			'Search Server history': 'xy server search SEARCH_TEXT',
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
			'List active Servers': 'xy servers',
			'Generate a Windows installer': 'xy server add --platform windows',
			'Generate a Docker installer': 'xy server add --platform docker',
			'Search Server history': 'xy server search'
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
			'List active Servers': 'xy servers'
		});
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
