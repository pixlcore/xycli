// Config Layer

const fs = require('fs');
const os = require('os');
const Path = require('path');
const cli = require('pixl-cli');
const Tools = cli.Tools;
const chalk = cli.chalk;

function getConfigFiles(platform, env, home_dir) {
	// Keep the existing Unix paths, but use Windows's shared application-data
	// directory instead of resolving /etc against whichever drive is current.
	// ProgramData should always exist in an ordinary Windows login.  If a custom
	// environment omits it, skip the optional machine file rather than guessing.
	var path_api = (platform == 'win32') ? Path.win32 : Path.posix;
	var config_files = [];
	var system_dir = (platform == 'win32') ?
		(env.ProgramData || env.PROGRAMDATA || env.ALLUSERSPROFILE) : '/etc';
	
	if (system_dir) config_files.push( path_api.join(system_dir, 'xyops', 'cli.json') );
	
	// os.homedir() uses USERPROFILE on Windows and has an operating-system
	// fallback, unlike reading HOME or HOMEPATH directly.
	config_files.push( path_api.join(home_dir, '.config', 'xyops', 'cli.json') );
	return config_files;
}

var config_layer = module.exports = {
	
	loadConfig() {
		// handle loading config at startup
		// optional config files, sync with env, two-way
		var config = {};
		var config_files = this.configFiles = getConfigFiles(process.platform, process.env, os.homedir());
		
		config_files.forEach( function(file) {
			if (!fs.existsSync(file)) return;
			Tools.mergeHashInto( config, JSON.parse(fs.readFileSync(file, 'utf8')) );
		} );
		
		for (var ekey in process.env) {
			if (ekey.match(/^XYOPS_(\w+)$/)) {
				var key = RegExp.$1.toLowerCase();
				var value = process.env[ekey];
				if (value === "true") value = true;
				else if (value === "false") value = false;
				else if (String(value).match(/^\-?\d+(\.\d+)?$/)) value = parseFloat(value);
				else if (String(value).match(/^\-?\d+$/)) value = parseInt(value);
				config[key] = value;
			}
		}
		
		for (var key in config) {
			process.env['XYOPS_' + key.toUpperCase()] = '' + config[key];
		}
		
		this.config = config;
	},
	
	async cmd_config() {
		// allow user to view config, and also modify it
		delete this.args.other;
		
		if (!Tools.firstKey(this.args)) {
			// just print config and exit
			println( "\n " + this.color('theme').bold( 'CONFIGURATION SOURCES:' ) + "\n" );
			this.configFiles.forEach( function(file) {
				println( bold.green("    • ") + file );
			} );
			println( bold.green("    • ") + "(XYOPS_ prefixed env vars)" );
			
			println( "\n " + this.color('theme').bold( 'CURRENT CONFIGURATION:' ) );
			var temp_config = { ...this.config };
			if (temp_config.api_key) temp_config.api_key = this.maskValue(temp_config.api_key);
			this.jsonOutput(temp_config);
			return;
		}
		
		// Reload only the user's settings before applying changes.  The effective
		// configuration also contains system settings and environment overrides,
		// which must not be copied into the user's file when saving preferences.
		var dest_file = this.configFiles[this.configFiles.length - 1];
		var user_config = fs.existsSync(dest_file) ? JSON.parse(fs.readFileSync(dest_file, 'utf8')) : {};
		
		// Apply only the supplied arguments, preserving other user settings.
		print("\n");
		for (var key in this.args) {
			var value = (key == 'api_key') ? this.maskValue(this.args[key]) : this.args[key];
			println( " " + bold.cyan("Setting key: ") + bold.green(key) + ": " + JSON.stringify(value) );
			
			if (!this.setPath(user_config, key, this.args[key])) {
				this.die("Invalid configuration path: " + key);
			}
		}
		
		Tools.mkdirpSync( Path.dirname(dest_file) );
		println( "\n " + bold.cyan("Writing to: ") + dest_file );
		fs.writeFileSync( dest_file, JSON.stringify(user_config, null, "\t") + "\n", { mode: 0o600 } );
		
		// Windows inherits an ACL from the user's profile directory and does not
		// implement Unix owner/group/other mode distinctions.
		if (process.platform != 'win32') fs.chmodSync(dest_file, 0o600);
	}
};

// Expose the pure path selector to unit tests without merging another command
// method into the runtime app object.
Object.defineProperty(config_layer, 'getConfigFiles', { value: getConfigFiles });
