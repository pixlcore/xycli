// xyCLI Self-Upgrade Layer

const cp = require('node:child_process');

const cli = require('pixl-cli');
const chalk = cli.chalk;

const PACKAGE_NAME = '@pixlcore/xycli';
const REGISTRY_URL = 'https://registry.npmjs.org/@pixlcore%2Fxycli/latest';
const REGISTRY_TIMEOUT_MS = 10000;

module.exports = {
	
	async cmd_upgrade() {
		// This is a deliberately small local command. It must remain usable before
		// the user has configured an xyOps URL or API key.
		if (this.args.other.length) this.dieUsage('upgrade');
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) {
			this.die("Upgrade --confirm must be true or false.");
		}
		
		// These common switches are consumed by the main command runner after local
		// commands return. Ignore them here, but reject command-specific typos.
		var allowed = ['other', 'confirm', 'debug', 'echo', 'quiet', 'verbose'];
		var unsupported = Object.keys(this.args).find( key => !allowed.includes(key) );
		if (unsupported) this.die("Unsupported upgrade option: --" + unsupported);
		
		var installed_version = this.version;
		var latest_version = await this.getLatestXYCLIVersion();
		var comparison = this.compareVersions(latest_version, installed_version);
		var status = comparison > 0 ? this.color('blue').bold('Upgrade available') :
			comparison < 0 ? this.color('yellow').bold('Installed version is newer than npm') :
			this.color('green').bold('Up to date');
		
		this.printBoxList({
			title: 'xyCLI Version',
			rows: [
				[ 'Installed Version', 'v' + installed_version ],
				[ 'Latest Version', 'v' + latest_version ],
				[ 'Status', status ]
			]
		});
		
		// A different version is not necessarily an upgrade. In particular, local
		// development builds must never be silently downgraded to npm's latest tag.
		if (comparison <= 0) return;
		
		if (this.args.confirm !== true) {
			this.toast('ℹ️', 'blue', "A new xyCLI version is available! Add '--confirm' to perform the upgrade now.");
			return;
		}
		
		// Install the exact version shown above. This prevents the npm latest tag
		// from moving between the version check and the confirmed installation.
		var command = 'npm install --global ' + PACKAGE_NAME + '@' + latest_version;
		println( "\n " + this.color('green').bold('Running command: ') + chalk.bold(command) );
		
		if (this.dry) {
			this.toast('⚠️', 'orange', "DRY RUN: The upgrade command was not executed.");
			return;
		}
		
		var result;
		try {
			result = await this.spawnUpgradeCommand(command);
		}
		catch (err) {
			this.die("Could not start the upgrade command: " + err.message);
		}
		
		if (result.signal) this.die("Upgrade command was terminated by signal: " + result.signal);
		if (result.code !== 0) this.die("Upgrade command failed with exit code: " + result.code);
		
		this.toast('✅', 'green', 'Successfully upgraded xyCLI to v' + latest_version + '.');
	},
	
	async getLatestXYCLIVersion() {
		// The npm latest document is authoritative for the version that an
		// unqualified global npm install would select.
		this.cli.progress.start({ amount: 1, pct: false, text: this.color('gray')('Checking npm for the latest xyCLI version...') });
		
		var response;
		try {
			response = await fetch(REGISTRY_URL, {
				headers: {
					'Accept': 'application/json',
					'User-Agent': PACKAGE_NAME + '/v' + this.version
				},
				signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS)
			});
		}
		catch (err) {
			this.cli.progress.end();
			this.die("Could not contact the npm registry: " + err.message);
		}
		
		this.cli.progress.end();
		if (!response.ok) this.die("npm registry request failed with HTTP status: " + response.status);
		
		var data;
		try { data = await response.json(); }
		catch (err) { this.die("Could not parse the npm registry response: " + err.message); }
		
		if (!data || (typeof(data.version) != 'string') || !data.version.length) {
			this.die("The npm registry response did not include a package version.");
		}
		
		return data.version;
	},
	
	spawnUpgradeCommand(command) {
		// npm is npm.cmd on Windows, so launch the fixed, validated command through
		// the platform shell. Inherited stdio gives npm full use of the terminal.
		return new Promise((resolve, reject) => {
			var child = cp.spawn(command, {
				shell: true,
				stdio: 'inherit',
				windowsHide: false
			});
			
			child.once('error', reject);
			child.once('close', (code, signal) => resolve({ code, signal }));
		});
	}
	
};
