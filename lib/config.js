// Config Layer

const fs = require('fs');
const Path = require('path');
const cli = require('pixl-cli');
const Tools = cli.Tools;
const chalk = cli.chalk;

module.exports = {
	
	loadConfig() {
		// handle loading config at startup
		// optional config files, sync with env, two-way
		var config = {};
		var config_files = this.configFiles = [
			Path.join( '/etc', 'xyops', 'cli.json' ),
			Path.join( process.env.HOME, '.config', 'xyops', 'cli.json' )
		];
		
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
		
		// allow args to set config values
		print("\n");
		for (var key in this.args) {
			var value = (key == 'api_key') ? this.maskValue(this.args[key]) : this.args[key];
			println( " " + bold.cyan("Setting key: ") + bold.green(key) + ": " + JSON.stringify(value) );
			Tools.setPath( this.config, key, this.args[key] );
		}
		
		var dest_file = this.configFiles.pop();
		Tools.mkdirpSync( Path.dirname(dest_file) );
		println( "\n " + bold.cyan("Writing to: ") + dest_file );
		fs.writeFileSync( dest_file, JSON.stringify(this.config, null, "\t") + "\n", { mode: 0o600 } );
		fs.chmodSync(dest_file, 0o600);
	}
	
};
