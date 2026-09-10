// Server Monitors Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_monitors() {
		// The plural command lists monitor definitions, with optional filters.
		await this.cmd_get_monitors();
	},
	
	async cmd_monitor() {
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('monitor');
		
		switch (cmd) {
			case 'list': await this.cmd_get_monitors(); break;
			case 'get': await this.cmd_get_monitor(); break;
			case 'create': await this.cmd_create_monitor(); break;
			case 'update': await this.cmd_update_monitor(); break;
			case 'test': await this.cmd_test_monitor(); break;
			case 'delete': await this.cmd_delete_monitor(); break;
			
			default:
				// A bare ID or title opens monitor details.
				this.args.other.unshift(cmd);
				await this.cmd_get_monitor();
			break;
		}
	},
	
	async cmd_get_monitors() {
		// Consume pagination before turning remaining options into filters.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var monitors = this.monitors.slice(0);
		var is_filtered = !!this.args.other.length;
		
		if (is_filtered) {
			var search = this.args.other.join(' ');
			monitors = this.findObjectsFuzzy(monitors, { id: search, title: search, source: search, notes: search }, 1);
		}
		delete this.args.other;
		
		['display', 'delta', 'divide_by_delta'].forEach( key => {
			if (!(key in this.args)) return;
			
			var value = this.parseMonitorBoolean(this.args[key], key);
			monitors = monitors.filter( monitor => !!monitor[key] === value );
			delete this.args[key];
			is_filtered = true;
		});
		
		if ('group' in this.args) {
			var selector = this.args.group;
			var group = Tools.findObject(this.groups, { id: selector }) || this.findObjectFuzzy(this.groups, { title: selector });
			if (!group) return this.die("Could not find server group based on your criteria: " + selector);
			
			// Include monitors scoped to all groups, since these apply here too.
			monitors = monitors.filter( monitor => !(monitor.groups || []).length || monitor.groups.includes(group.id) );
			delete this.args.group;
			is_filtered = true;
		}
		
		if (Tools.numKeys(this.args)) {
			monitors = this.findObjectsFuzzy(monitors, this.args);
			is_filtered = true;
		}
		
		monitors.sort( (a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.title).localeCompare(String(b.title)) );
		
		if (this.format.match(/json/)) return this.jsonOutput(monitors);
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Monitors' : 'All Monitors',
			header: ['Monitor ID', 'Title', 'Display', 'Data Type', 'Groups', 'Modified'],
			rows: monitors.slice(this.offset, this.offset + this.limit),
			list: { length: monitors.length },
			offset: this.offset,
			limit: this.limit
		}, monitor => [
			this.color('theme').bold(monitor.id),
			bold(monitor.title),
			monitor.display ? green('Visible') : gray('Hidden'),
			monitor.data_type,
			this.getNiceMonitorGroups(monitor.groups),
			this.getRelativeDateTime(monitor.modified, true)
		]);
		
		this.printSuggestedCommands({
			"View monitor details": "xy monitor MONITOR_ID_OR_TITLE",
			"Create a monitor": 'xy monitor create --title "CPU Usage" --source cpu.currentLoad --suffix %',
			"List hidden monitors": "xy monitors --display false",
			"Test a monitor": "xy monitor test MONITOR_ID --server SERVER_ID_OR_TITLE"
		});
	},
	
	async cmd_get_monitor() {
		await this.getMultiple();
		
		var selector = this.args.other.join(' ') || this.args.id || this.args.title;
		if (!selector) return this.dieUsage('monitor get');
		
		var monitor = await this.findMonitor(selector);
		
		if (this.format.match(/json/)) return this.jsonOutput(monitor);
		
		this.printBoxList({
			title: 'Monitor Summary',
			rows: [
				[ 'Monitor ID', gray(monitor.id) ],
				[ 'Title', this.color('theme').bold(monitor.title) ],
				[ 'Display', monitor.display ? green('Visible') : gray('Hidden') ],
				[ 'Icon', monitor.icon || gray('(None)') ],
				[ 'Groups', this.getNiceMonitorGroups(monitor.groups) ],
				[ 'Source', monitor.source ],
				[ 'Data Match', monitor.data_match || gray('(None)') ],
				[ 'Data Type', monitor.data_type ],
				[ 'Suffix', monitor.suffix || gray('(None)') ],
				[ 'Delta', monitor.delta ? green('Yes') : gray('No') ],
				[ 'Divide by Delta', monitor.divide_by_delta ? green('Yes') : gray('No') ],
				[ 'Delta Min', typeof(monitor.delta_min_value) == 'number' ? monitor.delta_min_value : gray('(Disabled)') ],
				[ 'Min Vert Scale', monitor.min_vert_scale || 0 ],
				[ 'Sort Order', monitor.sort_order || 0 ],
				[ 'Author', monitor.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(monitor.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(monitor.modified, true, true) ],
				[ 'Revision', monitor.revision || 1 ]
			]
		});
		
		// User notes may contain multiple lines, so keep them out of the summary box.
		if (monitor.notes) {
			this.printUserNotes('MONITOR NOTES', monitor.notes);
		}
		
		this.printSuggestedCommands({
			"Test monitor": `xy monitor test ${monitor.id} --server SERVER_ID_OR_TITLE`,
			"Export monitor": `xy monitor ${monitor.id} --export monitor.json`,
			"Update monitor": `xy monitor update ${monitor.id} --notes "My notes"`,
			"Hide monitor": `xy monitor update ${monitor.id} --display false`,
			"Delete monitor": `xy monitor delete ${monitor.id}`
		});
	},
	
	async cmd_create_monitor() {
		// Defaults match the web editor.  Collection continues when display is false.
		if (this.args.other.length) return this.dieUsage('monitor create');
		delete this.args.other;
		
		var params = this.prepareMonitorParams({
			data_type: 'float',
			suffix: '',
			groups: [],
			display: true,
			min_vert_scale: 0,
			icon: '',
			notes: '',
			data_match: '',
			delta: false,
			divide_by_delta: false,
			delta_min_value: false
		}, this.args, true);
		if (!params.title || !params.source) return this.dieUsage('monitor create');
		
		var data = await this.callStandardAPI('createMonitor', params, { text: 'Creating monitor...' });
		if (this.dry) return;
		
		if (this.format.match(/json/)) return this.jsonOutput(data.monitor);
		
		this.toast('✅', 'green', "Successfully created monitor: #" + data.monitor.id);
		
		this.printSuggestedCommands({
			"View monitor details": `xy monitor ${data.monitor.id}`,
			"Test monitor": `xy monitor test ${data.monitor.id} --server SERVER_ID_OR_TITLE`,
			"Update monitor": `xy monitor update ${data.monitor.id} --notes "My notes"`,
			"List all monitors": "xy monitors"
		});
	},
	
	async cmd_update_monitor() {
		// Fetch the saved groups for indexed edits and appends; send sparse updates.
		var id = this.consumeMonitorID();
		var monitor = await this.fetchMonitor(id);
		
		this.printMutationSummary({
			title: 'Update Monitor',
			rows: [
				[ 'Monitor ID', gray(monitor.id) ],
				[ 'Title', this.color('theme').bold(monitor.title) ]
			]
		});
		
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for monitor.");
		this.printUpdateData(this.args);
		
		var params = this.prepareMonitorParams(monitor, this.args, false);
		params.id = id;
		
		var data = await this.callStandardAPI('updateMonitor', params, { text: 'Updating monitor...' });
		if (this.dry) return;
		
		if (this.format.match(/json/)) return this.jsonOutput(data);
		
		this.toast('✅', 'green', "Successfully updated monitor: #" + id);
	},
	
	async cmd_test_monitor() {
		// Test saved settings with optional overrides, or an unsaved expression.
		await this.getMultiple();
		
		var selector = this.args.other.join(' ') || this.args.id;
		delete this.args.other;
		delete this.args.id;
		var monitor = selector ? await this.findMonitor(selector) : null;
		
		var server_selector = this.args.server;
		delete this.args.server;
		if (!server_selector) return this.dieUsage('monitor test');
		
		var servers = Object.values(this.servers);
		var server = Tools.findObject(servers, { id: server_selector }) || this.findObjectFuzzy(servers, {
			title: server_selector,
			hostname: server_selector,
			ip: server_selector
		}, 1);
		if (!server) return this.die("Could not find server based on your criteria: " + server_selector);
		
		Object.keys(this.args).forEach( key => {
			if (!['source', 'data_type', 'data_match'].includes(key)) this.die("Unsupported monitor test option: --" + key);
		});
		
		var params = this.prepareMonitorParams({
			source: monitor ? monitor.source : '',
			data_type: monitor ? monitor.data_type : 'float',
			data_match: (monitor && monitor.data_match) || ''
		}, this.args, true);
		params.server = server.id;
		
		var data = await this.callStandardAPI('testMonitor', params, { text: 'Testing monitor...' });
		if (this.dry) return;
		
		if (this.format.match(/json/)) return this.jsonOutput(data);
		
		// An unresolved expression is distinct from a valid zero result.
		this.printBoxList({
			title: 'Monitor Test Result',
			rows: [
				[ 'Monitor', monitor ? monitor.title + gray(' (' + monitor.id + ')') : gray('(Ad Hoc)') ],
				[ 'Server', this.getNiceServer(server) + gray(' (' + server.id + ')') ],
				[ 'Source', params.source ],
				[ 'Data Type', params.data_type ],
				[ 'Result', data.fail ? yellow('No Value') : green(String(data.value)) + ((params.data_type == 'bytes') ? ' (' + Tools.getTextFromBytes(data.value) + ')' : '') ]
			]
		});
	},
	
	async cmd_delete_monitor() {
		var id = this.consumeMonitorID();
		var monitor = await this.fetchMonitor(id);
		
		this.printMutationSummary({
			title: 'Delete Monitor',
			rows: [
				[ 'Monitor ID', gray(monitor.id) ],
				[ 'Title', this.color('theme').bold(monitor.title) ]
			]
		});
		
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the monitor delete by adding '--confirm'.");
			return;
		}
		
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported monitor delete option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('deleteMonitor', { id: id }, { text: 'Deleting monitor...' });
		if (this.dry) return;
		
		if (this.format.match(/json/)) return this.jsonOutput(data);
		
		this.toast('✅', 'green', "Successfully deleted monitor: #" + id);
	},
	
	async findMonitor(selector) {
		// Exact IDs take precedence over fuzzy titles for read-only commands.
		var match = Tools.findObject(this.monitors, { id: selector }) || this.findObjectFuzzy(this.monitors, { title: selector });
		if (!match) this.die("Could not find monitor based on your criteria: " + selector);
		
		return await this.fetchMonitor(match.id);
	},
	
	async fetchMonitor(id) {
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading monitor...') });
		
		var { err, data } = await this.api.getMonitor({ id: id });
		cli.progress.end();
		
		if (err) this.die(err);
		
		return data.monitor;
	},
	
	consumeMonitorID() {
		// Require an exact, unambiguous ID for changes to saved definitions.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing required Monitor ID argument.");
		if (this.args.other.length) this.die("Unexpected argument after Monitor ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Monitor ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die("Invalid Monitor ID: " + id);
		
		delete this.args.id;
		delete this.args.other;
		
		return id;
	},
	
	prepareMonitorParams(monitor, input, creating) {
		// Leave audit fields and unrelated settings untouched.  The API assigns
		// sort_order on creation, but it can be explicitly changed on update.
		var params = creating ? Tools.copyHash(monitor, true) : {};
		var fields = ['title', 'source', 'data_type', 'data_match', 'display', 'icon', 'groups', 'group', 'suffix', 'min_vert_scale', 'delta', 'divide_by_delta', 'delta_min_value', 'notes'];
		fields.push(creating ? 'id' : 'sort_order');
		
		var dotted = {};
		
		Object.keys(input).forEach( key => {
			var root = key.split('.')[0];
			if (!fields.includes(root)) this.die("Unsupported monitor option: --" + key);
			
			if (key.includes('.')) {
				if (root != 'groups') this.die("Invalid argument path: " + key);
				dotted[key] = input[key];
			}
			else params[key] = input[key];
		});
		
		// Replace groups first, edit existing indexes next, then append --group.
		if (('groups' in input) || ('group' in input) || Tools.numKeys(dotted)) {
			params.groups = this.parseMonitorGroups(('groups' in input) ? input.groups : (monitor.groups || []));
			this.mergeDotArgs(params, dotted);
			
			if ('group' in input) params.groups = params.groups.concat(this.parseMonitorGroups(input.group));
			params.groups = Array.from(new Set(this.parseMonitorGroups(params.groups)));
		}
		delete params.group;
		
		['title', 'source'].forEach( key => {
			if (!(key in params)) return;
			
			// Numeric constants are valid source expressions, even when parsed as numbers.
			if ((key == 'source') && (typeof(params[key]) == 'number') && Number.isFinite(params[key])) params[key] = String(params[key]);
			if ((typeof(params[key]) != 'string') || !params[key].trim()) this.die("Monitor " + key + " cannot be empty and must be a string.");
			params[key] = params[key].trim();
		});
		
		['display', 'delta', 'divide_by_delta'].forEach( key => {
			if (key in params) params[key] = this.parseMonitorBoolean(params[key], key);
		});
		
		['icon', 'notes', 'suffix', 'data_match'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die("Monitor " + key + " must be a string.");
		});
		
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) this.die("Invalid Monitor ID: " + params.id);
		if (('data_type' in params) && !['integer', 'float', 'bytes', 'seconds', 'milliseconds'].includes(params.data_type)) this.die("Monitor data_type must be integer, float, bytes, seconds, or milliseconds.");
		if (('min_vert_scale' in params) && (!Number.isFinite(params.min_vert_scale) || (params.min_vert_scale < 0))) this.die("Monitor min_vert_scale must be a non-negative number.");
		
		// Match the editor's minimum chart range for integer monitors, without
		// adding an unrelated field to sparse updates or test requests.
		if (('min_vert_scale' in params) && ((params.data_type || monitor.data_type) == 'integer') && (params.min_vert_scale < 1)) params.min_vert_scale = 1;
		
		if (('sort_order' in params) && !Number.isSafeInteger(params.sort_order)) this.die("Monitor sort_order must be an integer.");
		
		// false disables the delta minimum; numeric zero is an enabled minimum.
		if (('delta_min_value' in params) && (params.delta_min_value !== false) && !Number.isFinite(params.delta_min_value)) this.die("Monitor delta_min_value must be a number, or false to disable it.");
		
		if (params.data_match) {
			try { new RegExp(params.data_match); }
			catch (err) { this.die("Invalid monitor data_match regular expression: " + err.message); }
		}
		
		return params;
	},
	
	parseMonitorGroups(value) {
		// Group assignments use IDs, as in alert definitions and event targets.
		var groups = Array.isArray(value) ? value.slice(0) : ((typeof(value) == 'string') ? value.split(',') : null);
		if (!groups) this.die("Monitor groups must be a JSON array or comma-separated group IDs.");
		
		return groups.map( id => {
			if ((typeof(id) != 'string') || !id.trim().match(/^[a-z0-9_]+$/)) this.die("Invalid server group ID: " + id);
			return id.trim();
		});
	},
	
	parseMonitorBoolean(value, key) {
		if ([true, 1, '1', 'true', 'yes', 'on'].includes(value)) return true;
		if ([false, 0, '0', 'false', 'no', 'off'].includes(value)) return false;
		
		this.die("Invalid boolean value for '" + key + "': " + value);
	},
	
	getNiceMonitorGroups(groups) {
		return (groups && groups.length) ? groups.map( id => this.getNiceGroup(id) ).join(', ') : gray('(All)');
	}
	
}; // module.exports
