// System Log Viewer Layer

const cli = require('pixl-cli');
const Tools = cli.Tools;

module.exports = {
	
	async cmd_log() {
		// Log searches return the last N matches, not offset-based pages.  Leave
		// pagination helpers out of this command and use the API's rows option.
		var params = Object.assign({}, this.args);
		var log = params.other.shift();
		
		if (params.other.length) return this.dieUsage('log');
		if (log && params.log && (log !== params.log)) return this.die("Conflicting log names.");
		
		params.log = log || params.log || 'xyOps';
		delete params.other;
		if (!('rows' in params)) params.rows = 100;
		
		// Sorting is a display option in the web UI, not an API search parameter.
		var sort = params.sort || 'date_asc';
		delete params.sort;
		if (!['date_asc', 'date_desc'].includes(sort)) return this.die("Log sort must be 'date_asc' or 'date_desc'.");
		
		var fields = ['log', 'rows', 'match', 'regex', 'case', 'cols', 'date'];
		var unknown = Object.keys(params).find( key => !fields.includes(key) );
		if (unknown) return this.die("Unsupported log option: --" + unknown);
		
		if ((typeof(params.log) != 'string') || !params.log.match(/^\w+$/)) return this.die("Log name must contain only letters, numbers, or underscores, without an extension.");
		if (!Number.isInteger(params.rows) || (params.rows < 1) || (params.rows > 1000)) return this.die("Log rows must be an integer from 1 to 1000.");
		
		['regex', 'case'].forEach( key => {
			if (!(key in params)) return;
			
			if ([true, 1, '1', 'true'].includes(params[key])) params[key] = true;
			else if ([false, 0, '0', 'false'].includes(params[key])) params[key] = false;
			else this.die("Invalid boolean value for '" + key + "': " + params[key]);
		});
		
		if ('match' in params) {
			// Numeric search text is common for log codes and process IDs.
			if (!['string', 'number', 'boolean'].includes(typeof(params.match))) return this.die("Log match must be text.");
			params.match = String(params.match);
		}
		
		if (params.regex && params.match) {
			// The server does not always return an error for a malformed regex.
			// Compile it here first so the CLI fails immediately and clearly.
			try { new RegExp(params.match, params.case ? 'g' : 'ig'); }
			catch (err) { return this.die("Invalid log regular expression: " + err.message); }
		}
		
		if ('date' in params) {
			// An empty date selects the live log.  Archive dates use server time.
			if (params.date !== '') {
				if ((typeof(params.date) != 'string') || !params.date.match(/^\d{4}-\d{2}-\d{2}$/)) return this.die("Log date must use YYYY-MM-DD format.");
				
				var date = new Date(params.date + 'T00:00:00Z');
				if (!Number.isFinite(date.getTime()) || (date.toISOString().slice(0, 10) !== params.date)) return this.die("Invalid log date: " + params.date);
			}
		}
		
		var all_cols = this.config.log_columns || ['hires_epoch', 'date', 'hostname', 'pid', 'component', 'category', 'code', 'msg', 'data'];
		
		if ('cols' in params) {
			if (typeof(params.cols) == 'string') params.cols = params.cols.split(',').map( col => col.trim() );
			if (!Array.isArray(params.cols) || !params.cols.length || params.cols.some( col => !all_cols.includes(col) )) return this.die("Log cols must contain valid column names: " + all_cols.join(', '));
			
			params.cols = Array.from(new Set(params.cols));
		}
		
		// Reconstruct native log lines in the server's configured column order.
		// An explicit column selection applies to both native and JSON output.
		var cols = params.cols || all_cols;
		var data = await this.callStandardAPI('adminSearchLogs', params, { text: 'Searching system log...' });
		if (this.dry) return;
		
		var rows = data.rows || [];
		if (sort == 'date_desc') rows = rows.slice(0).reverse();
		
		if (this.format.match(/json/)) return this.jsonOutput(rows);
		
		// list.length counts every log line, including non-matches.  It is not a
		// match count or a pagination total.  Missing archives may omit it entirely.
		var summary = Tools.commify(rows.length) + ' rows returned';
		if (data.list && (typeof(data.list.length) == 'number')) summary += ', ' + Tools.commify(data.list.length) + ' total log rows';
		
		println( "\n " + gray(summary) + "\n" );
		
		// Color values independently so every delimiter remains gray.  Messages
		// and data retain their full contents, with no table wrapping or truncation.
		var colors = {
			hires_epoch: 'teal',
			date: 'cyan',
			hostname: 'violet',
			pid: 'orange',
			component: 'blue',
			category: 'green',
			code: 'yellow',
			data: 'gray'
		};
		
		rows.forEach( row => {
			println( cols.map( col => {
				var value = row[col];
				if ((value === undefined) || (value === null)) value = '';
				else value = String(value);
				
				var color = colors[col];
				if ((col == 'category') && /^(error|warning|fatal)$/.test(value)) color = (value == 'warning') ? 'yellow' : 'red';
				
				return gray('[') + (color ? this.color(color)(value) : value) + gray(']');
			}).join('') );
		});
		
		this.printSuggestedCommands({
			"Search log text": `xy log ${params.log} --match "error"`,
			"Search with a regex": `xy log ${params.log} --match "error|warning" --regex`,
			"Show newest first": `xy log ${params.log} --rows 100 --sort date_desc`,
			"Export JSON rows": `xy log ${params.log} --rows 100 --format json`
		});
	}
	
}; // module.exports
