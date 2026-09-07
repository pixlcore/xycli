// Event Categories Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_categories() {
		// The plural command always lists categories, with optional filters.
		await this.cmd_get_categories();
	},
	
	async cmd_category() {
		// Route category operations, or treat a bare ID or title as a detail lookup.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('category');
		switch (cmd) {
			case 'list': await this.cmd_get_categories(); break;
			case 'get': await this.cmd_get_category(); break;
			case 'create': await this.cmd_create_category(); break;
			case 'update': await this.cmd_update_category(); break;
			case 'delete': await this.cmd_delete_category(); break;
			default:
				this.args.other.unshift(cmd);
				await this.cmd_get_category();
			break;
		}
	},
	
	async cmd_get_categories() {
		// Load shared state for event counts and the established display helpers.
		this.prepSearchArgs();
		await this.getMultiple();
		var categories = this.categories.slice(0);
		var is_filtered = !!this.args.other.length;
		if (is_filtered) {
			var search = this.args.other.join(' ');
			categories = this.findObjectsFuzzy(categories, { id: search, title: search, notes: search }, 1);
		}
		delete this.args.other;
		
		if ('enabled' in this.args) {
			var enabled = this.parseCategoryBoolean(this.args.enabled, 'enabled');
			categories = categories.filter( category => !!category.enabled === enabled );
			delete this.args.enabled;
			is_filtered = true;
		}
		if (Tools.numKeys(this.args)) {
			categories = this.findObjectsFuzzy(categories, this.args);
			is_filtered = true;
		}
		
		// Preserve the same category ordering used by the web UI and event lists.
		categories.sort( function(a, b) {
			return ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.title).localeCompare(String(b.title));
		});
		if (this.format.match(/json/)) return this.jsonOutput(categories);
		
		var counts = {};
		this.events.forEach( event => { counts[event.category] = (counts[event.category] || 0) + 1; } );
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Categories' : 'All Categories',
			header: ['Category ID', 'Title', 'Status', 'Events', 'Author', 'Modified'],
			rows: categories.slice(this.offset, this.offset + this.limit),
			list: { length: categories.length },
			offset: this.offset,
			limit: this.limit
		}, category => [
			this.color('theme').bold(category.id),
			this.getNiceCategory(category),
			this.getNiceEnabled(category.enabled),
			Tools.commify(counts[category.id] || 0),
			category.username || gray('(Unknown)'),
			this.getRelativeDateTime(category.modified, true)
		]);
		
		this.printSuggestedCommands({
			"View category details": "xy category CAT_ID_OR_TITLE",
			"Create a category": 'xy category create --title "My Category" --notes "Hello"',
			"List disabled categories": "xy categories --enabled false",
			"List category events": "xy events --category CAT_ID"
		});
	},
	
	async cmd_get_category() {
		// Read-only selection accepts an exact ID first, then a fuzzy title.
		await this.getMultiple();
		var selector = this.args.other.join(' ') || this.args.id || this.args.title;
		if (!selector) return this.dieUsage('category get');
		var match = Tools.findObject(this.categories, { id: selector }) ||
			this.findObjectFuzzy(this.categories, { title: selector });
		if (!match) return this.die("Could not find category based on your criteria: " + selector);
		var category = await this.fetchCategory(match.id);
		if (this.format.match(/json/)) return this.jsonOutput(category);
		
		this.printBoxList({
			title: 'Category Summary',
			rows: [
				[ 'Category ID', gray(category.id) ],
				[ 'Title', this.getNiceCategory(category) ],
				[ 'Status', this.getNiceEnabled(category.enabled) ],
				[ 'Color', category.color || 'plain' ],
				[ 'Icon', category.icon || gray('(None)') ],
				[ 'Events', Tools.commify(Tools.findObjects(this.events, { category: category.id }).length) ],
				[ 'Sort Order', category.sort_order || 0 ],
				[ 'Author', category.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(category.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(category.modified, true, true) ],
				[ 'Revision', category.revision || 1 ]
			]
		});
		
		// User notes may contain multiple lines, so keep them out of the summary box.
		if (category.notes) {
			this.printUserNotes('CATEGORY NOTES', category.notes);
		}
		
		// Display only the category's own arrays so indexes map to update paths.
		// Descriptions and disabled styling mirror the event detail tables.
		this.printBoxTable({
			title: 'Category Actions',
			header: ['#', 'Status', 'Condition', 'Type', 'Description'],
			rows: (category.actions || []).map( (item, idx) => {
				var disp = this.getJobActionDisplayArgs(item);
				return [
					idx,
					this.getNiceEnabled(item.enabled),
					item.enabled ? this.color(disp.condition.color).bold(disp.condition.title) : gray(disp.condition.title),
					item.enabled ? disp.type : gray(disp.type),
					item.enabled ? disp.desc : gray(disp.desc)
				];
			})
		});
		this.printBoxTable({
			title: 'Category Limits',
			header: ['#', 'Status', 'Limit', 'Description'],
			rows: (category.limits || []).map( (item, idx) => {
				var disp = this.getResLimitDisplayArgs(item);
				return [
					idx,
					this.getNiceEnabled(item.enabled),
					item.enabled ? bold(disp.nice_title) : gray(disp.nice_title),
					item.enabled ? disp.nice_desc : gray(disp.nice_desc)
				];
			})
		});
		this.printSuggestedCommands({
			"List category events": `xy events --category ${category.id}`,
			"Export category": `xy category ${category.id} --export category.json`,
			"Update category": `xy category update ${category.id} --notes "Updated notes"`,
			"Append an action": `xy category update ${category.id} --action @action.json`,
			"Append a limit": `xy category update ${category.id} --limit @limit.json`,
			"Delete category": `xy category delete ${category.id} --confirm`
		});
	},
	
	async cmd_create_category() {
		// Defaults match the web editor.  The server assigns ID and audit fields.
		if (this.args.other.length) return this.dieUsage('category create');
		delete this.args.other;
		var params = this.prepareCategoryParams({
			enabled: true,
			color: 'plain',
			icon: '',
			notes: '',
			actions: [],
			limits: []
		}, this.args, true);
		if (!params.title) return this.dieUsage('category create');
		
		var data = await this.callStandardAPI('createCategory', params, { text: 'Creating category...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.category);
		this.toast('✅', 'green', "Successfully created category: #" + data.category.id);
		this.printSuggestedCommands({
			"View category details": `xy category ${data.category.id}`,
			"Update category": `xy category update ${data.category.id} --enabled false`,
			"Create an event": `xy event create --title "My Event" --category ${data.category.id}`,
			"List all categories": "xy categories"
		});
	},
	
	async cmd_update_category() {
		// Fetch by exact ID so nested changes preserve untouched array entries.
		var id = this.consumeCategoryID();
		var category = await this.fetchCategory(id);
		
		this.printMutationSummary({
			title: 'Update Category',
			rows: [
				[ 'Category ID', gray(category.id) ],
				[ 'Title', this.color('theme').bold(category.title) ]
			]
		});
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for category.");
		this.printUpdateData(this.args);
		
		var params = this.prepareCategoryParams(category, this.args, false);
		params.id = id;
		var data = await this.callStandardAPI('updateCategory', params, { text: 'Updating category...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully updated category: #" + id);
	},
	
	async cmd_delete_category() {
		// The server also refuses deletion while any event uses this category.
		var id = this.consumeCategoryID();
		var category = await this.fetchCategory(id);
		
		this.printMutationSummary({
			title: 'Delete Category',
			rows: [
				[ 'Category ID', gray(category.id) ],
				[ 'Title', this.color('theme').bold(category.title) ]
			]
		});
		
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the category delete by adding '--confirm'.");
			return;
		}
		
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported category delete option: --" + Tools.firstKey(this.args));
		var data = await this.callStandardAPI('deleteCategory', { id: id }, { text: 'Deleting category...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully deleted category: #" + id);
	},
	
	async fetchCategory(id) {
		// Use the single-resource API for authoritative metadata and access checks.
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading category...') });
		var { err, data } = await this.api.getCategory({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		return data.category;
	},
	
	consumeCategoryID() {
		// Updates and deletes never select by title, and cannot change the ID.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing required Category ID argument.");
		if (this.args.other.length) this.die("Unexpected argument after Category ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Category ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die("Invalid Category ID: " + id);
		delete this.args.other;
		delete this.args.id;
		return id;
	},
	
	prepareCategoryParams(category, input, creating) {
		// Only send edited top-level fields.  In particular, a notes-only update
		// should not rewrite actions, limits, sort order, or server audit metadata.
		var params = creating ? Tools.copyHash(category, true) : {};
		var fields = ['title', 'enabled', 'color', 'icon', 'notes', 'actions', 'limits', 'action', 'limit'];
		fields.push(creating ? 'id' : 'sort_order');
		Object.keys(input).forEach( key => {
			var root = key.split('.')[0];
			if (!fields.includes(root)) this.die("Unsupported category option: --" + key);
			if (key.includes('.') && !['actions', 'limits', 'action', 'limit'].includes(root)) {
				this.die("Invalid argument path: " + key);
			}
			var field = (root == 'action') ? 'actions' : ((root == 'limit') ? 'limits' : root);
			if (!creating && (field in category)) params[field] = Tools.copyHash({ value: category[field] }, true).value;
		});
		
		// Apply whole values before dotted edits, regardless of CLI option order.
		Object.keys(input).filter( key => !key.includes('.') ).forEach( key => { params[key] = input[key]; } );
		var dotted = {};
		Object.keys(input).filter( key => key.includes('.') ).forEach( key => { dotted[key] = input[key]; } );
		this.mergeDotArgs(params, dotted);
		
		// Match event convenience syntax: plural arrays replace, singular objects
		// append.  Repeated singular flags are also accepted for batch additions.
		['action', 'limit'].forEach( singular => {
			var plural = singular + 's';
			if (singular in params) {
				if (!(plural in params)) params[plural] = [];
				if (!Array.isArray(params[plural])) this.die("Category " + plural + " must be a JSON array.");
				Tools.alwaysArray(params[singular]).forEach( item => {
					// Repeated options arrive as an array of unparsed JSON strings.
					if (typeof(item) == 'string') {
						try { item = JSON.parse(item); }
						catch (err) { this.die("Category --" + singular + " must contain a JSON object."); }
					}
					if (!Tools.isaHash(item)) this.die("Category --" + singular + " must contain a JSON object.");
					params[plural].push(item);
				});
				delete params[singular];
			}
			if (plural in params) {
				if (!Array.isArray(params[plural])) this.die("Category " + plural + " must be a JSON array.");
				params[plural].forEach( (item, idx) => {
					if (!Tools.isaHash(item)) this.die("Category " + plural + "." + idx + " must be a JSON object.");
					if ('enabled' in item) item.enabled = this.parseCategoryBoolean(item.enabled, plural + '.' + idx + '.enabled');
				});
			}
		});
		
		if ('title' in params) {
			if ((typeof(params.title) != 'string') || !params.title.trim()) this.die("Category title cannot be empty and must be a string.");
			params.title = params.title.trim();
		}
		if ('enabled' in params) params.enabled = this.parseCategoryBoolean(params.enabled, 'enabled');
		['color', 'icon', 'notes'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die("Category " + key + " must be a string.");
		});
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) this.die("Invalid Category ID: " + params.id);
		if (('sort_order' in params) && (!Number.isInteger(params.sort_order) || (params.sort_order < 0))) this.die("Category sort_order must be a non-negative integer.");
		return params;
	},
	
	parseCategoryBoolean(value, name) {
		// Include numeric and friendly boolean spellings used by other resources.
		if ([true, 1, '1', 'true', 'yes', 'on'].includes(value)) return true;
		if ([false, 0, '0', 'false', 'no', 'off'].includes(value)) return false;
		this.die("Invalid boolean value for '" + name + "': " + value);
	}
	
}; // module.exports
