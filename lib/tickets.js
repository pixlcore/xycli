// Ticket Management Layer

const fs = require('fs');
const cli = require('pixl-cli');
const Tools = cli.Tools;

const TICKET_TYPES = ['issue', 'feature', 'release', 'change', 'maintenance', 'question', 'other'];
const TICKET_STATUSES = ['draft', 'open', 'closed'];
const TICKET_LIST_FIELDS = ['assignees', 'cc', 'notify', 'tags'];
const TICKET_EDIT_FIELDS = [
	'subject', 'body', 'type', 'status', 'category', 'server',
	'assignees', 'assign', 'cc', 'notify', 'due', 'tags', 'tag'
];

module.exports = {

	async cmd_tickets() {
		// Tickets live in the indexed database rather than the global memory lists.
		await this.cmd_search_tickets();
	},

	async cmd_ticket() {
		// Route Ticket operations, or treat a bare number / ID as a detail lookup.
		var cmd = this.args.other.shift();
		if (!cmd) return this.dieUsage('ticket');

		switch (cmd) {
			case 'list':
			case 'search': await this.cmd_search_tickets(); break;
			case 'get': await this.cmd_get_ticket(); break;
			case 'create': await this.cmd_create_ticket(); break;
			case 'update': await this.cmd_update_ticket(); break;
			case 'comment': await this.cmd_add_ticket_comment(); break;
			case 'upload': await this.cmd_upload_ticket_files(); break;
			case 'delete': await this.cmd_delete_ticket(); break;

			default:
				this.args.other.unshift(cmd);
				if ('comment' in this.args) await this.cmd_add_ticket_comment();
				else await this.cmd_get_ticket();
			break;
		}
	},

	async cmd_search_tickets() {
		// Convert friendly named options into the same Unbase query language used
		// by the web UI, while preserving an optional raw positional query.
		this.prepSearchArgs();
		await this.getMultiple();

		var query_parts = [];
		if (this.args.other.length) query_parts.push(this.args.other.join(' '));
		delete this.args.other;

		if ('query' in this.args) {
			if ((typeof(this.args.query) != 'string') || !this.args.query.trim()) this.die("Ticket query must be a non-empty string.");
			query_parts.push(this.args.query.trim());
			delete this.args.query;
		}

		var sort_by = this.args.sort_by || '_id';
		var sort_dir = this.parseTicketSortDirection(this.args.sort_dir);
		delete this.args.sort_by;
		delete this.args.sort_dir;

		var aliases = {
			assignee: 'assignees',
			assign: 'assignees',
			tag: 'tags',
			number: 'num',
			date: 'created'
		};
		var searchable = [
			'subject', 'body', 'changes', 'status', 'username', 'assignees',
			'cc', 'type', 'category', 'tags', 'created', 'due', 'num'
		];
		if (!searchable.concat(['_id']).includes(sort_by)) this.die("Unsupported Ticket sort field: " + sort_by);

		Object.keys(this.args).forEach( key => {
			var field = aliases[key] || key;
			if (!searchable.includes(field)) {
				var suggestion = this.findClosestString(key, searchable.concat(Object.keys(aliases)));
				this.die("Unsupported Ticket search option: --" + key + (suggestion ? '. Did you mean "--' + suggestion + '"?' : ''));
			}

			var values = this.parseTicketList(this.args[key], key);
			if (!values.length) this.die("Ticket search option cannot be empty: --" + key);
			if (field == 'category') values = values.map( value => this.resolveTicketCategory(value) );
			if (field == 'tags') values = values.map( value => this.resolveTicketTag(value) );
			if (field == 'status') values.forEach( value => this.validateTicketChoice(value, 'status', this.getTicketStatuses()) );
			if (field == 'type') values.forEach( value => this.validateTicketChoice(value, 'type', this.getTicketTypes()) );
			if ((field == 'created') || (field == 'due')) {
				values = values.map( value => this.getDateRangeQuery(field, value) || (field + ':' + value) );
				query_parts.push(values.join(' '));
			}
			else query_parts.push(field + ':' + values.map( value => this.quoteTicketQueryValue(value) ).join('|'));
		});

		var query = query_parts.join(' ').trim() || '*';
		if (this.format.match(/json/)) {
			var result = await this.searchTickets(query, sort_by, sort_dir);
			return this.jsonOutput(result.rows);
		}

		await this.printTickets({
			title: query == '*' ? 'All Tickets' : 'Ticket Search Results',
			query: query,
			sort_by: sort_by,
			sort_dir: sort_dir
		});

		this.printSuggestedCommands({
			"View Ticket details": "xy ticket TICKET_NUMBER_OR_ID",
			"Create a Ticket": 'xy ticket create --subject "My Ticket" --status draft',
			"Show open Tickets": "xy tickets --status open",
			"Show assigned Tickets": "xy tickets --assignee USERNAME",
			"Search Ticket text": 'xy tickets "search words"'
		});
	},

	async cmd_get_ticket() {
		// Pagination applies to the associated completed-job section.
		this.prepSearchArgs();
		var selector = this.consumeTicketSelector();
		if (Tools.numKeys(this.args)) return this.die("Unsupported Ticket get option: --" + Tools.firstKey(this.args));

		await this.getMultiple();
		var ticket = await this.fetchTicket(selector);
		if (this.format.match(/json/)) return this.jsonOutput(ticket);

		var comments = (ticket.changes || []).filter( change => change.type == 'comment' );
		this.printBoxList({
			title: 'Ticket #' + ticket.num,
			rows: [
				[ 'Number', this.color('theme').bold('#' + ticket.num) ],
				[ 'Ticket ID', gray(ticket.id) ],
				[ 'Subject', this.color('theme').bold(ticket.subject) ],
				[ 'Status', this.getNiceTicketStatus(ticket.status) ],
				[ 'Type', this.getNiceTicketType(ticket.type) ],
				[ 'Category', this.getNiceCategory(ticket.category) ],
				[ 'Server', this.getNiceServer(ticket.server) ],
				[ 'Assignees', this.getNiceTicketList(ticket.assignees) ],
				[ 'Cc', this.getNiceTicketList(ticket.cc) ],
				[ 'Notify', this.getNiceTicketList(ticket.notify) ],
				[ 'Due', ticket.due ? this.getNiceDateTime(ticket.due, false, true) : gray('(None)') ],
				[ 'Tags', this.getNiceTagList(ticket.tags || []) ],
				[ 'Events', Tools.commify((ticket.events || []).length) ],
				[ 'Files', Tools.commify((ticket.files || []).length) ],
				[ 'Comments', Tools.commify(comments.length) ],
				[ 'Author', ticket.username || gray('(Unknown)') ],
				[ 'Created', this.getNiceDateTime(ticket.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(ticket.modified, true, true) ]
			]
		});

		this.printTicketBody(ticket.body);
		this.printTicketEvents(ticket.events || []);
		this.printTicketFiles(ticket.files || []);

		// Match the UI by showing active jobs first and completed jobs below.
		var active_jobs = Object.values(this.activeJobs).filter( job => (job.tickets || []).includes(ticket.id) );
		if (active_jobs.length) this.printActiveJobs({ title: 'Active Ticket Jobs', rows: active_jobs });
		await this.printCompletedJobs({
			title: 'Ticket Jobs',
			query: 'tickets:' + ticket.id,
			hide_empty: true
		});

		this.printTicketComments(comments);
		this.printSuggestedCommands({
			"Add a comment": `xy ticket ${ticket.num} --comment "My comment"`,
			"Update Ticket": `xy ticket update ${ticket.num} --subject "New subject"`,
			"Assign a user": `xy ticket update ${ticket.num} --assign USERNAME`,
			"Add a Tag": `xy ticket update ${ticket.num} --tag TAG_ID`,
			"Upload a file": `xy ticket upload ${ticket.num} --file FILE`,
			"Close Ticket": ticket.status != 'closed' ? `xy ticket update ${ticket.num} close` : '',
			"Reopen Ticket": ticket.status == 'closed' ? `xy ticket update ${ticket.num} open` : '',
			"Delete Ticket": `xy ticket delete ${ticket.num} --confirm`
		});
	},

	async cmd_create_ticket() {
		await this.getMultiple();
		if (this.args.other.length) return this.dieUsage('ticket create');
		delete this.args.other;

		var files = this.consumeTicketFileArgs();
		this.validateTicketUploadFiles(files);
		var params = this.prepareTicketParams({
			status: 'open',
			type: 'change',
			body: '',
			category: '',
			server: '',
			assignees: [],
			cc: [],
			notify: [],
			due: 0,
			tags: []
		}, this.args, true);
		if (!params.subject) return this.dieUsage('ticket create');

		var data = await this.callStandardAPI('createTicket', params, { text: 'Creating Ticket...' });
		if (this.dry) {
			if (files.length) this.jsonOutput({ files: files, save: true });
			return;
		}

		if (files.length) {
			var upload = await this.callStandardAPI('uploadUserTicketFiles', {
				ticket: data.ticket.id,
				save: true
			}, {
				text: 'Uploading Ticket files...',
				files: files
			});
			data.ticket.files = upload.files || [];
		}

		if (this.format.match(/json/)) return this.jsonOutput(data.ticket);
		this.toast('✅', 'green', "Successfully created Ticket #" + data.ticket.num + ': ' + data.ticket.subject);
		this.printSuggestedCommands({
			"View Ticket details": `xy ticket ${data.ticket.num}`,
			"Add a comment": `xy ticket ${data.ticket.num} --comment "My comment"`,
			"Upload a file": `xy ticket upload ${data.ticket.num} --file FILE`,
			"Update Ticket": `xy ticket update ${data.ticket.num} --status open`,
			"List all Tickets": "xy tickets"
		});
	},

	async cmd_update_ticket() {
		var selector = this.consumeTicketSelector(true);
		var action = this.args.other.shift();
		if (this.args.other.length) this.die("Unexpected argument after Ticket update action: " + this.args.other[0]);
		delete this.args.other;

		if (action) {
			var statuses = { close: 'closed', closed: 'closed', open: 'open', reopen: 'open', draft: 'draft' };
			if (!statuses[action]) this.die("Unknown Ticket update action: " + action + '. Choose: close, open, draft');
			if ('status' in this.args) this.die("Specify either a Ticket update action or --status, not both.");
			this.args.status = statuses[action];
		}

		await this.getMultiple();
		var needs_ticket = ('assign' in this.args) || ('tag' in this.args);
		var resolved = await this.resolveTicketMutationSelector(selector, needs_ticket);
		this.printTicketMutationSummary('Update Ticket', resolved.ticket, resolved.id);

		var params = this.prepareTicketParams({}, this.args, false, resolved.ticket);
		if (!Tools.numKeys(params)) return this.die("No updates specified for Ticket.");
		this.printUpdateData(params);
		params.id = resolved.id;

		var data = await this.callStandardAPI('updateTicket', params, { text: 'Updating Ticket...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.ticket);
		this.toast('✅', 'green', "Successfully updated Ticket #" + data.ticket.num + ': ' + data.ticket.subject);
	},

	async cmd_add_ticket_comment() {
		var selector = this.consumeTicketSelector();
		var body = this.args.comment;
		if (body === undefined) body = this.args.body;
		delete this.args.comment;
		delete this.args.body;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Ticket comment option: --" + Tools.firstKey(this.args));
		if ((typeof(body) != 'string') || !body.trim()) return this.dieUsage('ticket comment');

		var resolved = await this.resolveTicketMutationSelector(selector, false);
		this.printTicketMutationSummary('Add Ticket Comment', resolved.ticket, resolved.id);
		var data = await this.callStandardAPI('addTicketChange', {
			id: resolved.id,
			change: { type: 'comment', body: body }
		}, { text: 'Adding Ticket comment...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.ticket);
		this.toast('✅', 'green', "Successfully added a comment to Ticket #" + data.ticket.num + '.');
	},

	async cmd_upload_ticket_files() {
		var selector = this.consumeTicketSelector();
		var files = this.consumeTicketFileArgs();
		if (Tools.numKeys(this.args)) return this.die("Unsupported Ticket upload option: --" + Tools.firstKey(this.args));
		if (!files.length) return this.dieUsage('ticket upload');
		this.validateTicketUploadFiles(files);

		var resolved = await this.resolveTicketMutationSelector(selector, false);
		this.printTicketMutationSummary('Upload Ticket Files', resolved.ticket, resolved.id);
		var data = await this.callStandardAPI('uploadUserTicketFiles', {
			ticket: resolved.id,
			save: true
		}, {
			text: 'Uploading Ticket files...',
			files: files
		});
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data.files || []);
		this.toast('✅', 'green', "Successfully uploaded " + Tools.commify(files.length) + " file(s) to Ticket.");
		this.printTicketFiles(data.files || []);
	},

	async cmd_delete_ticket() {
		var selector = this.consumeTicketSelector();
		var resolved = await this.resolveTicketMutationSelector(selector, false);
		this.printTicketMutationSummary('Delete Ticket', resolved.ticket, resolved.id);

		if (('confirm' in this.args) && (typeof(this.args.confirm) != 'boolean')) {
			return this.die("Ticket delete --confirm must be true or false.");
		}
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the Ticket delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		if (Tools.numKeys(this.args)) return this.die("Unsupported Ticket delete option: --" + Tools.firstKey(this.args));

		var data = await this.callStandardAPI('deleteTicket', { id: resolved.id }, { text: 'Deleting Ticket...' });
		if (this.dry) return;
		if (this.format.match(/json/)) return this.jsonOutput(data);
		this.toast('✅', 'green', "Successfully deleted Ticket" + (resolved.ticket ? ' #' + resolved.ticket.num : '') + ': #' + resolved.id);
	},

	async searchTickets(query, sort_by, sort_dir) {
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Searching Tickets...') });
		var { err, data } = await this.api.searchTickets({
			query: query,
			offset: this.offset,
			limit: this.limit,
			sort_by: sort_by,
			sort_dir: sort_dir,
			compact: true
		});
		cli.progress.end();
		if (err) this.die(err);
		return { rows: data.rows || [], list: data.list || { length: 0 } };
	},

	async fetchTicket(selector) {
		var request = this.parseTicketSelector(selector);
		cli.progress.start({ amount: 1, pct: false, text: gray('→ Loading Ticket...') });
		var { err, data } = await this.api.getTicket(request);
		cli.progress.end();
		if (err) this.die(err);
		return data.ticket;
	},

	async resolveTicketMutationSelector(selector, load_ticket) {
		// Numbers must be translated through get_ticket because mutating APIs accept
		// only IDs.  Exact IDs skip that lookup unless append sugar needs old arrays.
		var request = this.parseTicketSelector(selector);
		if ('num' in request) {
			var ticket = await this.fetchTicket(selector);
			return { id: ticket.id, ticket: ticket };
		}
		if (load_ticket) {
			var ticket = await this.fetchTicket(selector);
			return { id: ticket.id, ticket: ticket };
		}
		return { id: request.id, ticket: null };
	},

	consumeTicketSelector(keep_other) {
		var named_values = [this.args.num, this.args.number, this.args.id].filter( value => value !== undefined );
		if ((new Set(named_values.map(String))).size > 1) this.die("Conflicting Ticket selector arguments.");
		var named = named_values[0];
		var positional = (keep_other && (named !== undefined)) ? undefined : this.args.other.shift();
		if ((positional !== undefined) && (named !== undefined) && (String(positional) != String(named))) {
			this.die("Conflicting Ticket selector arguments.");
		}
		var selector = positional !== undefined ? positional : named;
		if (selector === undefined) this.die("Missing required Ticket number or ID argument.");
		if (!keep_other && this.args.other.length) this.die("Unexpected argument after Ticket selector: " + this.args.other[0]);
		delete this.args.id;
		delete this.args.num;
		delete this.args.number;
		if (!keep_other) delete this.args.other;
		return selector;
	},

	parseTicketSelector(selector) {
		selector = String(selector).trim();
		if (selector.match(/^#?(\d+)$/)) {
			var num = Number(RegExp.$1);
			if (!Number.isSafeInteger(num) || (num < 1)) this.die("Invalid Ticket number: " + selector);
			return { num: num };
		}
		if (!selector.match(/^t[a-z0-9_]*$/)) this.die("Invalid Ticket number or ID: " + selector);
		return { id: selector };
	},

	prepareTicketParams(defaults, input, creating, ticket) {
		// Updates are sparse.  Whole arrays replace saved values, while singular
		// --assign and --tag options append to copies of the current arrays.
		var params = creating ? Tools.copyHash(defaults, true) : {};
		var allowed = TICKET_EDIT_FIELDS.concat(creating ? ['id', 'template', 'job', 'alert'] : []);
		Object.keys(input).forEach( key => {
			if (key.includes('.')) this.die("Ticket options do not support dotted paths: --" + key);
			if (!allowed.includes(key)) this.die("Unsupported Ticket option: --" + key);
		});

		TICKET_EDIT_FIELDS.filter( key => !['assign', 'tag'].includes(key) ).forEach( key => {
			if (key in input) params[key] = input[key];
		});
		['id', 'template', 'job', 'alert'].forEach( key => {
			if (creating && (key in input)) params[key] = input[key];
		});

		TICKET_LIST_FIELDS.forEach( key => {
			if (key in params) params[key] = this.parseTicketList(params[key], key);
		});

		if ('assign' in input) {
			var assignees = ('assignees' in params) ? params.assignees : (ticket ? (ticket.assignees || []).slice(0) : []);
			params.assignees = this.uniqueTicketList(assignees.concat(this.parseTicketList(input.assign, 'assign')));
		}
		if ('tag' in input) {
			var tags = ('tags' in params) ? params.tags : (ticket ? (ticket.tags || []).slice(0) : []);
			params.tags = this.uniqueTicketList(tags.concat(this.parseTicketList(input.tag, 'tag').map( value => this.resolveTicketTag(value) )));
		}

		if ('subject' in params) {
			if ((typeof(params.subject) != 'string') || !params.subject.trim()) this.die("Ticket subject cannot be empty and must be a string.");
			params.subject = params.subject.trim();
		}
		if (('body' in params) && (typeof(params.body) != 'string')) this.die("Ticket body must be a string.");
		if ('type' in params) this.validateTicketChoice(params.type, 'type', this.getTicketTypes());
		if ('status' in params) this.validateTicketChoice(params.status, 'status', this.getTicketStatuses());
		if ('category' in params) params.category = params.category ? this.resolveTicketCategory(params.category) : '';
		if ('server' in params) params.server = params.server ? this.resolveTicketServer(params.server) : '';
		if ('tags' in params) params.tags = this.uniqueTicketList(params.tags.map( value => this.resolveTicketTag(value) ));
		['assignees', 'cc', 'notify'].forEach( key => {
			if (key in params) params[key] = this.uniqueTicketList(params[key]);
		});
		if ('notify' in params) params.notify.forEach( email => {
			if (!email.match(/^[\w\-.]+@[\w\-.]+$/)) this.die("Invalid Ticket notification email: " + email);
		});
		if ('due' in params) {
			if ((typeof(params.due) == 'string') && params.due.match(/^\d+$/)) params.due = Number(params.due);
			if (!['string', 'number'].includes(typeof(params.due)) || (typeof(params.due) == 'number' && (!Number.isSafeInteger(params.due) || params.due < 0))) {
				this.die("Ticket due must be a non-negative Unix timestamp or relative duration.");
			}
		}
		if ('template' in params) this.validateTicketChoice(params.template, 'template', ['job', 'alert']);
		if (params.template == 'job' && !params.job) this.die("Ticket template 'job' requires --job JOB_ID.");
		if (params.template == 'alert' && !params.alert) this.die("Ticket template 'alert' requires --alert ALERT_ID.");
		if (('id' in params) && ((typeof(params.id) != 'string') || !params.id.match(/^t[a-z0-9_]*$/))) this.die("Invalid Ticket ID: " + params.id);
		return params;
	},

	parseTicketList(value, name) {
		var list = [];
		Tools.alwaysArray(value).forEach( item => {
			if ((typeof(item) != 'string') && (typeof(item) != 'number')) this.die("Ticket " + name + " must be a comma-separated string or JSON array of strings.");
			list = list.concat(String(item).split(/\s*,\s*/));
		});
		return list.map( item => item.trim() ).filter( item => !!item );
	},

	uniqueTicketList(list) {
		return Array.from(new Set(list));
	},

	getTicketTypes() {
		return ((this.config.ui && this.config.ui.ticket_types) || []).map( item => item.id ).concat(TICKET_TYPES).filter( (id, idx, list) => list.indexOf(id) == idx );
	},

	getTicketStatuses() {
		return ((this.config.ui && this.config.ui.ticket_statuses) || []).map( item => item.id ).concat(TICKET_STATUSES).filter( (id, idx, list) => list.indexOf(id) == idx );
	},

	validateTicketChoice(value, name, choices) {
		if ((typeof(value) != 'string') || !choices.includes(value)) this.die("Invalid Ticket " + name + ': ' + value + '. Choose: ' + choices.join(', '));
		return value;
	},

	resolveTicketCategory(selector) {
		selector = String(selector);
		var category = Tools.findObject(this.categories, { id: selector }) || this.findObjectFuzzy(this.categories, { title: selector });
		if (!category) this.die("Could not find Ticket category: " + selector);
		return category.id;
	},

	resolveTicketTag(selector) {
		selector = String(selector);
		var tag = Tools.findObject(this.tags, { id: selector }) || this.findObjectFuzzy(this.tags, { title: selector });
		if (!tag) this.die("Could not find Ticket Tag: " + selector);
		return tag.id;
	},

	resolveTicketServer(selector) {
		selector = String(selector);
		var servers = Object.values(this.servers);
		var server = Tools.findObject(servers, { id: selector }) || this.findObjectFuzzy(servers, { title: selector, hostname: selector });
		if (!server) this.die("Could not find Ticket server: " + selector);
		return server.id;
	},

	parseTicketSortDirection(value) {
		if (value === undefined) return -1;
		if ([1, '1', 'asc', 'ascending'].includes(value)) return 1;
		if ([-1, '-1', 'desc', 'descending'].includes(value)) return -1;
		this.die("Ticket sort direction must be asc, desc, 1, or -1.");
	},

	quoteTicketQueryValue(value) {
		value = String(value);
		return value.match(/\s/) ? '"' + value.replace(/"/g, '\\"') + '"' : value;
	},

	consumeTicketFileArgs() {
		var files = [];
		if ('file' in this.args) files = files.concat(Tools.alwaysArray(this.args.file));
		if ('files' in this.args) files = files.concat(Tools.alwaysArray(this.args.files));
		delete this.args.file;
		delete this.args.files;
		return files.map( file => String(file) ).filter( file => !!file );
	},

	validateTicketUploadFiles(files) {
		files.forEach( file => {
			if (!fs.existsSync(file)) this.die("Upload file not found: " + file);
			if (!fs.statSync(file).isFile()) this.die("Upload path is not a file: " + file);
		});
	},

	getNiceTicketType(type) {
		var def = Tools.findObject((this.config.ui && this.config.ui.ticket_types) || [], { id: type });
		return def ? def.title : Tools.ucfirst(type || 'Other');
	},

	getNiceTicketStatus(status) {
		var def = Tools.findObject((this.config.ui && this.config.ui.ticket_statuses) || [], { id: status }) || {
			title: Tools.ucfirst(status || 'Unknown'),
			color: 'gray'
		};
		return this.color(def.color || 'gray').bold(def.title);
	},

	getNiceTicketList(list) {
		return (list || []).join(', ') || gray('(None)');
	},

	printTicketMutationSummary(title, ticket, id) {
		this.printMutationSummary({
			title: title,
			rows: [
				ticket ? [ 'Number', this.color('theme').bold('#' + ticket.num) ] : null,
				[ 'Ticket ID', gray(ticket ? ticket.id : id) ],
				ticket ? [ 'Subject', this.color('theme').bold(ticket.subject) ] : null
			]
		});
	},

	printTicketBody(body) {
		println("\n " + this.color('theme').bold('TICKET BODY'));
		if (!body) return println(' ' + gray('(Empty)'));
		println("\n" + this.markdown(body).trimEnd());
	},

	printTicketEvents(events) {
		this.printBoxTable({
			title: 'Ticket Events',
			header: ['Event ID', 'Title', 'Category', 'Plugin', 'Targets', 'Tags'],
			rows: events.map( stub => {
				var event = Tools.findObject(this.events, { id: stub.id }) || { id: stub.id, title: '(Event Not Found)' };
				return [
					this.color('theme').bold(event.id),
					event.title,
					this.getNiceCategory(event.category),
					this.getNicePlugin(event.plugin),
					this.getNiceTargets((stub.targets && stub.targets.length) ? stub.targets : event.targets),
					this.getNiceTagList((stub.tags && stub.tags.length) ? stub.tags : event.tags)
				];
			})
		});
	},

	printTicketFiles(files) {
		this.printBoxTable({
			title: 'Ticket Files',
			header: ['File ID', 'Filename', 'Size', 'Uploader', 'Uploaded'],
			rows: files.map( file => [
				this.color('theme').bold(file.id),
				bold(file.filename),
				Tools.getTextFromBytes(file.size || 0),
				file.username || gray('(Unknown)'),
				this.getRelativeDateTime(file.date, true)
			])
		});
	},

	printTicketComments(comments) {
		if (!comments.length) return;
		comments.forEach( change => {
			var date = this.getNiceDateTime(change.edited || change.date, true, true);
			var title = 'Comment by ' + (change.username || '(Unknown)') + ' -- ' + date + (change.edited ? ' (Edited)' : '');
			println("\n " + this.color('theme').bold(title));
			println("\n" + this.markdown(change.body || '').trimEnd());
		});
	}

}; // module.exports
