// API Key Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_keys() {
		// Collection alias for listing and filtering API Keys.
		await this.cmd_get_api_keys();
	},
	
	async cmd_key() {
		// Singular router, e.g. `xy key create` or `xy key update KEY_ID`.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('key');
		switch (cmd) {
			case 'list': await this.cmd_get_api_keys(); break;
			case 'get': await this.cmd_get_api_key(); break;
			case 'create': await this.cmd_create_api_key(); break;
			case 'update': await this.cmd_update_api_key(); break;
			case 'delete': await this.cmd_delete_api_key(); break;
			
			default:
				// A bare ID or title opens key details, matching `xy event ID_OR_TITLE`.
				this.args.other.unshift(cmd);
				await this.cmd_get_api_key();
			break;
		}
	},
	
	async cmd_get_api_keys() {
		// List API Keys with optional fuzzy filters.  Secret hashes are stripped.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var api_keys = this.api_keys.map( this.sanitizeAPIKey.bind(this) );
		var is_filtered = false;
		
		if (this.args.other.length) {
			// Search the safe, human-facing fields only.
			var search = this.args.other.join(' ');
			api_keys = this.findObjectsFuzzy(api_keys, {
				id: search,
				title: search,
				description: search,
				mask: search
			}, 1);
			is_filtered = true;
		}
		delete this.args.other;
		
		if ('active' in this.args) {
			var active = this.parseAPIKeyBoolean(this.args.active, 'active');
			api_keys = api_keys.filter( api_key => !!api_key.active === active );
			delete this.args.active;
			is_filtered = true;
		}
		
		if ('expired' in this.args) {
			var expired = this.parseAPIKeyBoolean(this.args.expired, 'expired');
			api_keys = api_keys.filter( api_key => {
				var is_expired = !!api_key.expires && (this.epoch >= api_key.expires);
				return is_expired === expired;
			});
			delete this.args.expired;
			is_filtered = true;
		}
		
		if ('privilege' in this.args) {
			var privileges = this.parseAPIKeyList(this.args.privilege);
			api_keys = api_keys.filter( api_key => {
				return privileges.every( id => !!(api_key.privileges || {})[id] );
			});
			delete this.args.privilege;
			is_filtered = true;
		}
		
		if ('role' in this.args) {
			var roles = this.parseAPIKeyList(this.args.role);
			api_keys = api_keys.filter( api_key => roles.every( id => (api_key.roles || []).includes(id) ) );
			delete this.args.role;
			is_filtered = true;
		}
		
		if (Tools.numKeys(this.args)) {
			// Remaining options are ordinary fuzzy property filters.
			api_keys = this.findObjectsFuzzy(api_keys, this.args);
			is_filtered = true;
		}
		
		api_keys.sort( function(a, b) {
			return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
		} );
		
		if (this.format.match(/json/)) return this.jsonOutput(api_keys);
		
		var total = api_keys.length;
		var rows = api_keys.slice(this.offset, this.offset + this.limit);
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered API Keys' : 'All API Keys',
			header: ['Key ID', 'App Title', 'Partial Key', 'Status', 'Privileges', 'Roles', 'Last Used'],
			rows: rows,
			list: { length: total },
			offset: this.offset,
			limit: this.limit
		}, api_key => {
			var state = ((this.state.api_keys || {})[api_key.id]) || {};
			return [
				this.color('theme').bold(api_key.id),
				bold(api_key.title),
				api_key.mask || gray('(Unavailable)'),
				this.getNiceAPIKeyStatus(api_key),
				this.getNicePrivileges(api_key.privileges),
				this.getNiceRoles(api_key.roles),
				state.date ? this.getRelativeDateTime(state.date, true) : gray('Never')
			];
		});
		
		this.printSuggestedCommands({
			"View key details": "xy key KEY_ID",
			"Create API Key": "xy key create --title \"My App\" --privileges.admin",
			"Update API Key": "xy key update KEY_ID [--KEY VALUE, ...]"
		});
	},
	
	async cmd_get_api_key() {
		// Show one API Key by exact ID or fuzzy title, without its stored hash.
		await this.getMultiple();
		if (!this.api_keys.length) return this.die("No API Keys found.");
		
		var api_key = null;
		if (this.args.other.length) {
			var search = this.args.other.join(' ');
			api_key = Tools.findObject(this.api_keys, { id: search }) ||
				this.findObjectFuzzy(this.api_keys, { title: search });
		}
		else if (this.args.id) {
			api_key = Tools.findObject(this.api_keys, { id: this.args.id });
		}
		else if (this.args.title) {
			api_key = this.findObjectFuzzy(this.api_keys, { title: this.args.title });
		}
		else return this.dieUsage('key get');
		
		if (!api_key) return this.die("Could not find API Key based on your criteria.");
		api_key = this.sanitizeAPIKey(api_key);
		
		if (this.format.match(/json/)) return this.jsonOutput(api_key);
		
		var state = ((this.state.api_keys || {})[api_key.id]) || {};
		this.printBoxList({
			title: 'API Key Summary',
			rows: [
				[ 'Key ID', gray(api_key.id) ],
				[ 'App Title', this.color('theme').bold(api_key.title) ],
				[ 'Partial Key', api_key.mask || gray('(Unavailable)') ],
				[ 'Status', this.getNiceAPIKeyStatus(api_key) ],
				[ 'Description', api_key.description || gray('(None)') ],
				[ 'Privileges', this.getNicePrivileges(api_key.privileges) ],
				[ 'Roles', this.getNiceRoles(api_key.roles) ],
				[ 'Rate Limit', api_key.max_per_sec ? Tools.commify(api_key.max_per_sec) + '/sec' : 'Unlimited' ],
				[ 'Expiration', api_key.expires ? this.getNiceDateTime(api_key.expires, true) : 'Never' ],
				[ 'Last Used', state.date ? this.getNiceDateTime(state.date, true, true) : 'Never' ],
				[ 'Author', api_key.username ],
				[ 'Created', this.getNiceDateTime(api_key.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(api_key.modified, true, true) ],
				[ 'Revision', api_key.revision ]
			]
		});
		
		this.printSuggestedCommands({
			"Update API Key": `xy key update ${api_key.id} [--KEY VALUE, ...]`,
			"Export API Key": `xy key ${api_key.id} --export key.json`,
			"Disable API Key": api_key.active ? `xy key update ${api_key.id} --active false` : '',
			"Delete API Key": `xy key delete ${api_key.id} --confirm`,
			"List all API Keys": "xy keys"
		});
	},
	
	async cmd_create_api_key() {
		// Create a key.  xyOps generates the secret and returns it exactly once.
		await this.getMultiple();
		if ('delete' in this.args) return this.die("The '--delete' option is only available for update commands.");
		
		var params = {
			active: true,
			description: '',
			privileges: Tools.copyHash(this.config.default_user_privileges || {}, true),
			roles: [],
			max_per_sec: 0,
			expires: 0
		};
		this.mergeDotArgs(params, this.args);
		delete params.other;
		this.processAPIKeyUpdates(params);
		delete params.id;
		
		if (!params.title || !String(params.title).trim()) return this.dieUsage('key create');
		params.title = String(params.title).trim();
		
		var data = await this.callStandardAPI('createApiKey', params, {
			text: 'Creating API Key...',
			filterResponse: data => {
				return {
					code: data.code,
					api_key: this.sanitizeAPIKey(data.api_key),
					plain_key: '[REDACTED: shown once below]'
				};
			}
		});
		if (this.dry) return;
		
		// Current xyOps releases always activate a new key at insertion time.  Honor
		// an explicitly disabled create by immediately applying the requested state.
		// If that follow-up fails, still reveal the one-time secret so it is not lost.
		var state_error = null;
		if (!params.active && data.api_key.active) {
			var state_result = await this.api.updateApiKey({ id: data.api_key.id, active: false });
			state_error = state_result.err;
			if (!state_error) data.api_key.active = false;
		}
		
		var result = {
			api_key: this.sanitizeAPIKey(data.api_key),
			plain_key: data.plain_key
		};
		if (state_error) result.error = "The key was created, but could not be disabled: " + (state_error.message || state_error);
		if (this.format.match(/json/)) {
			this.jsonOutput(result);
			if (state_error) process.exitCode = 1;
			return;
		}
		
		if (state_error) this.toast('⚠️', 'yellow', "API Key created, but it could not be disabled: #" + data.api_key.id);
		else this.toast('✅', 'green', "Successfully created API Key: #" + data.api_key.id);
		println( "\n " + cyan.bold("API Key Secret: ") + bold(data.plain_key) );
		println( " " + yellow.bold("Save this secret now.  It will never be displayed again.") );
		if (state_error) {
			println( "\n " + red.bold("Disable Error: ") + (state_error.message || state_error) );
			process.exitCode = 1;
			return;
		}
		
		this.printSuggestedCommands({
			"View key details": `xy key ${data.api_key.id}`,
			"Update API Key": `xy key update ${data.api_key.id} [--KEY VALUE, ...]`,
			"Disable API Key": `xy key update ${data.api_key.id} --active false`,
			"List all API Keys": "xy keys"
		});
	},
	
	async cmd_update_api_key() {
		// Updates require the safe internal ID, avoiding ambiguous title mutations.
		await this.getMultiple();
		var id = this.getAPIKeyIDArgument();
		var api_key = Tools.findObject(this.api_keys, { id: id });
		if (!api_key) return this.die("Could not find API Key from ID: " + id);
		
		delete this.args.id;
		delete this.args.other;
		
		this.printMutationSummary({
			title: 'Update API Key',
			rows: [
				[ 'API Key ID', gray(api_key.id) ],
				[ 'Title', this.color('theme').bold(api_key.title) ]
			]
		});
		
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for API Key.");
		if (('key' in this.args) || ('plain_key' in this.args)) {
			return this.die("API Key secrets cannot be updated.  Create a new key instead.");
		}
		
		this.printUpdateData(this.args);
		
		// Seed editable nested fields from the current key so a dotted privilege
		// update does not replace and erase all its sibling privileges.
		var params = {
			id: api_key.id,
			active: api_key.active,
			title: api_key.title,
			description: api_key.description || '',
			privileges: Tools.copyHash(api_key.privileges || {}, true),
			roles: [].concat(api_key.roles || []),
			max_per_sec: api_key.max_per_sec || 0,
			expires: api_key.expires || 0
		};
		this.mergeDotArgs(params, this.args);
		this.applyDeleteArgs(params, this.args);
		this.processAPIKeyUpdates(params);
		
		if (!params.title || !String(params.title).trim()) return this.die("API Key title cannot be empty.");
		params.title = String(params.title).trim();
		
		await this.callStandardAPI('updateApiKey', params, {
			text: 'Updating API Key...'
		});
		if (this.dry) return;
		this.toast('✅', 'green', "Successfully updated API Key: #" + api_key.id);
	},
	
	async cmd_delete_api_key() {
		// Delete by exact internal ID only, and require an explicit confirmation.
		await this.getMultiple();
		var id = this.getAPIKeyIDArgument();
		var api_key = Tools.findObject(this.api_keys, { id: id });
		if (!api_key) return this.die("Could not find API Key from ID: " + id);
		this.printMutationSummary({
			title: 'Delete API Key',
			rows: [
				[ 'API Key ID', gray(api_key.id) ],
				[ 'Title', this.color('theme').bold(api_key.title) ]
			]
		});
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the API Key delete by adding '--confirm'.");
			return;
		}
		
		await this.callStandardAPI('deleteApiKey', { id: id }, {
			text: 'Deleting API Key...'
		});
		if (this.dry) return;
		this.toast('✅', 'green', "Successfully deleted API Key: #" + id);
	},
	
	getAPIKeyIDArgument() {
		// Consume an ID from either the positional slot or --id.
		var id = this.args.id;
		if (this.args.other && this.args.other.length) id = this.args.other.shift();
		if (!id) this.die("Missing required API Key ID argument.");
		if (this.args.other && this.args.other.length) this.die("Unexpected argument after API Key ID: " + this.args.other[0]);
		return String(id);
	},
	
	parseAPIKeyBoolean(value, name) {
		// pixl-cli handles common scalar types, but also accept friendly spellings.
		if ((value === true) || (value === 1) || (value === '1')) return true;
		if ((value === false) || (value === 0) || (value === '0')) return false;
		if (String(value).match(/^(yes|on)$/i)) return true;
		if (String(value).match(/^(no|off)$/i)) return false;
		this.die("Invalid boolean value for '" + name + "': " + value);
	},
	
	parseAPIKeyList(value) {
		// Accept JSON arrays, repeated options, or a comma-separated list.
		if ((value === undefined) || (value === null) || (value === '')) return [];
		return Tools.alwaysArray(value).reduce( function(list, item) {
			return list.concat(String(item).split(/\s*,\s*/));
		}, [] ).filter( item => !!item );
	},
	
	processAPIKeyUpdates(api_key) {
		// Normalize all convenient CLI spellings into the APIKey data model.
		if ('active' in api_key) api_key.active = this.parseAPIKeyBoolean(api_key.active, 'active');
		
		if (Array.isArray(api_key.privileges) || (typeof(api_key.privileges) == 'string')) {
			var privileges = this.parseAPIKeyList(api_key.privileges);
			api_key.privileges = {};
			privileges.forEach( id => { api_key.privileges[id] = true; } );
		}
		if (!api_key.privileges || (typeof(api_key.privileges) != 'object')) api_key.privileges = {};
		
		if ('privilege' in api_key) {
			this.parseAPIKeyList(api_key.privilege).forEach( id => { api_key.privileges[id] = true; } );
			delete api_key.privilege;
		}
		
		// Privilege hashes should only contain enabled keys.  This makes dotted
		// updates such as `--privileges.tag_jobs false` behave like a deletion.
		Object.keys(api_key.privileges).forEach( id => {
			if (this.parseAPIKeyBoolean(api_key.privileges[id], 'privileges.' + id)) {
				api_key.privileges[id] = true;
			}
			else delete api_key.privileges[id];
		});
		if (api_key.privileges.admin) api_key.privileges = { admin: true };
		
		api_key.roles = this.parseAPIKeyList(api_key.roles);
		if ('role' in api_key) {
			api_key.roles = api_key.roles.concat(this.parseAPIKeyList(api_key.role));
			delete api_key.role;
		}
		api_key.roles = Array.from(new Set(api_key.roles));
		
		// Keep the server's field name internal and expose a shorter CLI option.
		if ('rate' in api_key) {
			api_key.max_per_sec = api_key.rate;
			delete api_key.rate;
		}
		if ('max_per_sec' in api_key) {
			api_key.max_per_sec = Number(api_key.max_per_sec);
			if (!Number.isInteger(api_key.max_per_sec) || (api_key.max_per_sec < 0)) {
				this.die("Rate limit must be a non-negative integer.");
			}
		}
		
		if (typeof(api_key.expires) == 'string') {
			if (api_key.expires.match(/^(never|none|off)$/i)) api_key.expires = 0;
			else if (api_key.expires.match(/^\d+$/)) api_key.expires = parseInt(api_key.expires);
			else api_key.expires = Tools.parseDate(api_key.expires) || this.die("Could not parse API Key expiration: " + api_key.expires);
		}
		if ((api_key.expires === false) || (api_key.expires === null)) api_key.expires = 0;
		if (!Number.isFinite(api_key.expires) || (api_key.expires < 0)) {
			this.die("API Key expiration must be a date, Unix timestamp, or 'never'.");
		}
		
		// These values are always generated and controlled by xyOps itself.
		delete api_key.key;
		delete api_key.plain_key;
		delete api_key.mask;
		delete api_key.username;
		delete api_key.created;
		delete api_key.modified;
		delete api_key.revision;
	}
	
};
