// Dashboard Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;
const chalk = cli.chalk;

module.exports = {
	
	async cmd_dashboard() {
		// show dashboard
		await this.getMultiple();
		
		var stats = this.stats;
		var day = stats.currentDay || { transactions: {} };
		var trans = day.transactions || {};
		
		// calculate total CPU usage
		var total_cpu = 0;
		
		// add CPU for all active jobs (avg)
		for (var job_id in this.activeJobs) {
			var job = this.activeJobs[job_id];
			if (job.cpu && job.cpu.total && job.cpu.count) {
				total_cpu += job.cpu.total / job.cpu.count;
			}
		}
		
		// calculate total memory usage
		var total_mem = 0;
		
		// add mem for all jobs (avg)
		for (var job_id in this.activeJobs) {
			var job = this.activeJobs[job_id];
			if (job.mem && job.mem.total && job.mem.count) {
				total_mem += job.mem.total / job.mem.count;
			}
		}
		
		println( "\n " + this.color('theme').bold("MAIN DASHBOARD") );
		println( "" + dashGrid([
			[ "Conductors", Tools.numKeys(this.masters) ],
			[ "Servers", Tools.numKeys(this.servers) ],
			[ "Current Alerts", Tools.numKeys(this.activeAlerts) ],
			[ "Active Jobs", Tools.numKeys(this.activeJobs) ],
			[ "Jobs Today", Tools.commify(trans.job_complete || 0) ],
			[ "Jobs Failed Today", Tools.commify(trans.job_error || 0) ],
			[ "Job Success Rate", Tools.pct( (trans.job_success || 0) / (trans.job_complete || 1) ) ],
			[ "Avg Job Elapsed", Tools.getTextFromSeconds( Math.round( (trans.job_elapsed || 0) / (trans.job_complete || 1) ), true, true ) ],
			[ "Avg Job Output", Tools.getTextFromBytes( Math.round( (trans.job_log_file_size || 0) / (trans.job_complete || 1) ) ).replace(/bytes/, 'B') ],
			[ "Job CPU Usage", Tools.pct( Math.round(total_cpu || 0), 100 ) ],
			[ "Job Mem Usage", Tools.getTextFromBytes(total_mem, 1).replace(/bytes/, 'B') ],
			[ "Uptime", Tools.getTextFromSeconds( stats.started ? (this.epoch - stats.started) : 0, true, true ) ],
			[ "Scheduler", this.getNiceEnabled(this.state.scheduler.enabled) ],
			[ "Server Time", this.getNiceTime(this.epoch, true) ]
		], 
		{
			minCols: 3,
			maxCols: 6,
			gap: 1,
			indent: 1,
			valueStyles: ["bold", "green"]
		}) );
		
		// active alerts
		this.printActiveAlerts();
		
		// active jobs
		this.printActiveJobs({
			rows: Object.values(this.activeJobs).sort( function(a, b) {
				// keep workflow parent jobs directly above their sub-jobs
				if (b.workflow && (b.workflow.job == a.id)) return -1;
				if (a.workflow && (a.workflow.job == b.id)) return 1;
				return (a.started < b.started) ? 1 : -1;
			} ) 
		});
		
		// internal jobs
		this.printInternalJobs();
		
		// queue summary
		await this.printQueueSummary();
		
		// rate limit summary
		this.printRateSummary();
		
		// aliases
		switch (this.args.other[0]) {
			case 'upcoming': this.args.upcoming = true; break;
			// case 'completed': this.args.completed = true; break;
		}
		
		// upcoming
		if (this.args.upcoming) {
			await this.printUpcomingJobs();
		}
		
		// completed jobs
		// if (this.args.completed) {
		// 	await this.printCompletedJobs();
		// }
		
		this.printSuggestedCommands({
			"Upcoming jobs": this.args.upcoming ? "" : "xy upcoming",
			"Completed jobs": "xy jobs",
			"Event list": "xy events",
			"Hide suggestions": "xy config --suggest false"
		});
	},
	
	async printQueueSummary() {
		// Fetch all visible queued-job groups from the server.
		cli.progress.start();
		var { err, data } = await this.api.getQueueSummary();
		if (err) this.die(err);
		cli.progress.end();
		
		this.queues = data.queues || [];
		// if (!this.queues.length) return;
		
		// Sort queues alphabetically by their effective queue or capacity ID.
		this.queues.sort( function(a, b) {
			return String(a.id).toLowerCase().localeCompare( String(b.id).toLowerCase() );
		} );
		
		var source_types = (this.config.ui?.job_source_types) || [];
		
		var rows = this.queues.map( queue => {
			var event_ids = Object.keys(queue.events || {}).sort();
			var category_ids = Object.keys(queue.categories || {}).sort();
			var source_ids = Object.keys(queue.sources || {}).sort();
			var target_ids = Object.keys(queue.targets || {}).sort();
			
			var nice_events = event_ids.length ?
				event_ids.map( this.getNiceEvent.bind(this) ).join(', ') :
				gray('(None)');
			
			var nice_categories = category_ids.length ?
				category_ids.map( this.getNiceCategory.bind(this) ).join(', ') :
				gray('(None)');
			
			var nice_sources = source_ids.length ? source_ids.map( function(source) {
				var source_def = Tools.findObject( source_types, { id: source } );
				return source_def ? source_def.title : Tools.ucfirst(source);
			} ).join(', ') : gray('(None)');
			
			var nice_targets = target_ids.length ? this.getNiceTargets(target_ids) : gray('(None)');
			
			return [
				this.color('theme').bold(queue.id),
				nice_events,
				nice_categories,
				nice_sources,
				nice_targets,
				bold(Tools.commify(queue.count || 0))
			];
		} );
		
		this.printBoxTable({
			title: 'Job Queues',
			header: [
				'Queue ID / Cap Key',
				'Events',
				'Categories',
				'Sources',
				'Targets',
				'# Jobs'
			],
			rows: rows
		});
	},
	
	printRateSummary() {
		// Render all currently active job rate-limit windows.
		var rates = Object.values(this.jobRateLimits || {});
		// if (!rates.length) return;
		
		// Sort pools alphabetically by their queue or shared-capacity ID.
		rates.sort( function(a, b) {
			return String(a.id).toLowerCase().localeCompare( String(b.id).toLowerCase() );
		} );
		
		var rows = rates.map( rate => {
			var rate_id = String(rate.id || '');
			var event_id = '';
			var match = null;
			
			// Normal event pool IDs begin with the event ID.
			match = rate_id.match(/^(e\w+)/);
			if (match) {
				event_id = match[1];
			}
			else {
				// Workflow node pools contain the parent workflow job ID.
				match = rate_id.match(/^n\w+\-(j\w+)/);
				
				if (match) {
					var workflow_job = this.activeJobs[match[1]];
					if (workflow_job) {
						event_id = workflow_job.event;
					}
				}
			}
			
			var remaining = Math.max( 0, (rate.expires || 0) - this.epoch );
			
			return [
				this.color('theme').bold(rate_id),
				event_id ? this.getNiceEvent(event_id) : gray('n/a'),
				Tools.commify(rate.count || 0),
				Tools.commify(rate.max || 0),
				Tools.getTextFromSeconds( rate.window || 0, false, true ),
				this.getTextFromSecondsRound( remaining, false )
			];
		} );
		
		this.printBoxTable({
			title: 'Rate Limit Pools',
			header: [
				'Pool ID / Cap Key',
				'Event',
				'Current Count',
				'Max Count',
				'Window Size',
				'Expires In'
			],
			rows: rows
		});
	},
	
	async cmd_upcoming() {
		// alias for `xy dashboard --upcoming`
		this.args.upcoming = true;
		await this.cmd_dashboard();
	}
	
};
