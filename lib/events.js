// Events Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;
const chalk = cli.chalk;

module.exports = {
	
	async cmd_events() {
		// alias for cmd_get_events
		await this.cmd_get_events();
	},
	
	async cmd_event() {
		// router, e.g. `xy event get`
		var cmd = this.args.other.shift();
		switch (cmd) {
			case 'list': await this.cmd_get_events(); break;
			case 'get': await this.cmd_get_event(); break;
			case 'run': await this.cmd_run_event(); break;
			
			case 'create': await this.cmd_create_event(); break;
			case 'update': await this.cmd_update_event(); break;
			case 'delete': await this.cmd_delete_event(); break;
			
			default: 
				// assume cmd_get_event, and other arg was the id
				this.args.other.unshift(cmd);
				await this.cmd_get_event();
			break;
		} // switch cmd
	},
	
	async cmd_run() {
		// alias for `xy event run`
		await this.cmd_run_event();
	},
	
	async cmd_get_events() {
		// show event list
		// args: raw, (any filters)
		await this.getMultiple();
		
		// apply user filters
		var is_filtered = false;
		var events = this.events;
		
		// xy events foobar == search for title:foobar
		if (this.args.other.length) this.args.title = this.args.other.join(' ');
		delete this.args.other;
		
		// special case for category, plugin, target
		if (this.args.category) {
			var cats = this.findObjectsFuzzy( this.categories, { id: this.args.category, title: this.args.category }, 1 );
			events = events.filter( event => !!Tools.findObject(cats, { id: event.category }) );
			is_filtered = true;
			delete this.args.category;
		}
		if (this.args.plugin) {
			var plugs = this.findObjectsFuzzy( this.plugins, { id: this.args.plugin, title: this.args.plugin }, 1 );
			events = events.filter( event => !!Tools.findObject(plugs, { id: event.plugin }) );
			is_filtered = true;
			delete this.args.plugin;
		}
		if (this.args.target) {
			var grps = this.findObjectsFuzzy( this.groups, { id: this.args.target, title: this.args.target }, 1 );
			if (grps.length) {
				events = events.filter( event => this.includesAny(event.targets || [], grps.map( grp => grp.id )) );
			}
			else {
				var srvs = this.findObjectsFuzzy( Object.values(this.servers), { id: this.args.target, title: this.args.target }, 1 );
				events = events.filter( event => this.includesAny(event.targets || [], srvs.map( srv => srv.id )) );
			}
			is_filtered = true;
			delete this.args.target;
		}
		
		if (Tools.numKeys(this.args)) {
			// if any args are left, consider them to be filters
			is_filtered = true;
			events = this.findObjectsFuzzy( events, this.args );
		}
		
		if (this.format.match(/json/)) {
			// early exit for json mode
			return this.jsonOutput(events);
		}
		
		// full cli table mode
		if (is_filtered) println( "\n " + this.color('theme').bold("FILTERED EVENTS") + "\n " + gray('(' + Tools.commify(events.length) + ' of ' + Tools.commify(this.events.length) + ' total events)') );
		else println( "\n " + this.color('theme').bold("ALL EVENTS") + "\n " + gray('(' + Tools.commify(events.length) + ' total events)') );
        
		// split up by sorted category so we can drop that column
		Tools.sortBy( this.categories, 'sort_order', { type: 'number', dir: 1 } ).forEach( category => {
			var cat_events = Tools.findObjects( events, { category: category.id } );
			if (!cat_events.length) return;
			Tools.sortBy(cat_events, 'title');
			
			println( "\n " + cli.emoji('📂') + ' ' + this.getNiceCategory(category.id) );
			
			var rows = [
                ['Event', 'Plugin', 'Targets', 'Triggers', 'Status', 'Modified']
            ];
            cat_events.forEach( event => {
                rows.push([ 
					this.color('theme').bold( this.getNiceEvent(event.id) ),
					this.getNicePlugin(event.plugin),
					this.getNiceTargets(event.targets || []),
					summarize_event_timings(event),
					this.getNiceEventStatus(event),
					// this.getNiceDateTime(event.modified)
					this.getTextFromSecondsShort(this.epoch - event.modified) + ' ago'
                ]);
            } );
			var clr = gray;
			if (category.color && (category.color != 'plain')) clr = this.color(category.color);
            print( "" + this.table(rows, { borderStyles: [clr] }) + "\n" );
		} ); // foreach cat
		
		if (!events.length) {
			if (is_filtered) print( gray(" (No events found matching your filters.)") + "\n");
			else print( gray(" (No events found.)") + "\n");
		}
		
		// suggested commands
		this.printSuggestedCommands({
			"Specific category": "xy events --category ID_OR_TITLE",
			"Specific plugin": "xy events --plugin ID_OR_TITLE",
			"Specific group": "xy events --target ID_OR_TITLE",
			"Get event details": "xy event ID_OR_TITLE"
		});
	},
	
	async cmd_get_event() {
		// Only the related-job variants use pagination.  Remove their page controls
		// before resolving an event from named filters.
		if (this.args.upcoming || this.args.completed || this.args.queued || this.args.queue) this.prepSearchArgs();
		
		// get single event and display details
		await this.getMultiple();
		
		if (!this.events.length) {
			return this.die( "No events found." );
		}
		
		var event = null;
		if (this.args.other.length) {
			// assume loose argument is event ID or fuzzy title
			var str = this.args.other.join(' ');
			event = this.findObjectFuzzy( this.events, { id: str, title: str }, 1 );
			if (!event) return this.die("Could not find event based on your criteria: " + str);
		}
		else {
			delete this.args.other;
			event = this.findObjectFuzzy( this.events, this.args );
			if (!event) return this.die("Could not find event based on your criteria: " + JSON.stringify(this.args));
		}
		
		if (this.format.match(/json/)) {
			// early exit for json mode
			return this.jsonOutput(event);
		}
		
		// summary table
		this.printBoxList({
			title: event.workflow ? "Workflow Summary" : "Event Summary",
			rows: [
				[ 'Event ID', gray(event.id) ],
				[ 'Title', this.color('theme').bold(event.title) ],
				[ 'Status', this.getNiceEnabled(event.enabled) ],
				[ 'Category', this.getNiceCategory(event.category) + ` ${gray('(' + event.category + ')')}` ],
				[ 'Plugin', this.getNicePlugin(event.plugin) + (event.plugin != '_workflow' ? ` ${gray('(' + event.plugin + ')')}` : '') ],
				[ 'Targets', this.getNiceTargets(event.targets) ],
				[ 'Algorithm', this.getNiceAlgo(event.algo) ],
				[ 'Author', event.username ],
				[ 'Created', this.getNiceDateTime(event.created, true, true) ],
				[ 'Modified', this.getNiceDateTime(event.modified, true, true) ],
				[ 'Revision', event.revision ]
			]
		});
		
		// upcoming jobs
		if (this.args.upcoming) {
			await this.printUpcomingJobs({
				events: [event]
			});
			return;
		}
		
		// completed jobs
		if (this.args.completed) {
			await this.printCompletedJobs({
				query: 'event:' + event.id
			});
			return;
		}
		
		// queued jobs
		if (this.args.queued || this.args.queue) {
			await this.printQueuedJobs({
				event: event.id
			});
			return;
		}
		
		// triggers
		this.printBoxTable({
			title: "Triggers",
			header: ['Status', 'Description', 'Type', 'Tags'],
			rows: (event.triggers || []).map( item => {
				var { nice_type, nice_desc } = this.getTriggerDisplayArgs(item);
				return [
					this.getNiceEnabled(item.enabled),
					item.enabled ? bold(nice_desc) : gray(nice_desc),
					item.enabled ? nice_type : gray(nice_type),
					this.getNiceTagList( item.tags || [] )
				];
			} )
		});
		
		// actions
		var actions = [].concat( event.actions || [] );
		
		// add inherited category actions
		var category = Tools.findObject( this.categories, { id: event.category } ) || {};
		(category.actions || []).forEach( function(action) {
			actions.push({ ...action, source: 'category' });
		} );
		
		// add universal actions (not hidden)
		var temp_event_type = event.workflow ? 'workflow' : 'default';
		this.config.job_universal_actions[temp_event_type].forEach( function(action) {
			if (action.condition && !action.hidden) actions.push({ ...action, source: 'universal' });
		} );
		
		this.printBoxTable({
			title: "Actions",
			header: ['#', 'Status', 'Condition', 'Type', 'Description', 'Note'],
			rows: actions.map( (item, idx) => {
				var disp = this.getJobActionDisplayArgs(item);
				return [
					idx,
					this.getNiceEnabled(item.enabled),
					item.enabled ? this.color(disp.condition.color).bold(disp.condition.title) : gray(disp.condition.title),
					item.enabled ? disp.type : gray(disp.type),
					item.enabled ? disp.desc : gray(disp.desc),
					item.enabled ? disp.note : gray(disp.note),
				];
			} )
		});
		
		// limits
		var limits = [].concat( event.limits || [] );
		
		// add inherited category limits
		var category = Tools.findObject( this.categories, { id: event.category } ) || {};
		(category.limits || []).forEach( function(limit) {
			limits.push({ ...limit, source: 'category' });
		} );
		
		// add universal limits (not hidden)
		var temp_event_type = event.workflow ? 'workflow' : 'default';
		this.config.job_universal_limits[temp_event_type].forEach( function(limit) {
			if (limit.type && !limit.hidden) limits.push({ ...limit, source: 'universal' });
		} );
		
		this.printBoxTable({
			title: "Limits",
			header: ['#', 'Status', 'Limit', 'Description', 'Note'],
			rows: limits.map( (item, idx) => {
				var { nice_title, nice_desc, note } = this.getResLimitDisplayArgs(item);
				return [
					idx,
					this.getNiceEnabled(item.enabled),
					item.enabled ? bold(nice_title) : gray(nice_title),
					item.enabled ? nice_desc : gray(nice_desc),
					item.enabled ? note : gray(note),
				];
			} )
		});
		
		// plugin param (values)
		if (!event.workflow) {
			var plugin = Tools.findObject( this.plugins, { id: event.plugin } ) || { title: "Plugin" };
			this.printParamValues({
				title: `${plugin.title} Parameters`,
				fields: plugin.params || [],
				values: event.params || {}
			});
		}
		
		// user params (field defs)
		this.printParamFields({
			title: "User Parameters",
			fields: event.fields || []
		});
		
		// workflow nodes (ugh)
		if (event.workflow && event.workflow.nodes) {
			var nodes = Tools.sortBy( event.workflow.nodes.filter( node => node.type.match(/^(event|job|controller)$/) ), 'type', { type: 'string', dir: 1 } );
			this.printBoxTable({
				title: "Workflow Nodes",
				header: ['Node Title', 'ID', 'Type', 'Description', 'Connections'],
				rows: nodes.map( node => {
					var { title, type, desc, conns } = this.getWFNodeDisplayArgs(event, node);
					return [ bold(title), gray(node.id), type, desc, conns ];
				} )
			});
		}
		
		// active jobs
		this.printActiveJobs({
			title: "Active Jobs",
			criteria: {
				event: event.id
			}
		});
		
		// suggested commands
		this.printSuggestedCommands({
			"Queued jobs": `xy event ${event.id} --queued`,
			"Upcoming jobs": `xy event ${event.id} --upcoming`,
			"Completed jobs": `xy event ${event.id} --completed`,
			"Run job manually": `xy run ${event.id}`,
			"Update event": `xy event update ${event.id} [--KEY VALUE, ...]`,
			"Export event": `xy event ${event.id} --export event.json`,
			"Delete event": `xy event delete ${event.id}`
		});
	},
	
	async cmd_run_event() {
		// launch job for event
		// launch w/params: xy run EVENT_ID --params.foo "bar"
		// launch w/files: xy run EVENT_ID --file FILE1.txt --file FILE2.txt
		// launch w/data: xy run EVENT_ID --input.data.foo "bar"
		// custom actions array from file: xy run EVENT_ID --actions @my-actions.json
		// entire request from stdin: xy run EVENT_ID --json @-
		await this.getMultiple();
		
		if (!this.events.length) {
			return this.die( "No events found." );
		}
		
		var event = null;
		if (this.args.other.length) {
			// assume loose argument is event ID or fuzzy title
			var str = this.args.other.join(' ');
			event = this.findObjectFuzzy( this.events, { id: str, title: str }, 1 );
			if (!event) return this.die("Could not find event based on your criteria: " + str);
		}
		else if (this.args.id) {
			event = this.findObjectFuzzy( this.events, { id: this.args.id } );
			if (!event) return this.die("Could not find event from ID: " + this.args.id);
		}
		else if (this.args.title) {
			event = this.findObjectFuzzy( this.events, { title: this.args.title } );
			if (!event) return this.die("Could not find event from title: " + this.args.title);
		}
		else this.die("Could not find event.");
		
		delete this.args.other;
		delete this.args.id;
		delete this.args.title;
		
		var do_follow = this.args.follow;
		delete this.args.follow;
		
		var files = Tools.alwaysArray( this.args.file || this.args.files || [] );
		delete this.args.file;
		delete this.args.files;
		
		this.args.id = event.id;
		
		// resolve dot paths in args
		this.mergeDotArgs( this.args, this.args );
		
		var req = this.args;
		var opts = { text: 'Running event...' };
		if (files.length) opts.files = files;
		
		var data = await this.callStandardAPI('runEvent', req, opts);
		if (this.dry) return;
		
		this.toast('✅', 'green', "Successfully launched job: #" + data.id );
		
		if (do_follow) {
			this.gotMultiple = false;
			this.args = { id: data.id };
			await this.cmd_stream_job();
		}
		else if (!this.verbose) {
			println( "\n " + green.bold("Watch job live: ") + bold("xy job " + data.id) );
		}
	},
	
	async cmd_create_event() {
		// create new event
		// xy event create --title "Foo" --plugin testplug --params.duration 30
		// xy event create --title "Yoo" --plugin shellplug --params.script "#!/bin/bash\necho 'Hi'"
		// xy event create --title "Bar" --cron "30 4 * * *" --seconds 15
		// xy event create --title "Baz" --interval "5 minutes" --catchup
		await this.getMultiple();
		
		// resolve dot paths in args
		this.mergeDotArgs( this.args, this.args );
		
		var params = Tools.mergeHashes( Tools.copyHash(this.config.new_event_template, true), this.args );
		delete params.other;
		
		if (!params.category) {
			if (Tools.findObject(this.categories, { id: 'general' })) params.category = 'general';
			else if (!this.categories.length) return this.die("You must define at least one category to add events.");
			else params.category = this.categories[0].id;
		}
		
		if (!params.plugin && (params.type != 'workflow')) {
			if (Tools.findObject(this.plugins, { id: 'shellplug' })) params.plugin = 'shellplug';
			else if (!this.plugins.length) return this.die("You must create at least one Plugin to add events.");
			else params.plugin = this.plugins[0].id;
		}
		
		if (!params.targets || !params.targets.length) {
			if (Tools.findObject(this.groups, { id: 'main' })) params.targets = ['main'];
			else if (!this.groups.length) return this.die("You must define at least one server group to add events.");
			else params.targets = [ this.groups[0].id ];
		}
		
		if (!params.algo) params.algo = 'random';
		
		this.processEventUpdates(params);
		
		var data = await this.callStandardAPI('createEvent', params, {
			text: 'Creating event...'
		});
		if (this.dry) return;
		
		this.toast('✅', 'green', "Successfully created event: #" + data.event.id );
		
		this.printSuggestedCommands({
			"View event details": `xy event ${data.event.id}`,
			"Run event manually": `xy run ${data.event.id}`,
			"Run and follow": `xy run ${data.event.id} --follow`,
			"Update event": `xy event update ${data.event.id} [--KEY VALUE, ...]`,
			"List all events": "xy events"
		});
	},
	
	async cmd_update_event() {
		// update single event
		// xy event update EVENT_ID --title "New Title" --params.duration 15
		// xy event update "Title" --action '{ "type":"email", "enabled":true, "condition":"success", "users":["admin"] }'
		// xy event update EVENT_ID --actions.0.condition "complete" --actions.0.enabled true
		// xy event update EVENT_ID --field '{ "id":"foo", "title":"Foo", "type":"text", "value":"hello" }'
		// xy event update "Title" --magic
		await this.getMultiple();
		
		if (!this.events.length) {
			return this.die( "No events found." );
		}
		
		var event = null;
		if (this.args.other.length) {
			// assume loose argument is event ID or fuzzy title
			var str = this.args.other.join(' ');
			event = this.findObjectFuzzy( this.events, { id: str, title: str }, 1 );
			if (!event) return this.die("Could not find event based on your criteria: " + str);
			delete this.args.other;
		}
		else {
			delete this.args.other;
			event = this.findObjectFuzzy( this.events, this.args );
			if (!event) return this.die("Could not find event based on your criteria: " + JSON.stringify(this.args));
		}
		
		this.printMutationSummary({
			title: event.workflow ? "Update Workflow" : "Update Event",
			rows: [
				[ 'Event ID', gray(event.id) ],
				[ 'Title', this.color('theme').bold(event.title) ]
			]
		});
		
		delete this.args.other;
		if (!Tools.firstKey(this.args)) return this.die("No updates specified for event.");
		
		this.printUpdateData(this.args);
		
		this.mergeDotArgs( event, this.args );
		this.processEventUpdates(event);
		
		var data = await this.callStandardAPI('updateEvent', event, {
			text: 'Updating event...'
		});
		if (this.dry) return;
		
		this.toast('✅', 'green', "Successfully updated event: #" + event.id );
	},
	
	async cmd_delete_event() {
		// delete single event
		// xy event delete EVENT_ID
		// xy event delete EVENT_ID --delete_jobs
		await this.getMultiple();
		
		if (!this.events.length) {
			return this.die( "No events found." );
		}
		
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");

		delete this.args.other;

		var event = Tools.findObject(this.events, { id: this.args.id });
		if (!event) return this.die("Could not find event from ID: " + this.args.id);
		
		this.printMutationSummary({
			title: event.workflow ? "Delete Workflow" : "Delete Event",
			rows: [
				[ 'Event ID', gray(event.id) ],
				[ 'Title', this.color('theme').bold(event.title) ]
			]
		});
		
		// user must confirm, as this is destructive
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		
		var data = await this.callStandardAPI('deleteEvent', this.args, {
			text: 'Deleting event...'
		});
		if (this.dry) return;
		
		this.toast('✅', 'green', "Successfully deleted event: #" + event.id );
	},
	
	processEventUpdates(event) {
		// convert convenience param syntax into event object
		
		// setup arrays and maybe append to them
		if (!event.triggers) event.triggers = [];
		if (!event.actions) event.actions = [];
		if (!event.limits) event.limits = [];
		if (!event.fields) event.fields = [];
		
		// allow convenience singular objects to append
		if (event.trigger) { event.triggers.push(event.trigger); delete event.trigger; }
		if (event.action) { event.actions.push(event.action); delete event.action; }
		if (event.limit) { event.limits.push(event.limit); delete event.limit; }
		if (event.field) { event.fields.push(event.field); delete event.field; }
		
		// allow cron syntax to append a schedule trigger
		if (event.cron) {
			var trigger = this.parseCrontab(event.cron, event.title);
			trigger.type = 'schedule';
			trigger.enabled = true;
			event.triggers.push(trigger);
			delete event.cron;
		}
		
		if (event.interval) {
			// add interval trigger
			var trigger = {
				type: 'interval',
				enabled: true,
				start: Tools.normalizeTime( Tools.timeNow(true), { sec: 0 } ),
				duration: Tools.getSecondsFromText( event.interval ) || this.die("Could not parse seconds from interval: " + event.interval)
			};
			event.triggers.push(trigger);
			delete event.interval;
		}
		
		if (event.single) {
			// add single-shot
			var trigger = {
				type: 'precision',
				enabled: true,
				epoch: Tools.parseDate(event.single) || this.die("Could not parse date from single-shot: " + event.single)
			};
			event.triggers.push(trigger);
			delete event.single;
		}
		
		if (event.magic) {
			// add or refresh magic link
			var trigger = {
				type: 'magic',
				enabled: true,
				key: Tools.generateUniqueID()
			};
			var magic_link = this.config.base_url + "/api/app/magic/v1/" + trigger.key;
			println( "\n " + cyan.bold("Magic Link: ") + " " + gray(magic_link) );
			this.updateOrAdd( event.triggers, { type: 'magic' }, trigger );
			delete event.magic;
		}
		
		if ('seconds' in event) {
			// add or update precision
			var trigger = {
				type: 'precision',
				enabled: true,
				seconds: String(event.seconds).split(/\,\s*/).map( sec => parseInt(sec) )
			};
			this.updateOrAdd( event.triggers, { type: 'precision' }, trigger );
			delete event.seconds;
		}
		
		if (event.delay) {
			// add or update delay
			var trigger = {
				type: 'delay',
				enabled: true,
				duration: Tools.getSecondsFromText(event.delay) || this.die("Could not parse seconds from delay: " + event.delay)
			};
			this.updateOrAdd( event.triggers, { type: 'delay' }, trigger );
			delete event.delay;
		}
		
		if (event.invisible) {
			// add or update quiet (invisible)
			var trigger = {
				type: 'quiet',
				enabled: true,
				invisible: true
			};
			this.updateOrAdd( event.triggers, { type: 'quiet' }, trigger );
			delete event.invisible;
		}
		
		if (event.ephemeral) {
			// add or update quiet (ephemeral)
			var trigger = {
				type: 'quiet',
				enabled: true,
				ephemeral: true
			};
			this.updateOrAdd( event.triggers, { type: 'quiet' }, trigger );
			delete event.ephemeral;
		}
		
		if (event.catchup) {
			// add or update catch-up
			var trigger = {
				type: 'catchup',
				enabled: true
			};
			this.updateOrAdd( event.triggers, { type: 'catchup' }, trigger );
			delete event.catchup;
		}
	},
	
	updateOrAdd(arr, criteria, obj) {
		// update object if found based on criteria, otherwise add new
		var old = Tools.findObject(arr, criteria);
		if (old) Tools.mergeHashInto(old, obj);
		else arr.push(obj);
	},
	
	getWFNodeDisplayArgs(event, node) {
		// get display args for any workflow node
		// title, type, desc, conns
		var workflow = event.workflow;
		var title = '';
		var type = '';
		var desc = '';
		
		var conns = [];
		(workflow.connections || []).forEach( function(conn) {
			if (conn.source == node.id) {
				var dest_node = Tools.findObject( workflow.nodes, { id: conn.dest } );
				if (dest_node && dest_node.type.match(/^(event|job|controller)$/)) conns.push( conn.dest );
			}
			// else if (conn.dest == node.id) conns.push( conn.source );
		} );
		conns = conns.join(', ') || gray('(None)');
		
		switch (node.type) {
			case 'event':
				var event = Tools.findObject( this.events, { id: node.data.event } ) || { title: red("(Event Not Found)") };
				type = "Event";
				title = event.title;
				desc = node.data.replay ? `(Replay Job #${node.data.replay})` : '-';
			break;
			
			case 'job':
				var plugin = Tools.findObject( this.plugins, { id: node.data.plugin } ) || { title: red("(Plugin Not Found)") };
				type = "Job";
				title = node.data.label || plugin.title;
				desc = node.data.replay ? `(Replay Job #${node.data.replay})` : '-';
			break;
			
			case 'controller':
				type = "Controller";
				title = Tools.ucfirst( node.data.controller ) + " Controller";
				desc = node.data.split || node.data.decision || '-';
				if (node.data.controller == 'repeat') desc = 'Repeat ' + node.data.repeat + " times";
				else if (node.data.controller == 'wait') desc = 'Wait ' + Tools.getTextFromSeconds(node.data.wait, false, false);
			break;
		} // switch node.type
		
		return { title, type, desc, conns };
	},
	
	getNiceEventStatus(event) {
		// get pretty event status (active jobs or last result)
		var num_jobs = 0;
		var last_job_id = '';
		for (var job_id in this.activeJobs) {
			var job = this.activeJobs[job_id];
			if (job.event == event.id) { num_jobs++; last_job_id = job.id; }
		}
		var nice_status = gray('Idle');
		var event_state = Tools.getPath( this.state, 'events/' + event.id );
		
		if (num_jobs) {
			nice_status = cli.emoji('🔄') + ' ' + this.color('theme').bold( num_jobs + ' Active' );
		}
		else if (!num_jobs && event_state && event_state.last_job) {
			switch (event_state.last_code) {
				case 'warning': nice_status = cli.emoji('⚠️') + ' ' + this.color('yellow').bold('Warning'); break;
				case 'critical': nice_status = cli.emoji('☢️') + ' ' + this.color('purple').bold('Critical'); break;
				case 'abort': nice_status = cli.emoji('🚫') + ' ' + this.color('gray').bold('Abort'); break;
				default:
					if (event_state.last_code) nice_status = cli.emoji('🛑') + ' ' + this.color('red').bold('Error');
					else nice_status = cli.emoji('✅') + ' ' + this.color('green').bold('Success');
				break;
			}
			if (event_state.last_completed) {
				nice_status += ' ' + gray( this.getTextFromSecondsShort(this.epoch - event_state.last_completed) + ' ago' );
			}
		}
		
		return nice_status;
	},
	
	getTriggerDisplayArgs(item) {
		// prep trigger item for display
		var nice_type = '';
		var alt_type = '';
		var nice_desc = '';
		var short_desc = '';
		
		var menu_item = Tools.findObject( this.config.ui.event_trigger_type_menu, { id: item.type } );
		
		switch (item.type) {
			case 'schedule':
				nice_type = 'Schedule';
				short_desc = summarize_event_timing(item);
				nice_desc = short_desc;
				
				// find actual sub-type based on schedule trigger params
				var trigger = item;
				var tmode = 'hourly';
				if (trigger.years && trigger.years.length) tmode = 'custom';
				else if (trigger.months && trigger.months.length && trigger.weekdays && trigger.weekdays.length) tmode = 'custom';
				else if (trigger.days && trigger.days.length && trigger.weekdays && trigger.weekdays.length) tmode = 'custom';
				else if (trigger.months && trigger.months.length) tmode = 'yearly';
				else if (trigger.weekdays && trigger.weekdays.length) tmode = 'weekly';
				else if (trigger.days && trigger.days.length) tmode = 'monthly';
				else if (trigger.hours && trigger.hours.length) tmode = 'daily';
				else if (trigger.minutes && trigger.minutes.length) tmode = 'hourly';
			break;
			
			case 'interval':
				nice_type = 'Schedule';
				alt_type = 'Interval';
				short_desc = Tools.getTextFromSeconds(item.duration || 0, true, false);
				nice_desc = Tools.getTextFromSeconds(item.duration || 0, false, false);
			break;
			
			case 'startup':
				nice_type = 'Schedule';
				alt_type = 'System';
				nice_desc = 'Run at Startup';
				short_desc = "Run at Startup";
			break;
			
			case 'single':
				nice_type = 'Schedule';
				alt_type = 'Single Shot';
				short_desc = summarize_event_timing(item);
				nice_desc = 'Single Shot: ' + short_desc;
			break;
			
			case 'manual':
				nice_type = 'On-Demand';
				nice_desc = 'Manual Run';
				short_desc = "Manual Run";
			break;
			
			case 'magic':
				nice_type = 'On-Demand';
				nice_desc = 'Magic Link';
				short_desc = "Magic Link";
			break;
			
			case 'keyboard':
				nice_type = 'On-Demand';
				alt_type = 'Keyboard';
				nice_desc = 'Keyboard: [' + (item.keys || []).join('], [') + ']';
				short_desc = '[' + (item.keys || []).join('], [') + ']';
			break;
			
			case 'catchup':
				nice_type = alt_type = 'Modifier';
				nice_desc = 'Catch-Up';
				short_desc = "Catch-Up";
			break;
			
			case 'nth':
				nice_type = alt_type = 'Modifier';
				nice_desc = 'Run Every ' + format_ordinal(item.every);
				short_desc = "Every " + format_ordinal(item.every);
			break;
			
			case 'range':
				nice_type = 'Modifier';
				alt_type = 'Range';
				short_desc = (item.start && item.end && (item.end > item.start)) ? Tools.getTextFromSeconds( item.end - item.start, true, true ) : this.summarizeTimingRange(item);
				nice_desc = 'Range: ' + this.summarizeTimingRange(item);
			break;
			
			case 'blackout':
				nice_type = 'Modifier';
				alt_type = 'Blackout';
				short_desc = (item.start && item.end && (item.end > item.start)) ? Tools.getTextFromSeconds( item.end - item.start, true, true ) : this.summarizeTimingRange(item);
				nice_desc = 'Blackout: ' + this.summarizeTimingRange(item);
			break;
			
			case 'delay':
				nice_type = 'Modifier';
				alt_type = 'Delay';
				short_desc = Tools.getTextFromSeconds(item.duration || 0, false, true);
				nice_desc = 'Delay: ' + short_desc;
			break;
			
			case 'precision':
				nice_type = 'Precision';
				alt_type = 'Precision';
				short_desc = 'On the minute';
				if (item.seconds && item.seconds.length) short_desc = item.seconds.map( sec => ':' + zeroPad(sec, 2) ).join(', ');
				nice_desc = 'Seconds: ' + short_desc;
			break;
			
			case 'quiet':
				nice_type = 'Modifier';
				alt_type = 'Quiet';
				short_desc = '';
				nice_desc = '';
				if (item.invisible) {
					short_desc += 'Invisible';
					nice_desc += 'Invisible';
				}
				if (item.ephemeral) {
					if (short_desc) short_desc += ', ';
					if (nice_desc) nice_desc += ', ';
					short_desc += 'Ephemeral';
					nice_desc += 'Ephemeral';
				}
				if (!short_desc) short_desc = '(None)';
				if (!nice_desc) nice_desc = '(None)';
			break;
			
			case 'plugin':
				nice_type = alt_type = 'Plugin';
				nice_desc = this.getNicePlugin(item.plugin_id);
				var plugin = Tools.findObject( this.plugins, { id: item.plugin_id } ) || { title: item.plugin_id };
				short_desc = plugin.title;
			break;
		} // switch item.type
		
		return { nice_type, alt_type, nice_desc, short_desc };
	},
	
	summarizeTimingRange(trigger) {
		// summarize date/time range, or single start/end
		var text = '';
		var tz = trigger.timezone || app.config.tz;
		var opts = this.getDateOptions({
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZone: tz
		});
		var formatter = new Intl.DateTimeFormat(opts.locale, opts);
		
		if (trigger.start && trigger.end) {
			// full range
			text = formatter.formatRange( new Date(trigger.start * 1000), new Date(trigger.end * 1000) );
		}
		else if (trigger.start) {
			// start only
			text = "Start on " + formatter.format( new Date(trigger.start * 1000) );
		}
		else if (trigger.end) {
			// end only
			text = "End on " + formatter.format( new Date(trigger.end * 1000) );
		}
		else return "n/a";
		
		// show timezone if it differs from user's current
		var ropts = Intl.DateTimeFormat().resolvedOptions();
		var user_tz = ropts.timeZone;
		if (user_tz != tz) text += ' (' + tz + ')';
		
		return text;
	}
	
}; // exports

function zeroPad(value, len) {
	// Pad a number with zeroes to achieve a desired total length (max 10)
	return ('0000000000' + value).slice(0 - len);
};

function get_pretty_int_list(arr, ranges) {
	// compose int array to string using commas + spaces, and
	// the english "and" to group the final two elements.
	// also detect sequences and collapse those into dashed ranges
	if (!arr || !arr.length) return '';
	if (arr.length == 1) return arr[0].toString();
	arr = Tools.copyHash(arr, true).sort( function(a, b) { return a - b; } );
	
	// check for ranges and collapse them
	if (ranges) {
		var groups = [];
		var group = [];
		for (var idx = 0, len = arr.length; idx < len; idx++) {
			var elem = arr[idx];
			if (!group.length || (elem == group[group.length - 1] + 1)) group.push(elem);
			else { groups.push(group); group = [elem]; }
		}
		if (group.length) groups.push(group);
		arr = [];
		for (var idx = 0, len = groups.length; idx < len; idx++) {
			var group = groups[idx];
			if (group.length == 1) arr.push( group[0] );
			else if (group.length == 2) {
				arr.push( group[0] );
				arr.push( group[1] );
			}
			else {
				arr.push( group[0] + ' - ' + group[group.length - 1] );
			}
		}
	} // ranges
	
	if (arr.length == 1) return arr[0].toString();
	return arr.slice(0, arr.length - 1).join(', ') + ' and ' + arr[ arr.length - 1 ];
}

function get_pretty_str_list(arr) {
	// compose string array to string using commas + spaces, and
	// the english "and" to group the final two elements
	if (!arr || !arr.length) return '';
	if (arr.length == 1) return arr[0].toString();
	return arr.slice(0, arr.length - 1).join(', ') + ' and ' + arr[ arr.length - 1 ];
}

function format_ordinal(num) {
	// keep English ordinal suffixes, but localize digits
	var date_opts = app.getDateOptions();
	var num_fmt = new Intl.NumberFormat(date_opts.locale, { useGrouping: false, numberingSystem: date_opts.numberingSystem });
	var suffix = 'th';
	if ((num % 100 < 11) || (num % 100 > 13)) {
		switch (num % 10) {
			case 1: suffix = 'st'; break;
			case 2: suffix = 'nd'; break;
			case 3: suffix = 'rd'; break;
		}
	}
	return num_fmt.format(num) + suffix;
};

function summarize_event_timings(event) {
	// summarize all event triggers from event into human-readable string
	// separate schedule items and options
	var triggers = event.triggers.filter( function(trigger) { return trigger.enabled; } );
	var schedules = triggers.filter( function(trigger) { return !!(trigger.type || '').match(/^(schedule|interval|single|startup|magic|keyboard)$/); } );
	var parts = (schedules.length == 1) ? [summarize_event_timing(schedules[0])] : schedules.map( summarize_event_timing );
	if (!parts.length) {
		if (Tools.findObject(triggers, { type: 'manual', enabled: true })) return "On Demand";
		else return "Disabled";
	}
	// var summary = (parts.length == 1) ? parts[0] : (parts.slice(0, parts.length - 1).join(', ') + ', and ' + parts[ parts.length - 1 ]);
	var summary = parts.join(', ');
	
	var opts = [];
	triggers.forEach( function(trigger) {
		switch (trigger.type) {
			case 'catchup': opts.push("Catch-Up"); break;
			case 'nth': 
				if (trigger.every > 1) opts.push("Every " + format_ordinal(trigger.every)); 
			break;
			case 'range': opts.push("Date Range"); break;
			case 'blackout': opts.push("Blackout"); break;
			case 'delay': opts.push("Delay"); break;
			case 'precision': opts.push("Precision"); break;
			case 'quiet': opts.push("Quiet"); break;
			case 'plugin':
				var plugin = Tools.findObject( app.plugins, { id: trigger.plugin_id } );
				if (plugin) opts.push(plugin.title);
				else opts.push("Plugin");
			break;
		}
	} );
	var unique_opts = [...new Set(opts)];
	if (unique_opts.length) summary += ' (' + unique_opts.join(', ') + ')';
	
	return summary;
}

function summarize_event_timing(trigger, idx) {
	// summarize event trigger into human-readable string
	if (trigger.type == 'startup') return "On Startup";
	if (trigger.type == 'plugin') return "Plugin";
	if (trigger.type == 'magic') return "Magic";
	if (trigger.type == 'keyboard') return "Keyboard";
	if (trigger.type == 'single') {
		var text = app.getNiceDateTime(trigger.epoch);
		return text;
	} // single shot
	
	if (trigger.type == 'interval') {
		return "Every " + Tools.getTextFromSeconds(trigger.duration, false, false);
	}
	
	// years
	var year_str = '';
	var date_opts = app.getDateOptions({ timeZone: 'UTC' });
	var locale = date_opts.locale;
	var lang = (locale || '').split(/\-/)[0];
	var is_english = (lang == 'en');
	var numbering = date_opts.numberingSystem;
	
	function build_formatter(extra) {
		var opts = Object.assign({}, date_opts, extra);
		var loc = opts.locale;
		delete opts.locale;
		return new Intl.DateTimeFormat(loc, opts);
	}
	var month_fmt = build_formatter({ month: 'long' });
	var wday_fmt = build_formatter({ weekday: 'long' });
	var hour_fmt = build_formatter({ hour: 'numeric' });
	var hm_fmt = build_formatter({ hour: 'numeric', minute: '2-digit' });
	var num_fmt = new Intl.NumberFormat(locale, { useGrouping: false, numberingSystem: numbering });
	var num2_fmt = new Intl.NumberFormat(locale, { useGrouping: false, numberingSystem: numbering, minimumIntegerDigits: 2 });
	
	function format_number(num, min_digits) {
		return (min_digits ? num2_fmt : num_fmt).format(num);
	}
	function format_ord(num) {
		// keep English ordinal suffixes, but localize digits
		var suffix = 'th';
		if ((num % 100 < 11) || (num % 100 > 13)) {
			switch (num % 10) {
				case 1: suffix = 'st'; break;
				case 2: suffix = 'nd'; break;
				case 3: suffix = 'rd'; break;
			}
		}
		return format_number(num) + suffix;
	}
	function format_month_name(num) {
		return month_fmt.format( new Date(Date.UTC(2020, num - 1, 1)) );
	}
	function format_weekday_name(num) {
		return wday_fmt.format( new Date(Date.UTC(2020, 7, 2 + num)) );
	}
	function normalize_time_label(text) {
		if (!is_english) return text;
		return text.replace(/\s+/g, '').replace(/am|pm/i, function(m_all) { return m_all.toLowerCase(); });
	}
	function format_hour_name(num) {
		return normalize_time_label( hour_fmt.format( new Date(Date.UTC(2020, 0, 1, num, 0)) ) );
	}
	function format_time_name(hour, minute) {
		return normalize_time_label( hm_fmt.format( new Date(Date.UTC(2020, 0, 1, hour, minute)) ) );
	}
	function format_weekday_label(num) {
		var name = format_weekday_name(num);
		return is_english ? (name + 's') : name;
	}
	function format_month_day(num) {
		if (num < 0) {
			if (num == -1) return 'last day';
			return format_ord(Math.abs(num)) + ' last day';
		}
		return format_ord(num);
	}
	function format_minute_label(num) {
		if (num == 0) return 'hour';
		if (num == 30) return 'half-hour';
		return ':' + format_number(num, 2);
	}
	
	if (trigger.years && trigger.years.length) {
		year_str = get_pretty_int_list(trigger.years, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return format_number( parseInt(m_g1) );
		});
	}
	
	// months
	var mon_str = '';
	if (trigger.months && trigger.months.length) {
		mon_str = get_pretty_int_list(trigger.months, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return format_month_name( parseInt(m_g1) );
		});
	}
	
	// days
	var mday_str = '';
	if (trigger.days && trigger.days.length) {
		mday_str = get_pretty_int_list(trigger.days, true).replace(/(\-?\d+)/g, function(m_all, m_g1) {
			return format_month_day( parseInt(m_g1) );
		});
	}
	
	// weekdays	
	var wday_str = '';
	if (trigger.weekdays && trigger.weekdays.length) {
		var wdays = Tools.copyHash(trigger.weekdays, true).sort( function(a, b) { return a - b; } );
		if ((wdays.length == 5) && (wdays[0] == 1) && (wdays[4] == 5)) {
			wday_str = 'weekdays';
		}
		else {
			wday_str = get_pretty_int_list(wdays, true).replace(/(\d+)/g, function(m_all, m_g1) {
				return format_weekday_label( parseInt(m_g1) );
			});
		}
	}
	
	// hours
	var hour_str = '';
	if (trigger.hours && trigger.hours.length) {
		hour_str = get_pretty_int_list(trigger.hours, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return format_hour_name( parseInt(m_g1) );
		});
	}
	
	// minutes
	var min_str = '';
	if (trigger.minutes && trigger.minutes.length) {
		var mins = Tools.copyHash(trigger.minutes, true).sort( function(a, b) { return a - b; } );
		min_str = get_pretty_str_list( mins.map( function(min) { return format_minute_label(min); } ) );
	}
	
	// construct final string
	var groups = [];
	var mday_compressed = false;
	
	if (year_str) {
		groups.push( 'in ' + year_str );
		if (mon_str) groups.push( mon_str );
	}
	else if (mon_str) {
		// compress single month + single day
		if (trigger.months && trigger.months.length == 1 && trigger.days && trigger.days.length == 1) {
			groups.push( 'on ' + mon_str + ' ' + mday_str );
			mday_compressed = true;
		}
		else {
			groups.push( 'in ' + mon_str );
		}
	}
	
	if (mday_str && !mday_compressed) {
		if (mon_str || wday_str) groups.push( 'on the ' + mday_str );
		else groups.push( 'monthly on the ' + mday_str );
	}
	if (wday_str) groups.push( 'on ' + wday_str );
	
	// compress single hour + single minute
	if (trigger.hours && trigger.hours.length == 1 && trigger.minutes && trigger.minutes.length == 1) {
		var new_str = format_time_name(trigger.hours[0], trigger.minutes[0]);
		
		if (mday_str || wday_str) groups.push( 'at ' + new_str );
		else groups.push( 'daily at ' + new_str );
	}
	else {
		var min_added = false;
		if (hour_str) {
			if (mday_str || wday_str) groups.push( 'at ' + hour_str );
			else groups.push( 'daily at ' + hour_str );
		}
		else {
			// check for repeating minute pattern
			if (trigger.minutes && trigger.minutes.length) {
				var interval = detect_num_interval( trigger.minutes, 60 );
				if (interval) {
					var new_str = 'every ' + interval + ' minutes';
					if (trigger.minutes[0] > 0) {
						new_str += ' starting on the :' + format_number(trigger.minutes[0], 2);
					}
					groups.push( new_str );
					min_added = true;
				}
			}
			
			if (!min_added) {
				if (min_str) groups.push( 'hourly' );
			}
		}
		
		if (!min_added) {
			if (min_str) groups.push( 'on the ' + min_str );
			else groups.push( 'every minute' );
		}
	}
	
	var text = (typeof(idx) != 'undefined') ? groups.join(' ') : groups.join(', ');
	var output = text;
	if (!idx) output = text.substring(0, 1).toUpperCase() + text.substring(1, text.length);
	var timing_tz = trigger.timezone || app.config.tz;
	var user_tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (timing_tz && user_tz && (timing_tz != user_tz)) output += ' (' + timing_tz + ')';
	
	return output;
};

function detect_num_interval(arr, max) {
	// detect interval between array elements, return if found
	// all elements must have same interval between them
	if (arr.length < 2) return false;
	// if (arr[0] > 0) return false;
	
	var interval = arr[1] - arr[0];
	for (var idx = 1, len = arr.length; idx < len; idx++) {
		var temp = arr[idx] - arr[idx - 1];
		if (temp != interval) return false;
	}
	
	// if max is provided, final element + interval must equal max
	// if (max && (arr[arr.length - 1] + interval != max)) return false;
	if (max && ((arr[arr.length - 1] + interval) % max != arr[0])) return false;
	
	return interval;
};
