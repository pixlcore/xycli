// Shared SDK boundary. No terminal formatting, cached records, or global args.
const READ_APIS = new Set(['get_events', 'get_event', 'get_categories', 'get_groups', 'get_plugins', 'get_plugin', 'get_job', 'search_jobs', 'search_alerts', 'search_snapshots', 'get_active_servers']);
const WRITE_APIS = new Set(['create_event', 'update_event', 'delete_event', 'run_event', 'create_ticket', 'update_ticket', 'delete_ticket', 'add_ticket_change', 'create_snapshot', 'create_group_snapshot']);

function checkKeys(value) {
	// Prevent prototype-bearing keys from reaching downstream merge helpers.
	if (!value || typeof value !== 'object') return;
	for (const key of Object.keys(value)) {
		if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsupported property: ' + key);
		checkKeys(value[key]);
	}
}

function createContext(api, options = {}) {
	const limits = Object.freeze({ max_page_size: options.max_page_size || 100, max_result_bytes: options.max_result_bytes || 1048576 });
	const redact = text => String(text).split(options.api_key || '\0').join('[redacted]');
	const log = message => process.stderr.write('xy mcp: ' + redact(message) + '\n');
	
	return {
		limits, log, redact, readOnly: !!options.read_only,
		withApiKey(api_key) {
			// HTTP requests get their own immutable credential scope, including
			// error redaction. Never change environment variables or SDK defaults.
			if (typeof api_key !== 'string' || !api_key) throw new Error('Missing xyOps API key.');
			return createContext(api, { ...options, api_key });
		},
		async callAPI(name, params = {}, signal) {
			if (!READ_APIS.has(name) && !WRITE_APIS.has(name)) throw new Error('Unsupported API: ' + name);
			if (options.read_only && !READ_APIS.has(name)) throw new Error('MCP is configured read-only.');
			if (signal?.aborted) throw new Error('Request cancelled before contacting xyOps.');
			checkKeys(params);
			
			// Retry policy belongs to this boundary, not the AI client. Retrying a
			// timed-out launch could create a second job. The SDK also starts with
			// retries disabled in the MCP entry point.
			let response;
			const requestOptions = { retries: 0 };
			if (options.api_key) requestOptions.headers = { 'X-API-Key': options.api_key };
			try { response = await api[name](params, requestOptions); }
			catch (err) { response = { err }; }
			if (response?.err || !response?.data || response.data.code) {
				const definitive = response?.data && response.data.code;
				const message = definitive ? response.data.description : (response?.err?.message || response?.err || 'Invalid xyOps response');
				const uncertain = WRITE_APIS.has(name) && !definitive;
				throw new Error(redact(message) + (uncertain ? ' Outcome is uncertain; inspect xyOps before retrying this operation.' : ''));
			}
			return response.data;
		}
	};
}

module.exports = { createContext, checkKeys };
