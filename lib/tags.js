// Tag Management Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_tags() {
		// The plural command lists and filters Tag definitions.
		await this.cmd_get_tags();
	},
	
	async cmd_tag() {
		// Route Tag operations, or treat a bare ID or title as a detail lookup.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('tag');
		
		switch (cmd) {
			case 'list': await this.cmd_get_tags(); break;
			case 'get': await this.cmd_get_tag(); break;
			case 'create': await this.cmd_create_tag(); break;
			case 'update': await this.cmd_update_tag(); break;
			case 'delete': await this.cmd_delete_tag(); break;
			
			default:
				this.args.other.unshift(cmd);
				await this.cmd_get_tag();
			break;
		}
	},
	
	async cmd_get_tags() {
		// Tags are kept in the shared getMultiple cache, so search and paginate
		// locally like the other small definition collections.
		this.prepSearchArgs();
		await this.getMultiple();
		
		var tags = this.tags.slice(0);
		var is_filtered = !!this.args.other.length;
		if (is_filtered) {
			var search = this.args.other.join(' ');
			tags = this.findObjectsFuzzy(tags, {
				id: search,
				title: search,
				notes: search,
				username: search
			}, 1);
		}
		delete this.args.other;
		
		if (Tools.numKeys(this.args)) {
			tags = this.findObjectsFuzzy(tags, this.args);
			is_filtered = true;
		}
		
		tags.sort( (a, b) => String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase()) );
		if (this.format.match(/json/)) return this.jsonOutput(tags);
		
		var event_counts = {};
		this.events.forEach( event => {
			(event.tags || []).forEach( id => { event_counts[id] = (event_counts[id] || 0) + 1; } );
		});
		
		this.printPaginatedBoxTable({
			title: is_filtered ? 'Filtered Tags' : 'All Tags',
			header: ['Tag ID', 'Title', 'Icon', 'Events', 'Author', 'Modified'],
			rows: tags.slice(this.offset, this.offset + this.limit),
			list: { length: tags.length },
			offset: this.offset,
			limit: this.limit
		}, tag => [
			this.color('theme').bold(tag.id),
			bold(tag.title),
			tag.icon || gray('(None)'),
			Tools.commify(event_counts[tag.id] || 0),
			tag.username || gray('(Unknown)'),
			this.getRelativeDateTime(tag.modified, true)
		]);
		
		this.printSuggestedCommands({
			"View Tag details": "xy tag TAG_ID_OR_TITLE",
			"Create a Tag": 'xy tag create --title "Production" --icon server',
			"Find a Tag": "xy tags SEARCH_TEXT",
			"List tagged Events": "xy events --tags TAG_ID"
		});
	},
	
	async cmd_get_tag() {
		// Exact IDs take priority, while fuzzy titles are safe for read-only views.
		await this.getMultiple();
		var selector = this.args.other.join(' ') || this.args.id || this.args.title;
		if (!selector) return this.dieUsage('tag get');
		
		delete this.args.other;
		delete this.args.id;
		delete this.args.title;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Tag get option: --" + Tools.firstKey(this.args));
		
		var match = Tools.findObject(this.tags, { id: selector }) || this.findObjectFuzzy(this.tags, { title: selector });
		if (!match) return this.die("Could not find Tag based on your criteria: " + selector);
		var tag = await this.fetchTag(match.id);
		if (this.format.match(/json/)) return this.jsonOutput(tag);
		
		var events = this.events.filter( event => (event.tags || []).includes(tag.id) );
		this.printBoxList({
			title: 'Tag Summary',
			rows: [
				[ 'Tag ID', gray(tag.id) ],
				[ 'Title', this.color('theme').bold(tag.title) ],
				[ 'Icon', tag.icon || gray('(None)') ],
				[ 'Events', Tools.commify(events.length) ],
				[ 'Author', tag.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(tag.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(tag.modified, true, true) ],
				[ 'Revision', tag.revision || 1 ]
			]
		});
		
		// Notes may contain multiple lines, so keep them out of the summary box.
		if (tag.notes) this.printUserNotes('TAG NOTES', tag.notes);
		
		this.printSuggestedCommands({
			"List tagged Events": `xy events --tags ${tag.id}`,
			"Export Tag": `xy tag ${tag.id} --export tag.json`,
			"Update Tag": `xy tag update ${tag.id} --notes "Updated notes"`,
			"Delete Tag": `xy tag delete ${tag.id}`
		});
	},
	
	async cmd_create_tag() {
		// Defaults match the web editor.  The server assigns ID and audit fields.
		if (this.args.other.length) return this.dieUsage('tag create');
		delete this.args.other;
		
		var params = this.prepareTagParams({
			icon: 'tag-outline',
			notes: ''
		}, this.args, true);
		if (!params.title) return this.dieUsage('tag create');
		
		var data = await this.callStandardAPI('createTag', params, { text: 'Creating Tag...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.tag);
		
		this.toast('✅', 'green', "Successfully created Tag: #" + data.tag.id);
		this.printSuggestedCommands({
			"View Tag details": `xy tag ${data.tag.id}`,
			"Update Tag": `xy tag update ${data.tag.id} --notes "Updated notes"`,
			"List all Tags": "xy tags",
			"Delete Tag": `xy tag delete ${data.tag.id}`
		});
	},
	
	async cmd_update_tag() {
		var id = this.consumeTagID();
		var tag = await this.fetchTag(id);
		
		this.printMutationSummary({
			title: 'Update Tag',
			rows: [
				[ 'Tag ID', gray(tag.id) ],
				[ 'Title', this.color('theme').bold(tag.title) ]
			]
		});
		if (!await this.confirmSyncUpdate('tag', tag.id, 'Tag')) return;
		if (!Tools.numKeys(this.args)) return this.die("No updates specified for Tag.");
		this.printUpdateData(this.args);
		
		var params = this.prepareTagParams({}, this.args, false);
		params.id = id;
		var data = await this.callStandardAPI('updateTag', params, { text: 'Updating Tag...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully updated Tag: #" + id);
	},
	
	async cmd_delete_tag() {
		var id = this.consumeTagID();
		var tag = await this.fetchTag(id);
		
		this.printMutationSummary({
			title: 'Delete Tag',
			rows: [
				[ 'Tag ID', gray(tag.id) ],
				[ 'Title', this.color('theme').bold(tag.title) ]
			]
		});
		
		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) {
			return this.die("Tag delete --confirm must be true or false.");
		}
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the Tag delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Tag delete option: --" + Tools.firstKey(this.args));
		
		var data = await this.callStandardAPI('deleteTag', { id: id }, { text: 'Deleting Tag...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully deleted Tag: #" + id);
	},
	
	async fetchTag(id) {
		// Use the single-resource endpoint for authoritative metadata and privileges.
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading Tag...') });
		var { err, data } = await this.api.getTag({ id: id });
		cli.progress.end();
		if (err) this.die(err);
		return data.tag;
	},
	
	consumeTagID() {
		// Mutations require an exact internal ID and can never change that ID.
		var id = this.args.other.shift() || this.args.id;
		if (!id) this.die("Missing required Tag ID argument.");
		if (this.args.other.length) this.die("Unexpected argument after Tag ID: " + this.args.other[0]);
		if (this.args.id && (this.args.id !== id)) this.die("Conflicting Tag ID arguments.");
		if ((typeof(id) != 'string') || !id.match(/^[a-z0-9_]+$/)) this.die("Invalid Tag ID: " + id);
		delete this.args.id;
		delete this.args.other;
		return id;
	},
	
	prepareTagParams(defaults, input, creating) {
		// Send only user-selected fields on update.  This keeps old CLI versions
		// compatible when newer xyOps releases add properties to Tag records.
		var params = creating ? Tools.copyHash(defaults, true) : {};
		var allowed = creating ? ['id', 'title', 'icon', 'notes'] : ['title', 'icon', 'notes'];
		Object.keys(input).forEach( key => {
			if (!allowed.includes(key)) return this.die("Unsupported Tag option: --" + key);
			params[key] = input[key];
		});
		
		if ('title' in params) {
			if ((typeof(params.title) != 'string') || !params.title.trim()) this.die("Tag title cannot be empty and must be a string.");
			params.title = params.title.trim();
		}
		['icon', 'notes'].forEach( key => {
			if ((key in params) && (typeof(params[key]) != 'string')) this.die("Tag " + key + " must be a string.");
		});
		if ('icon' in params) params.icon = params.icon.replace(/^mdi\-/, '');
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^[a-z0-9_]+$/))) {
			this.die("Invalid Tag ID: " + params.id);
		}
		return params;
	}
	
}; // module.exports
