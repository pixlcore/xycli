// Notification Channels Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_channels() {
		// The plural command lists channels, with optional search and filters.
		await this.cmd_get_channels();
	},
	
	async cmd_channel() {
		// Use the same operation names as categories, buckets, and API Keys.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('channel');
		switch (cmd) {
			case 'list': await this.cmd_get_channels(); break;
			case 'get': await this.cmd_get_channel(); break;
			case 'create': await this.cmd_create_channel(); break;
			case 'update': await this.cmd_update_channel(); break;
			case 'delete': await this.cmd_delete_channel(); break;
			default:
				// A bare ID or title opens channel details.
				this.args.other.unshift(cmd);
				await this.cmd_get_channel();
			break;
		}
	},
	
	async cmd_get_channels() {
		// Consume pagination before turning the remaining options into filters.
		this.prepSearchArgs();
		await this.getMultiple();
		var channels = this.channels.slice(0);
		var is_filtered = !!this.args.other.length;
		if (is_filtered) {
			var search = this.args.other.join(' ');
			channels = this.findObjectsFuzzy(channels, { id: search, title: search, notes: search, email: search }, 1);
		}
		delete this.args.other;
		
		if ('enabled' in this.args) {
			var enabled = this.parseChannelBoolean(this.args.enabled);
			channels = channels.filter( channel => !!channel.enabled === enabled );
			delete this.args.enabled;
			is_filtered = true;
		}
		if ('user' in this.args) {
			// User filters match whole usernames, not substrings of other users.
			var users = this.parseChannelUsers(this.args.user);
			channels = channels.filter( channel => users.every( user => (channel.users || []).includes(user) ) );
			delete this.args.user;
			is_filtered = true;
		}
		if (Tools.numKeys(this.args)) {
			channels = this.findObjectsFuzzy(channels, this.args);
			is_filtered = true;
		}
		channels.sort( (a, b) => String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase()) );
		if (this.format.match(/json/)) return this.jsonOutput(channels);
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Notification Channels' : 'All Notification Channels',
			header: ['Channel ID', 'Title', 'Status', 'Users', 'Daily Cap', 'Modified'],
			rows: channels.slice(this.offset, this.offset + this.limit),
			list: { length: channels.length },
			offset: this.offset,
			limit: this.limit
		}, channel => [
			this.color('theme').bold(channel.id),
			bold(this.getNiceChannel(channel)),
			this.getNiceEnabled(channel.enabled),
			Tools.commify((channel.users || []).length),
			channel.max_per_day ? Tools.commify(channel.max_per_day) : gray('Unlimited'),
			this.getRelativeDateTime(channel.modified, true)
		]);
		this.printSuggestedCommands({
			"View channel details": "xy channel CHANNEL_ID_OR_TITLE",
			"Create a channel": 'xy channel create --title "My Channel" --users admin',
			"List disabled channels": "xy channels --enabled false",
			"Find channels for a user": "xy channels --user admin"
		});
	},
	
	async cmd_get_channel() {
		// Prefer an exact ID before falling back to a case-insensitive title match.
		await this.getMultiple();
		var selector = this.args.other.join(' ') || this.args.id || this.args.title;
		if (!selector) return this.dieUsage('channel get');
		var match = Tools.findObject(this.channels, { id: selector }) || this.findObjectFuzzy(this.channels, { title: selector });
		if (!match) return this.die("Could not find channel based on your criteria: " + selector);
		var channel = await this.fetchChannel(match.id);
		if (this.format.match(/json/)) return this.jsonOutput(channel);
		
		this.printBoxList({
			title: 'Notification Channel Summary',
			rows: [
				[ 'Channel ID', gray(channel.id) ],
				[ 'Title', this.color('theme').bold(channel.title) ],
				[ 'Status', this.getNiceEnabled(channel.enabled) ],
				[ 'Icon', channel.icon || gray('(None)') ],
				[ 'Users', (channel.users || []).join(', ') || gray('(None)') ],
				[ 'Email', channel.email || gray('(None)') ],
				[ 'Web Hook', channel.web_hook ? this.getNiceWebHook(channel.web_hook) + gray(' (' + channel.web_hook + ')') : gray('(None)') ],
				[ 'Run Event', channel.run_event ? this.getNiceEvent(channel.run_event) + gray(' (' + channel.run_event + ')') : gray('(None)') ],
				[ 'Sound', channel.sound || gray('(None)') ],
				[ 'Daily Cap', channel.max_per_day ? Tools.commify(channel.max_per_day) : 'Unlimited' ],
				[ 'Notes', channel.notes || gray('(None)') ],
				[ 'Author', channel.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(channel.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(channel.modified, true, true) ],
				[ 'Revision', channel.revision || 1 ]
			]
		});
		this.printSuggestedCommands({
			"Update channel": `xy channel update ${channel.id} --max_per_day 100`,
			"Export channel": `xy channel ${channel.id} --export channel.json`,
			"Append a user": `xy channel update ${channel.id} --user USERNAME`,
			"Disable channel": `xy channel update ${channel.id} --enabled false`,
			"Delete channel": `xy channel delete ${channel.id} --confirm`
		});
	},
	
	async cmd_create_channel() {
		// Match the web editor defaults, including unlimited daily notifications.
		if (this.args.other.length) return this.dieUsage('channel create');
		delete this.args.other;
		var params = this.prepareChannelParams({
			enabled: true,
			icon: '',
			users: [],
			email: '',
			web_hook: '',
			run_event: '',
			sound: '',
			max_per_day: 0,
			notes: ''
		}, this.args, true);
		if (!params.title) return this.dieUsage('channel create');
		var data = await this.callStandardAPI('createChannel', params, { text: 'Creating notification channel...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.channel);
		this.toast('✅', 'green', "Successfully created notification channel: #" + data.channel.id);
		this.printSuggestedCommands({
			"View channel details": `xy channel ${data.channel.id}`,
			"Update channel": `xy channel update ${data.channel.id} --max_per_day 100`,
			"Use in an event": `xy event update EVENT_ID --action '{ "type":"channel", "enabled":true, "condition":"error", "channel_id":"${data.channel.id}" }'`,
			"List all channels": "xy channels"
		});
	},
	
	async cmd_update_channel() {
		// Load the current channel for indexed edits and appending subscribed users.
		var id = this.consumeChannelID();
		var channel = await this.fetchChannel(id);
		
		this.printMutationSummary({
			title: 'Update Notification Channel',
			rows: [
				[ 'Channel ID', gray(channel.id) ],
				[ 'Title', this.color('theme').bold(channel.title) ]
			]
		});
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for notification channel.");
		this.printUpdateData(this.args);
		
		var params = this.prepareChannelParams(channel, this.args, false);
		params.id = id;
		var data = await this.callStandardAPI('updateChannel', params, { text: 'Updating notification channel...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully updated notification channel: #" + id);
	},
	
	async cmd_delete_channel() {
		// Deleting the definition does not remove references from existing actions.
		var id = this.consumeChannelID();
		var channel = await this.fetchChannel(id);
		
		this.printMutationSummary({
			title: 'Delete Notification Channel',
			rows: [
				[ 'Channel ID', gray(channel.id) ],
				[ 'Title', this.color('theme').bold(channel.title) ]
			]
		});
		
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the notification channel delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported channel delete option: --" + Tools.firstKey(this.args));
		var data = await this.callStandardAPI('deleteChannel', { id: id }, { text: 'Deleting notification channel...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully deleted notification channel: #" + id);
	},
	
	async fetchChannel(id) {
		// Fetch authoritative metadata through the single-channel endpoint.
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading notification channel...') });
		var { err, data } = await this.api.getChannel({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		return data.channel;
	},
	
	consumeChannelID() {
		// Mutation selectors are exact IDs and cannot silently replace each other.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing required Channel ID argument.");
		if (this.args.other.length) this.die("Unexpected argument after Channel ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Channel ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die("Invalid Channel ID: " + id);
		delete this.args.id;
		delete this.args.other;
		return id;
	},
	
	prepareChannelParams(channel, input, creating) {
		// Send only the fields being edited, leaving audit fields and unrelated
		// settings untouched.  Only the users array supports indexed updates.
		var params = creating ? Tools.copyHash(channel, true) : {};
		var fields = ['title', 'enabled', 'icon', 'users', 'user', 'email', 'web_hook', 'run_event', 'sound', 'max_per_day', 'notes'];
		if (creating) fields.push('id');
		var dotted = {};
		Object.keys(input).forEach( key => {
			var root = key.split('.')[0];
			if (!fields.includes(root)) this.die("Unsupported channel option: --" + key);
			if (key.includes('.')) {
				if (root != 'users') this.die("Invalid argument path: " + key);
				dotted[key] = input[key];
			}
			else params[key] = input[key];
		});
		
		// Whole-list replacement precedes indexed edits, then --user appends.
		// Clone the saved array so preparing a dry run cannot change shared state.
		if (('users' in input) || ('user' in input) || Tools.numKeys(dotted)) {
			params.users = this.parseChannelUsers(('users' in input) ? input.users : (channel.users || []));
			this.mergeDotArgs(params, dotted);
			if ('user' in input) params.users = params.users.concat(this.parseChannelUsers(input.user));
			params.users = Array.from(new Set(this.parseChannelUsers(params.users)));
		}
		delete params.user;
		
		if ('title' in params) {
			if ((typeof(params.title) != 'string') || !params.title.trim()) this.die("Channel title cannot be empty and must be a string.");
			params.title = params.title.trim();
		}
		if ('enabled' in params) params.enabled = this.parseChannelBoolean(params.enabled);
		['icon', 'email', 'web_hook', 'run_event', 'sound', 'notes'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die("Channel " + key + " must be a string.");
		});
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) this.die("Invalid Channel ID: " + params.id);
		if (('max_per_day' in params) && (!Number.isSafeInteger(params.max_per_day) || (params.max_per_day < 0))) this.die("Channel max_per_day must be a non-negative integer.");
		if (params.sound && !params.sound.match(/^[\w.-]+\.mp3$/i)) this.die("Channel sound must be an .mp3 filename, or an empty string.");
		return params;
	},
	
	parseChannelUsers(value) {
		// Support a JSON array, comma-separated usernames, and repeated --user.
		var users = Array.isArray(value) ? value.slice(0) : ((typeof(value) == 'string') ? value.split(',') : null);
		if (!users) this.die("Channel users must be a JSON array or comma-separated usernames.");
		return users.map( user => {
			if ((typeof(user) != 'string') || !user.trim() || /\s/.test(user.trim())) this.die("Channel usernames must be non-empty strings without whitespace.");
			return user.trim();
		});
	},
	
	parseChannelBoolean(value) {
		// Accept the usual boolean and numeric spellings without truthy strings.
		if ([true, 1, '1', 'true', 'yes', 'on'].includes(value)) return true;
		if ([false, 0, '0', 'false', 'no', 'off'].includes(value)) return false;
		this.die("Invalid boolean value for 'enabled': " + value);
	}
	
}; // module.exports
