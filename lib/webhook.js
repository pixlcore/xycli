// Web Hook Management Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

const WEB_HOOK_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const WEB_HOOK_FIELDS = [
	'title', 'enabled', 'icon', 'url', 'method', 'headers', 'header', 'body',
	'timeout', 'retries', 'follow', 'ssl_cert_bypass', 'max_per_day', 'notes'
];

module.exports = {
	
	async cmd_hooks() {
		// Short user-friendly alias for the canonical webhooks command.
		await this.cmd_webhooks();
	},
	
	async cmd_hook() {
		// Short user-friendly alias for the canonical webhook command.
		await this.cmd_webhook();
	},
	
	async cmd_webhooks() {
		await this.cmd_get_webhooks();
	},
	
	async cmd_webhook() {
		// Route Web Hook operations, or treat a bare ID or title as a detail lookup.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('webhook');
		
		switch (cmd) {
			case 'list': await this.cmd_get_webhooks(); break;
			case 'get': await this.cmd_get_webhook(); break;
			case 'create': await this.cmd_create_webhook(); break;
			case 'update': await this.cmd_update_webhook(); break;
			case 'test': await this.cmd_test_webhook(); break;
			case 'delete': await this.cmd_delete_webhook(); break;
			
			default:
				this.args.other.unshift(cmd);
				await this.cmd_get_webhook();
			break;
		}
	},
	
	async cmd_get_webhooks() {
		// Web Hooks are included in getMultiple, so filtering and pagination can
		// happen locally without extra API requests.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var hooks = this.web_hooks.slice(0);
		var is_filtered = !!this.args.other.length;
		if (is_filtered) {
			var search = this.args.other.join(' ');
			hooks = this.findObjectsFuzzy(hooks, {
				id: search,
				title: search,
				url: search,
				notes: search,
				username: search
			}, 1);
		}
		delete this.args.other;
		
		if ('enabled' in this.args) {
			var enabled = this.parseWebHookBoolean(this.args.enabled, 'enabled');
			hooks = hooks.filter( hook => !!hook.enabled === enabled );
			delete this.args.enabled;
			is_filtered = true;
		}
		if ('method' in this.args) {
			var method = String(this.args.method).toUpperCase();
			hooks = hooks.filter( hook => String(hook.method).toUpperCase() === method );
			delete this.args.method;
			is_filtered = true;
		}
		if (Tools.numKeys(this.args)) {
			hooks = this.findObjectsFuzzy(hooks, this.args);
			is_filtered = true;
		}
		
		hooks.sort( (a, b) => String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase()) );
		if (this.format.match(/json/)) return this.jsonOutput(hooks);
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Web Hooks' : 'All Web Hooks',
			header: ['Hook ID', 'Title', 'Method', 'URL', 'Status', 'Modified'],
			rows: hooks.slice(this.offset, this.offset + this.limit),
			list: { length: hooks.length },
			offset: this.offset,
			limit: this.limit
		}, hook => [
			this.color('theme').bold(hook.id),
			bold(hook.title),
			String(hook.method || '').toUpperCase(),
			hook.url,
			this.getNiceEnabled(hook.enabled),
			this.getRelativeDateTime(hook.modified, true)
		]);
		
		this.printSuggestedCommands({
			"View Hook details": "xy hook HOOK_ID_OR_TITLE",
			"Create a Hook": 'xy hook create --title "My Hook" --url https://example.com/hook',
			"List disabled Hooks": "xy hooks --enabled false",
			"Test a Hook": "xy hook test HOOK_ID"
		});
	},
	
	async cmd_get_webhook() {
		// Exact IDs take priority, while fuzzy titles are safe for read-only views.
		await this.getMultiple();
		var selector = this.args.other.join(' ') || this.args.id || this.args.title;
		if (!selector) return this.dieUsage('webhook get');
		
		delete this.args.other;
		delete this.args.id;
		delete this.args.title;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Web Hook get option: --" + Tools.firstKey(this.args));
		
		var match = Tools.findObject(this.web_hooks, { id: selector }) || this.findObjectFuzzy(this.web_hooks, { title: selector });
		if (!match) return this.die("Could not find Web Hook based on your criteria: " + selector);
		var hook = await this.fetchWebHook(match.id);
		if (this.format.match(/json/)) return this.jsonOutput(hook);
		
		this.printBoxList({
			title: 'Web Hook Summary',
			rows: [
				[ 'Hook ID', gray(hook.id) ],
				[ 'Title', this.color('theme').bold(hook.title) ],
				[ 'Status', this.getNiceEnabled(hook.enabled) ],
				[ 'Icon', hook.icon || gray('(None)') ],
				[ 'URL', hook.url ],
				[ 'Method', String(hook.method || '').toUpperCase() ],
				[ 'Timeout', hook.timeout ? Tools.getTextFromSeconds(hook.timeout, false, true) : 'Infinite' ],
				[ 'Retries', Tools.commify(hook.retries || 0) ],
				[ 'Follow Redirects', hook.follow ? green('Yes') : gray('No') ],
				[ 'SSL Cert Bypass', hook.ssl_cert_bypass ? yellow('Yes') : gray('No') ],
				[ 'Daily Cap', hook.max_per_day ? Tools.commify(hook.max_per_day) : 'Unlimited' ],
				[ 'Author', hook.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(hook.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(hook.modified, true, true) ],
				[ 'Revision', hook.revision || 1 ]
			]
		});
		
		this.printBoxTable({
			title: 'Web Hook Headers',
			header: ['#', 'Name', 'Value'],
			rows: (hook.headers || []).map( (header, idx) => [idx, header.name, header.value] )
		});
		
		// Bodies may contain JSON, form data, XML, or arbitrary multiline text.
		this.printWebHookBody(hook.body);
		if (hook.notes) this.printUserNotes('WEB HOOK NOTES', hook.notes);
		
		this.printSuggestedCommands({
			"Test Hook": `xy hook test ${hook.id}`,
			"Export Hook": `xy hook ${hook.id} --export hook.json`,
			"Update Hook": `xy hook update ${hook.id} --timeout 60`,
			"Replace headers": `xy hook update ${hook.id} --headers @headers.json`,
			"Delete Hook": `xy hook delete ${hook.id}`
		});
	},
	
	async cmd_create_webhook() {
		// Defaults mirror the web editor and provide a useful JSON request template.
		if (this.args.other.length) return this.dieUsage('webhook create');
		delete this.args.other;
		
		var params = this.prepareWebHookParams({
			enabled: true,
			icon: '',
			url: '',
			method: 'POST',
			headers: [
				{ name: 'Content-Type', value: 'application/json' },
				{ name: 'User-Agent', value: 'xyOps/WebHook' }
			],
			body: JSON.stringify({ content: '[description]', text: '[description]' }, null, "\t"),
			timeout: 30,
			retries: 0,
			follow: false,
			ssl_cert_bypass: false,
			max_per_day: 0,
			notes: ''
		}, this.args, true);
		if (!params.title || !params.url) return this.dieUsage('webhook create');
		
		var data = await this.callStandardAPI('createWebHook', params, { text: 'Creating Web Hook...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.web_hook);
		
		this.toast('✅', 'green', "Successfully created Web Hook: #" + data.web_hook.id);
		this.printSuggestedCommands({
			"View Hook details": `xy hook ${data.web_hook.id}`,
			"Test Hook": `xy hook test ${data.web_hook.id}`,
			"Update Hook": `xy hook update ${data.web_hook.id} --timeout 60`,
			"List all Hooks": "xy hooks"
		});
	},
	
	async cmd_update_webhook() {
		var id = this.consumeWebHookID();
		var hook = await this.fetchWebHook(id);
		
		this.printWebHookMutationSummary('Update Web Hook', hook);
		if (!await this.confirmSyncUpdate('web_hook', hook.id, 'Web Hook')) return;
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for Web Hook.");
		this.printUpdateData(this.args);
		
		var params = this.prepareWebHookParams(hook, this.args, false);
		params.id = id;
		var data = await this.callStandardAPI('updateWebHook', params, { text: 'Updating Web Hook...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully updated Web Hook: #" + id);
	},
	
	async cmd_test_webhook() {
		// Test starts with the saved definition, then applies temporary CLI changes.
		// Nothing is persisted, but the resulting HTTP request is real unless --dry.
		var id = this.consumeWebHookID();
		var hook = await this.fetchWebHook(id);
		this.printWebHookMutationSummary('Test Web Hook', hook);
		
		var overrides = this.prepareWebHookParams(hook, this.args, false);
		var params = {};
		['id'].concat(WEB_HOOK_FIELDS.filter( key => key != 'header' )).forEach( key => {
			if (key in hook) params[key] = Tools.copyHash({ value: hook[key] }, true).value;
		});
		Tools.mergeHashInto(params, overrides);
		params.id = id;
		
		var data = await this.callStandardAPI('testWebHook', params, { text: 'Testing Web Hook...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.result);
		
		var result = data.result || {};
		var details = String(result.details || '').trim();
		if (result.description) details = '**Result:** ' + result.description + (details ? "\n\n" + details : '');
		if (!details) details = result.code ? 'The Web Hook test failed without additional details.' : 'The Web Hook test completed without additional details.';
		
		var title = 'WEB HOOK TEST RESULTS';
		println( "\n " + (result.code ? red.bold(title) : this.color('theme').bold(title)) );
		println( "\n" + this.markdown(details).trimEnd() );
	},
	
	async cmd_delete_webhook() {
		var id = this.consumeWebHookID();
		var hook = await this.fetchWebHook(id);
		this.printWebHookMutationSummary('Delete Web Hook', hook);
		
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) {
			return this.die("Web Hook delete --confirm must be true or false.");
		}
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the Web Hook delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Web Hook delete option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('deleteWebHook', { id: id }, { text: 'Deleting Web Hook...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully deleted Web Hook: #" + id);
	},
	
	async fetchWebHook(id) {
		// Use the single-resource endpoint for authoritative data and access checks.
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading Web Hook...') });
		var { err, data } = await this.api.getWebHook({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		return data.web_hook;
	},
	
	consumeWebHookID() {
		// Updates, tests, and deletes require one exact internal ID.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing required Web Hook ID argument.");
		if (this.args.other.length) this.die("Unexpected argument after Web Hook ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Web Hook ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die("Invalid Web Hook ID: " + id);
		delete this.args.id;
		delete this.args.other;
		return id;
	},
	
	prepareWebHookParams(hook, input, creating) {
		// Whole header arrays replace the saved list.  Dotted edits start from the
		// current list, and singular --header options append after those edits.
		var params = creating ? Tools.copyHash(hook, true) : {};
		var allowed = WEB_HOOK_FIELDS.concat(creating ? ['id'] : []);
		Object.keys(input).forEach( key => {
			var root = key.split('.')[0];
			if (!allowed.includes(root)) this.die("Unsupported Web Hook option: --" + key);
			if (key.includes('.') && (root != 'headers')) this.die("Invalid argument path: " + key);
			if (!creating && ['headers', 'header'].includes(root) && !('headers' in params)) {
				params.headers = Tools.copyHash({ value: hook.headers || [] }, true).value;
			}
		});
		
		// Apply complete values first, then dotted edits, regardless of CLI order.
		Object.keys(input).filter( key => !key.includes('.') ).forEach( key => { params[key] = input[key]; } );
		var dotted = {};
		Object.keys(input).filter( key => key.includes('.') ).forEach( key => { dotted[key] = input[key]; } );
		this.mergeDotArgs(params, dotted);
		
		if ('header' in params) {
			if (!('headers' in params)) params.headers = [];
			if (!Array.isArray(params.headers)) this.die("Web Hook headers must be a JSON array.");
			Tools.alwaysArray(params.header).forEach( header => {
				if (typeof(header) == 'string') {
					try { header = JSON.parse(header); }
					catch (err) { this.die("Web Hook --header must contain a JSON object."); }
				}
				if (!Tools.isaHash(header)) this.die("Web Hook --header must contain a JSON object.");
				params.headers.push(header);
			});
			delete params.header;
		}
		if ('headers' in params) params.headers = this.validateWebHookHeaders(params.headers);
		
		if ('title' in params) {
			if ((typeof(params.title) != 'string') || !params.title.trim()) this.die("Web Hook title cannot be empty and must be a string.");
			params.title = params.title.trim();
		}
		if ('url' in params) {
			if (typeof(params.url) != 'string') this.die("Web Hook url must be a string.");
			params.url = params.url.trim();
			if (!params.url.match(/^(?:https?:\/\/|\{\{)/i)) this.die("Web Hook url must begin with http://, https://, or {{.");
		}
		if ('method' in params) {
			if (typeof(params.method) != 'string') this.die("Web Hook method must be a string.");
			params.method = params.method.toUpperCase();
			if (!WEB_HOOK_METHODS.includes(params.method)) this.die("Invalid Web Hook method: " + params.method);
		}
		['enabled', 'follow', 'ssl_cert_bypass'].forEach( key => {
			if (key in params) params[key] = this.parseWebHookBoolean(params[key], key);
		});
		['timeout', 'retries', 'max_per_day'].forEach( key => {
			if (!(key in params)) return;
			params[key] = Number(params[key]);
			if (!Number.isSafeInteger(params[key]) || (params[key] < 0)) {
				this.die("Web Hook " + key + " must be a non-negative integer.");
			}
		});
		if (('retries' in params) && (params.retries > 999)) this.die("Web Hook retries cannot exceed 999.");
		if (('max_per_day' in params) && (params.max_per_day > 9999999)) this.die("Web Hook max_per_day cannot exceed 9999999.");
		['icon', 'body', 'notes'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die("Web Hook " + key + " must be a string.");
		});
		if ('icon' in params) params.icon = params.icon.replace(/^mdi\-/, '');
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) {
			this.die("Invalid Web Hook ID: " + params.id);
		}
		return params;
	},
	
	validateWebHookHeaders(headers) {
		if (!Array.isArray(headers)) this.die("Web Hook headers must be a JSON array.");
		return headers.map( (header, idx) => {
			if (!Tools.isaHash(header)) this.die("Web Hook headers." + idx + " must be a JSON object.");
			var extra = Object.keys(header).find( key => !['name', 'value'].includes(key) );
			if (extra) this.die("Unsupported property in Web Hook headers." + idx + ': "' + extra + '".');
			if ((typeof(header.name) != 'string') || !header.name.match(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/)) {
				this.die("Invalid HTTP header name in Web Hook headers." + idx + ".");
			}
			if ((typeof(header.value) != 'string') || !header.value.match(/^[\t\x20-\x7E\x80-\xFF]*$/)) {
				this.die("Invalid HTTP header value in Web Hook headers." + idx + ".");
			}
			return { name: header.name, value: header.value };
		});
	},
	
	parseWebHookBoolean(value, name) {
		if ([true, 1, '1', 'true', 'yes', 'on'].includes(value)) return true;
		if ([false, 0, '0', 'false', 'no', 'off'].includes(value)) return false;
		this.die("Invalid boolean value for '" + name + "': " + value);
	},
	
	printWebHookMutationSummary(title, hook) {
		this.printMutationSummary({
			title: title,
			rows: [
				[ 'Hook ID', gray(hook.id) ],
				[ 'Title', this.color('theme').bold(hook.title) ]
			]
		});
	},
	
	printWebHookBody(body) {
		println( "\n " + this.color('theme').bold('WEB HOOK BODY') );
		if (!body) {
			println( " " + gray('(Empty)') );
			return;
		}
		
		body = String(body).trim();
		var language = '';
		if (body.match(/^\{[\s\S]*\}$/) || body.match(/^\[[\s\S]*\]$/)) language = 'json';
		
		var source_lines = body.split(/\r?\n/).map( line => '    ' + line ).join("\n");
		var highlight_opts = { ignoreIllegals: true };
		if (language) highlight_opts.language = language;
		
		println( "\n" + this.highlight(source_lines, highlight_opts) );
	}
	
}; // module.exports
