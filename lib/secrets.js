// Secret Vault Management Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_secrets() {
		// The plural command lists Secret Vault metadata only.  Decrypted values are
		// available exclusively through the explicit, confirmed decrypt command.
		await this.cmd_get_secrets();
	},
	
	async cmd_secret() {
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('secret');
		
		switch (cmd) {
			case 'list': await this.cmd_get_secrets(); break;
			case 'get': await this.cmd_get_secret(); break;
			case 'create': await this.cmd_create_secret(); break;
			case 'update': await this.cmd_update_secret(); break;
			case 'decrypt': await this.cmd_decrypt_secret(); break;
			case 'delete': await this.cmd_delete_secret(); break;
			
			default:
				// A bare ID or title opens the safe metadata view.
				this.args.other.unshift(cmd);
				await this.cmd_get_secret();
			break;
		}
	},
	
	async cmd_get_secrets() {
		// Secret values are never present in getMultiple(), so all listing and
		// filtering below operates exclusively on plaintext vault metadata.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var secrets = this.secrets.slice(0);
		var is_filtered = !!this.args.other.length;
		if (is_filtered) {
			var search = this.args.other.join(' ');
			secrets = this.findObjectsFuzzy(secrets, {
				id: search,
				title: search,
				notes: search,
				names: search
			}, 1);
		}
		delete this.args.other;
		
		if ('enabled' in this.args) {
			var enabled = this.parseSecretBoolean(this.args.enabled, 'enabled');
			secrets = secrets.filter( secret => !!secret.enabled === enabled );
			delete this.args.enabled;
			is_filtered = true;
		}
		
		var filters = {
			name: 'names',
			event: 'events',
			category: 'categories',
			plugin: 'plugins',
			web_hook: 'web_hooks',
			hook: 'web_hooks'
		};
		Object.keys(filters).forEach( key => {
			if (!(key in this.args)) return;
			var values = this.parseSecretList(this.args[key], key);
			var property = filters[key];
			secrets = secrets.filter( secret => values.every( value => (secret[property] || []).includes(value) ) );
			delete this.args[key];
			is_filtered = true;
		});
		
		if (Tools.numKeys(this.args)) {
			secrets = this.findObjectsFuzzy(secrets, this.args);
			is_filtered = true;
		}
		
		secrets.sort( (a, b) => String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase()) );
		if (this.format.match(/json/)) return this.jsonOutput(secrets);
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Secret Vaults' : 'All Secret Vaults',
			header: ['Vault ID', 'Title', 'Status', 'Variable Names', 'Assignments', 'Modified'],
			rows: secrets.slice(this.offset, this.offset + this.limit),
			list: { length: secrets.length },
			offset: this.offset,
			limit: this.limit
		}, secret => [
			this.color('theme').bold(secret.id),
			bold(secret.title),
			this.getNiceEnabled(secret.enabled),
			(secret.names || []).join(', ') || gray('(None)'),
			Tools.commify(['events', 'categories', 'plugins', 'web_hooks'].reduce( (total, key) => total + (secret[key] || []).length, 0 )),
			this.getRelativeDateTime(secret.modified, true)
		]);
		
		this.printSuggestedCommands({
			"View vault details": "xy secret SECRET_VAULT_ID_OR_TITLE",
			"Create a Secret Vault": 'xy secret create --title "My Vault" --fields @secrets.json',
			"List disabled vaults": "xy secrets --enabled false",
			"Find vaults containing a name": "xy secrets --name API_TOKEN"
		});
	},
	
	async cmd_get_secret() {
		await this.getMultiple();
		var selector = this.args.other.join(' ') || this.args.id || this.args.title;
		if (!selector) return this.dieUsage('secret get');
		
		delete this.args.other;
		delete this.args.id;
		delete this.args.title;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Secret Vault get option: --" + Tools.firstKey(this.args));
		
		var match = Tools.findObject(this.secrets, { id: selector }) || this.findObjectFuzzy(this.secrets, { title: selector });
		if (!match) return this.die("Could not find Secret Vault based on your criteria: " + selector);
		var secret = await this.fetchSecret(match.id);
		if (this.format.match(/json/)) return this.jsonOutput(secret);
		
		this.printBoxList({
			title: 'Secret Vault Summary',
			rows: [
				[ 'Vault ID', gray(secret.id) ],
				[ 'Title', this.color('theme').bold(secret.title) ],
				[ 'Status', this.getNiceEnabled(secret.enabled) ],
				[ 'Icon', secret.icon || gray('(None)') ],
				[ 'Variable Names', (secret.names || []).join(', ') || gray('(None)') ],
				[ 'Events', this.getNiceSecretAssignments('events', secret.events) ],
				[ 'Categories', this.getNiceSecretAssignments('categories', secret.categories) ],
				[ 'Plugins', this.getNiceSecretAssignments('plugins', secret.plugins) ],
				[ 'Web Hooks', this.getNiceSecretAssignments('web_hooks', secret.web_hooks) ],
				[ 'Author', secret.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(secret.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(secret.modified, true, true) ],
				[ 'Revision', secret.revision || 1 ]
			]
		});
		
		// Notes are plaintext metadata and may contain multiple lines.
		if (secret.notes) this.printUserNotes('SECRET VAULT NOTES', secret.notes);
		
		this.printSuggestedCommands({
			"Decrypt variables": `xy secret decrypt ${secret.id} --confirm`,
			"Update vault metadata": `xy secret update ${secret.id} --notes "Updated notes"`,
			"Replace all variables": `xy secret update ${secret.id} --fields @secrets.json`,
			"Disable vault": secret.enabled ? `xy secret update ${secret.id} --enabled false` : '',
			"Delete vault": `xy secret delete ${secret.id} --confirm`
		});
	},
	
	async cmd_create_secret() {
		// Load assignment targets for exact-ID validation before accepting plaintext.
		await this.getMultiple();
		if (this.args.other.length) return this.dieUsage('secret create');
		delete this.args.other;
		
		var params = this.prepareSecretParams({
			enabled: true,
			icon: '',
			notes: '',
			events: [],
			categories: [],
			plugins: [],
			web_hooks: [],
			fields: []
		}, this.args, true);
		if (!params.title) return this.dieUsage('secret create');
		
		var data = await this.callStandardAPI('createSecret', params, {
			text: 'Creating Secret Vault...',
			filterRequest: request => this.redactSecretRequest(request)
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.secret);
		
		this.toast('✅', 'green', "Successfully created Secret Vault: #" + data.secret.id);
		this.printSuggestedCommands({
			"View vault details": `xy secret ${data.secret.id}`,
			"Decrypt variables": `xy secret decrypt ${data.secret.id} --confirm`,
			"Replace all variables": `xy secret update ${data.secret.id} --fields @secrets.json`,
			"List all Secret Vaults": "xy secrets"
		});
	},
	
	async cmd_update_secret() {
		await this.getMultiple();
		var id = this.consumeSecretID();
		var secret = await this.fetchSecret(id);
		
		this.printSecretMutationSummary('Update Secret Vault', secret);
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for Secret Vault.");
		
		// Validate first, so even an unsupported typo cannot cause a secret-shaped
		// value to be echoed by the friendly update preview.
		var params = this.prepareSecretParams(secret, this.args, false);
		this.printUpdateData(this.redactSecretRequest(this.args));
		params.id = id;
		var data = await this.callStandardAPI('updateSecret', params, {
			text: 'Updating Secret Vault...',
			filterRequest: request => this.redactSecretRequest(request)
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully updated Secret Vault: #" + id);
	},
	
	async cmd_decrypt_secret() {
		// Fetching metadata is safe and does not create a secret_access audit event.
		// Only the confirmed decrypt_secret API call below records the access.
		await this.getMultiple();
		var id = this.consumeSecretID();
		var secret = await this.fetchSecret(id);
		this.printSecretMutationSummary('Decrypt Secret Vault', secret);
		
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) {
			return this.die("Secret Vault decrypt --confirm must be true or false.");
		}
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm decryption by adding '--confirm'. This access will be recorded in the xyOps activity log.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Secret Vault decrypt option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('decryptSecret', { id: id }, {
			text: 'Decrypting Secret Vault...',
			filterResponse: response => ({
				code: response.code,
				fields: this.redactSecretFields(response.fields)
			})
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.fields);
		
		if (!data.fields.length) {
			println( "\n " + this.color('theme').bold('SECRET VARIABLES') );
			println( " " + gray('(None)') );
			return;
		}
		
		// Values are deliberately not trimmed, wrapped, indented or boxed.  This
		// preserves multiline data exactly so it can be selected and copied.
		data.fields.forEach( field => {
			println( "\n" + this.color('orange').bold('SECRET VARIABLE: ' + field.name) );
			var value = String(field.value);
			print(value);
			if (!value.endsWith("\n")) print("\n");
		});
	},
	
	async cmd_delete_secret() {
		await this.getMultiple();
		var id = this.consumeSecretID();
		var secret = await this.fetchSecret(id);
		this.printSecretMutationSummary('Delete Secret Vault', secret);
		
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) {
			return this.die("Secret Vault delete --confirm must be true or false.");
		}
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the Secret Vault delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Secret Vault delete option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('deleteSecret', { id: id }, {
			text: 'Deleting Secret Vault...'
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully deleted Secret Vault: #" + id);
	},
	
	async fetchSecret(id) {
		// get_secret returns metadata only and cannot expose encrypted values.
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading Secret Vault...') });
		var { err, data } = await this.api.getSecret({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		return data.secret;
	},
	
	consumeSecretID() {
		// Mutations and decryption require an exact internal ID.  A fuzzy title must
		// never select the destination for either a destructive or sensitive action.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing required Secret Vault ID argument.");
		if (this.args.other.length) this.die("Unexpected argument after Secret Vault ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Secret Vault ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die("Invalid Secret Vault ID: " + id);
		delete this.args.id;
		delete this.args.other;
		return id;
	},
	
	prepareSecretParams(secret, input, creating) {
		// Metadata updates are sparse.  Assignment aliases append to their complete
		// lists, while fields is accepted only as one complete replacement array.
		var params = creating ? Tools.copyHash(secret, true) : {};
		var allowed = [
			'id', 'title', 'enabled', 'icon', 'notes', 'fields',
			'events', 'event', 'categories', 'category', 'plugins', 'plugin',
			'web_hooks', 'web_hook', 'hook'
		];
		
		Object.keys(input).forEach( key => {
			if (key.includes('.')) this.die("Secret Vault options do not support dotted paths: --" + key);
			if (!allowed.includes(key)) this.die("Unsupported Secret Vault option: --" + key);
		});
		
		['id', 'title', 'enabled', 'icon', 'notes', 'fields'].forEach( key => {
			if (key in input) params[key] = input[key];
		});
		
		var assignments = [
			{ property: 'events', aliases: ['event'], collection: 'events', label: 'event' },
			{ property: 'categories', aliases: ['category'], collection: 'categories', label: 'category' },
			{ property: 'plugins', aliases: ['plugin'], collection: 'plugins', label: 'Plugin' },
			{ property: 'web_hooks', aliases: ['web_hook', 'hook'], collection: 'web_hooks', label: 'web hook' }
		];
		assignments.forEach( assignment => {
			var has_list = Object.prototype.hasOwnProperty.call(input, assignment.property);
			var aliases = assignment.aliases.filter( alias => Object.prototype.hasOwnProperty.call(input, alias) );
			if (!creating && !has_list && !aliases.length) return;
			
			var value = has_list ? input[assignment.property] : (secret[assignment.property] || []);
			var list = this.parseSecretList(value, assignment.property);
			aliases.forEach( alias => {
				list = list.concat(this.parseSecretList(input[alias], alias));
			});
			params[assignment.property] = Array.from(new Set(list));
			this.validateSecretAssignments(params[assignment.property], assignment.collection, assignment.label);
		});
		
		if ('fields' in params) params.fields = this.validateSecretFields(params.fields);
		if ('title' in params) {
			if ((typeof(params.title) != 'string') || !params.title.trim()) this.die("Secret Vault title cannot be empty and must be a string.");
			params.title = params.title.trim();
		}
		if ('enabled' in params) params.enabled = this.parseSecretBoolean(params.enabled, 'enabled');
		['icon', 'notes'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die("Secret Vault " + key + " must be a string.");
		});
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) {
			this.die("Invalid Secret Vault ID: " + params.id);
		}
		return params;
	},
	
	parseSecretList(value, name) {
		// Accept JSON arrays, repeated options and comma-separated strings.  Empty
		// input intentionally becomes an empty list so assignments can be cleared.
		if ((value === undefined) || (value === null) || (value === '')) return [];
		var list = [];
		Tools.alwaysArray(value).forEach( item => {
			if (typeof(item) != 'string') this.die("Secret Vault --" + name + " must be a comma-separated string or JSON array of strings.");
			list = list.concat(item.split(/\s*,\s*/));
		});
		return Array.from(new Set(list.map( item => item.trim() ).filter( item => !!item )));
	},
	
	validateSecretAssignments(ids, collection, label) {
		ids.forEach( id => {
			if (!id.match(/^[a-z0-9_]+$/)) this.die("Invalid " + label + " ID for Secret Vault assignment: " + id);
			if (!Tools.findObject(this[collection] || [], { id: id })) {
				this.die("Could not find " + label + " for Secret Vault assignment: " + id);
			}
		});
	},
	
	validateSecretFields(fields) {
		// Values stay opaque strings.  Validate structure and names without ever
		// including a plaintext value in an error message.
		if (!Array.isArray(fields)) this.die("Secret Vault fields must be a complete JSON array.");
		var names = new Set();
		return fields.map( (field, idx) => {
			if (!Tools.isaHash(field)) this.die("Secret Vault fields." + idx + " must be a JSON object.");
			var extra = Object.keys(field).find( key => !['name', 'value'].includes(key) );
			if (extra) this.die("Unsupported property in Secret Vault fields." + idx + ': "' + extra + '".');
			if ((typeof(field.name) != 'string') || !field.name.match(/^[A-Za-z_][A-Za-z0-9_]*$/) || field.name.match(Tools.MATCH_BAD_KEY)) {
				this.die("Invalid variable name in Secret Vault fields." + idx + ".");
			}
			if (names.has(field.name)) this.die("Duplicate variable name in Secret Vault fields: " + field.name);
			if (typeof(field.value) != 'string') this.die("Secret Vault fields." + idx + ".value must be a string.");
			names.add(field.name);
			return { name: field.name, value: field.value };
		});
	},
	
	parseSecretBoolean(value, name) {
		if ([true, 1, '1', 'true', 'yes', 'on'].includes(value)) return true;
		if ([false, 0, '0', 'false', 'no', 'off'].includes(value)) return false;
		this.die("Invalid boolean value for '" + name + "': " + value);
	},
	
	redactSecretFields(fields) {
		// Invalid input can reach an update preview before structural validation.
		// In that case, redact the complete value instead of inspecting or echoing it.
		if (!Array.isArray(fields)) return '[REDACTED]';
		return fields.map( field => ({
			name: Tools.isaHash(field) && (typeof(field.name) == 'string') ? field.name : '(Invalid)',
			value: '[REDACTED]'
		}));
	},
	
	redactSecretRequest(request) {
		// Construct the display object without first cloning plaintext field values.
		var display = {};
		Object.keys(request || {}).forEach( key => {
			if (key == 'fields') display.fields = this.redactSecretFields(request.fields);
			else display[key] = Tools.copyHash({ value: request[key] }, true).value;
		});
		return display;
	},
	
	printSecretMutationSummary(title, secret) {
		this.printMutationSummary({
			title: title,
			rows: [
				[ 'Vault ID', gray(secret.id) ],
				[ 'Title', this.color('theme').bold(secret.title) ]
			]
		});
	},
	
	getNiceSecretAssignments(type, ids) {
		ids = ids || [];
		if (!ids.length) return gray('(None)');
		var collection = this[type] || [];
		return ids.map( id => {
			var item = Tools.findObject(collection, { id: id });
			return item ? item.title + gray(' (' + id + ')') : gray(id + ' (Not Found)');
		}).join(', ');
	}
	
}; // module.exports
