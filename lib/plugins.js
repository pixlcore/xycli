// Plugins Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_plugins() {
		// The plural command lists Plugin definitions with optional filters.
		await this.cmd_get_plugins();
	},
	
	async cmd_plugin() {
		// Route the singular command, while keeping a bare ID or title convenient.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('plugin');
		
		switch (cmd) {
			case 'list': await this.cmd_get_plugins(); break;
			case 'get': await this.cmd_get_plugin(); break;
			case 'create': await this.cmd_create_plugin(); break;
			case 'update': await this.cmd_update_plugin(); break;
			case 'delete': await this.cmd_delete_plugin(); break;
			
			default:
				this.args.other.unshift(cmd);
				await this.cmd_get_plugin();
			break;
		}
	},
	
	async cmd_get_plugins() {
		// Plugin data is cached by getMultiple(), so filtering and pagination are
		// performed locally without making a separate API request for each page.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var plugins = this.plugins.slice(0);
		var is_filtered = !!this.args.other.length;
		
		if (is_filtered) {
			var search = this.args.other.join(' ');
			plugins = this.findObjectsFuzzy(plugins, {
				id: search,
				title: search,
				command: search,
				script: search,
				notes: search
			}, 1);
		}
		delete this.args.other;
		
		if ('enabled' in this.args) {
			var enabled = this.parsePluginBoolean(this.args.enabled, 'enabled');
			plugins = plugins.filter( plugin => !!plugin.enabled === enabled );
			delete this.args.enabled;
			is_filtered = true;
		}
		
		if ('type' in this.args) {
			var type = this.parsePluginType(this.args.type);
			plugins = plugins.filter( plugin => plugin.type === type );
			delete this.args.type;
			is_filtered = true;
		}
		
		if (Tools.numKeys(this.args)) {
			plugins = this.findObjectsFuzzy(plugins, this.args);
			is_filtered = true;
		}
		
		plugins.sort( (a, b) => String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase()) );
		if (this.format.match(/json/)) return this.jsonOutput(plugins);
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Plugins' : 'All Plugins',
			header: ['Plugin ID', 'Title', 'Type', 'Status', 'Parameters', 'Modified'],
			rows: plugins.slice(this.offset, this.offset + this.limit),
			list: { length: plugins.length },
			offset: this.offset,
			limit: this.limit
		}, plugin => [
			this.color('theme').bold(plugin.id),
			bold(this.getNicePlugin(plugin)),
			this.getNicePluginType(plugin.type),
			this.getNiceEnabled(plugin.enabled),
			(plugin.type == 'monitor') ? gray('(Monitor)') : Tools.commify((plugin.params || []).length),
			this.getRelativeDateTime(plugin.modified, true)
		]);
		
		this.printSuggestedCommands({
			"View Plugin details": "xy plugin PLUGIN_ID_OR_TITLE",
			"Create an Event Plugin": 'xy plugin create --title "My Plugin" --type event --command node --script @plugin.js',
			"List Monitor Plugins": "xy plugins --type monitor",
			"List disabled Plugins": "xy plugins --enabled false"
		});
	},
	
	async cmd_get_plugin() {
		// Exact IDs take precedence over fuzzy title matching for read-only access.
		await this.getMultiple();
		
		var selector = this.args.other.join(' ') || this.args.id || this.args.title;
		if (!selector) return this.dieUsage('plugin get');
		
		var plugin = await this.findPlugin(selector);
		if (this.format.match(/json/)) return this.jsonOutput(plugin);
		
		var script = plugin.script || '';
		// Do not count the empty element created by a conventional trailing EOL.
		var script_lines = script ? script.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
		var source = plugin.marketplace ? 'Marketplace' : (plugin.stock ? 'xyOps Default' : (plugin.username || '(Unknown)'));
		
		this.printBoxList({
			title: 'Plugin Summary',
			rows: [
				[ 'Plugin ID', gray(plugin.id) ],
				[ 'Title', this.color('theme').bold(plugin.title) ],
				[ 'Status', this.getNiceEnabled(plugin.enabled) ],
				[ 'Type', this.getNicePluginType(plugin.type) ],
				[ 'Icon', plugin.icon || gray('(None)') ],
				[ 'Command', plugin.command ],
				[ 'Script', script ? Tools.commify(script_lines) + ' ' + Tools.pluralize('line', script_lines) + ', ' + Tools.getTextFromBytes(Buffer.byteLength(script)) : gray('(None)') ],
				(plugin.type == 'monitor') ? [ 'Groups', this.getNicePluginGroups(plugin.groups) ] : null,
				(plugin.type == 'monitor') ? [ 'Format', String(plugin.format || 'text').toUpperCase() ] : null,
				(plugin.type == 'monitor') ? [ 'Quick Monitor', plugin.quick ? green('Yes') : gray('No') ] : null,
				(plugin.type == 'event') ? [ 'Abort Policy', plugin.kill || 'parent' ] : null,
				(plugin.type == 'event') ? [ 'Remote Runner', plugin.runner ? green('Yes') : gray('No') ] : null,
				[ 'Run as User', ('uid' in plugin) && (plugin.uid !== '') ? plugin.uid : gray('(Default)') ],
				[ 'Run as Group', ('gid' in plugin) && (plugin.gid !== '') ? plugin.gid : gray('(Default)') ],
				[ 'Source', source ],
				[ 'Created', this.getNiceDateTime(plugin.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(plugin.modified, true, true) ],
				[ 'Revision', plugin.revision || 1 ]
			]
		});
		
		// User notes may contain multiple lines, so keep them out of the summary box.
		if (plugin.notes) {
			this.printUserNotes('PLUGIN NOTES', plugin.notes);
		}
		
		if (plugin.type != 'monitor') {
			this.printParamFields({
				title: 'Plugin Parameters',
				fields: plugin.params || []
			});
		}
		
		// Keep potentially large source behind verbose mode in the normal detail view.
		this.printPluginScript(plugin, { verboseOnly: true });
		
		this.printSuggestedCommands({
			"Update Plugin": `xy plugin update ${plugin.id} --notes "My notes"`,
			"Export Plugin": `xy plugin ${plugin.id} --export plugin.json`,
			"Disable Plugin": plugin.enabled ? `xy plugin update ${plugin.id} --enabled false` : '',
			"Delete Plugin": `xy plugin delete ${plugin.id}`
		});
	},
	
	async cmd_create_plugin() {
		// These defaults match a fresh Plugin in the xyOps web editor. Type-specific
		// fields are normalized below after all user input has been applied.
		if (this.args.other.length) return this.dieUsage('plugin create');
		delete this.args.other;
		
		var params = this.preparePluginParams({
			enabled: true,
			type: 'event',
			icon: '',
			command: '',
			script: '',
			params: [],
			groups: [],
			format: '',
			uid: '',
			gid: '',
			kill: 'parent',
			runner: false,
			notes: ''
		}, this.args, true);
		
		if (!params.title || !params.command) return this.dieUsage('plugin create');
		
		var data = await this.callStandardAPI('createPlugin', params, { text: 'Creating Plugin...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.plugin);
		
		this.toast('✅', 'green', "Successfully created Plugin: #" + data.plugin.id);
		this.printSuggestedCommands({
			"View Plugin details": `xy plugin ${data.plugin.id}`,
			"Update Plugin": `xy plugin update ${data.plugin.id} --notes "My notes"`,
			"Add a parameter": data.plugin.type == 'monitor' ? '' : `xy plugin update ${data.plugin.id} --param '{ "id":"name", "title":"Name", "type":"text", "value":"World" }'`,
			"List all Plugins": "xy plugins"
		});
	},
	
	async cmd_update_plugin() {
		// Fetch the authoritative definition so indexed parameter/group changes can
		// preserve all untouched entries while the outgoing API request stays sparse.
		var id = this.consumePluginID();
		var plugin = await this.fetchPlugin(id);
		
		this.printMutationSummary({
			title: 'Update Plugin',
			rows: [
				[ 'Plugin ID', gray(plugin.id) ],
				[ 'Title', this.color('theme').bold(plugin.title) ]
			]
		});
		
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for Plugin.");
		this.printUpdateData(this.args);
		
		var params = this.preparePluginParams(plugin, this.args, false);
		params.id = id;
		
		var data = await this.callStandardAPI('updatePlugin', params, { text: 'Updating Plugin...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		
		this.toast('✅', 'green', "Successfully updated Plugin: #" + id);
	},
	
	async cmd_delete_plugin() {
		var id = this.consumePluginID();
		var plugin = await this.fetchPlugin(id);
		
		this.printMutationSummary({
			title: 'Delete Plugin',
			rows: [
				[ 'Plugin ID', gray(plugin.id) ],
				[ 'Title', this.color('theme').bold(plugin.title) ]
			]
		});
		
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the Plugin delete by adding '--confirm'.");
			return;
		}
		
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Plugin delete option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('deletePlugin', { id: id }, { text: 'Deleting Plugin...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		
		this.toast('✅', 'green', "Successfully deleted Plugin: #" + id);
	},
	
	async findPlugin(selector) {
		var match = Tools.findObject(this.plugins, { id: selector }) || this.findObjectFuzzy(this.plugins, { title: selector });
		if (!match) this.die("Could not find Plugin based on your criteria: " + selector);
		return await this.fetchPlugin(match.id);
	},
	
	async fetchPlugin(id) {
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading Plugin...') });
		var { err, data } = await this.api.getPlugin({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		return data.plugin;
	},
	
	consumePluginID() {
		// Mutations always require the exact internal ID, never a fuzzy title.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing required Plugin ID argument.");
		if (this.args.other.length) this.die("Unexpected argument after Plugin ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Plugin ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die("Invalid Plugin ID: " + id);
		delete this.args.id;
		delete this.args.other;
		return id;
	},
	
	preparePluginParams(plugin, input, creating) {
		// Whole arrays replace first, dotted paths edit existing indexes next, and
		// singular --param / --group options append last. This is the same model used
		// by event fields and other CLI resources with editable arrays.
		//
		// --format is reserved globally for CLI output, so expose the Monitor Plugin
		// property as --plugin_format for ordinary command-line use. Complete JSON
		// request objects may still use the native `format` property.
		if ('plugin_format' in input) {
			if ('format' in input) this.die("Use either Plugin format or plugin_format, not both.");
			input.format = input.plugin_format;
			delete input.plugin_format;
		}
		
		var params = creating ? Tools.copyHash(plugin, true) : {};
		var fields = ['title', 'enabled', 'icon', 'command', 'script', 'params', 'param', 'groups', 'group', 'format', 'uid', 'gid', 'kill', 'runner', 'quick', 'notes'];
		if (creating) fields.push('id', 'type');
		
		Object.keys(input).forEach( key => {
			var root = key.split('.')[0];
			if (!fields.includes(root)) {
				if (!creating && (root == 'type')) this.die("Plugin type cannot be changed after creation.");
				this.die("Unsupported Plugin option: --" + key);
			}
			if (key.includes('.') && !['params', 'groups'].includes(root)) this.die("Invalid argument path: " + key);
			
			// Clone only the saved arrays needed for dotted edits or appends.
			if (!creating && ['params', 'param'].includes(root) && !('params' in params)) {
				params.params = Tools.copyHash({ value: plugin.params || [] }, true).value;
			}
			if (!creating && ['groups', 'group'].includes(root) && !('groups' in params)) {
				params.groups = Tools.copyHash({ value: plugin.groups || [] }, true).value;
			}
		});
		
		// Apply ordinary options before dotted edits, independent of option order.
		Object.keys(input).filter( key => !key.includes('.') ).forEach( key => { params[key] = input[key]; } );
		var dotted = {};
		Object.keys(input).filter( key => key.includes('.') ).forEach( key => { dotted[key] = input[key]; } );
		this.mergeDotArgs(params, dotted);
		
		if ('param' in params) {
			if (!('params' in params)) params.params = [];
			if (!Array.isArray(params.params)) this.die("Plugin params must be a JSON array.");
			this.parsePluginObjects(params.param, 'param').forEach( item => { params.params.push(item); } );
			delete params.param;
		}
		if ('params' in params) {
			if (!Array.isArray(params.params)) this.die("Plugin params must be a JSON array.");
			params.params.forEach( (param, idx) => { this.validatePluginParam(param, idx); } );
			this.validatePluginParamIDs(params.params);
		}
		
		if ('group' in params) {
			if (!('groups' in params)) params.groups = [];
			params.groups = this.parsePluginGroups(params.groups).concat(this.parsePluginGroups(params.group));
			params.groups = Array.from(new Set(params.groups));
			delete params.group;
		}
		if ('groups' in params) params.groups = Array.from(new Set(this.parsePluginGroups(params.groups)));
		
		if ('title' in params) {
			if ((typeof(params.title) != 'string') || !params.title.trim()) this.die("Plugin title cannot be empty and must be a string.");
			params.title = params.title.trim();
		}
		if ('command' in params) {
			if ((typeof(params.command) != 'string') || !params.command.trim()) this.die("Plugin command cannot be empty and must be a string.");
			params.command = params.command.trim();
		}
		if ('enabled' in params) params.enabled = this.parsePluginBoolean(params.enabled, 'enabled');
		['icon', 'script', 'notes'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die("Plugin " + key + " must be a string.");
		});
		['uid', 'gid'].forEach( key => {
			if ((key in params) && !['string', 'number'].includes(typeof(params[key]))) this.die("Plugin " + key + " must be a string or number.");
		});
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) this.die("Invalid Plugin ID: " + params.id);
		
		var type = creating ? this.parsePluginType(params.type) : plugin.type;
		if (creating) params.type = type;
		
		// Keep the wire object aligned with the web editor and reject settings that
		// have no meaning for the selected Plugin type.
		if (type == 'monitor') {
			if (('params' in input) && input.params.length) this.die("Monitor Plugins do not support parameter definitions.");
			if ('param' in input) this.die("Monitor Plugins do not support parameter definitions.");
			if (('kill' in input) || ('runner' in input)) this.die("Monitor Plugins do not support Event Plugin process options.");
			
			if (creating) params.params = [];
			if (!('groups' in params) && creating) params.groups = [];
			if (creating && !params.format) params.format = 'text';
			if (!('quick' in params) && creating) params.quick = false;
			if (('format' in params) && !['text', 'json', 'xml'].includes(params.format)) this.die("Monitor Plugin format must be text, json, or xml.");
			if ('quick' in params) params.quick = this.parsePluginBoolean(params.quick, 'quick');
			delete params.kill;
			delete params.runner;
		}
		else {
			if (('groups' in input) || ('group' in input) || ('format' in input) || ('quick' in input)) {
				this.die(Tools.ucfirst(type) + " Plugins do not support Monitor Plugin options.");
			}
			
			if (creating) {
				params.groups = [];
				params.format = '';
			}
			delete params.quick;
			
			if (type == 'event') {
				if (('kill' in params) && !['none', 'parent', 'all'].includes(params.kill)) this.die("Event Plugin kill must be none, parent, or all.");
				if ('runner' in params) params.runner = this.parsePluginBoolean(params.runner, 'runner');
			}
			else {
				if (('kill' in input) || ('runner' in input)) this.die(Tools.ucfirst(type) + " Plugins do not support Event Plugin process options.");
				delete params.kill;
				delete params.runner;
			}
		}
		
		return params;
	},
	
	parsePluginObjects(value, name) {
		// Repeated command-line options arrive as an array of JSON strings. A single
		// parsed object and repeated objects both become a clean object array here.
		return Tools.alwaysArray(value).map( item => {
			if (typeof(item) == 'string') {
				try { item = JSON.parse(item); }
				catch (err) { this.die("Plugin --" + name + " must contain a JSON object."); }
			}
			if (!Tools.isaHash(item)) this.die("Plugin --" + name + " must contain a JSON object.");
			return item;
		});
	},
	
	validatePluginParam(param, idx) {
		// Perform the common schema checks locally for good dry-run feedback. The
		// xyOps API remains authoritative for specialized toolset configuration.
		var prefix = 'Plugin params.' + idx;
		if (!Tools.isaHash(param)) this.die(prefix + " must be a JSON object.");
		if ((typeof(param.id) != 'string') || !param.id.match(/^[A-Za-z_][\w.\-]*$/) || param.id.match(Tools.MATCH_BAD_KEY)) this.die(prefix + ".id is invalid.");
		if ((typeof(param.title) != 'string') || !param.title.trim() || param.title.match(/[<>]/)) this.die(prefix + ".title is invalid.");
		if ((typeof(param.type) != 'string') || !this.config.ui.control_type_labels[param.type]) this.die(prefix + ".type is invalid.");
		if (('caption' in param) && (typeof(param.caption) != 'string')) this.die(prefix + ".caption must be a string.");
		if (param.caption && param.caption.match(/[<>]/)) this.die(prefix + ".caption contains illegal characters.");
		
		['required', 'locked'].forEach( key => {
			if (key in param) param[key] = this.parsePluginBoolean(param[key], prefix + '.' + key);
		});
		
		if ((param.type == 'text') && param.variant) {
			var variants = (this.config.ui.text_field_variants || []).map( item => item.id );
			if (!variants.includes(param.variant)) this.die(prefix + ".variant is invalid.");
		}
		if (param.regex) {
			try { new RegExp(param.regex); }
			catch (err) { this.die(prefix + ".regex is invalid: " + err.message); }
		}
		
		if (param.type.match(/^(checkbox|code|hidden|json|select|text|textarea)$/) && !('value' in param)) this.die(prefix + ".value is required for type " + param.type + '.');
		if ((param.type == 'checkbox') && ('value' in param)) param.value = this.parsePluginBoolean(param.value, prefix + '.value');
		if ((param.type == 'json') && (typeof(param.value) != 'object')) this.die(prefix + ".value must be a JSON object.");
		if ((param.type == 'text') && (param.variant == 'number') && (param.value !== null) && !Number.isFinite(param.value)) this.die(prefix + ".value must be a number or null.");
		if (param.type.match(/^(code|hidden|select|textarea)$/) && (typeof(param.value) != 'string')) this.die(prefix + ".value must be a string.");
		if ((param.type == 'text') && (param.variant != 'number') && (typeof(param.value) != 'string')) this.die(prefix + ".value must be a string.");
	},
	
	validatePluginParamIDs(params) {
		var ids = {};
		params.forEach( param => {
			if (ids[param.id]) this.die("Duplicate Plugin parameter ID: " + param.id);
			ids[param.id] = true;
		});
	},
	
	parsePluginGroups(value) {
		var groups = Array.isArray(value) ? value.slice(0) : ((typeof(value) == 'string') ? value.split(',') : null);
		if (!groups) this.die("Plugin groups must be a JSON array or comma-separated group IDs.");
		return groups.map( id => {
			if ((typeof(id) != 'string') || !id.trim().match(/^[a-z0-9_]+$/)) this.die("Invalid server group ID: " + id);
			return id.trim();
		});
	},
	
	parsePluginType(value) {
		if ((typeof(value) != 'string') || !['event', 'monitor', 'action', 'scheduler'].includes(value)) {
			this.die("Plugin type must be event, monitor, action, or scheduler.");
		}
		return value;
	},
	
	parsePluginBoolean(value, key) {
		if ([true, 1, '1', 'true', 'yes', 'on'].includes(value)) return true;
		if ([false, 0, '0', 'false', 'no', 'off'].includes(value)) return false;
		this.die("Invalid boolean value for '" + key + "': " + value);
	},
	
	getNicePluginType(type) {
		var labels = {
			event: 'Event',
			monitor: 'Monitor',
			action: 'Action',
			scheduler: 'Scheduler'
		};
		return labels[type] || Tools.ucfirst(type || 'Unknown');
	},
	
	getNicePluginGroups(groups) {
		if (!groups || !groups.length) return gray('All Groups');
		return groups.map( id => this.getNiceGroup(id) + gray(' (' + id + ')') ).join(', ');
	}
	
}; // module.exports
