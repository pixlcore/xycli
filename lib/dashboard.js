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
	
	async cmd_upcoming() {
		// alias for `xy dashboard --upcoming`
		this.args.upcoming = true;
		await this.cmd_dashboard();
	}
	
};
