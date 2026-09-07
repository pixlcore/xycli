// xyOps Plugin Marketplace Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_marketplace() {
		// Marketplace is both the collection command and the singular router.  A
		// bare author/repo ID opens details, while all other bare text is a search.
		var cmd = this.args.other[0];
		
		if (cmd == 'list' || cmd == 'search') {
			this.args.other.shift();
			return await this.cmd_search_marketplace();
		}
		if (cmd == 'get') {
			this.args.other.shift();
			return await this.cmd_get_marketplace_product();
		}
		if (cmd == 'install') {
			this.args.other.shift();
			return await this.cmd_install_marketplace_product();
		}
		if ((this.args.other.length == 1) && this.args.other[0].includes('/')) {
			return await this.cmd_get_marketplace_product();
		}
		
		await this.cmd_search_marketplace();
	},
	
	async cmd_search_marketplace() {
		// The Marketplace API performs its own filtering, sorting, and pagination.
		// Product type is fixed to Plugin for v1, leaving room for future products.
		this.prepSearchArgs();
		
		if (this.args.other.length) {
			if ('query' in this.args) this.die("Use either positional search text or --query, not both.");
			this.args.query = this.args.other.join(' ');
		}
		delete this.args.other;
		
		var allowed = ['query', 'plugin_type', 'author', 'status', 'license', 'tags', 'requires', 'sort_by', 'sort_dir'];
		Object.keys(this.args).forEach( key => {
			if (!allowed.includes(key)) this.die("Unsupported Marketplace search option: --" + key);
		});
		
		if ('plugin_type' in this.args) this.args.plugin_type = this.parsePluginType(this.args.plugin_type);
		if (('status' in this.args) && !['installed', 'not'].includes(this.args.status)) {
			this.die("Marketplace status must be installed or not.");
		}
		if (('sort_by' in this.args) && !['title', 'author', 'license', 'plugin_type', 'created', 'modified'].includes(this.args.sort_by)) {
			this.die("Marketplace sort_by must be title, author, license, plugin_type, created, or modified.");
		}
		if ('sort_dir' in this.args) {
			if (this.args.sort_dir == 'asc') this.args.sort_dir = 1;
			else if (this.args.sort_dir == 'desc') this.args.sort_dir = -1;
			else this.args.sort_dir = Number(this.args.sort_dir);
			if (![1, -1].includes(this.args.sort_dir)) this.die("Marketplace sort_dir must be asc, desc, 1, or -1.");
		}
		['query', 'author', 'license'].forEach( key => {
			if ((key in this.args) && ((typeof(this.args[key]) != 'string') || !this.args[key].trim())) {
				this.die("Marketplace " + key + " must be a non-empty string.");
			}
		});
		['tags', 'requires'].forEach( key => {
			if (key in this.args) this.args[key] = this.normalizeMarketplaceList(this.args[key], key);
		});
		
		this.offset = this.parseMarketplaceInteger(this.offset, 'offset', 0);
		this.limit = this.parseMarketplaceInteger(this.limit, 'limit', 1);
		
		var params = Object.assign({
			type: 'plugin',
			offset: this.offset,
			limit: this.limit
		}, this.args);
		
		await this.getMultiple({ lists: 'plugins' });
		var data = await this.fetchMarketplace(params, 'Searching Marketplace...');
		var rows = data.rows || [];
		if (this.format.match(/json/)) return this.jsonOutput(rows);
		
		this.printPaginatedBoxTable({
			title: Tools.numKeys(this.args) ? 'Marketplace Search Results' : 'Plugin Marketplace',
			header: ['Marketplace ID', 'Title', 'Type', 'Author', 'Version', 'Status'],
			rows: rows,
			list: data.list || { length: rows.length },
			offset: this.offset,
			limit: this.limit
		}, product => {
			var installed = this.findInstalledMarketplaceProduct(product);
			return [
				this.color('theme').bold(product.id),
				bold(product.title),
				this.getNicePluginType(product.plugin_type),
				product.author,
				(product.versions || [])[0] || gray('(Unknown)'),
				this.getNiceMarketplaceStatus(product, installed)
			];
		});
		
		this.printSuggestedCommands({
			"View Marketplace Plugin": "xy marketplace AUTHOR/REPO",
			"Install Marketplace Plugin": "xy marketplace install AUTHOR/REPO",
			"List Event Plugins": "xy marketplace --plugin_type event",
			"List installed Plugins": "xy marketplace --status installed"
		});
	},
	
	async cmd_get_marketplace_product() {
		// The server returns listing metadata and the selected version's README in
		// one response.  README source is preserved in JSON output.
		var id = this.consumeMarketplaceID();
		var version = this.consumeMarketplaceVersion();
		if (Tools.numKeys(this.args)) this.die("Unsupported Marketplace detail option: --" + Tools.firstKey(this.args));
		
		await this.getMultiple({ lists: 'plugins' });
		var params = { id: id, readme: true };
		if (version) params.version = version;
		var data = await this.fetchMarketplace(params, 'Loading Marketplace Plugin...');
		this.validateMarketplaceProduct(data.item, data.version, version);
		
		if (this.format.match(/json/)) return this.jsonOutput({
			item: data.item,
			version: data.version,
			text: data.text
		});
		
		var product = data.item;
		var installed = this.findInstalledMarketplaceProduct(product);
		var repo_url = product.repo_url || ('https://github.com/' + product.id);
		
		this.printBoxList({
			title: 'Marketplace Plugin Summary',
			rows: [
				[ 'Marketplace ID', gray(product.id) ],
				[ 'Title', this.color('theme').bold(product.title) ],
				[ 'Description', product.description ],
				[ 'Author', product.author ],
				[ 'Plugin Type', this.getNicePluginType(product.plugin_type) ],
				[ 'Status', this.getNiceMarketplaceStatus(product, installed) ],
				installed ? [ 'Installed Plugin', installed.title + gray(' (' + installed.id + ')') ] : null,
				installed ? [ 'Installed Version', installed.marketplace.version ] : null,
				[ 'Viewed Version', data.version ],
				[ 'Latest Version', product.versions[0] ],
				[ 'Available Versions', product.versions.join(', ') ],
				[ 'License', product.license ],
				[ 'Requirements', (product.requires || []).join(', ') || gray('(None)') ],
				[ 'Tags', (product.tags || []).join(', ') || gray('(None)') ],
				[ 'Created', product.created ],
				[ 'Modified', product.modified ],
				[ 'Repository', repo_url ]
			]
		});
		
		println( "\n " + this.color('theme').bold('PLUGIN README') );
		println( "\n" + this.markdown(this.cleanMarketplaceReadme(data.text)).trimEnd() );
		
		this.printSuggestedCommands({
			"Preview installation": "xy marketplace install " + product.id + (data.version == product.versions[0] ? '' : ' --version ' + data.version),
			"Install latest version": "xy marketplace install " + product.id + " --confirm",
			"List Marketplace Plugins": "xy marketplace"
		});
	},
	
	async cmd_install_marketplace_product() {
		// Marketplace packages are single-item XYPDF files.  Preview by default,
		// then use the ordinary Plugin APIs only after explicit confirmation.
		var id = this.consumeMarketplaceID();
		var version = this.consumeMarketplaceVersion();
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) {
			this.die("Marketplace install --confirm must be true or false.");
		}
		if (Tools.numKeys(this.args) > (('confirm' in this.args) ? 1 : 0)) {
			var unsupported = Object.keys(this.args).find( key => key != 'confirm' );
			this.die("Unsupported Marketplace install option: --" + unsupported);
		}
		
		await this.getMultiple({ lists: 'plugins' });
		var params = { id: id, data: true };
		if (version) params.version = version;
		var response = await this.fetchMarketplace(params, 'Preparing Marketplace installation...');
		this.validateMarketplaceProduct(response.item, response.version, version);
		this.validateMarketplacePayload(response.data, response.item);
		
		var plugin = this.cleanTransferData(response.data.items[0].data);
		plugin.marketplace = {
			id: response.item.id,
			version: response.version
		};
		
		// Marketplace Plugins always run under the server's configured default
		// credentials.  Strip these fields client-side as well as server-side.
		delete plugin.uid;
		delete plugin.gid;
		
		var installed = this.findInstalledMarketplaceProduct(response.item);
		if (installed && (installed.id != plugin.id)) {
			this.die("Marketplace Plugin is already installed with a different Plugin ID: " + installed.id);
		}
		
		var existing = Tools.findObject(this.plugins, { id: plugin.id });
		if (existing && (existing.type != plugin.type)) {
			this.die("Existing Plugin #" + plugin.id + " has a different Plugin type and cannot be replaced.");
		}
		var operation = existing ? 'update' : 'create';
		var warning = '';
		if (existing && (!existing.marketplace || (existing.marketplace.id != response.item.id))) {
			warning = "Existing local Plugin #" + plugin.id + " will be replaced by the Marketplace version.";
		}
		
		var preview = {
			product: response.item,
			marketplace: plugin.marketplace,
			version: response.version,
			operation: operation,
			preview: true,
			warnings: warning ? [warning] : [],
			plugin: plugin
		};
		
		if (this.dry || this.args.confirm !== true) {
			// Explicit JSON formats retain the complete machine-readable preview envelope.
			// The friendly terminal preview below focuses on the Plugin definition itself.
			if (this.format.match(/json/)) return this.jsonOutput(preview);
			
			var display = this.prepareMarketplacePreviewPlugin(plugin);
			this.printBoxList({
				title: 'Marketplace Plugin Install Preview',
				rows: [
					[ 'Plugin Name', this.color('theme').bold(response.item.title) ],
					[ 'Author', response.item.author ],
					[ 'Version', response.version ]
				]
			});
			
			if (warning) println("\n " + yellow(warning));
			println("\n This is the Plugin definition that will be " + (operation == 'create' ? 'created' : 'used to update the installed Plugin') + " when you confirm:");
			this.jsonOutput(display.plugin);
			if (display.script) this.printPluginScript(plugin);
			
			this.toast('⚠️', 'orange', "Preview only. Review the Plugin data above, then use --confirm to install it.");
			this.printSuggestedCommands({
				"Confirm this installation": "xy marketplace install " + response.item.id + " --version " + response.version + " --confirm",
				"View Marketplace Plugin": "xy marketplace " + response.item.id
			});
			return;
		}
		
		var method = operation == 'create' ? 'createPlugin' : 'updatePlugin';
		var data = await this.callStandardAPI(method, plugin, {
			text: (operation == 'create' ? 'Installing' : 'Upgrading') + ' Marketplace Plugin...'
		});
		var saved = data.plugin;
		var result = {
			code: 0,
			marketplace: plugin.marketplace,
			operation: operation == 'create' ? 'created' : 'updated',
			plugin: saved
		};
		
		if (this.format.match(/json/)) return this.jsonOutput(result);
		
		this.toast('✅', 'green', response.item.title + ' ' + response.version + ' was installed successfully.');
		this.printSuggestedCommands({
			"View installed Plugin": "xy plugin " + saved.id,
			"View Marketplace details": "xy marketplace " + response.item.id,
			"List installed Marketplace Plugins": "xy marketplace --status installed"
		});
	},
	
	async fetchMarketplace(params, message) {
		// Keep progress behavior consistent across search, details, and data fetches.
		cli.progress.start({ amount: 1, pct: false, text: gray('→ ' + message) });
		var { err, data } = await this.api.marketplace(params);
		cli.progress.end();
		if (err) this.die(err);
		return data;
	},
	
	consumeMarketplaceID() {
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing Marketplace Plugin ID. Use AUTHOR/REPO.");
		if (this.args.other.length) this.die("Unexpected argument after Marketplace Plugin ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Marketplace Plugin ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)) {
			this.die("Invalid Marketplace Plugin ID: " + id + ". Use AUTHOR/REPO.");
		}
		delete this.args.id;
		delete this.args.other;
		return id;
	},
	
	consumeMarketplaceVersion() {
		var version = this.args.version;
		delete this.args.version;
		if ((version !== undefined) && ((typeof(version) != 'string') || !version.trim() || !version.match(/^[A-Za-z0-9_.+-]+$/))) {
			this.die("Invalid Marketplace Plugin version: " + version);
		}
		return version;
	},
	
	validateMarketplaceProduct(product, resolved_version, requested_version) {
		if (!product || (product.type != 'plugin')) this.die("Marketplace product is not a Plugin.");
		if (!Array.isArray(product.versions) || !product.versions.length) this.die("Marketplace Plugin has no published versions.");
		if (!['event', 'monitor', 'action', 'scheduler'].includes(product.plugin_type)) this.die("Marketplace Plugin has an invalid Plugin type.");
		if (!product.versions.includes(resolved_version)) this.die("Marketplace returned an unknown Plugin version: " + resolved_version);
		if (requested_version && (resolved_version != requested_version)) this.die("Marketplace returned the wrong Plugin version.");
	},
	
	validateMarketplacePayload(payload, product) {
		// Reuse the complete XYPDF validation, then narrow the accepted package to
		// the single Plugin product supported by Marketplace v1.
		this.validateTransferPayload(payload);
		if (payload.items.length != 1 || payload.items[0].type != 'plugin') {
			this.die("Marketplace package must contain exactly one Plugin item.");
		}
		var plugin = payload.items[0].data;
		if (!plugin.id) this.die("Marketplace Plugin is missing its internal Plugin ID.");
		if (plugin.type != product.plugin_type) this.die("Marketplace Plugin type does not match its listing metadata.");
	},
	
	prepareMarketplacePreviewPlugin(plugin) {
		// Scripts are unreadable once escaped inside JSON, so pull non-empty source
		// into a separate display section without mutating the install request.
		var preview_plugin = Object.assign({}, plugin);
		var script = preview_plugin.script || '';
		if (script) delete preview_plugin.script;
		
		return { plugin: preview_plugin, script: script };
	},
	
	findInstalledMarketplaceProduct(product) {
		return (this.plugins || []).find( plugin => {
			return !!(plugin.marketplace && (plugin.marketplace.id == product.id));
		});
	},
	
	getNiceMarketplaceStatus(product, installed) {
		if (!installed) return gray('Not Installed');
		if (installed.marketplace.version == product.versions[0]) return green('Up to Date');
		return yellow('Outdated');
	},
	
	normalizeMarketplaceList(value, key) {
		var values = [];
		Tools.alwaysArray(value).forEach( entry => {
			if (typeof(entry) != 'string') this.die("Marketplace " + key + " must be a comma-separated string or repeated option.");
			entry.split(',').forEach( item => {
				item = item.trim();
				if (item) values.push(item);
			});
		});
		if (!values.length) this.die("Marketplace " + key + " cannot be empty.");
		return values;
	},
	
	parseMarketplaceInteger(value, key, minimum) {
		value = Number(value);
		if (!Number.isInteger(value) || (value < minimum)) this.die("Marketplace " + key + " must be an integer of at least " + minimum + ".");
		return value;
	},
	
	cleanMarketplaceReadme(text) {
		// Terminals cannot display images, and marked-terminal otherwise leaves the
		// source markup visible.  Preserve linked badge labels, then remove images.
		text = String(text || '').replace(/\r\n?/g, '\n');
		
		// README content comes from third-party repositories.  Remove raw terminal
		// control characters before rendering while preserving tabs and newlines.
		text = text.replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '');
		text = text.replace(/\[!\[([^\]]*)\]\([^\n]*?\)\]\(([^\n]*?)\)/g, '[$1]($2)');
		text = text.replace(/!\[[^\]]*\]\([^\n]*?\)/g, '');
		text = text.replace(/<(p|div)\b[^>]*>\s*(?:<img\b[^>]*\/?\s*>\s*)+<\/\1>/gi, '');
		text = text.replace(/<img\b[^>]*\/?\s*>/gi, '');
		
		// GitHub READMEs often center their title using raw HTML.  Convert those
		// headings back to Markdown so they remain readable in the terminal.
		text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, function(match, level, title) {
			return '#'.repeat(Number(level)) + ' ' + title.replace(/<[^>]+>/g, '').trim();
		});
		return text.trim();
	}
	
}; // module.exports
