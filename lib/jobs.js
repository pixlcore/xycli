// Job Search Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;
const chalk = cli.chalk;

module.exports = {

	async cmd_jobs() {
		// alias for cmd_search_jobs
		await this.cmd_search_jobs();
	},
	
	async cmd_job() {
		// router, e.g. `xy job ID`
		var cmd = this.args.other.shift();
		switch (cmd) {
			case 'search': await this.cmd_search_jobs(); break;
			case 'get': await this.cmd_get_job(); break;
			case 'log': await this.cmd_get_job_log(); break;
			case 'stream': await this.cmd_stream_job(); break;
			
			case 'run': await this.cmd_run_job_again(); break;
			case 'resume': await this.cmd_resume_job(); break;
			case 'abort': await this.cmd_abort_job(); break;
			case 'delete': await this.cmd_delete_job(); break;
			
			default: 
				// assume cmd_get_job, and arg was the id
				this.args.other.unshift(cmd);
				await this.cmd_get_job();
			break;
		} // switch cmd
	},
	
	async cmd_search_jobs() {
		// search completed jobs
		this.prepSearchArgs();
		await this.getMultiple();
		
		// args become search criteria, other[0] becomes raw query
		if (this.args.other.length) this.args.query = this.args.other.join(' ');
		delete this.args.other;
		var is_filtered = !!Tools.firstKey(this.args);
		
		// active jobs
		if (!is_filtered) this.printActiveJobs({
			rows: Object.values(this.activeJobs).sort( function(a, b) {
				// keep workflow parent jobs directly above their sub-jobs
				if (b.workflow && (b.workflow.job == a.id)) return -1;
				if (a.workflow && (a.workflow.job == b.id)) return 1;
				return (a.started < b.started) ? 1 : -1;
			} ) 
		});
		
		// upcoming jobs
		if (this.args.upcoming || (this.args.query === "upcoming")) {
			await this.printUpcomingJobs();
			return;
		}
		
		// job search
		if (this.args.event) {
			var event = this.findObjectFuzzy( this.events, { id: this.args.event, title: this.args.event }, 1 );
			if (!event) return this.die("Could not find event based on your criteria: " + this.args.event);
			this.args.event = event.id;
		}
		if (this.args.category) {
			var category = this.findObjectFuzzy( this.categories, { id: this.args.category, title: this.args.category }, 1 );
			if (!category) return this.die("Could not find category based on your criteria: " + this.args.category);
			this.args.category = category.id;
		}
		if (this.args.plugin && !this.args.plugin.match(/^_/)) {
			var plugin = this.findObjectFuzzy( this.plugins, { id: this.args.plugin, title: this.args.plugin }, 1 );
			if (!plugin) return this.die("Could not find plugin based on your criteria: " + this.args.plugin);
			this.args.plugin = plugin.id;
		}
		if (this.args.server) {
			var server = this.findObjectFuzzy( Object.values(this.servers), { id: this.args.server, title: this.args.server, hostname: this.args.server, ip: this.args.server }, 1 );
			if (!server) return this.die("Could not find server based on your criteria: " + this.args.server);
			this.args.server = server.id;
		}
		if (this.args.group) {
			var group = this.findObjectFuzzy( this.groups, { id: this.args.group, title: this.args.group }, 1 );
			if (!group) return this.die("Could not find group based on your criteria: " + this.args.group);
			this.args.groups = group.id;
			delete this.args.group;
		}
		if (this.args.tag && !this.args.tag.match(/^_/)) {
			var tag = this.findObjectFuzzy( this.tags, { id: this.args.tag, title: this.args.tag }, 1 );
			if (!tag) return this.die("Could not find tag based on your criteria: " + this.args.tag);
			this.args.tags = tag.id;
			delete this.args.tag;
		}
		
		if (this.args.success) {
			this.args.tags = '_success';
			delete this.args.success;
		}
		else if (this.args.error) {
			this.args.tags = '_error';
			delete this.args.error;
		}
		else if (this.args.files) {
			this.args.tags = '_files';
			delete this.args.files;
		}
		
		if (this.args.warning) {
			this.args.code = 'warning';
			delete this.args.warning;
		}
		else if (this.args.critical) {
			this.args.code = 'critical';
			delete this.args.critical;
		}
		else if (this.args.abort) {
			this.args.code = 'abort';
			delete this.args.abort;
		}
		
		if (this.args.workflow || this.args.workflows) {
			this.args.plugin = '_workflow';
			delete this.args.workflow;
			delete this.args.workflows;
		}
		
		var date_range = this.args.date || '';
		delete this.args.date;
		
		var query = this.args.query || '';
		delete this.args.query;
		query += ' ' + Object.keys(this.args).map( key => `${key}:${this.args[key]}` ).join(' ');
		
		// date (keyword or raw expression)
		if (date_range) {
			var criteron = this.getDateRangeQuery('date', date_range) || date_range;
			query += ' ' + criteron;
		}
		
		await this.printCompletedJobs({
			title: is_filtered ? 'Job Search Results' : 'All Completed Jobs',
			query: query.trim()
		});
		
		this.printSuggestedCommands({
			"Show successful jobs": "xy jobs --success",
			"Show failed jobs": "xy jobs --error",
			"Show workflows": "xy jobs --workflows",
			"Specific category": "xy jobs --category ID_OR_TITLE",
			"Completed today": "xy jobs --date today",
			"Job details": "xy job JOB_ID_HERE"
			// "Get help": "xy jobs --help"
		});
	},
	
	async cmd_stream_job() {
		// stream job progress and print result
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");
		
		// load everything
		await this.getMultiple();
		
		// load job directly, as it may be queued (not in AJ)
		var { err, data } = await this.api.getJob({ id: this.args.id, remove: 'timelines' });
		if (err) this.die(err);
		if (!data.job) this.die("Job not found: " + this.args.id);
		var job = data.job;
		
		// check if job is still active
		if (job.final) {
			// job must have completed, hop over to job details
			return await this.cmd_get_job();
		}
		
		// print def list of job summary data
		this.printBoxList({
			title: "Job Summary",
			rows: [
				[ 'Job ID', this.color('theme').bold( this.getNiceJob(job) ) ],
				[ 'Event', this.getNiceJobEvent(job) ],
				[ 'Category', this.getNiceCategory(job.category) + ` ${gray('(' + job.category + ')')}` ],
				[ 'Plugin', this.getNicePlugin(job.plugin) + (job.plugin != '_workflow' ? ` ${gray('(' + job.plugin + ')')}` : '') ],
				(job.type != 'workflow') ? [ 'Targets', this.getNiceTargets(job.targets) ] : null,
				(job.type != 'workflow') ? [ 'Server', this.getNiceServer(job.server) ] : null,
				(job.type != 'workflow') ? [ 'Algorithm', this.getNiceAlgo(job.algo) ] : null,
				[ 'Source', this.getNiceJobSource(job) ],
				(job.workflow && job.workflow.job) ? [ 'Parent Workflow', this.getNiceJob(job.workflow.job) ] : null,
				(job.parent && job.parent.job) ? [ 'Linked Job', this.getNiceJob(job.parent.job) ] : null,
				[ 'Started', this.getRelativeDateTime(job.started, true) ]
			]
		});
		
		// println( "\n " + this.color('theme').bold("Streaming Job: ") + '#' + this.args.id );
		print("\n");
		
		// print meta log up to current
		(job.activity || []).forEach( row => {
			if (!row.msg) return;
			if (!row.server) row.server = 'n/a';
			cli.println( green('[' + String(row.server).replace(/^m:/, '') + '] ') + gray( String(row.msg).trim() ) );
		} );
		
		cli.progress.start();
		var job = {};
		var { err } = await this.api.streamJob({ id: this.args.id, output: true, meta: true }, data => {
			// called repeatedly for each streaming job update
			if ((data.type === 'output') && ('text' in data) && (typeof(data.text) == 'string')) {
				if (!data.text.match(/\n$/)) data.text += "\n";
				cli.print( data.text );
			}
			else if ((data.type === 'meta') && data.row && data.row.msg) {
				if (!data.row.server) data.row.server = 'n/a';
				cli.println( green('[' + String(data.row.server).replace(/^m:/, '') + '] ') + gray( String(data.row.msg).trim() ) );
			}
			else {
				Tools.mergeHashInto( job, data );
				cli.progress.update({
					amount: job.progress || 0,
					text: '[' + (job.status || this.getNiceJobState(job)) + ']'
				});
			}
		});
		if (err) this.die(err);
		cli.progress.end();
		
		verboseln( "\n Stream is complete." );
		
		// this.printJobCompletionBanner(job);
		// delete this.activeJobs[this.args.id];
		await this.cmd_get_job();
	},
	
	async cmd_get_job() {
		// get job progress or result
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");
		
		// load everything
		await this.getMultiple();
		
		// load job data
		var { err, data } = await this.api.getJob({ id: this.args.id, remove: 'timelines' });
		if (err) this.die(err);
		if (!data.job) this.die("Job not found: " + this.args.id);
		var job = data.job;
		
		if (!job.final) {
			// job is still in progress, hop over to cmd_stream_job
			return await this.cmd_stream_job();
		}
		
		if (this.format.match(/json/)) {
			return this.jsonOutput(job);
		}
		
		this.printJobCompletionBanner(job);
		
		// The Job result code may be a number, a string such as "warning", or a
		// falsey success value.  Normalize a missing code to zero for display.
		var result_code = ('code' in job) ? job.code : 0;
		var result_args = this.getJobResultArgs(job);
		var description = job.description || (
			result_code ?
				'Unknown Error (no description provided).' :
				'Job completed successfully.'
		);
		
		// Summarize retry lineage.  retry_count is zero or absent for the initial
		// attempt, and retry_prev points to the immediately preceding attempt.
		var nice_attempt = 'Initial';
		if (job.retry_count) {
			nice_attempt = 'Retry #' + Tools.commify(job.retry_count);
			if (job.retry_prev) {
				nice_attempt += gray(' (Previous: ') +
					this.getNiceJob(job.retry_prev) + gray(')');
			}
		}
		
		// CPU is expressed in percentage points
		var has_cpu = !!(job.cpu && job.cpu.count && ('total' in job.cpu));
		var avg_cpu = has_cpu ?
			Math.round(job.cpu.total / job.cpu.count) : 0;
		
		// Memory samples are expressed in bytes.
		var has_mem = !!(job.mem && job.mem.count && ('total' in job.mem));
		var avg_mem = has_mem ?
			Math.floor(job.mem.total / job.mem.count) : 0;
		
		this.printBoxList({
			title: job.test ? "Test Summary" : "Job Summary",
			rows: [
				[ 'Job ID', this.color('theme').bold(this.getNiceJob(job)) ],
				[ 'Event', this.getNiceJobEvent(job) ],
				[ 'Category', this.getNiceCategory(job.category) + ` ${gray('(' + job.category + ')')}` ],
				[ 'Plugin', this.getNicePlugin(job.plugin) + (job.plugin != '_workflow' ? ` ${gray('(' + job.plugin + ')')}` : '') ],
				[ 'Targets', this.getNiceTargets(job.targets) ],
				job.algo ? [ 'Algorithm', this.getNiceAlgo(job.algo) ] : null,
				job.server ? [ 'Server', this.getNiceServer(job.server) ] : null,
				
				// [ 'Result', this.getNiceJobResult(job) ],
				// [ 'Result Code', this.color(result_args.color).bold(String(result_code)) ],
				// [ 'Description', this.color(result_args.color)(description) ],
				
				[ 'Source', this.getNiceJobSource(job) ],
				(job.workflow && job.workflow.job) ? [ 'Parent Workflow', this.getNiceJob(job.workflow.job) ] : null,
				(job.parent && job.parent.job) ? [ 'Linked Job', this.getNiceJob(job.parent.job) ] : null,
				[ 'Attempt', nice_attempt ],
				
				[ 'Started', this.getRelativeDateTime(job.started, true) ],
				[ 'Completed', this.getRelativeDateTime(job.completed, true) ],
				[ 'Elapsed', this.getNiceJobElapsedTime(job) ],
				
				has_cpu ? [ 'Avg CPU', Tools.pct(avg_cpu, 100) ] : null,
				has_mem ? [ 'Avg Memory', Tools.getTextFromBytes(avg_mem) ] : null,
				(job.type != 'workflow') ? [ 'Job Output', Tools.getTextFromBytes(job.log_file_size || 0) ] : null,
				
				[ 'Tags', this.getNiceTagList(job.tags || []) ]
			]
		});
		
		// workflow jobs
		if (job.type == 'workflow') {
			this.printWorkflowJobs(job);
		}
		
		// actions
		this.printJobActions(job);

		// limits
		this.printJobLimits(job);
		
		// Related alerts, snapshots, and tickets share the requested page settings.
		this.prepSearchArgs();
		
		// alerts
		await this.printAlertInvocations({
			title: 'Alert Invocations',
			query: 'jobs:' + job.id,
			hide_empty: true
		});
		
		// snapshots
		await this.printSnapshots({
			title: 'Server Snapshots',
			query: 'jobs:' + job.id,
			hide_empty: true
		});
		
		// tickets
		await this.printTickets({
			title: 'Job Tickets',
			ids: job.tickets || [],
			hide_empty: true
		});
		
		// additional jobs
		await this.printAdditionalJobs({
			title: 'Additional Jobs',
			jobs: job.jobs || [],
			hide_empty: true
		});
		
		// user params
		this.printParamValues({
			title: `User Parameters`,
			fields: job.fields || [],
			values: job.params || {}
		});
		
		// plugin params
		if (job.type != 'workflow') {
			var plugin = Tools.findObject( this.plugins, { id: job.plugin } ) || { title: "Plugin" };
			this.printParamValues({
				title: `${plugin.title} Parameters`,
				fields: plugin.params || [],
				values: job.params || {}
			});
		}
		
		// user content
		if (job.table && Array.isArray(job.table.header) && Array.isArray(job.table.rows)) {
			var table_header = job.table.header.map( function(value) {
				return (value == null) ? '' : String(value);
			} );
			
			var table_rows = job.table.rows.map( function(row) {
				return row.map( function(value) {
					if (value == null) return '';
					if (typeof(value) == 'object') return JSON.stringify(value);
					return String(value);
				} );
			} );
			
			this.printBoxTable({
				title: job.table.title || 'User Table',
				header: table_header,
				rows: table_rows
			});
			
			if (job.table.caption) {
				println( " " + gray(job.table.caption) );
			}
		} // job.table
		
		// job.html
		if (job.html && job.html.content) {
			println( "\n " + this.color('theme').bold( String( job.html.title || "Custom Content" ).toUpperCase() ) );
			
			this.printNiceHTML( job.html.content );
			
			if (job.table.caption) {
				println( " " + gray(job.table.caption) );
			}
		} // job.html
		
		// perf metrics
		if (job.perf) {
			println( "\n " + this.color('theme').bold( 'PERFORMANCE METRICS' ) );
			var disp_value = JSON.stringify(job.perf, null, "\t").trim().split(/\n/).map( line => '    ' + line ).join("\n");
			println( this.highlight(disp_value, { language: 'json', ignoreIllegals: true }) );
		}
		
		// files
		this.printJobFiles(job);
		
		// data
		this.printJobData( job.input?.data, "Input Data" );
		this.printJobData( job.data, "Output Data" );
		
		// job output
		this.printJobOutput(job);
		
		// meta log
		this.printMetaLog(job);
		
		// suggested commands
		var has_output = !!(job.output || job.log_file_size);
		var has_event = !!(job.event && Tools.findObject(this.events, { id: job.event }));
		
		this.printSuggestedCommands({
			"Show details": this.verbose ? "" : `xy job ${job.id} --verbose`,
			"View job output": has_output ? `xy job log ${job.id}` : "",
			"Download job output": has_output ? `xy job log ${job.id} --download ${job.id}.log` : "",
			"Parent workflow": (job.workflow && job.workflow.job) ? `xy job ${job.workflow.job}` : "",
			"Linked job": (job.parent && job.parent.job) ? `xy job ${job.parent.job}` : "",
			"Previous attempt": job.retry_prev ? `xy job ${job.retry_prev}` : "",
			"Event details": has_event ? `xy event ${job.event}` : "",
			"Run event again": has_event ? `xy run ${job.event}` : ""
		});
	},
	
	async cmd_get_job_log() {
		// print raw job log
		// alias: xy job log JOB_ID
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");
		
		println( "\n " + this.color('theme').bold( 'JOB OUTPUT: #' + this.args.id ) );
		if (this.args.download) println( " " + gray("Downloading to file: ") + this.args.download );
		else println("");
		
		var download = this.args.download || this.getOutputStream();
		var { err } = await this.api.getJobLog({ id: this.args.id }, { download });
		if (err) this.die(err);
		
		if (this.args.download) println( " " + gray("Download complete." ) );
	},
	
	async cmd_run_job_again() {
		// run completed job again
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");
		
		var do_follow = this.args.follow;
		delete this.args.follow;
		
		// load everything
		await this.getMultiple();
		
		// load job data
		var { err, data } = await this.api.getJob({ id: this.args.id, remove: 'timelines' });
		if (err) this.die(err);
		if (!data.job) this.die("Job not found: " + this.args.id);
		var job = data.job;
		
		if (!job.final) this.die("Job is still in progress.");
		if (!job.event) this.die("Cannot rerun adhoc jobs (need to rerun the workflow).");
		
		if (job.workflow && (job.type == 'adhoc')) {
			return this.die("Adhoc workflow jobs cannot run independently.  Please rerun the parent workflow job instead.");
		}
		
		// clense new job of previous running context
		var new_job = Tools.copyHash(job, true);
		for (var key in new_job) {
			if (!key.match(/^(type|event|category|plugin|targets|algo|workflow|input|params|parent|source|username|api_key|icon|label|test|retry_count|tags|now)$/)) delete new_job[key];
		}
		
		// run_event API expects event ID in "id" prop
		new_job.id = job.event;
		
		// locate original event
		var event = Tools.findObject( this.events, { id: job.event } );
		if (!event) this.die("The original event could not be found: " + job.event);
		
		// we must reset actions and limits to the event versions, as inherited ones are added server-side
		new_job.actions = Tools.copyHash( event.actions || [], true );
		new_job.limits = Tools.copyHash( event.limits || [], true );
		
		// remove workflow running context (state, etc.)
		if (new_job.workflow) {
			for (var key in new_job.workflow) {
				if (!key.match(/^(nodes|connections|start)$/)) delete new_job.workflow[key];
			}
			if (!Tools.numKeys(new_job.workflow)) delete new_job.workflow;
		}
		
		// remove system tags from new job
		// FUTURE: tags that were added dynamically during the previous job run will be included in the new job
		new_job.tags = (new_job.tags || []).filter( function(tag) { return !tag.match(/^_/); } );
		
		var data = await this.callStandardAPI('runEvent', new_job, {
			text: 'Running job again...'
		});
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
	
	async cmd_resume_job() {
		// resume suspended job
		// xy job resume JOB_ID --params.foo "bar"
		// xy job resume JOB_ID --input.data.bar "baz"
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");
		delete this.args.other;
		
		// load everything
		await this.getMultiple();
		
		// resolve dot paths in args
		this.mergeDotArgs( this.args, this.args );
		
		// load job directly, as it may be queued (not in AJ)
		var { err, data } = await this.api.getJob({ id: this.args.id, remove: 'timelines' });
		if (err) this.die(err);
		if (!data.job) this.die("Job not found: " + this.args.id);
		var job = data.job;
		
		// check if job is still active
		if (job.final) this.die("Job is already completed.");
		if (!job.suspended) this.die("Job is not currently suspended.");
		
		var data = await this.callStandardAPI('resumeJob', this.args, {
			text: 'Resuming job...'
		});
		if (this.dry) return;
		
		this.toast('✅', 'green', "Successfully resumed job: #" + this.args.id );
	},
	
	async cmd_abort_job() {
		// abort active job
		// xy job abort JOB_ID
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");
		delete this.args.other;
		
		// load everything
		await this.getMultiple();
		
		// load job directly, as it may be queued (not in AJ)
		var { err, data } = await this.api.getJob({ id: this.args.id, remove: 'timelines' });
		if (err) this.die(err);
		if (!data.job) this.die("Job not found: " + this.args.id);
		var job = data.job;
		
		// check if job is still active
		if (job.final) this.die("Job is already completed.");
		
		this.printMutationSummary({
			title: 'Abort Job',
			rows: [
				[ 'Job ID', this.color('theme').bold(this.getNiceJob(job)) ],
				[ 'Event', this.getNiceJobEvent(job) ]
			]
		});
		
		var data = await this.callStandardAPI('abortJob', this.args, {
			text: 'Aborting job...'
		});
		if (this.dry) return;
		
		this.toast('✅', 'green', "Successfully aborted job: #" + this.args.id );
	},
	
	async cmd_delete_job() {
		// delete completed job
		// xy job delete JOB_ID --confirm
		if (this.args.other && this.args.other.length && !this.args.id) {
			this.args.id = this.args.other.shift();
		}
		if (!this.args.id) this.die("Missing required 'id' argument.");
		delete this.args.other;
		
		// load everything
		await this.getMultiple();
		
		// load job directly
		var { err, data } = await this.api.getJob({ id: this.args.id, remove: 'timelines' });
		if (err) this.die(err);
		if (!data.job) this.die("Job not found: " + this.args.id);
		var job = data.job;
		
		// check if job is still active
		if (!job.final) this.die("Cannot delete active job.");
		
		this.printMutationSummary({
			title: 'Delete Job',
			rows: [
				[ 'Job ID', this.color('theme').bold(this.getNiceJob(job)) ],
				[ 'Event', this.getNiceJobEvent(job) ]
			]
		});
		if (this.args.confirm !== true) {
			this.toast('⚠️', 'orange', "Please confirm the delete by adding '--confirm'.");
			return;
		}
		delete this.args.confirm;
		
		var data = await this.callStandardAPI('deleteJob', this.args, {
			text: 'Deleting job...'
		});
		if (this.dry) return;
		
		this.toast('✅', 'green', "Successfully deleted job: #" + this.args.id );
	},
	
	printJobData(data, title) {
		// print job input or output data in verbose mode
		if (!data) return;
		
		println( "\n " + this.color('theme').bold( String(title).toUpperCase() ) );
		if (!this.verbose) {
			println( " " + gray("(Shown in verbose mode)") );
			return;
		}
		
		var disp_value = JSON.stringify(data, null, "\t").trim().split(/\n/).map( line => '    ' + line ).join("\n");
		println( this.highlight(disp_value, { language: 'json', ignoreIllegals: true }) );
	},
	
	printJobOutput(job) {
		// print job output in verbose mode
		if (!job.output && !job.log_file_size) return; // zero output
		
		println( "\n " + this.color('theme').bold( 'JOB OUTPUT (' + Tools.getTextFromBytes(job.log_file_size) + ')' ) );
		
		if (!job.output && job.log_file_size) {
			// too large, requires separate API call
			println( " " + gray("View using: ") + bold("xy job log " + this.args.id) );
			return;
		}
		
		if (!this.verbose) {
			println( " " + gray("(Shown in verbose mode)") );
			return;
		}
		
		println( "\n" + job.output.trim() );
	},
	
	printMetaLog(job) {
		// Print the chronological job metadata activity log.
		var activity = job.activity || [];
		if (!activity.length) return;
		
		var is_workflow = (job.type == 'workflow');
		var title = is_workflow ? 'WORKFLOW LOG' : 'METADATA LOG';
		
		// Keep potentially noisy metadata behind verbose mode.
		if (!this.verbose) {
			println( "\n " + this.color('theme').bold(title) );
			println( " " + gray("(Shown in verbose mode)") );
			return;
		}
		
		var rows = activity.map( row => {
			var nice_timestamp = row.epoch ? this.getRelativeDateTime(row.epoch, true) : '-';
			var nice_server = '-';
			
			if (row.server) {
				var server_id = String(row.server);
				
				// Conductor rows use the special "m:hostname" notation.
				if (server_id.match(/^\w+$/)) nice_server = this.getNiceServer(server_id);
				else nice_server = server_id.replace(/^m\:/, '');
			}
			else if (row.username) {
				nice_server = row.username;
			}
			
			// Meta-log messages should be single-line table cells.
			var message = String(row.msg || '').replace(/\s+/g, ' ').trim();
			var is_warning = message.match(/^WARNING\:/);
			
			// Match the web UI by highlighting IDs and state names.
			var nice_message = message
				.replace(/\#(\w+)/g, function(match) {
					return cyan.bold(match);
				})
				.replace(/\{(.+?)\}/g, function(match, state) {
					return cyan(state);
				});
			
			if (is_warning) {
				nice_message = nice_message.replace(/^WARNING\:/, yellow.bold('WARNING:'));
			}
			
			if (!is_workflow) {
				return [
					nice_timestamp,
					nice_server,
					nice_message
				];
			}
			
			// Workflow meta rows may also identify the associated node.
			var nice_node_id = '-';
			var nice_node_type = '-';
			
			if (row.node) {
				nice_node_id = gray('#' + row.node);
				
				var workflow = job.workflow || {};
				var nodes = workflow.nodes || [];
				var node = Tools.findObject( nodes, { id: row.node } );
				
				if (node) {
					var node_types = (this.config.ui && this.config.ui.workflow_node_types) || [];
					var type_def = Tools.findObject( node_types, { id: node.type } );
					
					nice_node_type = type_def ? type_def.title : Tools.ucfirst(node.type || 'Unknown');
				}
			}
			
			return [
				nice_timestamp,
				nice_server,
				nice_node_id,
				nice_node_type,
				nice_message
			];
		} );
		
		this.printBoxTable({
			title: title,
			header: is_workflow ? [ 'Date / Time', 'Server', 'Node ID', 'Type', 'Message' ] : [ 'Date / Time', 'Server', 'Message' ],
			rows: rows
		});
	},
	
	async printAdditionalJobs(opts) {
		// print additional jobs for job (with reason column)
		if (!opts) opts = {};
		
		var rows = [];
		var list = { length: 0 };
		
		if (!opts.jobs || !opts.jobs.length) return;
		var ids = opts.jobs.map( stub => stub.id );
		
		cli.progress.start();
		var { err, data } = await this.api.getJobs({
			ids: ids
		});
		if (err) this.die(err);
		cli.progress.end();
		
		var rows = data.jobs || [];
		list = { length: rows.length };
		
		// Embedded detail screens should omit the section when there are no associated tickets.
		if (opts.hide_empty && !rows.length) return;
		
		rows.forEach( function(row, idx) {
			row.reason = opts.jobs[idx].reason;
		} );
		
		opts.title = opts.title || 'Additional Jobs';
		opts.header = [ 'Job ID', 'Reason', 'Event', 'Category', 'Plugin', 'Server', 'Result' ];
		opts.rows = rows.map( job => {
			if (!job) return false;
			return [
				this.color('theme').bold( this.getNiceJob(job) ),
				Tools.ucfirst(job.reason),
				this.getNiceJobEvent(job, true),
				this.getNiceCategory(job.category, true),
				this.getNicePlugin(job.plugin, true),
				this.getNiceServer(job.server, true),
				// this.getNiceJobSource(job),
				// this.getNiceTagList( job.tags, false ),
				// this.getRelativeDateTime( job.completed, true ),
				// this.getNiceJobElapsedTime(job, true, true),
				this.getNiceJobResult(job)
			];
		} );
		opts.list = list;
		
		this.printBoxTable(opts);
	},
	
	printJobCompletionBanner(job) {
		// print toast for job completion
		var disp = this.getJobResultArgs(job);
		
		if (job.code) {
			if (!job.description) job.description = 'Unknown Error (no description provided).';
		}
		else {
			if (!job.description) job.description = 'Job completed successfully.';
		}
		
		this.toast(disp.icon, disp.color, job.description );
	},
	
	printWorkflowJobs(job) {
		// Render all completed sub-jobs and controller nodes belonging to a completed workflow.
		var workflow = job.workflow || {};
		var nodes = workflow.nodes || [];
		var states = workflow.state || {};
		var workflow_jobs = workflow.jobs || {};
		var items = [];
		
		// Controller nodes do not launch real jobs, so construct synthetic rows from their workflow state.
		nodes.filter( node => node.type == 'controller' ).forEach( function(node) {
			var state = states[node.id];
			if (!state || !state.started) return;
			if (!state.completed && !state.error) return;
			
			items.push({
				type: 'controller',
				node: node,
				state: state,
				sort_epoch: state.started // for table sort
			});
		} );
		
		// Reconstruct job-compatible objects from the compact completed-job stubs.
		// Each workflow node may have launched multiple jobs.
		for (var node_id in workflow_jobs) {
			var node = Tools.findObject( nodes, { id: node_id } );
			if (!node) continue;
			
			var node_data = node.data || {};
			var event = node_data.event ?
				Tools.findObject( this.events, { id: node_data.event } ) : null;
			
			(workflow_jobs[node_id] || []).forEach( function(job_stub) {
				var sub_job = {
					...job_stub,
					state: 'complete',
					final: true,
					workflow: {
						node: node_id,
						job: job.id
					}
				};
				
				if (event) {
					// Standard event node.
					sub_job.event = event.id;
					sub_job.category = event.category;
					sub_job.plugin = event.plugin;
					sub_job.type = event.type;
					sub_job.plabel = node_data.label;
				}
				else {
					// Ad-hoc job node.
					sub_job.type = 'adhoc';
					sub_job.category = node_data.category;
					sub_job.plugin = node_data.plugin;
					sub_job.plabel = node_data.label;
					sub_job.picon = node_data.icon;
				}
				
				items.push({
					type: 'job',
					job: sub_job,
					sort_epoch: sub_job.completed || 0
				});
			} );
		}
		
		// Match the web UI by displaying completed workflow activity in chronological order.
		items.sort( function(a, b) {
			return a.sort_epoch - b.sort_epoch;
		} );
		
		var rows = items.map( item => {
			if (item.type == 'controller') {
				var node = item.node;
				var state = item.state;
				var node_data = node.data || {};
				var controller_id = node_data.controller || 'controller';
				var controller_menu = (this.config.ui && this.config.ui.workflow_controller_type_menu) || [];
				var controller_def = Tools.findObject( controller_menu, { id: controller_id } ) || { title: Tools.ucfirst(controller_id) };
				
				// Failed controller states do not currently receive a completed
				// timestamp, so use the parent workflow completion as their end.
				var completed = state.completed || job.completed || this.epoch;
				var elapsed = this.getNiceJobElapsedTime({
					started: state.started,
					completed: completed
				});
				
				var result = state.error ?
					this.color('red').bold('Error') :
					this.color('blue').bold('Complete');
				
				return [
					this.color('theme').bold(this.getNiceWorkflowNode(node)),
					controller_def.title,
					gray('(Controller)'),
					'-',
					result,
					elapsed
				];
			} // controller
			
			var sub_job = item.job;
			var result = sub_job.deleted ?
				gray('Deleted (' + this.getJobResultArgs(sub_job).text + ')') :
				this.getNiceJobResult(sub_job);
			
			return [
				this.color('theme').bold(this.getNiceJob(sub_job)),
				this.getNiceJobEvent(sub_job),
				this.getNiceCategory(sub_job.category),
				this.getNiceServer(sub_job.server),
				result,
				this.getNiceJobElapsedTime(sub_job)
			];
		} ); // foreach row
		
		this.printBoxTable({
			title: 'Workflow Jobs',
			header: [
				'Job / Node ID',
				'Event / Plugin',
				'Category',
				'Server',
				'Result',
				'Elapsed'
			],
			rows: rows
		});
	},
	
	printJobFiles(job) {
		// Combine input and output files into one table, while preserving their source.
		var files = [];
		
		if (job.input && job.input.files) {
			files = files.concat( job.input.files.map( function(file) {
				return { ...file, source: 'input' };
			} ) );
		}
		
		if (job.files) {
			files = files.concat( job.files.map( function(file) {
				return { ...file, source: 'output' };
			} ) );
		}
		
		// Match the web UI by omitting malformed or incomplete file records.
		files = files.filter( function(file) {
			return !!file.filename;
		} );
		
		// The web UI hides the entire section when the job has no files.
		if (!files.length) return;
		
		var rows = files.map( file => {
			var nice_source = '';
			
			if (file.source == 'input') {
				if (file.bucket) nice_source = this.getNiceBucket(file.bucket);
				else if (file.plugin) nice_source = this.getNicePlugin(file.plugin);
				else if (file.ticket) nice_source = 'Ticket ' + file.ticket;
				else if (file.magic) nice_source = 'Magic Link';
				else if (file.username) nice_source = file.username;
				else nice_source = 'Input';
			}
			else {
				nice_source = 'Output';
			}
			
			return [
				cli.emoji('📄') + ' ' + bold(file.filename),
				Tools.getTextFromBytes(file.size || 0),
				file.date ? this.getRelativeDateTime(file.date, true) : gray('(Unknown)'),
				nice_source,
				this.getNiceJob({ id: file.job || job.id }),
				file.server ? this.getNiceServer(file.server) : gray('(None)')
			];
		} );
		
		this.printBoxTable({
			title: 'Job Files',
			header: [ 'Filename', 'Size', 'Modified', 'Source', 'Job', 'Server' ],
			rows: rows
		});
		
		// In verbose mode, print full file URLs beneath the table.
		if (this.verbose) {
			var base_url = String(this.config.base_url || '').replace(/\/+$/, '');
			
			var linked_files = files.filter( function(file) {
				return !!file.path;
			} );
			
			if (linked_files.length) {
				println( "\n " + this.color('theme').bold('FILE URLS') );
				
				linked_files.forEach( function(file) {
					var file_path = String(file.path).replace(/^\/+/, '');
					var url = base_url + '/' + file_path;
					
					println( ' - ' + url );
				} );
			}
		}
	},
	
	getNiceWorkflowNode(node) {
		// Get a terminal-friendly icon for any workflow node type.
		if (!node) return '(None)';
		
		var node_icons = {
			trigger: '🚀',
			event: '📅',
			job: '🔌',
			action: '⚡',
			limit: '🚧',
			controller: '🎛️',
			note: '📝'
		};
		
		// Controller nodes get more specific icons based on their behavior.
		var controller_icons = {
			decision: '❓',
			join: '🔗',
			multiplex: '📡',
			repeat: '🔁',
			split: '🔀',
			wait: '⏳'
		};
		
		var icon = node_icons[node.type] || '🧩';
		
		if (node.type == 'controller') {
			var controller_type = node.data && node.data.controller;
			icon = controller_icons[controller_type] || icon;
		}
		
		return cli.emoji(icon) + ' ' + (node.id || '(Unknown)');
	},
	
	printJobActions(job) {
		// Only display actions that actually fired and are not hidden.
		var actions = (job.actions || []).filter( function(action) {
			return !!(action.date && !action.hidden);
		} );
		
		var workflow = job.workflow;
		
		// Workflow action nodes store their execution results in the workflow
		// state object instead of the parent job's normal actions array.
		if (workflow && workflow.state && workflow.nodes) {
			workflow.nodes.filter( function(node) {
				return node.type == 'action';
			} ).forEach( function(node) {
				var state = workflow.state[node.id];
				if (!state || !state.date) return;
				
				// Copy the state so we do not mutate the original job object.
				actions.push({
					...state,
					source: 'workflow'
				});
			} );
		}
		
		// Match the web UI by displaying actions chronologically.
		actions.sort( function(a, b) {
			return a.date - b.date;
		} );
		
		// The web UI hides this entire section when no actions fired.
		if (!actions.length) return;
		
		var rows = actions.map( item => {
			var disp = this.getJobActionDisplayArgs(item);
			var source = String(item.source || 'event').toLowerCase();
			var nice_source =  Tools.ucfirst(source);
			
			if (item.count > 1) {
				nice_source += ' (x' + Tools.commify(item.count) + ')';
			}
			
			// Preserve millisecond precision for quick actions, then switch to the
			// normal duration formatter for actions lasting one second or longer.
			var elapsed_ms = Math.max(0, Math.floor(item.elapsed_ms || 0));
			var nice_elapsed = (elapsed_ms < 1000) ?
				Tools.commify(elapsed_ms) + ' ms' :
				Tools.getTextFromSeconds(elapsed_ms / 1000, true, true);
			
			var nice_result = '';
			if (item.code) {
				nice_result =
					cli.emoji('🛑') + ' ' + this.color('red').bold('Error');
				
				// The web UI puts this behind a details link.  Show it inline in
				// the CLI so an action failure remains immediately actionable.
				if (item.description) {
					var error_text = String(item.description)
						.replace(/\s+/g, ' ')
						.trim();
					
					nice_result += gray(' (' + error_text + ')');
				}
			}
			else {
				nice_result =
					cli.emoji('✅') + ' ' + this.color('green').bold('Success');
			}
			
			return [
				this.color(disp.condition.color).bold(disp.condition.title),
				(disp.type || Tools.ucfirst(item.type || 'Unknown')),
				nice_source,
				disp.desc || 'n/a',
				this.getRelativeDateTime(item.date, true),
				nice_result,
				nice_elapsed
			];
		} );
		
		this.printBoxTable({
			title: 'Job Actions',
			header: [
				'Condition',
				'Type',
				'Source',
				'Description',
				'Date / Time',
				'Result',
				'Elapsed'
			],
			rows: rows
		});
	},
		
	printJobLimits(job) {
		// Only display limits that actually triggered and are not hidden.
		var limits = (job.limits || []).filter( function(limit) {
			return !!(limit.date && !limit.hidden);
		} );
		
		// The web UI hides this entire section when no limits were exceeded.
		if (!limits.length) return;
		
		// Limits should normally already be chronological, but explicitly sort
		// them in case their configuration order differs from trigger order.
		limits.sort( function(a, b) {
			return a.date - b.date;
		} );
		
		var rows = limits.map( item => {
			var disp = this.getResLimitDisplayArgs(item);
			var source = String(item.source || 'event').toLowerCase();
			var nice_type = (disp.nice_title || Tools.ucfirst(item.type || 'Unknown'));
			var nice_source = Tools.ucfirst(source);
			
			// The triggered-limit message describes what was actually exceeded.
			// Fall back to the configured limit description for older records.
			var nice_description =
				item.msg || disp.nice_desc || 'n/a';
			
			var nice_result = '';
			if (item.code) {
				nice_result =
					cli.emoji('🛑') + ' ' + this.color('red').bold('Error');
				
				if (item.description) {
					var error_text = String(item.description)
						.replace(/\s+/g, ' ')
						.trim();
					
					nice_result += gray(' (' + error_text + ')');
				}
			}
			else {
				nice_result =
					cli.emoji('✅') + ' ' + this.color('green').bold('OK');
			}
			
			return [
				this.color('theme').bold(nice_type),
				nice_source,
				nice_description,
				this.getRelativeDateTime(item.date, true),
				nice_result
			];
		} );
		
		this.printBoxTable({
			title: 'Job Limits Exceeded',
			header: [
				'Limit Type',
				'Source',
				'Description',
				'Date / Time',
				'Result'
			],
			rows: rows
		});
	}
	
};
