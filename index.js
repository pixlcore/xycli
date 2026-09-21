#!/usr/bin/env node

// xyOps CLI
// See: https://github.com/pixlcore/xyops
// Copyright (c) 2019 - 2026 PixlCore LLC, BSD 3-Clause License

// Config Keys: api_key, base_url, temp_dir, color, suggest, items_per_page

const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const Path = require('path');
const Uncatch = require('uncatch');
const cli = require('pixl-cli');
const pkg = require('./package.json');

if (!process.env.XYOPS_USER_AGENT) {
	process.env.XYOPS_USER_AGENT = `xyOps CLI v${pkg.version} (Node.js); ${os.hostname()} (${os.platform()}/${os.arch()})`;
}

cli.global();

cli.mapArgs({
	'v': 'verbose',
	'q': 'quiet',
	'd': 'debug',
	'f': 'format',
	'r': 'raw',
	'h': 'help'
});

process.on('SIGINT', function() { cli.progress.end(); process.exit(130); } );
process.on('SIGTERM', function() { cli.progress.end(); process.exit(143); } );
process.on('SIGHUP', function() { cli.progress.end(); process.exit(129); } );

Uncatch.on('uncaughtException', function(err) {
	// execute your own application shutdown routine here
	// do not call any async code, and do not call process.exit
	cli.progress.end();
});

const { api } = require('@pixlcore/xyops-sdk');
var highlight = require('cli-highlight').highlight;
const Tools = cli.Tools;
const chalk = cli.chalk;

// minimum xyops version
const XYOPS_MIN_VERSION = '1.0.96';

// These API parameters are always opaque strings, even when their contents
// happen to look like JSON or come from a file with a .json extension.
const JSON_ARG_EXCEPTIONS = ['body'];

// Keep the public command inventory in one place, so typo suggestions and the
// fallback help text always advertise the exact same top-level commands.
const TOP_LEVEL_COMMANDS = [
	'help', 'config', 'doc', 'dashboard', 'system', 'upcoming',
	'alerts', 'alert', 'buckets', 'bucket', 'categories', 'category',
	'channels', 'channel', 'events', 'event', 'run', 'groups', 'group',
	'jobs', 'job', 'keys', 'key', 'log', 'monitors', 'monitor',
	'plugins', 'plugin', 'servers', 'server', 'secrets', 'secret',
	'snapshots', 'snapshot', 'tags', 'tag', 'tickets', 'ticket',
	'hooks', 'hook', 'marketplace',
	'import', 'api', 'repl'
];

// coerce true/false into booleans
for (var key in cli.args) {
	if (cli.args[key] === 'true') cli.args[key] = true;
	else if (cli.args[key] === 'false') cli.args[key] = false;
}

// make our own copy of cli.args
var args = Object.assign( {}, cli.args );

if (!args.other || !args.other.length) args.other = ['dashboard'];
else if (args.help) args.other = ['help'];

var cmd = args.other.shift().toLowerCase();

const app = {
	
	epoch: Tools.timeNow(),
	
	colors: {
		"theme": [55, 145, 245],
		"gray": [127, 127, 127],
		
		"red": [251, 44, 54],
		"fire": [255, 77, 7],
		"orange": [255, 105, 0],
		"tangerine": [255, 130, 0],
		"amber": [254, 154, 0],
		"gold": [248, 165, 0],
		"yellow": [240, 177, 0],
		"lemon": [198, 191, 0],
		"lime": [124, 207, 0],
		"grass": [74, 204, 38],
		"green": [0, 201, 80],
		"mint": [0, 195, 106],
		"emerald": [0, 188, 125],
		"aqua": [0, 188, 148],
		"teal": [0, 187, 167],
		"turquoise": [0, 187, 195],
		"cyan": [0, 184, 219],
		"ice": [0, 176, 232],
		"sky": [0, 166, 244],
		"azure": [0, 148, 254],
		"blue": [43, 127, 255],
		"sapphire": [75, 111, 255],
		"indigo": [97, 95, 255],
		"lavender": [120, 88, 255],
		"violet": [142, 81, 255],
		"orchid": [158, 76, 255],
		"purple": [173, 70, 255],
		"magenta": [199, 59, 255],
		"fuchsia": [225, 42, 251],
		"hotpink": [241, 43, 201],
		"pink": [246, 51, 154],
		"blush": [252, 40, 122],
		"rose": [255, 32, 86]
	},
	
	condition_colors: {
		'start': 'sky',
		'complete': 'emerald',
		'continue': 'gray',
		'success': 'green',
		'error': 'red',
		'user': 'orange',
		'warning': 'yellow',
		'critical': 'purple',
		'abort': 'gray'
	},
	
	events: [],
	categories: [],
	groups: [],
	plugins: [],
	tags: [],
	api_keys: [],
	buckets: [],
	roles: [],
	secrets: [],
	web_hooks: [],
	
	activeJobs: {},
	activeAlerts: {},
	internalJobs: {},
	servers: {},
	serverCache: {},
	state: {},
	stats: {},
	
	lastMonthDayCache: {},
	
	async run() {
		// main entry point
		var self = this;
		
		this.loadConfig();
		
		this.version = pkg.version;
		this.args = args;
		this.api = api;
		this.cli = cli;
		this.highlight = highlight;
		
		this.debug = args.debug;
		this.verbose = args.verbose;
		this.quiet = args.quiet;
		
		// process global common args
		this.format = args.format || '';
		delete args.format;
		
		this.raw = args.raw || this.config.raw || false;
		delete args.raw;
		
		this.dry = args.dry || false;
		delete args.dry;
		
		// show invisible jobs: config prop only
		this.invisible = this.config.invisible || false;
		
		// optionally disable all ANSI color
		if (("color" in this.config) && !this.config.color) {
			cli.chalk.enabled = false;
			highlight = this.highlight = function(text) { return text; };
		}
		
		println( "\n " + cli.emoji('🚀') + " " + this.color('theme').bold("xyOps CLI ") + gray("v" + this.version) );
		
		// call config cmd early (before contacting xyops)
		if (cmd == 'config') {
			await this['cmd_' + cmd]();
			print("\n");
			return;
		}
		
		// Validate local command routing before requiring a configured server. This
		// keeps help and typo diagnostics available during initial CLI setup. Export
		// is excluded because it also supports portable resource types that do not
		// have their own complete command routers yet.
		if (!('export' in args) && !this['cmd_' + cmd]) {
			// Allow the user to swap the first two args if the second is a known command.
			if (this['cmd_' + args.other[0]]) {
				var new_cmd = args.other[0];
				args.other[0] = cmd;
				cmd = new_cmd;
			}
			else {
				var suggestion = this.findClosestString(cmd, TOP_LEVEL_COMMANDS);
				this.die(
					"Unknown command: " + cmd + (suggestion ? '. Did you mean "' + suggestion + '"?' : ''),
					"Available Commands: " + TOP_LEVEL_COMMANDS.join(', ') + "\n\n"
				);
			}
		}
		
		// Help is entirely local, so it should work before a user has configured an
		// API key or server URL, and should never make a network request.
		if (cmd == 'help') {
			await this.cmd_help();
			print("\n");
			return;
		}
		
		delete args.debug;
		delete args.echo;
		delete args.quiet;
		delete args.verbose;
		
		// create temp dir if needed
		this.tempDir = this.config.temp_dir || Path.join( os.tmpdir(), 'xyops', 'cli' );
		if (!fs.existsSync(this.tempDir)) Tools.mkdirpSync( this.tempDir );
		
		if (!this.config.api_key) {
			this.die("Missing xyOps API Key.  Set an 'api_key' property in " + this.configFiles.join(', or ') + ", or set a 'XYOPS_API_KEY' environment variable.");
		}
		if (!this.config.base_url) {
			this.die("Missing xyOps Base URL.  Set a 'base_url' property in " + this.configFiles.join(', or ') + ", or set a 'XYOPS_BASE_URL' environment variable.");
		}
		
		println( ' ' + gray(this.config.base_url) );
		
		if (this.dry) {
			this.toast('⚠️', 'orange', bold("DRY RUN: ") + "No changes will actually be made.");
		}
		
		// optionally read STDIN into a named arg (use curl @- convention)
		var stdin_arg_key = null;
		for (var key in args) {
			if (args[key] === '@-') { stdin_arg_key = key; break; }
		}
		if (stdin_arg_key) {
			verboseln("Reading STDIN into: " + stdin_arg_key);
			const chunks = [];
			for await (const chunk of process.stdin) chunks.push(chunk);
			args[stdin_arg_key] = chunks.join('');
			
			// Some API parameters are opaque strings even when they look like JSON.
			if (!JSON_ARG_EXCEPTIONS.includes(stdin_arg_key) && (args[stdin_arg_key].trim().match(/^\{[\s\S]*\}$/) || args[stdin_arg_key].trim().match(/^\[[\s\S]*\]$/))) {
				try { args[stdin_arg_key] = JSON.parse(args[stdin_arg_key]); }
				catch (err) { this.die("Failed to parse JSON from STDIN: " + err); }
			}
		}
		
		// optionally read any file into any arg (use curl @FILE convention)
		for (var key in args) {
			if (String(args[key]).match(/^@(.+)$/)) {
				var file = RegExp.$1;
				if (!fs.existsSync(file)) this.die("File not found: " + file);
				if (!JSON_ARG_EXCEPTIONS.includes(key) && file.match(/\.json$/i)) args[key] = JSON.parse( fs.readFileSync(file, 'utf8') );
				else args[key] = fs.readFileSync(file, 'utf8');
			}
		}
		
		// if 'json' arg is present and an object, merge into top-level
		// (so user can pipe entire request in from STDIN or file)
		if (args.json && (typeof(args.json) == 'object')) {
			Tools.mergeHashInto( args, args.json );
			delete args.json;
		}
		
		// any arg value that looks like json will be parsed
		for (var key in args) {
			if (!JSON_ARG_EXCEPTIONS.includes(key) && args[key] && (typeof(args[key]) == 'string') && (args[key].trim().match(/^\{[\s\S]*\}$/) || args[key].trim().match(/^\[[\s\S]*\]$/))) {
				try { args[key] = JSON.parse( args[key] ); }
				catch (err) { this.die("Failed to parse JSON from argument: " + err); }
			}
		}
		
		// Export is an explicit read-only variant, including portable object types
		// whose full resource routers are not yet implemented. Do not let the flag
		// become a search filter or an accidental field in a create/update request.
		if (('export' in args) && (cmd != 'api')) {
			await this.cacheConfig();
			await this.cmd_export_object(cmd);
			print("\n");
			return;
		}
		
		// merge in config from xyops
		await this.cacheConfig();
		
		// make sure we have a compatible version of xyops
		if (this.compareVersions(XYOPS_MIN_VERSION, this.xyopsVersion) > 0) {
			this.die("The CLI requires xyOps v" + XYOPS_MIN_VERSION + " or higher.");
		}
		
		// go go go
		await this['cmd_' + cmd]();
		
		// always end with empty line
		print("\n");
	},
	
	async cmd_repl() {
		// open repl for user to debug
		await this.getMultiple();
		
		println( "\n" + this.markdown(
			"The REPL exposes `app`, `xy`, `config`, `cli`, and `Tools` in its context.\n\n" + 
			"Type `.exit` or hit `Ctrl-C` to exit."
		) );
		
		print("\n");
		var repl = this.repl = require('repl').start({ prompt: '> ', useGlobal: true, ignoreUndefined: true });
		
		repl.context.app = this;
		repl.context.config = this.config;
		repl.context.cli = cli;
		repl.context.Tools = Tools;
		repl.context.xy = this;
		
		await new Promise((resolve) => {
			repl.once('exit', () => {
				delete app.repl;
				resolve();
			});
		});
	},
	
	async cmd_api() {
		// perform arbitrary xyops api call
		// e.g. "xy api getEvents"
		var name = this.args.other.shift() || this.dieUsage('api');
		delete this.args.other;
		
		this.mergeDotArgs( this.args, this.args );
		if (this.verbose) this.args.verbose = true;
		
		println( "\n " + this.color('theme').bold("Calling API: " + name) );
		
		print( "\n " + cyan.bold("Request:") );
		this.jsonOutput(this.args);
		
		if (this.dry) {
			this.toast('⚠️', 'orange', bold("DRY RUN: ") + "Exiting without sending request.");
			return;
		}
		
		cli.progress.start({ amount: 1, pct: false, text: gray('→ ' + name) });
		var { err, data } = await this.api[name](this.args);
		cli.progress.end();
		if (err) this.die(err);
		
		print( "\n " + cyan.bold("Response:") );
		this.jsonOutput(data);
	},
	
	async cmd_help() {
		// show help section
		var parts = this.args.other.slice(0);
		var heading = parts.join(' ') || 'help';
		this.printHelp(heading);
	},
	
	printHelp(heading) {
		// print named section from help file
		heading = heading.toLowerCase();
		// Git may check this file out with CRLF on Windows. Normalize it before
		// matching headings so the parser behaves identically on every platform.
		var md = fs.readFileSync(Path.join(__dirname, 'docs', 'help.md'), 'utf8')
			.replace(/\r\n?/g, '\n').trim() + "\n\n# end sentinel\n";
		var re = new RegExp( "(^|\\n)(\\#+)\\s+(" + Tools.escapeRegExp(heading) + ")\\n([\\s\\S]*?)\\n\#+\\s+" );
		var matches = md.match(re);
		if (!matches) {
			var msg = 'Could not find help chapter for "' + heading + '".';
			
			// Extract the user-visible Markdown headings and reuse the same conservative
			// Levenshtein matcher used for API property typo suggestions.  The final
			// heading is synthetic and exists only to terminate the section regex.
			var headings = Array.from( md.matchAll(/^\#+\s+(.+?)\s*$/gm), match => match[1] );
			headings = headings.filter( heading => heading != 'end sentinel' );
			var suggestion = this.findClosestString(heading, headings);
			if (suggestion) msg += ' Did you mean "' + suggestion + '"?';
			
			this.die(msg);
		}
		
		if (heading == 'help') heading = 'overview';
		println( "\n " + this.color('theme').bold( 'HELP: ' + heading.toUpperCase() ) );
		println( "\n" + this.markdown( matches[4].trim() ).trimEnd() );
	},
	
	dieUsage(heading) {
		// print help and exit
		this.printHelp(heading);
		println("");
		process.exit(1);
	},
	
	die(msg, extra = "") {
		// colorful die
		cli.progress.end();
		if (typeof(msg) == 'object') {
			print("\n");
			console.error(msg);
			if (msg.message) msg = msg.message;
		}
		cli.args.quiet = false;
		die( "\n ❌ " + red.bold("ERROR: ") + yellow.bold(msg) + "\n\n" + extra );
	}
	
};

Tools.mergeHashInto( app, require('./lib/utils.js') );
Tools.mergeHashInto( app, require('./lib/config.js') );
Tools.mergeHashInto( app, require('./lib/doc.js') );
Tools.mergeHashInto( app, require('./lib/dashboard.js') );
Tools.mergeHashInto( app, require('./lib/system.js') );
Tools.mergeHashInto( app, require('./lib/events.js') );
Tools.mergeHashInto( app, require('./lib/jobs.js') );
Tools.mergeHashInto( app, require('./lib/apikey.js') );
Tools.mergeHashInto( app, require('./lib/alerts.js') );
Tools.mergeHashInto( app, require('./lib/buckets.js') );
Tools.mergeHashInto( app, require('./lib/categories.js') );
Tools.mergeHashInto( app, require('./lib/channels.js') );
Tools.mergeHashInto( app, require('./lib/log.js') );
Tools.mergeHashInto( app, require('./lib/monitors.js') );
Tools.mergeHashInto( app, require('./lib/plugins.js') );
Tools.mergeHashInto( app, require('./lib/servers.js') );
Tools.mergeHashInto( app, require('./lib/groups.js') );
Tools.mergeHashInto( app, require('./lib/snapshots.js') );
Tools.mergeHashInto( app, require('./lib/secrets.js') );
Tools.mergeHashInto( app, require('./lib/tags.js') );
Tools.mergeHashInto( app, require('./lib/tickets.js') );
Tools.mergeHashInto( app, require('./lib/webhook.js') );
Tools.mergeHashInto( app, require('./lib/transfer.js') );
Tools.mergeHashInto( app, require('./lib/marketplace.js') );
Tools.mergeHashInto( app, require('./lib/sync.js') );

global.app = app;

app.run().catch( function(err) {
	app.die(err);
} );
