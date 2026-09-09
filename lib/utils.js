// Utils

const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const Path = require('path');
const { PassThrough } = require('stream');

const { convert: convertHTMLToText } = require('html-to-text');
const { listLanguages: listHighlightLanguages } = require('cli-highlight');
const { marked } = require('marked');
const { markedTerminal } = require('marked-terminal');

const HIGHLIGHT_LANGUAGES = listHighlightLanguages();
const MARKDOWN_PADDING = 1;

const terminalRenderer = markedTerminal({
	emoji: false,
	showSectionPrefix: false,
	reflowText: true,
	tab: 2,
	// Reserve one column on each side so rendered Markdown lines up with the
	// rest of the CLI without allowing reflowed text to touch the right edge.
	width: Math.max(20, Math.min(process.stdout.columns || 80, 120) - (MARKDOWN_PADDING * 2))
}, {
	ignoreIllegals: true,
	languageSubset: ['json', 'javascript', 'bash', 'shell']
});

// marked-terminal hardcodes an asterisk as its unordered-list marker.  Wait
// until the outermost list is complete before swapping those markers, because
// its parent renderer still needs the original asterisks to identify and lay
// out nested lists correctly.
const renderTerminalList = terminalRenderer.renderer.list;
let terminalListDepth = 0;
terminalRenderer.renderer.list = function(...args) {
	terminalListDepth++;
	try {
		var output = renderTerminalList.apply(this, args);
		if (terminalListDepth == 1) output = output.replace(/^([ \t]*)\* /gm, '$1• ');
		return output;
	}
	finally {
		terminalListDepth--;
	}
};

marked.use(terminalRenderer);

// render explicitly labeled plain-text blocks in gray
marked.use({
	renderer: {
		text(token) {
			// Marked stores inline formatting inside child tokens for list-item text.
			// marked-terminal 7.3.0 returns only token.text here, which exposes the
			// original **strong** and `code` markup instead of rendering it.  Parse
			// those children ourselves, then fall through for ordinary text tokens.
			if (token && Array.isArray(token.tokens)) {
				return this.parser.parseInline(token.tokens);
			}
			
			return false;
		},
		
		code(token) {
			if (token.lang === 'sh') {
				var disp_value = String(token.text).trim().split(/\n/).map( line => '    ' + line ).join("\n");
				return chalk.cyan(disp_value) + '\n\n';
			}
			
			// use marked-terminal for all other code blocks
			return false;
		}
	}
});

const cli = require('pixl-cli');
const Tools = cli.Tools;
const chalk = cli.chalk;

const DEFAULT_CACHE_TTL = 300;
const DATE_FMT = '[yyyy]/[mm]/[dd] [hour12]:[mi] [AMPM]';
const DATE_FMT_SEC = '[yyyy]/[mm]/[dd] [hour12]:[mi]:[ss] [AMPM]';
const TIME_FMT = '[hour12]:[mi] [AMPM]';
const TIME_FMT_SEC = '[hour12]:[mi]:[ss] [AMPM]';

// CRUD APIs deliberately accept arbitrary top-level properties, which is useful
// for direct API integrations but dangerous for hand-typed CLI commands.  These
// rules describe the final, normalized request objects that this CLI supports.
// Rule names match the real snake_case API endpoints and are regular expressions
// so create and update operations can share one property list.
const STANDARD_API_PROPERTY_RULES = {
	'^(create_alert|update_alert)$': [
		'id', 'title', 'enabled', 'icon', 'expression', 'message', 'groups',
		'actions', 'monitor_id', 'samples', 'exclusive_actions', 'limit_jobs',
		'abort_jobs', 'notes', 'username', 'modified', 'created', 'revision'
	],
	'^(create_api_key|update_api_key)$': [
		'id', 'key', 'mask', 'active', 'privileges', 'roles', 'title',
		'description', 'expires', 'max_per_sec', 'username', 'modified',
		'created', 'revision'
	],
	'^(create_bucket|update_bucket)$': [
		'id', 'title', 'enabled', 'icon', 'notes', 'username', 'modified',
		'created', 'revision', 'data'
	],
	'^(create_category|update_category)$': [
		'id', 'title', 'enabled', 'icon', 'color', 'notes', 'actions', 'limits',
		'sort_order', 'username', 'modified', 'created', 'revision'
	],
	'^(create_channel|update_channel)$': [
		'id', 'title', 'enabled', 'icon', 'users', 'email', 'web_hook',
		'run_event', 'sound', 'max_per_day', 'notes', 'username', 'modified',
		'created', 'revision'
	],
	'^(create_event|update_event)$': [
		'id', 'title', 'enabled', 'icon', 'type', 'category', 'plugin', 'params',
		'fields', 'tags', 'targets', 'expression', 'algo', 'notes', 'actions',
		'limits', 'triggers', 'workflow', 'username', 'modified', 'created',
		'revision', 'update_state'
	],
	'^(create_monitor|update_monitor)$': [
		'id', 'title', 'display', 'icon', 'groups', 'source', 'data_match',
		'data_type', 'min_vert_scale', 'suffix', 'delta', 'divide_by_delta',
		'delta_min_value', 'notes', 'sort_order', 'username', 'modified',
		'created', 'revision'
	],
	'^(create_plugin|update_plugin)$': [
		'id', 'title', 'enabled', 'icon', 'type', 'command', 'script', 'params',
		'groups', 'format', 'uid', 'gid', 'kill', 'runner', 'quick', 'stock',
		'notes', 'marketplace', 'username', 'modified', 'created', 'revision'
	],
	'^(create_secret|update_secret)$': [
		'id', 'title', 'enabled', 'icon', 'notes', 'events', 'categories',
		'plugins', 'web_hooks', 'fields'
	],
	'^update_server$': [
		'id', 'title', 'enabled', 'icon', 'groups', 'autoGroup', 'maxJobs', 'userData'
	],
	'^(create_tag|update_tag)$': [
		'id', 'title', 'icon', 'notes', 'username', 'modified', 'created', 'revision'
	],
	'^(create_ticket|update_ticket)$': [
		'id', 'num', 'subject', 'body', 'type', 'status', 'category', 'server',
		'assignees', 'cc', 'notify', 'due', 'tags', 'events', 'files', 'changes',
		'username', 'modified', 'created', 'template', 'job', 'alert'
	],
	'^(create_web_hook|update_web_hook)$': [
		'id', 'title', 'enabled', 'icon', 'url', 'method', 'headers', 'body',
		'timeout', 'retries', 'follow', 'ssl_cert_bypass', 'max_per_day', 'notes',
		'username', 'modified', 'created', 'revision'
	]
};

module.exports = {

	async getMultiple(req) {
		// only call once per run
		if (this.gotMultiple) return;
		
		if (!req) req = { lists: 'all', jobs: 1, alerts: 1, state: 1, stats: 1, servers: 1, serverCache: 1 };
		var { err, data } = await this.api.getMultiple(req);
		if (err) this.die(err);
		
		["api_keys", "groups", "plugins", "categories", "events", "channels", "web_hooks", "buckets", "secrets", "monitors", "alerts", "tags", "roles"].forEach( key => {
			this[key] = data[key] || [];
		} );
		
		if (!this.invisible) {
			for (var job_id in data.activeJobs) {
				var job = data.activeJobs[job_id];
				if (job.invisible) delete data.activeJobs[job_id];
			}
		}
		
		this.activeJobs = data.activeJobs || {};
		this.internalJobs = data.internalJobs || {};
		this.jobRateLimits = data.jobRateLimits || {};
		this.activeAlerts = data.activeAlerts || {};
		this.state = data.state || {};
		this.stats = data.stats || {};
		this.servers = data.servers || {};
		this.serverCache = data.serverCache || {};
		this.epoch = data.epoch || Tools.timeNow();
		this.gotMultiple = true;
	},
	
	color(name) {
		return this.colors[name] ? chalk.rgb(...this.colors[name]) : chalk.gray;
	},
	
	getNiceEvent(event) {
		if (!event) return gray('(None)');
		if (typeof(event) == 'string') {
			event = Tools.findObject( this.events, { id: event } ) || { id: event, title: event };
		}
		
		if (!event.enabled) return this.raw ? gray(event.id) : gray(event.title);
		
		var category = Tools.findObject( this.categories, { id: event.category } );
		if (category && category.color && (category.color != 'plain')) {
			return this.raw ? gray(event.id) : this.color(category.color).bold(event.title);
		}
		
		return this.raw ? gray(event.id) : event.title;
	},
	
	getNiceCategory(category) {
		if (!category) return gray('(None)');
		if (typeof(category) == 'string') {
			category = Tools.findObject( this.categories, { id: category } ) || { id: category, title: category };
		}
		
		if (this.raw) return gray(category.id);
		else if (category.color && (category.color != 'plain')) return this.color(category.color).bold(category.title);
		else return bold(category.title);
	},
	
	getNicePlugin(plugin) {
		if (!plugin) return gray('(None)');
		if (plugin === '_workflow') return '(Workflow)';
		if (typeof(plugin) == 'string') {
			plugin = Tools.findObject( this.plugins, { id: plugin } ) || { id: plugin, title: plugin };
		}
		return this.raw ? gray(plugin.id) : plugin.title;
	},
	
	getLangFromBinary(bin) {
		// Guess a cli-highlight language from an executable path and arguments.
		// This mirrors the xyOps UI helper, while avoiding slow source auto-detection
		// for common interpreters.
		if ((typeof(bin) != 'string') || !bin.trim()) return null;
		var cmd = Path.basename( bin.trim() ).replace(/\s+.+$/, '').replace(/\d+$/, '').toLowerCase();
		
		switch (cmd) {
			case 'sh':
			case 'csh':
			case 'ksh':
			case 'tcsh':
			case 'fish':
			case 'zsh':
			case 'bash':
				cmd = 'shell';
			break;
			
			case 'node':
			case 'deno':
			case 'bun':
				cmd = 'javascript';
			break;
			
			case 'pwsh':
				cmd = 'powershell';
			break;
		}
		
		return HIGHLIGHT_LANGUAGES.includes(cmd) ? cmd : null;
	},
	
	getNiceGroup(group) {
		if (!group) return gray('(None)');
		if (typeof(group) == 'string') {
			group = Tools.findObject( this.groups, { id: group } ) || { id: group, title: group };
		}
		return this.raw ? gray(group.id) : group.title;
	},
	
	getNiceServer(server) {
		if (!server) return gray('(None)');
		if (typeof(server) == 'string') {
			server = this.servers[server] || this.serverCache[server] || { id: server, hostname: server };
		}
		return this.raw ? gray(server.id) : (server.title || server.hostname);
	},
	
	getNiceTarget(target) {
		// a target can be a group ID, or a server ID
		if (!target) return gray('(None)');
		if (Tools.findObject(this.groups, { id: target })) return this.getNiceGroup(target);
		else return this.getNiceServer(target);
	},
	
	getNiceTargets(targets) {
		// CSV list of targets
		if (!targets || !targets.length) return gray('(None)');
		return targets.map( this.getNiceTarget.bind(this) ).join(', ');
	},
	
	getNiceTag(tag) {
		if (!tag) return gray('(None)');
		if (typeof(tag) == 'string') {
			tag = Tools.findObject( this.tags, { id: tag } ) || { id: tag, title: tag };
		}
		return this.raw ? gray(tag.id) : tag.title;
	},
	
	getNiceTagList(list) {
		if (!list || !list.length) return gray('(None)');
		list = list.filter( function(tag) { return !tag.match(/^_/); } ); // filter out system tags
		if (!list.length) return '(None)';
		return list.map( tag => this.getNiceTag(tag) ).join(', ');
	},
	
	getNiceAlgo(algo) {
		if (!algo) return gray('(None)');
		var def = Tools.findObject( this.config.ui.event_target_algo_menu, { id: algo } );
		return def ? def.title : algo;
	},
	
	getNiceAlert(alert) {
		if (!alert) return gray('(None)');
		if (typeof(alert) == 'string') {
			alert = Tools.findObject( this.alerts, { id: alert } ) || { id: alert, title: alert };
		}
		return this.raw ? gray(alert.id) : alert.title;
	},
	
	getNiceAlertStatus(alert) {
		return alert.active ? `${cli.emoji('🚨')} ${red('Active')}` : `${gray('Cleared')}`;
	},
	
	getNiceAPIKeyStatus(api_key) {
		// API Keys may be enabled but expired, so represent that as a distinct state.
		if (!api_key.active) return red('Disabled');
		if (api_key.expires && (this.epoch >= api_key.expires)) return yellow('Expired');
		return green('Active');
	},
	
	getNicePrivileges(privileges) {
		// Convert the privilege hash into the same friendly labels used by the UI.
		var priv_list = (this.config.ui && this.config.ui.privilege_list) || [];
		var ids = Object.keys(privileges || {}).filter( id => !!privileges[id] );
		if (!ids.length) return gray('(None)');
		
		return ids.map( function(id) {
			var def = Tools.findObject(priv_list, { id: id });
			return def ? def.title : id;
		} ).join(', ');
	},
	
	getNiceRoles(roles) {
		// Role IDs are safe to display, even if a referenced role was later deleted.
		if (!roles || !roles.length) return gray('(None)');
		return roles.map( id => {
			var role = Tools.findObject(this.roles || [], { id: id });
			return role ? role.title + gray(' (' + id + ')') : id;
		} ).join(', ');
	},
	
	sanitizeAPIKey(api_key) {
		// Never expose the stored salted hash through the friendly key commands.
		// plain_key is only added explicitly by the create command at display time.
		var clean = Tools.copyHash(api_key || {}, true);
		delete clean.key;
		delete clean.plain_key;
		return clean;
	},
	
	getNiceDateTime(epoch, secs, ago) {
		var str = Tools.formatDate(epoch, secs ? DATE_FMT_SEC : DATE_FMT);
		if (ago) str += gray(` (${this.getTextFromSecondsShort(Math.max(0, this.epoch - epoch))} ago)`);
		return str;
	},
	
	getNiceTime(epoch, secs, ago) {
		var str = Tools.formatDate(epoch, secs ? TIME_FMT_SEC : TIME_FMT);
		if (ago) str += gray(` (${this.getTextFromSecondsShort(Math.max(0, this.epoch - epoch))} ago)`);
		return str;
	},
	
	getRelativeDateTime(epoch, secs) {
		var dargs = Tools.getDateArgs(epoch);
		var nargs = Tools.getDateArgs( this.epoch );
		
		if (nargs.yyyy_mm_dd == dargs.yyyy_mm_dd) {
			// today
			return 'Today at ' + this.getNiceTime(epoch, secs);
		}
		else {
			// some other day
			return this.getNiceDateTime(epoch, secs);
		}
	},
	
	getDateOptions(opts = {}) {
		// get combined date/time options with user locale settings
		var user = this.config;
		var ropts = Intl.DateTimeFormat().resolvedOptions();
		var [lang, reg] = ropts.locale.split(/\-/);
		if (!reg) reg = lang.toUpperCase();
		
		lang = user.language || lang;
		reg = user.region || reg;
		
		if (opts.locale === false) delete opts.locale;
		else if (!opts.locale) opts.locale = lang + '-' + reg;
		
		if (opts.timeZone === false) delete opts.timeZone;
		else if (!opts.timeZone) opts.timeZone = user.timezone || ropts.timeZone;
		
		if (opts.numberingSystem === false) delete opts.numberingSystem;
		else if (!opts.numberingSystem) opts.numberingSystem = user.num_format || ropts.numberingSystem;
		
		if (opts.hourCycle === false) delete opts.hourCycle;
		else if (!opts.hourCycle) opts.hourCycle = user.hour_cycle || 'h12';
		
		if (!opts.second) delete opts.second;
		else {
			// has seconds -- does user want milliseconds too?
			if (user.milliseconds) opts.fractionalSecondDigits = 3;
			else delete opts.fractionalSecondDigits;
		}
		
		return opts;
	},
	
	getNiceEnabled(enabled) {
		return enabled ? `${cli.emoji('✅')} ${green('Enabled')}` : `${cli.emoji('🚫')} ${gray('Disabled')}`;
	},
	
	getNiceWebHook(hook) {
		if (!hook) return gray('(None)');
		if (typeof(hook) == 'string') {
			hook = Tools.findObject( this.web_hooks, { id: hook } ) || { id: hook, title: hook };
		}
		return this.raw ? gray(hook.id) : hook.title;
	},
	
	getNiceChannel(channel) {
		if (!channel) return gray('(None)');
		if (typeof(channel) == 'string') {
			channel = Tools.findObject( this.channels, { id: channel } ) || { id: channel, title: channel };
		}
		return this.raw ? gray(channel.id) : channel.title;
	},
	
	getNiceBucket(bucket) {
		if (!bucket) return gray('(None)');
		if (typeof(bucket) == 'string') {
			bucket = Tools.findObject( this.buckets, { id: bucket } ) || { id: bucket, title: bucket };
		}
		return this.raw ? gray(bucket.id) : bucket.title;
	},
	
	getNiceJob(job) {
		// get formatted job id
		if (!job) return '(None)';
		if (typeof(job) == 'string') {
			if (this.activeJobs[job]) job = this.activeJobs[job];
			else job = { id: job };
		}
		
		var nice_id = job.id;
		if (job.label && ((job.type != 'adhoc') || ('plabel' in job))) {
			nice_id = job.label + gray(' (' + job.id + ')');
		}
		
		var prefix = '';
		if (job.workflow && job.workflow.job) prefix = gray.bold('➥ ');
		
		var icon = '⏱️';
		if (job.suspended) icon = '⏸️';
		else if (job.invisible) icon = '🫥';
		else if (job.type == 'workflow') icon = '📋';
		
		return prefix + cli.emoji(icon) + ' ' + nice_id;
	},
	
	getNiceJobElapsedTime(job, abbrev, no_secondary) {
		// render nice elapsed time display
		var now = Math.floor( job.completed || this.epoch );
		var elapsed = job.elapsed || Math.max( 0, now - Math.floor(job.started) ) || 0;
		return Tools.getTextFromSeconds( elapsed, abbrev, no_secondary );
	},
	
	getNiceJobRemainingTime(job, abbrev) {
		// get nice job remaining time, using elapsed and progress
		var now = this.epoch;
		var elapsed = Math.floor( Math.max( 0, now - job.started ) );
		var progress = job.progress || 0;
		if ((elapsed >= 10) && (progress > 0) && (progress < 1.0)) {
			var sec_remain = Math.floor(((1.0 - progress) * elapsed) / progress);
			return Tools.getTextFromSeconds( sec_remain, abbrev, true );
		}
		else return 'n/a';
	},
	
	getNiceJobState(job) {
		// get nice job state given job
		// (states: queued, start_delay, retry_delay, ready, starting, active, finishing, complete)
		var nice_state = ucfirst(job.state || 'unknown');
		var now = this.epoch;
		
		switch (job.state) {
			case 'queued': 
				if (job.position && job.priority) nice_state += ` (#${job.position} - Priority)`;
				else if (job.position) nice_state += ` (#${job.position})`;
				else if (job.priority) nice_state += ` (Priority)`;
			break;
			
			case 'start_delay': 
				nice_state = 'Start Delay';
				if (job.until && (job.until > now)) nice_state += ' (' + Tools.getTextFromSeconds(job.until - now, true, true) + ')';
			break;
			
			case 'retry_delay': 
				nice_state = 'Retry Delay';
				if (job.until && (job.until > now)) nice_state += ' (' + Tools.getTextFromSeconds(job.until - now, true, true) + ')';
			break;
		}
		
		// special case: If job is complete but not final, it's actually still finishing
		if ((job.state == 'complete') && !job.final) { nice_state = 'Finishing'; }
		
		// special case for suspended job
		if (job.suspended && !job.final) { nice_state = 'Suspended'; }
		
		return nice_state;
	},
	
	getNiceJobEvent(job) {
		// get nice event formatted as running job, supporting workflows etc.
		if (job.type == 'adhoc') {
			var plugin = Tools.findObject( this.plugins, { id: job.plugin } );
			if (!plugin) return 'n/a'; // sanity
			
			var title = '';
			
			if ('plabel' in job) {
				// new
				title = job.plabel || plugin.title;
			}
			else {
				// legacy
				title = job.label || plugin.title;
			}
			
			return title;
		}
		else if ('plabel' in job) {
			return job.plabel || this.getNiceEvent(job.event);
		}
		else return this.getNiceEvent(job.event);
	},
	
	getNiceJobSource(job) {
		return Tools.ucfirst(job.source);
	},
	
	getJobResultArgs(job) {
		var color = '';
		var text = ucfirst( '' + job.code );
		var icon = '';
		
		if (!job.final) {
			color = 'blue';
			text = 'In Progress';
			icon = '🔄';
		}
		else if (job.replay) {
			color = 'cyan';
			text = 'Replay';
			icon = '⏮️';
		}
		else if (!job.code) {
			color = 'green';
			text = 'Success';
			icon = '✅';
		}
		else if (job.retried) {
			color = 'orange';
			text = 'Retried';
			icon = '✴️';
		}
		else switch(job.code) {
			case 'warning': color = 'yellow'; icon = '⚠️'; break;
			case 'critical': color = 'purple'; icon = '☢️'; break;
			case 'abort': color = 'gray'; text = 'Aborted'; icon = '🚫'; break;
			
			default:
				color = 'red';
				text = 'Error';
				icon = '🛑';
			break;
		}
		
		return { color, text, icon };
	},
	
	getNiceJobResult(job) {
		// color label + icon for job result
		var args = this.getJobResultArgs(job);
		return cli.emoji(args.icon) + ' ' + this.color(args.color).bold(args.text);
	},
	
	getJobActionDisplayArgs(action, link) {
		// get display args for job action
		// returns: { condition, type, text, desc }
		var disp = Tools.copyHash({
			condition: Tools.findObject( this.config.ui.action_condition_menu, { id: action.condition } ) || 
				Tools.findObject( this.config.ui.alert_action_condition_menu, { id: action.condition } )
		}, true);
		
		if (!disp.condition && action.condition.match(/^tag:(\w+)$/)) {
			var tag_id = RegExp.$1;
			var tag = Tools.findObject( this.tags, { id: tag_id } ) || { title: tag_id };
			disp.condition = { id: action.condition, title: "On " + tag.title };
		}
		else if (!disp.condition && (action.condition == 'instant')) {
			disp.condition = { id: action.condition, title: "Instant" };
		}
		
		disp.condition.color = this.condition_colors[action.condition] || 'gray';
		
		disp.note = action.source ? `(Inherited from ${action.source})` : '';
		
		switch (action.type) {
			case 'email':
				disp.type = "Send Email";
				var parts = [];
				if (action.users && action.users.length) parts.push( '' + Tools.commify(action.users.length) + ' ' + Tools.pluralize('user', action.users.length) );
				if (action.email) parts.push( action.email );
				if (!parts.length) parts = [ '(None)' ];
				disp.text = disp.desc = parts.join(', ');
			break;
			
			case 'web_hook':
				disp.type = "Web Hook";
				var web_hook = Tools.findObject( this.web_hooks, { id: action.web_hook } );
				disp.text = web_hook ? web_hook.title : "(Web Hook not found)";
				disp.desc = this.getNiceWebHook(action.web_hook);
			break;
			
			case 'run_event':
				disp.type = "Run Event";
				var event = Tools.findObject( this.events, { id: action.event_id } );
				disp.text = event ? event.title : "(Event not found)";
				disp.desc = this.getNiceEvent(event);
			break;
			
			case 'channel':
				disp.type = "Notify Channel";
				var channel = Tools.findObject( this.channels, { id: action.channel_id } );
				disp.text = channel ? channel.title : "(Channel not found)";
				disp.desc = this.getNiceChannel(channel, link);
			break;
			
			case 'snapshot':
				disp.type = "Take Snapshot";
				disp.text = disp.desc = "(Current Server)";
			break;
			
			case 'store':
				disp.type = "Store Bucket";
				var bucket = Tools.findObject( this.buckets, { id: action.bucket_id } );
				disp.text = bucket ? bucket.title : "(Bucket not found)";
				disp.desc = this.getNiceBucket(bucket, link);
			break;
			
			case 'fetch':
				disp.type = "Fetch Bucket";
				var bucket = Tools.findObject( this.buckets, { id: action.bucket_id } );
				disp.text = bucket ? bucket.title : "(Bucket not found)";
				disp.desc = this.getNiceBucket(bucket, link);
			break;
			
			case 'ticket':
				disp.type = 'Create Ticket';
				var ticket_type = Tools.findObject( this.config.ui.ticket_types, { id: action.ticket_type } );
				disp.text = ticket_type.title;
				disp.desc = disp.text;
			break;
			
			case 'suspend':
				disp.type = "Suspend Job";
				var label = "";
				if ((action.users && action.users.length) || action.email.length) label = "Send Email";
				if (action.web_hook) label += (label.length ? ', ' : '') + "Web Hook";
				disp.text = disp.desc = label || 'n/a';
			break;
			
			case 'tag':
				disp.type = "Apply Tags";
				disp.text = this.getNiceTagList(action.tags);
				disp.desc = disp.text;
			break;
			
			case 'label':
				disp.type = "Apply Label";
				disp.text = '"' + action.label + '"';
				disp.desc = disp.text;
			break;
			
			case 'disable':
				disp.type = "Disable Event";
				disp.text = disp.desc = "(Current Event)";
				disp.icon = 'cancel';
			break;
			
			case 'delete':
				disp.type = "Delete Event";
				disp.text = disp.desc = "(Current Event)";
				disp.icon = 'trash-can-outline';
			break;
			
			case 'plugin':
				disp.type = "Plugin";
				var plugin = Tools.findObject( this.plugins, { id: action.plugin_id, type: 'action' } );
				disp.text = plugin ? plugin.title : "(Plugin not found)";
				disp.desc = this.getNicePlugin(plugin, link);
				disp.icon = 'power-plug';
			break;
			
		} // switch item.type
		
		return disp;
	},
	
	getResLimitDisplayArgs(item) {
		// get nice title and description for resource limit
		var nice_title = '';
		var nice_desc = '';
		var short_desc = '';
		var note = item.source ? `(Inherited from ${item.source})` : '';
		
		switch (item.type) {
			case 'mem':
				nice_title = "Max Memory";
				nice_desc = Tools.getTextFromBytes(item.amount) + " for " + Tools.getTextFromSeconds(item.duration, false, true);
				short_desc = Tools.getTextFromBytes(item.amount);
			break;
			
			case 'cpu':
				nice_title = "Max CPU %";
				nice_desc = item.amount + "% for " + Tools.getTextFromSeconds(item.duration, false, true);
				short_desc = item.amount + '%';
			break;
			
			case 'log':
				nice_title = "Max Log Size";
				nice_desc = short_desc = Tools.getTextFromBytes(item.amount);
			break;
			
			case 'time':
				nice_title = "Max Run Time";
				nice_desc = Tools.getTextFromSeconds(item.duration, false, false);
				short_desc = Tools.getTextFromSeconds(item.duration, true, false);
			break;
			
			case 'job':
				nice_title = "Max Jobs";
				if (!item.amount) nice_desc = short_desc = "Unlimited";
				else {
					nice_desc = "Up to " + Tools.commify(item.amount) + " concurrent " + Tools.pluralize("job", item.amount);
					short_desc = Tools.commify(item.amount) + ' ' + Tools.pluralize("job", item.amount);
				}
			break;
			
			case 'retry':
				nice_title = "Max Retries";
				if (!item.amount) {
					nice_desc = "No retries will be attempted";
					short_desc = "None";
				}
				else {
					nice_desc = short_desc = "Up to " + Tools.commify(item.amount);
					if (item.duration) nice_desc += " (" + Tools.getTextFromSeconds(item.duration, false, true) + " delay)";
				}
			break;
			
			case 'queue':
				nice_title = "Max Queue";
				if (!item.amount) {
					nice_desc = "No jobs allowed in queue";
					short_desc = "None";
				}
				else {
					nice_desc = "Up to " + Tools.commify(item.amount) + " " + Tools.pluralize("job", item.amount) + " allowed in queue";
					short_desc = Tools.commify(item.amount) + ' ' + Tools.pluralize("job", item.amount);
				}
			break;
			
			case 'file':
				nice_title = "Max Files";
				if (!item.amount) {
					nice_desc = "No files allowed";
					short_desc = "None";
				}
				else {
					nice_desc = "Up to " + Tools.commify(item.amount) + " " + Tools.pluralize("file", item.amount);
					if (item.size) nice_desc += " (" + Tools.getTextFromBytes(item.size) + " total)";
					
					short_desc = Tools.commify(item.amount) + ' ' + Tools.pluralize("file", item.amount);
					if (item.size) short_desc += ", " + Tools.getTextFromBytes(item.size);
				}
			break;
			
			case 'day':
				nice_title = "Max Daily";
				nice_desc = "Up to " + Tools.commify(item.amount) + " &ldquo;" + item.condition + "&rdquo; " + Tools.pluralize("condition", item.amount);
				short_desc = Tools.commify(item.amount) + " x " + item.condition;
			break;
			
			case 'tag':
				nice_title = "Max Tags";
				if (!item.amount) {
					nice_desc = "No tags allowed";
					short_desc = "None";
				}
				else {
					nice_desc = "Up to " + Tools.commify(item.amount) + " " + Tools.pluralize("tag", item.amount);
					short_desc = Tools.commify(item.amount) + ' ' + Tools.pluralize("tag", item.amount);
				}
			break;
		} // switch item.type
		
		return { nice_title, nice_desc, short_desc, note };
	},
	
	setPath: function(target, path, value) {
		// set path using dir/slash/syntax or dot.path.syntax
		// support inline dots and slashes if backslash-escaped
		// implement strict array indexing
		var parts = (path.indexOf("\\") > -1) ? path.replace(/\\\./g, '__PXDOT__').replace(/\\\//g, '__PXSLASH__').split(/[\.\/]/).map( function(elem) {
			return elem.replace(/__PXDOT__/g, '.').replace(/__PXSLASH__/g, '/');
		} ) : path.split(/[\.\/]/);
		
		var key = parts.pop();
		if (key.match(Tools.MATCH_BAD_KEY)) return false;
		
		// traverse path
		while (parts.length) {
			var part = parts.shift();
			if (part) {
				if (part.match(Tools.MATCH_BAD_KEY)) {
					// do not traverse into any bad keys
					return false;
				}
				if (Array.isArray(target)) {
					if (!part.match(/^(0|[1-9]\d*)$/)) return false;
					if (!(parseInt(part) in target)) return false;
				}
				if (!(part in target)) {
					// auto-create nodes
					target[part] = {};
				}
				if (!target[part] || (typeof(target[part]) != 'object')) {
					// path runs into null or a non-object
					return false;
				}
				target = target[part];
			}
		}
		
		if (Array.isArray(target)) {
			if (!key.match(/^(0|[1-9]\d*)$/)) return false;
			if (!(parseInt(key) in target)) return false;
		}
		
		target[key] = value;
		return true;
	},
	
	deletePath: function(target, path) {
		// Delete an object property using dir/slash/syntax or dot.path.syntax.
		// This intentionally tightens pixl-tools' implementation for untrusted CLI
		// paths, just as our local setPath() does for strict array traversal.
		if (!target || (typeof(target) != 'object') || (typeof(path) != 'string') || !path.length) return false;
		
		// Support literal dots and slashes when they are backslash-escaped.
		var parts = (path.indexOf("\\") > -1) ? path.replace(/\\\./g, '__PXDOT__').replace(/\\\//g, '__PXSLASH__').split(/[\.\/]/).map( function(elem) {
			return elem.replace(/__PXDOT__/g, '.').replace(/__PXSLASH__/g, '/');
		} ) : path.split(/[\.\/]/);
		
		var key = parts.pop();
		if (!key || key.match(Tools.MATCH_BAD_KEY)) return false;
		
		// Traverse existing containers only.  Arrays may be crossed using a strict,
		// existing numeric index, but they are never modified by this helper.
		while (parts.length) {
			var part = parts.shift();
			if (!part) continue;
			if (part.match(Tools.MATCH_BAD_KEY)) return false;
			
			if (Array.isArray(target) && !part.match(/^(0|[1-9]\d*)$/)) return false;
			if (!Object.prototype.hasOwnProperty.call(target, part)) return false;
			if (!target[part] || (typeof(target[part]) != 'object')) return false;
			target = target[part];
		}
		
		// Deleting an array index would leave a sparse hole.  The final container
		// must be an object with the requested property as its own key.
		if (Array.isArray(target)) return false;
		if (!Object.prototype.hasOwnProperty.call(target, key)) return false;
		delete target[key];
		return true;
	},
	
	mergeDotArgs(target, source) {
		// merge dot paths into target cleanly
		// target and source may be the same object
		for (var key in source) {
			if (key.match(/\./)) {
				// resolve dotted paths
				if (!this.setPath(target, key, source[key])) {
					this.die("Invalid argument path: " + key);
				}
				
				// remove the original dotted key when operating in-place
				if (target === source) delete target[key];
			}
			else if (target !== source) {
				// copy ordinary top-level arguments
				target[key] = source[key];
			}
		}
	},
	
	applyDeleteArgs(target, source) {
		// Apply one or more repeated `--delete PATH` options to an update object.
		// The caller should merge ordinary updates first so explicit deletes win.
		if (!Object.prototype.hasOwnProperty.call(source, 'delete')) return;
		var paths = Tools.alwaysArray(source.delete);
		
		// `delete` is a CLI instruction, not part of the outgoing API request.
		delete source.delete;
		if (target !== source) delete target.delete;
		
		paths.forEach( path => {
			path = String(path);
			
			// xyOps update APIs shallow-merge top-level properties.  Require a nested
			// path so deleting the leaf and sending its parent has real server effect.
			var path_parts = path.replace(/\\\./g, '').replace(/\\\//g, '').split(/[\.\/]/).filter( part => !!part );
			if (path_parts.length < 2) {
				this.die("Delete path must identify a nested object property: " + path);
			}
			if (!this.deletePath(target, path)) {
				this.die("Invalid or missing delete path: " + path);
			}
		});
	},
	
	jsonOutput(data) {
		// output formatted or compact json
		if (this.format && this.format.match(/jsonc/)) {
			print("\n");
			process.stdout.write( JSON.stringify(data) + "\n" );
		}
		else {
			var disp_value = JSON.stringify(data, null, "\t");
			
			if (this.format && this.format.match(/json/)) disp_value = String(disp_value).trim() + "\n";
			else disp_value = String(disp_value).trim().split(/\n/).map( line => '    ' + line ).join("\n") + "\n";
			
			process.stdout.write( "\n" + gray( this.highlight(disp_value, { language: 'json', ignoreIllegals: true }) ) );
		}
	},
	
	async cacheConfig() {
		// load client config from xyops and cache for a while
		var { err, data } = await this.cacheAPI('config', { format: 'json' }, { cache_ttl: 3600 });
		if (err) {
			println( "\n" + bold.red("Failed to contact xyOps at: ") + this.config.base_url );
			this.die(err);
		}
		
		for (var key in data.config) {
			if (!(key in this.config)) this.config[key] = data.config[key];
		}
		
		this.masters = data.masters;
		this.xyopsVersion = data.version;
	},
	
	async cacheAPI(name, req, opts) {
		// use cached API response, or call origin and update cache
		if (!opts) opts = {};
		
		// vary cache filename based on hash of base_url
		var filename = name + '-' + Tools.digestHex(this.config.base_url, 'sha256', 16) + '.json';
		
		var cache_file = Path.join( this.tempDir, filename );
		var ttl = opts.cache_ttl || this.config.cache_ttl || DEFAULT_CACHE_TTL;
		var stats = null;
		
		try { stats = fs.statSync(cache_file); }
		catch (err) { stats = null; }
		
		if (stats && (stats.mtimeMs / 1000 > Tools.timeNow() - ttl)) {
			// cache object still fresh
			return { data: JSON.parse( fs.readFileSync(cache_file, 'utf8') ) };
		}
		
		// fetch from origin
		delete opts.cache_ttl;
		var res = await this.api[name](req, opts);
		if (res.err) return res;
		
		// store in cache
		Tools.writeFileAtomicSync( cache_file, JSON.stringify(res.data) );
		
		return res;
	},
	
	async callStandardAPI(name, req, opts = {}) {
		// wrapper around APIs that make a change
		// indeterminate progress w/text, handle dry run, verbose req/res, etc.
		this.validateStandardAPIRequest(name, req);
		
		// Sensitive callers may supply a redacted display copy while the original
		// request continues through validation and transport unchanged.
		var filter_request = opts.filterRequest;
		delete opts.filterRequest;
		
		if (this.dry || this.verbose) {
			println( "\n " + this.color('theme').bold("API REQUEST:") );
			this.jsonOutput(filter_request ? filter_request(req) : req);
		}
		
		if (this.dry) {
			this.toast('⚠️', 'orange', bold("DRY RUN: ") + "Exiting without sending request.");
			return;
		}
		
		var text = opts.text || '';
		if (text) text = gray('→ ' + text);
		delete opts.text;
		
		// Callers handling one-time secrets can redact the verbose response while
		// retaining the original response object for their final, controlled output.
		var filter_response = opts.filterResponse;
		delete opts.filterResponse;
		
		cli.progress.start({ amount: 1, pct: false, text: text });
		var { err, data } = await this.api[name](req, opts);
		if (err) this.die(err);
		cli.progress.end();
		
		if (this.verbose) {
			println( "\n " + this.color('theme').bold("API RESPONSE:") );
			this.jsonOutput(filter_response ? filter_response(data) : data);
		}
		
		return data;
	},
	
	getLevenshteinDistance(left, right) {
		// Compute edit distance using two rows instead of allocating a full matrix.
		// CRUD property names are short, but keeping memory linear makes this helper
		// safe and generally useful for other CLI suggestions in the future.
		left = String(left);
		right = String(right);
		if (left === right) return 0;
		if (!left.length) return right.length;
		if (!right.length) return left.length;
		
		var previous = Array.from({ length: right.length + 1 }, (unused, idx) => idx);
		
		for (var left_idx = 1; left_idx <= left.length; left_idx++) {
			var current = [left_idx];
			
			for (var right_idx = 1; right_idx <= right.length; right_idx++) {
				var cost = left[left_idx - 1] == right[right_idx - 1] ? 0 : 1;
				current[right_idx] = Math.min(
					current[right_idx - 1] + 1,
					previous[right_idx] + 1,
					previous[right_idx - 1] + cost
				);
			}
			
			previous = current;
		}
		
		return previous[right.length];
	},
	
	findClosestString(value, candidates) {
		// Avoid noisy or misleading guesses.  Longer names tolerate a few more
		// edits, and tied candidates produce no suggestion at all.
		value = String(value).toLowerCase();
		var max_distance = Math.max(1, Math.min(3, Math.ceil(value.length / 3)));
		var best = '';
		var best_distance = Infinity;
		var tied = false;
		
		candidates.forEach( candidate => {
			var distance = this.getLevenshteinDistance(value, String(candidate).toLowerCase());
			if (distance < best_distance) {
				best = candidate;
				best_distance = distance;
				tied = false;
			}
			else if (distance == best_distance) tied = true;
		});
		
		return (!tied && (best_distance <= max_distance)) ? best : '';
	},
	
	validateStandardAPIRequest(name, req) {
		// Convert the SDK's camelCase method name to the documented API endpoint.
		// APIs without a CRUD property rule retain their normal pass-through behavior.
		var api_name = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
		var pattern = Object.keys(STANDARD_API_PROPERTY_RULES).find( pattern => {
			return new RegExp(pattern).test(api_name);
		});
		if (!pattern || !req || (typeof(req) != 'object') || Array.isArray(req)) return;
		
		var allowed = STANDARD_API_PROPERTY_RULES[pattern];
		var unexpected = Object.keys(req).find( key => !allowed.includes(key) );
		if (!unexpected) return;
		
		var suggestion = this.findClosestString(unexpected, allowed);
		var message = 'Unsupported property for ' + api_name + ': "' + unexpected + '".';
		if (suggestion) message += ' Did you mean "' + suggestion + '"?';
		this.die(message);
	},
	
	findObjectsFuzzy(arr, criteria, crit_count = 0) {
		// find objects using fuzzy matching (lower-case substring)
		crit_count = crit_count || Tools.numKeys(criteria);
		
		return arr.filter( item => {
			var num_matched = 0;
			for (var key in criteria) {
				if (String(item[key]).toLowerCase().includes(String(criteria[key]).toLowerCase())) num_matched++;
			}
			return (num_matched >= crit_count);
		} );
	},
	
	findObjectFuzzy(arr, criteria, crit_count = 0) {
		// find object using fuzzy matching (lower-case substring)
		crit_count = crit_count || Tools.numKeys(criteria);
		
		return arr.find( item => {
			var num_matched = 0;
			for (var key in criteria) {
				if (String(item[key]).toLowerCase().includes(String(criteria[key]).toLowerCase())) num_matched++;
			}
			return (num_matched >= crit_count);
		} );
	},
	
	includesAny: function(haystack, needles) {
		// return true if haystack contains any needles, false otherwise
		for (var idx = 0, len = needles.length; idx < len; idx++) {
			if (haystack.includes(needles[idx])) return true;
		}
		return false;
	},
	
	includesAll: function(haystack, needles) {
		// return true if haystack contains ALL needles, false otherwise
		for (var idx = 0, len = needles.length; idx < len; idx++) {
			if (!haystack.includes(needles[idx])) return false;
		}
		return true;
	},
	
	getTextFromSecondsShort(sec) {
		if (sec >= 31536000) return '' + Math.floor(sec / 31536000) + 'y';
		if (sec >= 2592000) return '' + Math.floor(sec / 2592000) + 'mo';
		if (sec >= 86400) return '' + Math.floor(sec / 86400) + 'd';
		if (sec >= 3600) return '' + Math.floor(sec / 3600) + 'h';
		if (sec >= 60) return '' + Math.floor(sec / 60) + 'm';
		return '' + Math.floor(sec / 1) + 's';
	},
	
	toast(emoji, color, text) {
		// Toasts wrap at the visible terminal width.  Redirected output has no TTY
		// width, so use the same conventional 80-column fallback as other displays.
		var final_text = cli.emoji(emoji) + '  ' + this.color(color).bold( text );
		
		// Account for the indent, two borders, and two spaces of padding per side.
		// cli.box performs word wrapping at this content width and never ellipsizes.
		var available_width = Math.max( 1, (cli.width() || 80) - 7 );
		var max_width = Math.min( available_width, cli.stringWidth(final_text) );
		println( "\n" + cli.box(final_text, { width: max_width, hspace: 2, vspace: 1, indent: 1, styles: [this.color(color)] }) );
	},
	
	printMutationSummary(opts) {
		// Mutation summaries are UX for interactive users.  Keep explicit JSON
		// formats machine-readable by omitting all decorative terminal output.
		if (this.format && this.format.match(/json/)) return;
		this.printBoxList(opts);
	},
	
	printUpdateData(data) {
		// Show the parsed CLI input before resource-specific normalization or merging,
		// so the user can verify exactly how their update arguments were understood.
		if (this.format && this.format.match(/json/)) return;
		print( "\n " + this.color('theme').bold('UPDATE DATA') );
		this.jsonOutput(data || {});
	},
	
	printUserNotes(title, notes) {
		// print user notes (plain text, multi-line)
		println( "\n " + this.color('theme').bold(title) );
		if (cli.width()) {
			println( cli.box(String(notes).trim(), { indent: 1, hspace: 1, width: Math.min( cli.width() - 6, cli.widestLine(notes) ) } ) );
		}
		else {
			println( String(notes).trim() );
		}
	},
	
	table(rows, opts) {
		// wrapper around cli.table, drop columns based on screen width
		if (!opts) opts = {};
		if (!('indent' in opts)) opts.indent = 1;
		// if (!('autoFit' in opts)) opts.autoFit = true;
		opts.autoFit = false;
		
		var width = cli.width();
		if (!width) return cli.table(rows, opts);
		
		// chop columns if table is too wide
		var orig_rows = [ ...rows ];
		var chopped = false;
		
		while ((cli.widestLine(cli.table(Tools.copyHash(rows, true), opts)) > width) && rows[0].length) {
			rows.forEach( function(row) { row.pop(); } );
			chopped = true;
		}
		
		if (!rows[0].length) {
			// oops, we killed all the rows, add first one back in (will be auto-fit)
			rows.forEach( function(row, idx) { row.push( orig_rows[idx] ); } );
		}
		
		if (chopped) {
			rows.forEach( function(row) { row.push('...'); } );
			opts.autoFit = true;
		}
		
		return cli.table(rows, opts);
	},
	
	printSuggestedCommands(opts) {
		// print formatted suggested commands for the user to copy & paste
		if (('suggest' in this.config) && !this.config.suggest) return;
		
		var cmds = Object.keys(opts).filter( label => !!opts[label] ).map( label => {
			return [ label, opts[label] ];
		} );
		if (!cmds.length) return;
		
		println("\n " + this.color('theme').bold("Other Commands:") );
		cmds.forEach( pair => {
			var [ label, cmd ] = pair;
			println( "   " + this.color('green').bold('• ' + label) + ": " + bold(cmd) );
		} );
	},
	
	printBoxList(opts) {
		// convenience wrapper around cli.defList with title and colors
		// args: { title, rows }
		println( "\n " + this.color('theme').bold( opts.title.toUpperCase() ) + "\n" + 
			cli.defList(opts.rows.filter( row => !!row ), { labelStyles: ['yellow', 'bold'], textStyles: [], indent: 1, gap: 2 }) );
	},
	
	printBoxTable(opts) {
		// convenience wrapper around cli.table with title and colors
		println( "\n " + this.color('theme').bold( opts.title.toUpperCase() ) + (opts.title_suffix || '') );
		var rows = [ opts.header ].concat( opts.rows.filter( row => !!row ) );
		if (rows.length < 2) {
			println( gray(` No ${opts.title.toLowerCase()} found.`) );
			return;
		}
		println( "" + this.table(rows, {}) );
	},
	
	prepSearchArgs() {
		// Call only from a paginated command or variant, before building filters.
		// Other commands may use these names as API or resource properties.
		this.offset = this.args.offset || 0;
		this.limit = this.args.limit || this.config.items_per_page;
		if (this.args.page) this.offset = (this.args.page - 1) * this.limit;
		
		// Keep pagination out of fuzzy criteria and server search query strings.
		delete this.args.offset;
		delete this.args.limit;
		delete this.args.page;
	},
	
	printPaginatedBoxTable(opts, callback) {
		// print paginated box table
		var results = {
			limit: opts.limit,
			offset: opts.offset || 0,
			total: opts.list.length
		};
		
		var num_pages = Math.floor( results.total / results.limit ) + 1;
		if (results.total % results.limit == 0) num_pages--;
		var current_page = Math.floor( results.offset / results.limit ) + 1;
		
		var data_type = opts.data_type || opts.title.toLowerCase();
		var nice_total = Tools.commify(results.total) + ' items found';
		if (num_pages > 1) nice_total += ', page ' + Tools.commify(current_page) + ' of ' + Tools.commify(num_pages);
		
		if (results.total) opts.title_suffix = gray(` (${nice_total})`);
		opts.rows = opts.rows.map( callback );
		
		this.printBoxTable(opts);
		
		if ((current_page == 1) && (current_page < num_pages)) {
			println( ' ' + gray(`(Add ${cyan.bold('--page 2')} to view the next page.)`) );
		}
	},
	
	printActiveJobs(opts) {
		// print table of running jobs, with optional criteria
		if (!opts) opts = {};
		if (!opts.criteria) opts.criteria = {};
		
		opts.title = opts.title || 'Active Jobs';
		opts.header = [ 'Job ID', 'Event', 'Category', 'Server', 'State', 'Elapsed', 'Progress', 'Remaining' ];
		
		var jobs = opts.rows || Tools.sortBy( Tools.findObjects( Object.values(this.activeJobs), opts.criteria ), 'started', { type: 'number', dir: -1 } );
		var now = this.epoch;
		
		opts.rows = jobs.map( job => {
			return [
				this.color('theme').bold( this.getNiceJob(job) ),
				this.getNiceEvent(job.event),
				this.getNiceCategory(job.category),
				this.getNiceServer(job.server),
				this.getNiceJobState(job),
				Tools.getTextFromSeconds( now - job.started, true, true ),
				Tools.pct( (job.progress || 0), 1.0, true ),
				this.getNiceJobRemainingTime(job, true)
			];
		} );
		
		this.printBoxTable(opts);
	},
	
	printInternalJobs(opts) {
		// print table of internal jobs, with optional criteria
		if (!opts) opts = {};
		if (!opts.criteria) opts.criteria = {};
		
		// hide section entirely if no jobs
		if (!Tools.firstKey(this.internalJobs)) return;
		
		opts.title = opts.title || 'Internal Jobs';
		opts.header = [ 'Job ID', 'Title', 'Type', 'Username', 'Progress', 'Elapsed', 'Remaining' ];
		
		var jobs = Tools.sortBy( Tools.findObjects( Object.values(this.internalJobs), opts.criteria ), 'started', { type: 'number', dir: -1 } );
		var now = this.epoch;
		
		opts.rows = jobs.map( job => {
			return [
				this.color('theme').bold(job.id),
				bold(job.title),
				job.type,
				job.username,
				Tools.pct( (job.progress || 0), 1.0, true ),
				Tools.getTextFromSeconds( now - job.started, true, true ),
				this.getNiceJobRemainingTime(job, true)
			];
		} );
		
		this.printBoxTable(opts);
	},
	
	printActiveAlerts(opts) {
		// print table of running alerts, with optional criteria
		if (!opts) opts = {};
		if (!opts.criteria) opts.criteria = {};
		
		opts.title = opts.title || 'Active Alerts';
		opts.header = [ "Alert ID", "Title", "Message", "Server", "Status", "Started", "Duration" ];
		
		var alerts = Tools.sortBy( Tools.findObjects( Object.values(this.activeAlerts), opts.criteria ), 'date', { type: 'number', dir: -1 } );
		var now = this.epoch;
		
		opts.rows = alerts.map( alert => {
			return [
				cli.emoji('🔔') + ' ' + this.color('theme').bold(alert.id),
				this.getNiceAlert(alert.alert, false),
				alert.message,
				this.getNiceServer(alert.server, false),
				this.getNiceAlertStatus(alert),
				this.getNiceDateTime(alert.date),
				Tools.getTextFromSeconds( now - alert.date, true, true )
			];
		} );
		
		this.printBoxTable(opts);
	},
	
	async printUpcomingJobs(opts) {
		// predict and print upcoming jobs
		if (!opts) opts = {};
		
		cli.progress.start();
		
		this.upcomingJobs = await new Promise((resolve, reject) => {
			this.predictUpcomingJobs({
				events: opts.events || this.events,
				duration: 86400 * 32,
				burn: 16,
				max: 1000,
				progress: function(amount) { cli.progress.update( amount ); },
				callback: resolve
			});
		}); // promise
		
		cli.progress.end();
		
		opts.title = opts.title || 'Upcoming Jobs';
		opts.header = [ 'Event', 'Category', 'Targets', 'Source', 'Scheduled Time', 'Countdown' ];
		
		opts.offset = this.offset || 0;
		opts.limit = this.limit || this.config.items_per_page;
		opts.rows = this.upcomingJobs.slice( opts.offset, opts.offset + opts.limit );
		opts.list = { length: this.upcomingJobs.length };
		
		this.printPaginatedBoxTable( opts, job => {
			var type_info = Tools.findObject( this.config.ui.event_trigger_type_menu, { id: job.type } ) || { title: "Scheduler", icon: 'update' };
			var nice_source = type_info.title;
			var event = Tools.findObject( this.events, { id: job.event } ) || {};
			var precision = event.triggers ? Tools.findObject(event.triggers, { type: 'precision', enabled: true }) : null;
			var nice_date_time = '';
			var nice_countdown = '';
			var nice_skip = '';
			
			// take over source if plugin modifier
			if (job.plugin) {
				var plugin = Tools.findObject( this.plugins, { id: job.plugin } ) || { title: job.plugin };
				nice_source = plugin.title;
			}
			
			// optionally vary date/time prediction display based on precision or interval
			var countdown = 0;
			
			if (precision && precision.seconds && precision.seconds.length) {
				job.seconds = precision.seconds;
			}
			
			if (job.seconds) {
				// precision or interval job
				nice_date_time = this.getRelativeDateTime( job.epoch + job.seconds[0], true );
				if (job.seconds.length > 1) nice_date_time += ' (+' + Math.floor(job.seconds.length - 1) + ')';
				countdown = Math.max( 60, Math.abs((job.epoch + job.seconds[0]) - app.epoch) );
			}
			else {
				// normal scheduled job
				nice_date_time = this.getRelativeDateTime( job.epoch );
				countdown = Math.max( 60, Math.abs(job.epoch - app.epoch) );
			}
			
			nice_countdown = get_text_from_seconds_round( countdown, true );
			
			return [
				this.color('theme').bold( this.getNiceEvent(job.event, true) ),
				this.getNiceCategory(event.category),
				this.getNiceTargets(event.targets),
				nice_source,
				nice_date_time,
				nice_countdown
			];
		} );
	},
	
	async printCompletedJobs(opts) {
		// search for jobs, and print results
		if (!opts) opts = {};
		
		var has_ids = Array.isArray(opts.ids);
		var query = opts.query || '*';
		var offset = ('offset' in opts) ? opts.offset : this.offset;
		var limit = opts.limit || this.limit || this.config.items_per_page;
		var rows = [];
		var list = { length: 0 };
		
		if (has_ids) {
			if (!opts.ids.length) return;
			cli.progress.start();
			var { err, data } = await this.api.getJobs({
				ids: opts.ids
			});
			if (err) this.die(err);
			cli.progress.end();
			
			var all_rows = data.jobs || [];
			list = { length: all_rows.length };
			rows = all_rows.slice(offset, offset + limit);
		}
		else {
			cli.progress.start();
			var { err, data } = await this.api.searchJobs({
				query: opts.query || '*',
				offset: this.offset,
				limit: this.limit
			});
			if (err) this.die(err);
			rows = data.rows;
			list = data.list;
			cli.progress.end();
		}
		
		// Embedded detail screens should omit the section when there are no associated tickets.
		if (opts.hide_empty && !rows.length) return;
		
		opts.title = opts.title || 'Completed Jobs';
		opts.header = [ 'Job ID', 'Event', 'Category', 'Server', 'Source', 'Tags', 'Completed', 'Elapsed', 'Result' ];
		
		opts.offset = this.offset || 0;
		opts.limit = this.limit || this.config.items_per_page;
		opts.rows = rows;
		opts.list = list;
		
		this.printPaginatedBoxTable( opts, job => {
			if (!job) return false;
			return [
				this.color('theme').bold( this.getNiceJob(job) ),
				this.getNiceJobEvent(job, true),
				this.getNiceCategory(job.category, true),
				this.getNiceServer(job.server, true),
				this.getNiceJobSource(job),
				this.getNiceTagList( job.tags, false ),
				this.getRelativeDateTime( job.completed, true ),
				this.getNiceJobElapsedTime(job, true, true),
				this.getNiceJobResult(job)
			];
		});
	},
	
	async printQueuedJobs(opts) {
		// Fetch queued jobs from the server and print a paginated table.
		if (!opts) opts = {};
		
		var offset = ('offset' in opts) ? opts.offset : this.offset;
		var limit = opts.limit || this.limit || this.config.items_per_page;
		
		// Start with any optional caller-supplied criteria, but always restrict this
		// helper to queued jobs.  An event ID may be supplied for event detail views.
		var params = Object.assign({}, opts.criteria || {}, {
			state: 'queued',
			offset: offset,
			limit: limit,
			sort_by: opts.sort_by || 'started',
			sort_dir: ('sort_dir' in opts) ? opts.sort_dir : -1
		});
		
		if (opts.event) params.event = opts.event;
		
		cli.progress.start();
		var { err, data } = await this.api.getActiveJobs(params);
		if (err) this.die(err);
		cli.progress.end();
		
		var rows = data.rows || [];
		
		// Allow this helper to be embedded in larger detail screens without
		// displaying an empty section.
		if (opts.hide_empty && !rows.length) return;
		
		opts.title = opts.title || 'Queued Jobs';
		opts.header = [
			'Job ID',
			'State',
			'Source',
			'Targets',
			'Queued',
			'Elapsed'
		];
		
		opts.offset = offset;
		opts.limit = limit;
		opts.rows = rows;
		opts.list = data.list || { length: rows.length };
		
		this.printPaginatedBoxTable(opts, job => {
			if (!job) return false;
			
			return [
				this.color('theme').bold(this.getNiceJob(job)),
				this.getNiceJobState(job),
				this.getNiceJobSource(job),
				this.getNiceTargets(job.targets),
				this.getRelativeDateTime(job.started, true),
				this.getNiceJobElapsedTime(job, true)
			];
		});
	},
	
	async printAlertInvocations(opts) {
		// Search historical or active alert invocations and print the results.
		// By default this shows all invocations, with the most recent first.
		if (!opts) opts = {};
		
		var query = opts.query || '*';
		var offset = ('offset' in opts) ? opts.offset : this.offset;
		var limit = opts.limit || this.limit || this.config.items_per_page;
		
		cli.progress.start();
		var { err, data } = await this.api.searchAlerts({
			query: query,
			offset: offset,
			limit: limit,
			sort_by: opts.sort_by || '_id',
			sort_dir: ('sort_dir' in opts) ? opts.sort_dir : -1
		});
		if (err) this.die(err);
		cli.progress.end();
		
		var rows = data.rows || [];
		
		// Some embedded detail screens, such as completed jobs, should omit the
		// section entirely when no related alerts exist.
		if (opts.hide_empty && !rows.length) return;
		
		var is_filtered = query && (query != '*');
		
		if (this.format.match(/json/)) return this.jsonOutput(rows);
		
		opts.title = opts.title || (
			is_filtered ? 'Alert Invocation Search Results' : 'All Alert Invocations'
		);
		
		opts.header = [
			'Invocation ID',
			'Title',
			'Message',
			'Server',
			'Status',
			'Started',
			'Duration'
		];
		
		opts.offset = offset;
		opts.limit = limit;
		opts.rows = rows;
		opts.list = data.list || { length: rows.length };
		
		this.printPaginatedBoxTable(opts, alert => {
			var icon = alert.active ? '🚨' : '🔔';
			
			// Active alerts run through the current server time.  Cleared alerts
			// use their final modified timestamp as the ending time.
			var completed = alert.active ?
				this.epoch :
				(alert.modified || alert.date);
			
			var elapsed = Math.floor(
				Math.max(0, completed - alert.date)
			);
			
			// Keep multiline alert messages from breaking the table layout.
			var message = String(alert.message || '')
				.replace(/\s+/g, ' ')
				.trim();
			
			return [
				this.color('theme').bold(alert.id),
				this.getNiceAlert(alert.alert),
				message,
				this.getNiceServer(alert.server),
				this.getNiceAlertStatus(alert),
				this.getRelativeDateTime(alert.date, true),
				Tools.getTextFromSeconds(elapsed, true, true)
			];
		});
	},
	
	async printSnapshots(opts) {
		// Search server or group snapshots and print the results.
		// By default this shows all snapshots, with the most recent first.
		if (!opts) opts = {};
		
		var query = opts.query || '*';
		var offset = ('offset' in opts) ? opts.offset : this.offset;
		var limit = opts.limit || this.limit || this.config.items_per_page;
		
		cli.progress.start();
		var { err, data } = await this.api.searchSnapshots({
			query: query,
			offset: offset,
			limit: limit,
			sort_by: opts.sort_by || '_id',
			sort_dir: ('sort_dir' in opts) ? opts.sort_dir : -1,
			verbose: !!opts.verbose
		});
		if (err) this.die(err);
		cli.progress.end();
		
		var rows = data.rows || [];
		
		// Embedded detail screens should omit this section when no related
		// snapshots were found.
		if (opts.hide_empty && !rows.length) return;
		
		var is_filtered = query && (query != '*');
		
		opts.title = opts.title || (
			is_filtered ? 'Snapshot Search Results' : 'All Snapshots'
		);
		
		opts.header = [
			'Snapshot ID',
			'Source',
			'Target',
			'Uptime',
			'Load Avg',
			'Mem Avail',
			'Date / Time'
		];
		
		opts.offset = offset;
		opts.limit = limit;
		opts.rows = rows;
		opts.list = data.list || { length: rows.length };
		
		this.printPaginatedBoxTable(opts, snapshot => {
			var is_group = (snapshot.type == 'group');
			var snapshot_icon = is_group ? '🖥️' : '📸';
			var source = String(snapshot.source || 'unknown').toLowerCase();
			var nice_source = Tools.ucfirst(source);
			
			if ((source == 'user') && snapshot.username) {
				nice_source += ' (' + snapshot.username + ')';
			}
			
			var nice_target = 'n/a';
			var nice_uptime = 'n/a';
			var nice_load = 'n/a';
			var nice_memory = 'n/a';
			
			if (is_group) {
				// Group snapshots identify their target using the first group ID.
				if (snapshot.groups && snapshot.groups.length) {
					nice_target = this.getNiceGroup(snapshot.groups[0]);
				}
			}
			else {
				// Server snapshots contain a lightweight monitor-data object even
				// when verbose mode is disabled.
				var snap_data = snapshot.data || {};
				var memory = snap_data.memory || {};
				var load = Array.isArray(snap_data.load) ?
					snap_data.load : [];
				
				nice_target = this.getNiceServer(snapshot.server);
				nice_uptime = Tools.getTextFromSeconds(
					snap_data.uptime_sec || 0,
					true,
					true
				);
				
				if (load.length) {
					nice_load = load.map( function(value) {
						return Tools.shortFloat(value);
					} ).join(', ');
				}
				
				nice_memory = Tools.getTextFromBytes(
					memory.available || 0
				);
			}
			
			return [
				cli.emoji(snapshot_icon) + ' ' +
					this.color('theme').bold(snapshot.id),
				nice_source,
				nice_target,
				nice_uptime,
				nice_load,
				nice_memory,
				this.getRelativeDateTime(snapshot.date, true)
			];
		});
	},
	
	async printTickets(opts) {
		// Fetch or search tickets and print the results.  Explicit IDs are useful
		// for embedded sections such as completed-job details, while query mode
		// supports general ticket searches.
		if (!opts) opts = {};
		
		var has_ids = Array.isArray(opts.ids);
		var query = opts.query || '*';
		var offset = ('offset' in opts) ? opts.offset : this.offset;
		var limit = opts.limit || this.limit || this.config.items_per_page;
		var rows = [];
		var list = { length: 0 };
		
		if (has_ids) {
			// An explicitly empty ID list means there are no related tickets.
			if (opts.ids.length) {
				cli.progress.start();
				var { err, data } = await this.api.getTickets({
					ids: opts.ids
				});
				if (err) this.die(err);
				cli.progress.end();
				
				var all_rows = data.tickets || [];
				list = { length: all_rows.length };
				rows = all_rows.slice(offset, offset + limit);
			}
		}
		else {
			// No explicit IDs were supplied, so perform a normal ticket search.
			cli.progress.start();
			var { err, data } = await this.api.searchTickets({
				query: query,
				offset: offset,
				limit: limit,
				sort_by: opts.sort_by || '_id',
				sort_dir: ('sort_dir' in opts) ? opts.sort_dir : -1,
				compact: ('compact' in opts) ? !!opts.compact : true
			});
			if (err) this.die(err);
			cli.progress.end();
			
			rows = data.rows || [];
			list = data.list || { length: rows.length };
		}
		
		// Embedded detail screens should omit the section when there are no associated tickets.
		if (opts.hide_empty && !rows.length) return;
		
		var is_filtered = !has_ids && query && (query != '*');
		
		opts.title = opts.title || (
			has_ids ?
				'Tickets' :
				(is_filtered ? 'Ticket Search Results' : 'All Tickets')
		);
		
		opts.header = [
			'#',
			'Subject',
			'Type',
			'Status',
			'Assignees',
			'Tags',
			'Created'
		];
		
		opts.offset = offset;
		opts.limit = limit;
		opts.rows = rows;
		opts.list = list;
		
		this.printPaginatedBoxTable(opts, ticket => {
			// getTickets() returns an error stub when a requested ticket was
			// deleted or could not be loaded.
			if (ticket.err) {
				return [
					cli.emoji('🗑️') + ' ' + gray(ticket.id || '#'),
					gray('(Ticket was deleted)'),
					'n/a',
					'n/a',
					'n/a',
					'n/a',
					'n/a'
				];
			}
			
			var status_icons = {
				draft: '📝',
				open: '🟢',
				closed: '🔴'
			};
			
			var ticket_types =
				(this.config.ui && this.config.ui.ticket_types) || [];
			var ticket_statuses =
				(this.config.ui && this.config.ui.ticket_statuses) || [];
			
			var type_def = Tools.findObject(
				ticket_types,
				{ id: ticket.type }
			) || {
				title: Tools.ucfirst(ticket.type || 'Other')
			};
			
			var status_def = Tools.findObject(
				ticket_statuses,
				{ id: ticket.status }
			) || {
				title: Tools.ucfirst(ticket.status || 'Unknown'),
				color: 'gray'
			};
			
			var status_icon = status_icons[ticket.status] || '⚪';
			var nice_type = type_def.title;
			
			var nice_status =
				cli.emoji(status_icon) + ' ' +
				this.color(status_def.color || 'gray').bold(status_def.title);
			
			var assignees = (ticket.assignees || []).join(', ');
			if (!assignees) assignees = gray('(None)');
			
			// Keep unexpected whitespace out of the table layout.
			var subject = String(ticket.subject || '(No Subject)')
				.replace(/\s+/g, ' ')
				.trim();
			
			return [
				this.color('theme').bold('#' + ticket.num),
				cli.emoji('🗒️') + ' ' + subject,
				nice_type,
				nice_status,
				assignees,
				this.getNiceTagList(ticket.tags || []),
				this.getRelativeDateTime(ticket.created, true)
			];
		});
	},
	
	printParamValues(opts) {
		// print param value with values
		// opts: { title, fields, values }
		if (!opts.fields.length) {
			println( "\n " + this.color('theme').bold( opts.title.toUpperCase() ) );
			println( gray(" No parameter definitions found.") );
			return;
		}
		
		opts.header = opts.header || ['Param Title', 'ID', 'Type', 'Value'];
		opts.rows = [];
		
		opts.fields.forEach( field => {
			var nice_id = field.id;
			var value = (field.id in opts.values) ? opts.values[field.id] : field.value;
			var disp_value = value;
			var nice_type = this.config.ui.control_type_labels[field.type] || Tools.ucfirst(field.type);
			
			switch (field.type) {
				case 'checkbox':
					disp_value = value ? `${cli.emoji('✅')} ${green('Checked')}` : `${gray('Unchecked')}`
				break;
				
				case 'text':
					if ((field.variant == 'password') && !this.verbose) disp_value = yellow('(Shown in verbose mode)');
					else disp_value = green( disp_value );
				break;
				
				case 'textarea':
				case 'code':
				case 'json':
					disp_value = this.verbose ? green('(See below)') : yellow('(Shown in verbose mode)');
				break;
				
				case 'hidden':
					if (!opts.hidden) return false;
					disp_value = green( disp_value );
				break;
				
				case 'group':
					if (!opts.hidden) return false;
					nice_id = '-';
					disp_value = '-';
				break;
				
				case 'select':
					if (field.multiple) nice_type += ' (Multi)';
					disp_value = green( disp_value );
				break;
				
				case 'bucket':
					disp_value = this.getNiceBucket(field.bucket_id);
					if (field.multiple) nice_type += ' (Multi)';
				break;
				
				case 'system':
					disp_value = this.getNiceSystemList(field.list_id);
					if (field.multiple) nice_type += ' (Multi)';
				break;
				
				case 'toolset':
					if (opts.hidden) {
						if (field.data && field.data.tools && field.data.tools.length) disp_value = Tools.commify(field.data.tools.length) + " tools in set";
						else disp_value = "(No tools in set)";
					}
					else {
						disp_value = green( disp_value );
					}
				break;
				
				default:
					disp_value = green( disp_value );
				break;
			} // switch field.type
			
			opts.rows.push([
				bold(field.title),
				gray(nice_id),
				nice_type,
				disp_value
			]);
		} );
		
		this.printBoxTable(opts);
		
		opts.fields.filter( field => !!field.type.match(/^(toolset)$/) ).forEach( toolset => {
			var tools = (toolset.data && toolset.data.tools) || [];
			if (!tools.length) return;
			
			// Definition views need to describe every available tool.  Value views
			// only need the selected tool, because the others have no active values.
			var display_tools = tools;
			if (!opts.hidden) {
				var tool_sel = opts.values[toolset.id] || tools[0].id;
				if (tool_sel && (typeof(tool_sel) == 'object')) tool_sel = tool_sel.id;
				display_tools = [ Tools.findObject( tools, { id: tool_sel } ) || tools[0] ];
			}
			
			display_tools.forEach( tool => {
				this.printParamValues({
					title: toolset.title + ": " + tool.title,
					fields: tool.fields || [],
					values: opts.values,
					hidden: opts.hidden
				});
			});
		});
		
		if (this.verbose) {
			opts.fields.filter( field => !!field.type.match(/^(textarea|code|json)$/) ).forEach( field => {
				var value = (field.id in opts.values) ? opts.values[field.id] : field.value;
				var disp_value = (typeof(value) == 'object') ? JSON.stringify(value, null, "\t") : value;
				println( "\n " + this.color('theme').bold( 'PARAMETER: ' + field.title.toUpperCase() ) );
				
				disp_value = String(disp_value).trim().split(/\n/).map( line => '    ' + line ).join("\n");
				
				if (field.type == 'json') println( this.highlight(disp_value, { language: 'json', ignoreIllegals: true }) );
				else println( disp_value );
			} );
		}
	},
	
	printParamFields(opts) {
		// print param field definitions
		// opts: { title, fields }
		opts.header = ['Param Title', 'ID', 'Type', 'Default Value'];
		opts.values = {};
		opts.hidden = true;
		
		this.printParamValues(opts);
	},
	
	printPluginScript(plugin, opts) {
		// Print embedded Plugin source consistently wherever a full definition is
		// shown. Prefer the executable language, then inspect the script shebang,
		// and only fall back to cli-highlight's slower automatic detection.
		opts = opts || {};
		var script = plugin.script || '';
		if (!script) return;
		
		println( "\n " + this.color('theme').bold('PLUGIN SCRIPT') );
		if (opts.verboseOnly && !this.verbose) {
			println( " " + gray("(Shown in verbose mode)") );
			return;
		}
		
		var language = this.getLangFromBinary(plugin.command);
		if (!language && script.match(/^\#\!(\/\S+)/)) language = this.getLangFromBinary(RegExp.$1);
		
		var source_lines = script.trim().split(/\r?\n/).map( line => '    ' + line ).join("\n");
		var highlight_opts = { ignoreIllegals: true };
		if (language) highlight_opts.language = language;
		println( "\n" + this.highlight(source_lines, highlight_opts) );
	},
	
	getNiceSystemList(list_id) {
		// get formatted list title with icon
		var item = Tools.findObject( this.getSystemListMenuItems(), { id: list_id } );
		if (!item) return '(None)';
		return item.title;
	},
	
	getSystemListMenuItems() {
		// get menu of all lists (excluding a few)
		var items = this.config.ui.list_list.filter( function(item) {
			return !item.id.match(/^(api_keys|secrets)$/);
		} );
		
		items = items.concat([
			{
				"id": "servers",
				"title": "Servers"
			},
			{
				"id": "groups",
				"title": "Groups"
			},
			{
				"id": "targets",
				"title": "Targets"
			},
			{
				"id": "algos",
				"title": "Algorithms"
			},
			{
				"id": "icons",
				"title": "Icons"
			}
		]);
		
		Tools.sortBy( items, 'title' );
		return items;
	},
	
	markdown(text) {
		// Convert GitHub-style Markdown into ANSI terminal output.  The renderer
		// width above already reserves both margins, so only the visible left-side
		// padding needs to be added to each completed output line.
		var output = marked.parse(String(text)).trimEnd();
		if (!cli.chalk.enabled) output = Tools.stripANSI(output);
		return output.split('\n').map( line => ' '.repeat(MARKDOWN_PADDING) + line ).join('\n');
	},
	
	ellipsis(text, max_len) {
		// add ellipsis to text if over N length
		text = '' + text;
		if (cli.stringWidth(text) >= max_len) {
			return text.substring(0, max_len - 1) + '…';
		}
		else return text;
	},
	
	getLastDayInMonth: function(year, month) {
		// compute the last day in the month, and cache in RAM
		var cache_key = '' + year + '/' + month;
		if (cache_key in this.lastMonthDayCache) return this.lastMonthDayCache[cache_key];
		
		var last_day = new Date(year, month, 0).getDate();
		this.lastMonthDayCache[cache_key] = last_day;
		
		return last_day;
	},
	
	predictUpcomingJobs(opts) {
		// simulate schedule for predicting future jobs
		// opts: { events, duration, burn, max, progress, callback }
		if (!opts.start) opts.start = Tools.normalizeTime( Math.floor(this.epoch), { sec: 0 } ) + 60; // next minute
		if (!opts.duration) opts.duration = 86400; // default 24 hours
		if (!opts.burn) opts.burn = 1000; // default cpu time per chunk
		if (!opts.max) opts.max = 1000; // max 1k jobs in array
		
		opts.epoch = opts.start; // starting time
		opts.end = opts.start + opts.duration; // where to stop (inclusive)
		opts.jobs = []; // output jobs
		opts.formatters = {}; // intl formatters
		
		opts.events = Tools.copyHash(opts.events, true).filter( event => { 
			if (!event.enabled) return false;
			if (!event.triggers || !event.triggers.length) return false; // on-demand
			
			// check for disabled category
			var category = Tools.findObject( this.categories, { id: event.category } );
			if (!category.enabled) return false;
			
			// check for disabled plugin
			if (event.plugin && !event.plugin.match(/^_/)) {
				var plugin = Tools.findObject( this.plugins, { id: event.plugin } );
				if (plugin && !plugin.enabled) return false;
			}
			
			// process triggers
			var triggers = event.triggers.filter( function(trigger) { return trigger.enabled; } );
			var schedules = triggers.filter( function(trigger) { return trigger.type.match(/^(schedule|single|interval)$/); } );
			if (!schedules.length) return false;
			
			// quiet (invisible) mode
			var quiet = Tools.findObject( triggers, { type: 'quiet' } );
			if (quiet && quiet.invisible) {
				if (!this.invisible) return false;
				event.invisible = true;
			}
			
			// setup all unique timezones (intl formatters)
			schedules.forEach( trigger => {
				if (trigger.type != 'schedule') return;
				var tz = trigger.timezone || this.config.tz;
				if (tz in opts.formatters) return; // already setup
				
				opts.formatters[tz] = new Intl.DateTimeFormat('en-US', 
					{ year: 'numeric', month: '2-digit', day: 'numeric', weekday: 'long', hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: tz }
				);
			} );
			
			// store some props for fast access below
			event.schedules = schedules;
			event.ranges = triggers.filter( function(trigger) { return (trigger.type == 'range') || (trigger.type == 'blackout'); } );
			event.plugin_trigger = Tools.findObject( triggers, { type: 'plugin', enabled: true } );
			event.nth_trigger = Tools.findObject( triggers, { type: 'nth', enabled: true } );
			event.day_limits = Tools.findObjects( event.limits || [], { type: 'day', enabled: true } ) || [];
			
			// add deep copies of event stats and state, so we can simulate mutations
			event.stats = Tools.copyHash( Tools.getPath( this.stats.currentDay, 'events.' + event.id ) || {}, true );
			event.state = Tools.copyHash( Tools.getPath( this.state, 'events.' + event.id ) || {}, true );
			
			// if we have day_limits, we need a formatter for the server timezone (whew!)
			if (event.day_limits.length && !opts.formatters[ this.config.tz ]) {
				opts.formatters[ this.config.tz ] = new Intl.DateTimeFormat('en-US', 
					{ year: 'numeric', month: '2-digit', day: 'numeric', weekday: 'long', hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: this.config.tz }
				);
			}
			
			return true;
		} ); // filter events
		
		if (!opts.events.length) return opts.callback([]);
		
		this.currentPrediction = opts;
		this.predictNextChunk();
	},
	
	predictNextChunk() {
		// predict one chunk of upcoming jobs (limit CPU burn)
		var self = this;
		var opts = this.currentPrediction;
		if (!opts) return; // sanity
		
		var pstart = performance.now();
		var date = new Date();
		var tzargs = {};
		var days = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
		
		do {
			// predict jobs for current minute
			date.setTime( opts.epoch * 1000 );
			
			// convert date to all unique timezones we care about and argify it
			// { month: 11, day: 29, weekday: 2, year: 2022, hour: 22, minute: 29 }
			for (var tz in opts.formatters) {
				if (!tzargs[tz]) tzargs[tz] = {};
				
				opts.formatters[tz].formatToParts(date).forEach( function(part) {
					if (part.type == 'literal') return;
					if (part.type == 'weekday') tzargs[tz][ part.type ] = days[ part.value ];
					else tzargs[tz][ part.type ] = parseInt( part.value );
				} );
				
				// include reverse-month-day (rday): -1 is last day of month, -2 is 2nd-to-last day, etc.
				tzargs[tz].rday = (tzargs[tz].day - this.getLastDayInMonth( tzargs[tz].year, tzargs[tz].month )) - 1;
			}
			
			// keep track of day rollovers for day_limits
			var is_server_midnight = false;
			if (tzargs[this.config.tz] && (tzargs[this.config.tz].hour == 0) && (tzargs[this.config.tz].minute == 0)) is_server_midnight = true;
			
			// do any events need to run this minute?
			// { "type": "schedule", "enabled": true, "years": [2023], "months": [3, 4, 5], "days": [1, 15], "weekdays": [1, 2, 3, 4, 5], "hours": [6, 7, 8, 9, 10], "minutes": [15, 45] }
			opts.events.forEach( event => {
				var scheduled = false;
				var extras = {};
				
				// reset stats at server midnight (simulated)
				if (is_server_midnight) event.stats = {};
				
				event.schedules.forEach( trigger => {
					if ((trigger.type == 'single') && (trigger.epoch == opts.epoch)) {
						scheduled = 'single';
						return;
					}
					if (trigger.type == 'interval') {
						var hits = interval_hits_per_minute(trigger, opts.epoch);
						if (hits.length) {
							scheduled = 'interval';
							extras.seconds = hits;
							return;
						}
					}
					
					if (trigger.type != 'schedule') return; // sanity
					var tz = trigger.timezone || this.config.tz;
					var dargs = tzargs[tz];
					
					if (trigger.years && trigger.years.length && !trigger.years.includes(dargs.year)) return;
					if (trigger.months && trigger.months.length && !trigger.months.includes(dargs.month)) return;
					if (trigger.days && trigger.days.length && !trigger.days.includes(dargs.day) && !trigger.days.includes(dargs.rday)) return;
					if (trigger.weekdays && trigger.weekdays.length && !trigger.weekdays.includes(dargs.weekday)) return;
					if (trigger.hours && trigger.hours.length && !trigger.hours.includes(dargs.hour)) return;
					if (trigger.minutes && trigger.minutes.length && !trigger.minutes.includes(dargs.minute)) return;
					
					scheduled = 'schedule';
				} ); // foreach schedule
				
				if (!scheduled) return;
				
				// check ranges
				// (both start/end dates are INCLUSIVE)
				event.ranges.forEach( function(trigger) {
					switch (trigger.type) {
						case 'range':
							if (trigger.start && (opts.epoch < trigger.start)) scheduled = false;
							else if (trigger.end && (opts.epoch > trigger.end)) scheduled = false;
						break;
						
						case 'blackout':
							if ((opts.epoch >= trigger.start) && (opts.epoch <= trigger.end)) scheduled = false;
						break;
					}
				} );
				
				if (!scheduled) return;
				
				// check day limits
				event.day_limits.forEach( function(limit) {
					var count = event.stats[ 'job_' + limit.condition ] || 0;
					if (limit.amount && (count >= limit.amount)) scheduled = false;
				} );
				
				if (!scheduled) return;
				
				// check every nth
				if (event.nth_trigger) {
					var nth_counter = (event.state.nth || 0) - 1;
					if (nth_counter <= 0) nth_counter = event.nth_trigger.every;
					else scheduled = false;
					event.state.nth = nth_counter;
				}
				
				if (!scheduled) return;
				
				// add plugin modifier if applicable
				if (event.plugin_trigger) extras.plugin = event.plugin_trigger.plugin_id;
				
				// add invisible flag if applicable
				if (event.invisible) extras.invisible = true;
				
				// add job!
				opts.jobs.push({ event: event.id, epoch: opts.epoch, type: scheduled, ...extras });
				
				// simulate event stat increments (used by day_limits)
				event.stats.job_start = (event.stats.job_start || 0) + 1;
				event.stats.job_complete = (event.stats.job_complete || 0) + 1;
				event.stats.job_success = (event.stats.job_success || 0) + 1;
			} ); // foreach event
			
			opts.epoch += 60; // skip to next minute
		}
		while ((performance.now() - pstart < opts.burn) && (opts.epoch <= opts.end));
		
		if ((opts.epoch > opts.end) || (opts.jobs.length >= opts.max)) {
			// all done, reached target epoch (inclusive)
			if (opts.jobs.length > opts.max) opts.jobs.splice( opts.max );
			delete this.currentPrediction;
			return opts.callback(opts.jobs);
		}
		else {
			// not done, optionally call progress handler
			if (opts.progress) opts.progress( (opts.epoch - opts.start) / opts.duration, opts.jobs );
			
			// schedule next chunk after a frame of sleep
			setTimeout( function() { self.predictNextChunk(); }, 1 );
		}
	},
	
	getDateRangeQuery(key, value) {
		// get formatted epoch/3600 date range for DB queries
		// now, lasthour, today, yesterday, month, lastmonth, year, lastyear, older
		var query = '';
		var now = Math.floor(this.epoch);
		var dargs = get_date_args( now );
		
		switch (value) {
			case 'now':
			case 'hour':
				query += '' + key + ':' + now;
			break;
			
			case 'lasthour':
				var date_code = now - 3600;
				query += '' + key + ':' + date_code;
			break;
			
			case 'today': 
				var epoch = parse_date( dargs.year + '-' + dargs.month + '-' + dargs.day + ' 00:00:00' );
				query += '' + key + ':>=' + epoch;
			break;
			
			case 'yesterday': 
				var midnight = parse_date( dargs.year + '-' + dargs.month + '-' + dargs.day + ' 00:00:00' ); // get epoch of midnight today
				var noon = parse_date( dargs.year + '-' + dargs.month + '-' + dargs.day + ' 12:00:00' ); // get epoch of noon today
				var yesterday = noon - 86400; // subtract 1d for yesterday -- can be +/- 1 hour off
				dargs = get_date_args( yesterday ); // get dargs for yesterday
				var yesterday_midnight = parse_date( dargs.year + '-' + dargs.month + '-' + dargs.day + ' 00:00:00' ); // get epoch of midnight yesterday
				query += '' + key + ':' + yesterday_midnight + '..' + Math.floor(midnight - 1);
			break;
			
			case 'month': 
				var cur_month = parse_date( dargs.year + '-' + dargs.month + '-01 00:00:00' ); // get epoch of midnight on first month day
				query += '' + key + ':>=' + cur_month;
			break;
			
			case 'lastmonth':
				var cur_month = parse_date( dargs.year + '-' + dargs.month + '-01 00:00:00' ); // get epoch of midnight on first month day
				var before = cur_month - (86400 * 15); // sometime in last month -- does not need to be exact
				dargs = get_date_args( before ); // get dargs for last month
				var last_month = parse_date( dargs.year + '-' + dargs.month + '-01 00:00:00' ); // get epoch of midnight on first day of last month
				query += '' + key + ':' + last_month + '..' + Math.floor(cur_month - 1);
			break;
			
			case 'year': 
				var cur_year = parse_date( dargs.year + '-01-01 00:00:00' ); // get epoch of midnight on first year day
				query += '' + key + ':>=' + cur_year;
			break;
			
			case 'lastyear':
				var cur_year = parse_date( dargs.year + '-01-01 00:00:00' ); // get epoch of midnight on first year day
				var before = cur_year - (86400 * 180); // sometime in last year -- does not need to be exact
				dargs = get_date_args( before ); // get dargs for last year
				var last_year = parse_date( dargs.year + '-01-01 00:00:00' ); // get epoch of midnight on first day of last year
				query += '' + key + ':' + last_year + '..' + Math.floor(cur_year - 1);
			break;
			
			case 'older':
				var cur_year = parse_date( dargs.year + '-01-01 00:00:00' ); // get epoch of midnight on first year day
				var before = cur_year - (86400 * 180); // sometime in last year -- does not need to be exact
				dargs = get_date_args( before ); // get dargs for last year
				var last_year = parse_date( dargs.year + '-01-01 00:00:00' ); // get epoch of midnight on first day of last year
				query += '' + key + ':<' + last_year;
			break;
		} // switch
		
		return query;
	},
	
	maskValue(value) {
		// mask value for display purposes
		value = String(value);
		if (value.length < 16) return '********';
		if (value.length < 32) return value.substring(0, 2) + ('*').repeat(8) + value.substring(value.length - 2);
		return value.substring(0, 4) + ('*').repeat(8) + value.substring(value.length - 4);
	},
	
	printNiceHTML(html) {
		// Convert user-generated HTML into terminal-friendly plain text.
		if (!html) return;
		
		var text = convertHTMLToText(String(html), {
			wordwrap: false,
			preserveNewlines: false
		}).trim();
		
		println( text.split(/\n/).map( line => ' ' + line ).join("\n") );
	},
	
	getOutputStream() {
		var download = new PassThrough();
		download.pipe(process.stdout, {
			end: false
		});
		return download;
	},
	
	getTextFromSecondsRound(sec, abbrev) {
		// Public wrapper around the local duration formatting helper.
		return get_text_from_seconds_round(sec, abbrev);
	},
	
	parseCrontab(raw, rand_seed) {
		// alias for parse_crontab
		return parse_crontab(raw, rand_seed);
	}
	
}; // module.exports

function interval_hits_per_minute(trigger, epoch) {
	// calculate when an interval should hit in the current minute (epoch)
	// return an array of second offsets, similar to precision.seconds
	// trigger: { start, duration }
	if (trigger.start > epoch) return []; // trigger starts in future
	
	var first_idx = Math.ceil((epoch - trigger.start) / trigger.duration);
	var first_hit = trigger.start + first_idx * trigger.duration;
	var hits = [];
	
	for (var t = first_hit; t < epoch + 60; t += trigger.duration) {
		if (t >= epoch) hits.push(t - epoch);
	}
	
	return hits;
};

function get_text_from_seconds_round(sec, abbrev) {
	// convert raw seconds to human-readable relative time
	// round to nearest instead of floor
	var neg = '';
	sec = Math.round(sec);
	if (sec < 0) { sec =- sec; neg = '-'; }
	
	var suffix = abbrev ? "sec" : "second";
	var amt = sec;
	
	if (sec > 59) {
		var min = Math.round(sec / 60);
		suffix = abbrev ? "min" : "minute"; 
		amt = min;
		
		if (min > 59) {
			var hour = Math.round(min / 60);
			suffix = abbrev ? "hr" : "hour"; 
			amt = hour;
			
			if (hour > 23) {
				var day = Math.round(hour / 24);
				suffix = "day"; 
				amt = day;
			} // hour>23
		} // min>59
	} // sec>59
	
	if (abbrev === 2) suffix = suffix.substring(0, 1);
	
	var text = "" + amt + " " + suffix;
	if ((amt != 1) && !abbrev) text += "s";
	if (abbrev === 2) text = text.replace(/\s+/g, '');
	
	return(neg + text);
};

function parse_date(str) {
	// parse date into epoch
	return Math.floor( ((new Date(str)).getTime() / 1000) );
};

function get_date_args(now) {
	// convenience wrapper with month / day aliases
	var dargs = Tools.getDateArgs( now );
	dargs.month = dargs.mon;
	dargs.day = dargs.mday;
	return dargs;
};

// Crontab Parsing Tools
// by Joseph Huckaby, (c) 2015, BSD 3-Clause License

var cron_aliases = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
	
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6
};
var cron_alias_re = new RegExp("\\b(" + Object.keys(cron_aliases).join('|') + ")\\b", "g");

function string_hash(str) {
	// DJB2 algorithm
	var hash = 5381, i = str.length;
	while (i) { hash = (hash * 33) ^ str.charCodeAt(--i); }
	return hash >>> 0;
};

function parse_crontab_part(trigger, raw, key, min, max, rand_seed) {
	// parse one crontab part, e.g. 1,2,3,5,20-25,30-35,59
	// can contain single number, and/or list and/or ranges and/or these things: */5 or 10-50/5
	if (raw == '*') { return; } // wildcard
	if (raw == 'h') {
		// unique value over accepted range, but locked to random seed
		// https://github.com/jhuckaby/Cronicle/issues/6
		raw = min + (string_hash(rand_seed) % ((max - min) + 1));
		raw = '' + raw;
	}
	if (!raw.match(/^[\w\-\,\/\*]+$/)) { throw new Error("Invalid crontab format: " + raw); }
	var values = {};
	var bits = raw.split(/\,/);
	
	for (var idx = 0, len = bits.length; idx < len; idx++) {
		var bit = bits[idx];
		if (bit.match(/^\d+$/)) {
			// simple number, easy
			values[bit] = 1;
		}
		else if (bit.match(/^(\d+)\-(\d+)$/)) {
			// simple range, e.g. 25-30
			var start = parseInt( RegExp.$1 );
			var end = parseInt( RegExp.$2 );
			for (var idy = start; idy <= end; idy++) { values[idy] = 1; }
		}
		else if (bit.match(/^\*\/(\d+)$/)) {
			// simple step interval, e.g. */5
			var step = parseInt( RegExp.$1 );
			var start = min;
			var end = max;
			for (var idy = start; idy <= end; idy += step) { values[idy] = 1; }
		}
		else if (bit.match(/^(\d+)\-(\d+)\/(\d+)$/)) {
			// range step inverval, e.g. 1-31/5
			var start = parseInt( RegExp.$1 );
			var end = parseInt( RegExp.$2 );
			var step = parseInt( RegExp.$3 );
			for (var idy = start; idy <= end; idy += step) { values[idy] = 1; }
		}
		else {
			throw new Error("Invalid crontab format: " + bit + " (" + raw + ")");
		}
	}
	
	// min max
	var to_add = {};
	var to_del = {};
	for (var value in values) {
		value = parseInt( value );
		if (value < min) {
			to_del[value] = 1;
			to_add[min] = 1;
		}
		else if (value > max) {
			to_del[value] = 1;
			value -= min;
			value = value % ((max - min) + 1); // max is inclusive
			value += min;
			to_add[value] = 1;
		}
	}
	for (var value in to_del) delete values[value];
	for (var value in to_add) values[value] = 1;
	
	// convert to sorted array
	var list = Object.keys(values);
	for (var idx = 0, len = list.length; idx < len; idx++) {
		list[idx] = parseInt( list[idx] );
	}
	list = list.sort( function(a, b) { return a - b; } );
	if (list.length) trigger[key] = list;
};

function parse_crontab(raw, rand_seed) {
	// parse standard crontab syntax, return trigger object
	// e.g. 1,2,3,5,20-25,30-35,59 23 31 12 * *
	// optional 6th element == years
	if (!rand_seed) rand_seed = Tools.generateShortID();
	var trigger = {};
	
	// resolve all @shortcuts
	raw = String(raw).trim().toLowerCase();
	if (raw.match(/\@(yearly|annually)/)) raw = '0 0 1 1 *';
	else if (raw == '@monthly') raw = '0 0 1 * *';
	else if (raw == '@weekly') raw = '0 0 * * 0';
	else if (raw == '@daily') raw = '0 0 * * *';
	else if (raw == '@hourly') raw = '0 * * * *';
	
	// expand all month/wday aliases
	raw = raw.replace(cron_alias_re, function(m_all, m_g1) {
		return cron_aliases[m_g1];
	} );
	
	// at this point string should not contain any alpha characters or '@', except for 'h'
	if (raw.match(/([a-gi-z\@]+)/i)) throw new Error("Invalid crontab keyword: " + RegExp.$1);
	
	// split into parts
	var parts = raw.split(/\s+/);
	if (parts.length > 6) throw new Error("Invalid crontab format: " + parts.slice(6).join(' '));
	if (!parts[0].length) throw new Error("Invalid crontab format");
	
	// parse each part
	if ((parts.length > 0) && parts[0].length) parse_crontab_part( trigger, parts[0], 'minutes', 0, 59, rand_seed );
	if ((parts.length > 1) && parts[1].length) parse_crontab_part( trigger, parts[1], 'hours', 0, 23, rand_seed );
	if ((parts.length > 2) && parts[2].length) parse_crontab_part( trigger, parts[2], 'days', 1, 31, rand_seed );
	if ((parts.length > 3) && parts[3].length) parse_crontab_part( trigger, parts[3], 'months', 1, 12, rand_seed );
	if ((parts.length > 4) && parts[4].length) parse_crontab_part( trigger, parts[4], 'weekdays', 0, 6, rand_seed );
	if ((parts.length > 5) && parts[5].length) parse_crontab_part( trigger, parts[5], 'years', 1970, 3000, rand_seed );
	
	return trigger;
};
