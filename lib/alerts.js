// Alert Layer
//
// xyOps uses the word "alert" for both reusable alert definitions and the
// historical invocations they produce.  The CLI keeps the short word, and uses
// the operation to select the resource wherever possible.  Ambiguous get and
// delete operations resolve an exact definition ID first, then an invocation
// ID.  The two ID namespaces are designed not to collide.

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_alerts() {
		// The plural command defaults to definitions.  Searching is the one
		// collection operation that always targets alert invocations.
		var cmd = this.args.other[0];
		if (cmd == 'list') {
			this.args.other.shift();
			return await this.cmd_get_alert_definitions();
		}
		else if (cmd == 'search') {
			this.args.other.shift();
			return await this.cmd_search_alert_invocations();
		}
		else return await this.cmd_get_alert_definitions();
	},
	
	async cmd_alert() {
		// Singular router, e.g. `xy alert create` or `xy alert INVOCATION_ID`.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('alert');
		
		switch (cmd) {
			case 'list': await this.cmd_get_alert_definitions(); break;
			case 'search': await this.cmd_search_alert_invocations(); break;
			case 'get': await this.cmd_get_alert(); break;
			case 'test': await this.cmd_test_alert_definition(); break;
			
			case 'add':
			case 'create': await this.cmd_create_alert_definition(); break;
			case 'edit':
			case 'update': await this.cmd_update_alert_definition(); break;
			case 'remove':
			case 'delete': await this.cmd_delete_alert(); break;
			
			default:
				// A bare selector opens either a definition or an invocation.
				this.args.other.unshift(cmd);
				await this.cmd_get_alert();
			break;
		}
	},
	
	async cmd_get_alert_definitions() {
		// List and locally filter the definitions already returned by getMultiple.
		await this.getMultiple();
		var alerts = this.alerts.slice(0);
		var is_filtered = false;
		
		if (this.args.other.length) {
			var search = this.args.other.join(' ');
			alerts = this.findObjectsFuzzy(alerts, {
				id: search,
				title: search,
				expression: search,
				message: search
			}, 1);
			is_filtered = true;
		}
		delete this.args.other;
		
		if ('disabled' in this.args) {
			var disabled = this.parseAlertBoolean(this.args.disabled, 'disabled');
			alerts = alerts.filter( alert => !alert.enabled === disabled );
			delete this.args.disabled;
			is_filtered = true;
		}
		if ('enabled' in this.args) {
			var enabled = this.parseAlertBoolean(this.args.enabled, 'enabled');
			alerts = alerts.filter( alert => !!alert.enabled === enabled );
			delete this.args.enabled;
			is_filtered = true;
		}
		
		if ('group' in this.args) {
			var groups = this.parseAlertList(this.args.group).map( selector => {
				var group = this.findObjectFuzzy(this.groups, {
					id: selector,
					title: selector
				}, 1);
				if (!group) this.die("Could not find server group based on your criteria: " + selector);
				return group.id;
			});
			alerts = alerts.filter( alert => this.includesAll(alert.groups || [], groups) );
			delete this.args.group;
			is_filtered = true;
		}
		
		if ('monitor' in this.args) {
			var monitor = this.findObjectFuzzy(this.monitors, {
				id: this.args.monitor,
				title: this.args.monitor
			}, 1);
			if (!monitor) return this.die("Could not find monitor based on your criteria: " + this.args.monitor);
			alerts = alerts.filter( alert => alert.monitor_id == monitor.id );
			delete this.args.monitor;
			is_filtered = true;
		}
		
		if (Tools.numKeys(this.args)) {
			// Remaining options are ordinary fuzzy property filters.
			alerts = this.findObjectsFuzzy(alerts, this.args);
			is_filtered = true;
		}
		
		alerts.sort( function(a, b) {
			return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
		} );
		
		if (this.format.match(/json/)) return this.jsonOutput(alerts);
		
		var total = alerts.length;
		var rows = alerts.slice(this.offset, this.offset + this.limit);
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Alert Definitions' : 'All Alert Definitions',
			header: ['Alert ID', 'Title', 'Expression', 'Groups', 'Status', 'Modified'],
			rows: rows,
			list: { length: total },
			offset: this.offset,
			limit: this.limit
		}, alert => {
			return [
				this.color('theme').bold(alert.id),
				bold(alert.title),
				String(alert.expression || '').replace(/\s+/g, ' ').trim(),
				this.getNiceAlertGroups(alert.groups, '(All)'),
				this.getNiceEnabled(alert.enabled),
				this.getRelativeDateTime(alert.modified, true)
			];
		});
		
		this.printSuggestedCommands({
			"View an alert": "xy alert ID_OR_TITLE",
			"Create an alert definition": "xy alert create --title \"My Alert\" --expression \"...\" --message \"...\"",
			"Search alert invocations": "xy alerts search [QUERY]"
		});
	},
	
	async cmd_search_alert_invocations() {
		// Build an invocation query from friendly resource selectors and flags.
		await this.getMultiple();
		var query_parts = [];
		var sort_dir = -1;
		
		if (this.args.other.length) query_parts.push(this.args.other.join(' '));
		delete this.args.other;
		if (this.args.query) query_parts.push(this.args.query);
		delete this.args.query;
		
		if (this.args.alert) {
			var alert = this.findObjectFuzzy(this.alerts, {
				id: this.args.alert,
				title: this.args.alert
			}, 1);
			if (!alert) return this.die("Could not find alert definition based on your criteria: " + this.args.alert);
			query_parts.push('alert:' + alert.id);
			delete this.args.alert;
		}
		
		if (this.args.server) {
			var server = this.findObjectFuzzy(Object.values(this.servers), {
				id: this.args.server,
				title: this.args.server,
				hostname: this.args.server,
				ip: this.args.server
			}, 1);
			if (!server) return this.die("Could not find server based on your criteria: " + this.args.server);
			query_parts.push('server:' + server.id);
			delete this.args.server;
		}
		
		if (this.args.group) {
			var group = this.findObjectFuzzy(this.groups, {
				id: this.args.group,
				title: this.args.group
			}, 1);
			if (!group) return this.die("Could not find server group based on your criteria: " + this.args.group);
			query_parts.push('groups:' + group.id);
			delete this.args.group;
		}
		
		if ('active' in this.args) {
			query_parts.push('active:' + this.parseAlertBoolean(this.args.active, 'active'));
			delete this.args.active;
		}
		if ('cleared' in this.args) {
			var cleared = this.parseAlertBoolean(this.args.cleared, 'cleared');
			query_parts.push('active:' + !cleared);
			delete this.args.cleared;
		}
		
		if (this.args.date) {
			var date_query = this.getDateRangeQuery('start', this.args.date);
			if (!date_query) {
				var date_text = String(this.args.date);
				if (date_text.match(/^\d{4}\-\d{2}\-\d{2}$/)) {
					// A calendar date means the entire local day, not only midnight.
					var start_epoch = Tools.parseDate(date_text + ' 00:00:00');
					var next_day = new Date(start_epoch * 1000);
					next_day.setDate(next_day.getDate() + 1);
					date_query = 'start:>=' + start_epoch + ' start:<' + Math.floor(next_day.getTime() / 1000);
				}
				else date_query = date_text.includes(':') ? date_text : 'start:' + date_text;
			}
			query_parts.push(date_query);
			delete this.args.date;
		}
		if (this.args.oldest) {
			if (this.parseAlertBoolean(this.args.oldest, 'oldest')) sort_dir = 1;
			delete this.args.oldest;
		}
		if (this.args.sort) {
			if (String(this.args.sort).match(/^(oldest|asc|ascending)$/i)) sort_dir = 1;
			else if (!String(this.args.sort).match(/^(newest|desc|descending)$/i)) {
				return this.die("Invalid alert invocation sort order: " + this.args.sort);
			}
			delete this.args.sort;
		}
		
		// These IDs may refer to deleted resources, so pass them through without
		// requiring that the related object still exists in a current global list.
		['job', 'ticket'].forEach( key => {
			if (this.args[key]) query_parts.push(key + 's:' + this.args[key]);
			delete this.args[key];
		});
		
		// Preserve access to the complete xyOps search language.  Any additional
		// named option becomes a field:value criterion, matching the jobs command.
		Object.keys(this.args).forEach( key => {
			query_parts.push(key + ':' + this.args[key]);
		});
		
		var query = query_parts.join(' ').trim();
		await this.printAlertInvocations({
			title: query ? 'Alert Invocation Search Results' : 'All Alert Invocations',
			query: query,
			sort_dir: sort_dir
		});
		if (this.format.match(/json/)) return;
		
		this.printSuggestedCommands({
			"Active invocations": "xy alerts search --active",
			"Cleared invocations": "xy alerts search --cleared",
			"Invocations from today": "xy alerts search --date today",
			"View an invocation": "xy alert INVOCATION_ID"
		});
	},
	
	async cmd_get_alert() {
		// Resolve an ambiguous selector in the documented order: exact definition
		// ID, exact invocation ID, then fuzzy definition title.
		await this.getMultiple();
		var selector = this.getAlertSelector();
		var resolved = await this.resolveAlert(selector, true);
		if (!resolved) return this.die("Could not find an alert definition or invocation based on your criteria: " + selector);
		if (Tools.numKeys(this.args)) return this.die("Unexpected alert option: --" + Tools.firstKey(this.args));
		
		if (this.format.match(/json/)) return this.jsonOutput(resolved.alert);
		if (resolved.type == 'definition') this.printAlertDefinition(resolved.alert);
		else await this.printAlertInvocation(resolved.alert);
	},
	
	async cmd_create_alert_definition() {
		// Create a definition with the same safe defaults used by the web UI.
		await this.getMultiple();
		if ('delete' in this.args) return this.die("The '--delete' option is only available for update commands.");
		
		var params = {
			title: '',
			expression: '',
			message: '',
			groups: [],
			actions: [],
			monitor_id: '',
			enabled: true,
			samples: 1,
			exclusive_actions: false,
			limit_jobs: false,
			abort_jobs: false,
			notes: ''
		};
		this.mergeDotArgs(params, this.args);
		delete params.other;
		this.processAlertDefinitionUpdates(params);
		this.validateAlertDefinition(params);
		
		var data = await this.callStandardAPI('createAlert', params, {
			text: 'Creating Alert Definition...'
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.alert);
		
		this.toast('✅', 'green', "Successfully created Alert Definition: #" + data.alert.id);
		this.printSuggestedCommands({
			"View alert definition": `xy alert ${data.alert.id}`,
			"Test alert definition": `xy alert test ${data.alert.id} --server SERVER_ID_OR_TITLE`,
			"Update alert definition": `xy alert update ${data.alert.id} [--KEY VALUE, ...]`,
			"List alert definitions": "xy alerts"
		});
	},
	
	async cmd_update_alert_definition() {
		// Updates always target definitions and require an exact, safe internal ID.
		await this.getMultiple();
		var id = this.getAlertIDArgument('Alert Definition');
		var alert = Tools.findObject(this.alerts, { id: id });
		if (!alert) return this.die("Could not find Alert Definition from ID: " + id);
		
		delete this.args.id;
		delete this.args.other;
		if (!Tools.numKeys(this.args)) return this.dieUsage('alert update');
		
		// Seed every editable field from the current definition.  This preserves
		// siblings when dotted options or generic --delete paths modify a nested
		// action object, despite the API's shallow top-level merge behavior.
		var params = { id: alert.id };
		[
			'title', 'expression', 'message', 'groups', 'actions', 'monitor_id',
			'enabled', 'samples', 'exclusive_actions', 'limit_jobs', 'abort_jobs',
			'icon', 'notes'
		].forEach( key => {
			if (key in alert) params[key] = Tools.copyHash(alert[key], true);
		});
		
		this.mergeDotArgs(params, this.args);
		this.applyDeleteArgs(params, this.args);
		this.processAlertDefinitionUpdates(params);
		this.validateAlertDefinition(params);
		
		await this.callStandardAPI('updateAlert', params, {
			text: 'Updating Alert Definition...'
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput({ id: id, updated: true });
		this.toast('✅', 'green', "Successfully updated Alert Definition: #" + id);
	},
	
	async cmd_test_alert_definition() {
		// Test a stored definition, with optional expression or message overrides.
		await this.getMultiple();
		var selector = '';
		if (this.args.other.length) selector = this.args.other.join(' ');
		delete this.args.other;
		
		var alert = null;
		if (selector) {
			alert = Tools.findObject(this.alerts, { id: selector }) ||
				this.findObjectFuzzy(this.alerts, { title: selector });
			if (!alert) return this.die("Could not find Alert Definition based on your criteria: " + selector);
		}
		
		var server_selector = this.args.server;
		delete this.args.server;
		if (!server_selector) return this.dieUsage('alert test');
		var server = this.findObjectFuzzy(Object.values(this.servers), {
			id: server_selector,
			title: server_selector,
			hostname: server_selector,
			ip: server_selector
		}, 1);
		if (!server) return this.die("Could not find server based on your criteria: " + server_selector);
		
		var params = {
			server: server.id,
			expression: ('expression' in this.args) ? String(this.args.expression) : String((alert && alert.expression) || ''),
			message: ('message' in this.args) ? String(this.args.message) : String((alert && alert.message) || '')
		};
		delete this.args.expression;
		delete this.args.message;
		if (Tools.numKeys(this.args)) return this.die("Unexpected alert test option: --" + Tools.firstKey(this.args));
		if (!params.expression.trim() || !params.message.trim()) return this.dieUsage('alert test');
		
		var data = await this.callStandardAPI('testAlert', params, {
			text: 'Testing Alert Definition...'
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput({ result: !!data.result, message: data.message });
		
		this.printBoxList({
			title: 'Alert Definition Test Result',
			rows: [
				[ 'Definition', alert ? alert.title + gray(' (' + alert.id + ')') : gray('(Ad Hoc)') ],
				[ 'Server', this.getNiceServer(server) + gray(' (' + server.id + ')') ],
				[ 'Triggered', data.result ? green.bold('Yes') : gray('No') ],
				[ 'Message', data.message ]
			]
		});
	},
	
	async cmd_delete_alert() {
		// Deletes use exact IDs only.  Definition IDs take precedence.
		await this.getMultiple();
		var id = this.getAlertIDArgument('Alert');
		var resolved = await this.resolveAlert(id, false);
		if (!resolved) return this.die("Could not find Alert Definition or Alert Invocation from ID: " + id);
		
		if (!this.args.confirm) {
			if (resolved.type == 'definition') {
				return this.die("Deleting Alert Definition #" + id + " also clears its live state and starts background deletion of all its Alert Invocations.  Add '--confirm' to continue.");
			}
			return this.die("Deleting Alert Invocation #" + id + " is permanent.  Add '--confirm' to continue.");
		}
		
		if (resolved.type == 'definition') {
			await this.callStandardAPI('deleteAlert', { id: id }, {
				text: 'Deleting Alert Definition and its invocations...'
			});
			if (this.dry) return;
			if (this.format.match(/json/)) return this.jsonOutput({ id: id, type: 'definition', deleted: true });
			this.toast('✅', 'green', "Deleted Alert Definition #" + id + "; invocation cleanup started in the background.");
		}
		else {
			await this.callStandardAPI('deleteAlertInvocation', { id: id }, {
				text: 'Deleting Alert Invocation...'
			});
			if (this.dry) return;
			if (this.format.match(/json/)) return this.jsonOutput({ id: id, type: 'invocation', deleted: true });
			this.toast('✅', 'green', "Successfully deleted Alert Invocation: #" + id);
		}
	},
	
	getAlertSelector() {
		// Consume a free-form selector for read operations.
		var selector = '';
		if (this.args.other && this.args.other.length) selector = this.args.other.join(' ');
		else if (this.args.id) selector = this.args.id;
		else if (this.args.title) selector = this.args.title;
		if (!selector) this.dieUsage('alert get');
		delete this.args.other;
		delete this.args.id;
		delete this.args.title;
		return String(selector);
	},
	
	getAlertIDArgument(label) {
		// Mutation targets must be one exact internal ID, never a fuzzy title.
		var id = this.args.id;
		if (this.args.other && this.args.other.length) id = this.args.other.shift();
		if (!id) this.die("Missing required " + label + " ID argument.");
		if (this.args.other && this.args.other.length) this.die("Unexpected argument after " + label + " ID: " + this.args.other[0]);
		return String(id);
	},
	
	async resolveAlert(selector, allow_fuzzy) {
		// Definition IDs are checked first because definitions are already cached
		// locally.  Invocation fetch errors are represented as per-item stubs.
		var definition = Tools.findObject(this.alerts, { id: selector });
		if (definition) return { type: 'definition', alert: definition };
		
		var invocation = await this.fetchAlertInvocation(selector);
		if (invocation) return { type: 'invocation', alert: invocation };
		
		if (allow_fuzzy) {
			var fuzzy_definition = this.findObjectFuzzy(this.alerts, { title: selector });
			if (fuzzy_definition) return { type: 'definition', alert: fuzzy_definition };
		}
		return null;
	},
	
	async fetchAlertInvocation(id) {
		// getAlertInvocations keeps positional error stubs inside a successful
		// response, so normalize those to a simple not-found result here.
		cli.progress.start();
		var { err, data } = await this.api.getAlertInvocations({ ids: id });
		cli.progress.end();
		if (err) this.die(err);
		var alert = data.alerts && data.alerts[0];
		return (alert && !alert.err) ? alert : null;
	},
	
	parseAlertBoolean(value, name) {
		// pixl-cli handles literal true and false globally; include conventional
		// flag and numeric spellings for values arriving from JSON or config files.
		if ((value === true) || (value === 1) || (value === '1')) return true;
		if ((value === false) || (value === 0) || (value === '0')) return false;
		if (String(value).match(/^(yes|on)$/i)) return true;
		if (String(value).match(/^(no|off)$/i)) return false;
		this.die("Invalid boolean value for '" + name + "': " + value);
	},
	
	parseAlertList(value) {
		// Accept JSON arrays, repeated options, or convenient comma-separated IDs.
		if ((value === undefined) || (value === null) || (value === '')) return [];
		return Tools.alwaysArray(value).reduce( function(list, item) {
			if (Array.isArray(item)) return list.concat(item);
			return list.concat(String(item).split(/\s*,\s*/));
		}, [] ).filter( item => !!item );
	},
	
	processAlertDefinitionUpdates(alert) {
		// Convert short CLI option names into the xyOps Alert data model.
		var aliases = {
			monitor: 'monitor_id',
			'limit-jobs': 'limit_jobs',
			'abort-jobs': 'abort_jobs',
			exclusive: 'exclusive_actions'
		};
		Object.keys(aliases).forEach( alias => {
			if (alias in alert) {
				alert[aliases[alias]] = alert[alias];
				delete alert[alias];
			}
		});
		
		if ('group' in alert) {
			alert.groups = this.parseAlertList(alert.groups).concat(this.parseAlertList(alert.group));
			delete alert.group;
		}
		else alert.groups = this.parseAlertList(alert.groups);
		alert.groups = Array.from(new Set(alert.groups));
		
		if (!Array.isArray(alert.actions)) {
			if (!alert.actions) alert.actions = [];
			else alert.actions = [alert.actions];
		}
		if ('action' in alert) {
			alert.actions = alert.actions.concat(Tools.alwaysArray(alert.action));
			delete alert.action;
		}
		
		['enabled', 'exclusive_actions', 'limit_jobs', 'abort_jobs'].forEach( key => {
			if (key in alert) alert[key] = this.parseAlertBoolean(alert[key], key);
		});
		
		alert.samples = Number(alert.samples || 1);
		if (!Number.isInteger(alert.samples) || (alert.samples < 1) || (alert.samples > 59)) {
			this.die("Alert samples must be an integer from 1 through 59.");
		}
		
		if ((alert.monitor_id === false) || (alert.monitor_id === null) || (alert.monitor_id == 'none')) alert.monitor_id = '';
		if ((alert.icon === false) || (alert.icon === null) || (alert.icon == 'none')) alert.icon = '';
	},
	
	validateAlertDefinition(alert) {
		// Fail early with CLI-specific guidance before asking the API to validate
		// expression syntax, message macros, groups, and action structures.
		['title', 'expression', 'message'].forEach( key => {
			if (!alert[key] || !String(alert[key]).trim()) this.die("Alert Definition requires a non-empty '" + key + "'.");
			alert[key] = String(alert[key]).trim();
		});
	},
	
	getNiceAlertGroups(groups, empty_text) {
		// Alert definitions with no group restriction apply to every server group.
		if (!groups || !groups.length) return gray(empty_text || '(None)');
		return groups.map( id => this.getNiceGroup(id) ).join(', ');
	},
	
	printAlertDefinition(alert) {
		// Human-readable definition detail, explicitly labeled to avoid confusing
		// it with an invocation record.
		var monitor = Tools.findObject(this.monitors, { id: alert.monitor_id });
		var nice_monitor = monitor ? monitor.title + gray(' (' + monitor.id + ')') : (alert.monitor_id || gray('(None)'));
		this.printBoxList({
			title: 'Alert Definition Summary',
			rows: [
				[ 'Alert ID', gray(alert.id) ],
				[ 'Title', this.color('theme').bold(alert.title) ],
				[ 'Status', this.getNiceEnabled(alert.enabled) ],
				[ 'Expression', alert.expression ],
				[ 'Message', alert.message ],
				[ 'Groups', this.getNiceAlertGroups(alert.groups, '(All)') ],
				[ 'Samples', Tools.commify(alert.samples || 1) ],
				[ 'Monitor Overlay', nice_monitor ],
				[ 'Limit Jobs', alert.limit_jobs ? green('Yes') : gray('No') ],
				[ 'Abort Jobs', alert.abort_jobs ? red('Yes') : gray('No') ],
				[ 'Exclusive Actions', alert.exclusive_actions ? green('Yes') : gray('No') ],
				[ 'Notes', alert.notes || gray('(None)') ],
				[ 'Author', alert.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(alert.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(alert.modified, true, true) ],
				[ 'Revision', alert.revision || 1 ]
			]
		});
		this.printAlertDefinitionActions(alert);
		this.printSuggestedCommands({
			"Test alert definition": `xy alert test ${alert.id} --server SERVER_ID_OR_TITLE`,
			"Update alert definition": `xy alert update ${alert.id} [--KEY VALUE, ...]`,
			"Find its invocations": `xy alerts search --alert ${alert.id}`,
			"Delete alert definition": `xy alert delete ${alert.id} --confirm`
		});
	},
	
	printAlertDefinitionActions(alert) {
		// Configured actions describe future behavior and do not have result data.
		var actions = alert.actions || [];
		if (!actions.length) return;
		this.printBoxTable({
			title: 'Alert Definition Actions',
			header: ['Condition', 'Type', 'Description', 'Status'],
			rows: actions.map( action => {
				var disp = this.getJobActionDisplayArgs(action);
				return [
					this.color(disp.condition.color).bold(disp.condition.title),
					disp.type || Tools.ucfirst(action.type || 'Unknown'),
					disp.desc || 'n/a',
					this.getNiceEnabled(action.enabled)
				];
			})
		});
	},
	
	async printAlertInvocation(alert) {
		// Match the web UI's core invocation summary, then include the useful
		// related records that can be rendered with existing CLI helpers.
		var definition = Tools.findObject(this.alerts, { id: alert.alert });
		var nice_definition = definition ? definition.title + gray(' (' + definition.id + ')') : alert.alert;
		var completed = alert.active ? this.epoch : (alert.modified || alert.date);
		var elapsed = Math.max(0, Math.floor(completed - alert.date));
		
		this.printBoxList({
			title: 'Alert Invocation Summary',
			rows: [
				[ 'Invocation ID', gray(alert.id) ],
				[ 'Alert Definition', nice_definition ],
				[ 'Message', this.color('theme').bold(alert.message || '(None)') ],
				[ 'Server', this.getNiceServer(alert.server) + gray(' (' + alert.server + ')') ],
				[ 'Status', this.getNiceAlertStatus(alert) ],
				[ 'Started', this.getNiceDateTime(alert.date, true, true) ],
				[ 'Duration', Tools.getTextFromSeconds(elapsed, false, true) ],
				[ 'Expression', alert.exp || gray('(Unavailable)') ],
				[ 'Groups', this.getNiceAlertGroups(alert.groups) ],
				[ 'Notified', alert.notified ? green('Yes') : gray('No') ],
				[ 'Sample Count', Tools.commify(alert.count || 0) ]
			]
		});
		
		this.printAlertInvocationActions(alert);
		await this.printSnapshots({
			title: 'Alert Invocation Snapshots',
			query: 'alerts:' + alert.id,
			offset: 0,
			hide_empty: true
		});
		await this.printTickets({
			title: 'Alert Invocation Tickets',
			ids: alert.tickets || [],
			offset: 0,
			hide_empty: true
		});
		await this.printCompletedJobs({
			title: 'Alert Invocation Jobs',
			ids: alert.jobs || [],
			offset: 0,
			hide_empty: true
		});
		
		this.printSuggestedCommands({
			"View alert definition": `xy alert ${alert.alert}`,
			"Similar invocations": `xy alerts search --alert ${alert.alert} --server ${alert.server}`,
			"Delete this invocation": `xy alert delete ${alert.id} --confirm`
		});
	},
	
	printAlertInvocationActions(alert) {
		// Invocation actions include only executions that actually ran.
		var actions = (alert.actions || []).filter( function(action) {
			return !!(action.date && !action.hidden);
		});
		if (!actions.length) return;
		actions.sort( function(a, b) { return a.date - b.date; } );
		
		this.printBoxTable({
			title: 'Alert Invocation Actions',
			header: ['Condition', 'Type', 'Source', 'Description', 'Date / Time', 'Result', 'Elapsed'],
			rows: actions.map( action => {
				var disp = this.getJobActionDisplayArgs(action);
				var elapsed_ms = Math.max(0, Math.floor(action.elapsed_ms || 0));
				var nice_elapsed = (elapsed_ms < 1000) ? Tools.commify(elapsed_ms) + ' ms' : Tools.getTextFromSeconds(elapsed_ms / 1000, true, true);
				var result = action.code ? cli.emoji('🛑') + ' ' + red.bold('Error') : cli.emoji('✅') + ' ' + green.bold('Success');
				if (action.code && action.description) result += gray(' (' + String(action.description).replace(/\s+/g, ' ').trim() + ')');
				return [
					this.color(disp.condition.color).bold(disp.condition.title),
					disp.type || Tools.ucfirst(action.type || 'Unknown'),
					Tools.ucfirst(String(action.source || 'alert')),
					disp.desc || 'n/a',
					this.getRelativeDateTime(action.date, true),
					result,
					nice_elapsed
				];
			})
		});
	}
	
}; // module.exports
