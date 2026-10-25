// Dedicated MCP startup avoids terminal behavior in the interactive CLI.
const { parseArgs } = require('node:util');
const os = require('node:os');
const pkg = require('../package.json');

const HELP = `Usage:
  xy mcp stdio [--read-only]
  xy mcp serve [--port 8080] [--host 127.0.0.1] [--read-only]

Uses the existing CLI configuration and XYOPS_BASE_URL. STDIO uses XYOPS_API_KEY.
HTTP endpoint: /mcp. Clients supply their xyOps API key as a Bearer token.
Remote binds also require allowed_hosts in the mcp configuration section.
TLS options: --tls-cert FILE --tls-key FILE. See xy help mcp for details.
`;

function configuration(config, args) {
	if (config.mcp !== undefined && (!config.mcp || typeof config.mcp !== 'object' || Array.isArray(config.mcp))) throw new Error('MCP configuration must be an object.');
	const values = { ...config.mcp };
	// Nested config stays readable in cli.json. Environment overrides use flat
	// names, matching the CLI's existing XYOPS_* loader.
	for (const key of ['host', 'port', 'read_only', 'max_page_size', 'max_result_bytes', 'max_request_bytes', 'tls_cert', 'tls_key']) {
		if (config['mcp_' + key] !== undefined) values[key] = config['mcp_' + key];
	}
	for (const key of ['host', 'port', 'read-only', 'tls-cert', 'tls-key']) {
		if (args[key] !== undefined) values[key.replaceAll('-', '_')] = args[key];
	}
	const options = {
		host: '127.0.0.1', port: 8080, read_only: false,
		max_page_size: 100, max_result_bytes: 1048576, max_request_bytes: 1048576,
		allowed_hosts: ['localhost', '127.0.0.1', '[::1]'], allowed_origins: [], ...values
	};
	for (const key of ['port', 'max_page_size', 'max_result_bytes', 'max_request_bytes']) {
		options[key] = Number(options[key]);
		const max = key === 'port' ? 65535 : (key === 'max_page_size' ? 100 : 16 * 1024 * 1024);
		if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > max) throw new Error('Invalid MCP ' + key);
	}
	if (typeof options.host !== 'string' || !options.host) throw new Error('Invalid MCP host');
	if (typeof options.read_only !== 'boolean') throw new Error('MCP read_only must be a boolean');
	for (const key of ['allowed_hosts', 'allowed_origins']) {
		if (!Array.isArray(options[key]) || options[key].some(value => typeof value !== 'string' || !value)) throw new Error('MCP ' + key + ' must be an array of strings');
	}
	if (!!options.tls_cert !== !!options.tls_key) throw new Error('Supply both tls_cert and tls_key');
	return options;
}

async function main(argv) {
	const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
		port: { type: 'string' }, host: { type: 'string' }, 'read-only': { type: 'boolean' },
		'tls-cert': { type: 'string' }, 'tls-key': { type: 'string' },
		help: { type: 'boolean', short: 'h' }, verbose: { type: 'boolean', short: 'v' },
		debug: { type: 'boolean', short: 'd' }, quiet: { type: 'boolean', short: 'q' }
	} });
	if (values.help || positionals[0] === 'help') { process.stdout.write(HELP); return; }
	const mode = positionals[0];
	if (!['stdio', 'serve'].includes(mode) || positionals.length !== 1) throw new Error('Use xy mcp stdio or xy mcp serve --port 8080. Run xy mcp --help for details.');
	if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('MCP requires Node.js 20 or newer.');
	
	const app = {};
	require('./config.js').loadConfig.call(app);
	const config = app.config;
	if (!config.base_url) throw new Error('Configure XYOPS_BASE_URL or base_url in cli.json.');
	if (mode === 'stdio' && !config.api_key) throw new Error('Configure XYOPS_API_KEY or api_key in cli.json for STDIO.');
	const options = configuration(config, values);
	if (mode === 'serve' && !['127.0.0.1', '::1', 'localhost'].includes(options.host)) {
		if (!config.mcp?.allowed_hosts?.length) throw new Error('Remote HTTP binds require explicit mcp.allowed_hosts.');
	}
	
	// Identify MCP traffic in xyOps logs, preserving an explicit override.
	if (!process.env.XYOPS_USER_AGENT) {
		process.env.XYOPS_USER_AGENT = `xyOps MCP v${pkg.version} (Node.js); ${os.hostname()} (${os.platform()}/${os.arch()})`;
	}
	
	// Initialize the SDK only after config is loaded so timeout settings apply.
	// Never inherit a retry policy which could duplicate a create/run request.
	process.env.XYOPS_RETRIES = '0';
	const { api } = require('@pixlcore/xyops-sdk');
	api.request.setRetries(0);
	const context = require('./mcp/context.js').createContext(api, { ...options, api_key: mode === 'stdio' ? config.api_key : undefined });
	const tools = require('./mcp/registry.js')();
	const factory = require('./mcp/server.js')(tools, context);
	const start = require('./mcp/transports/' + (mode === 'stdio' ? 'stdio' : 'http') + '.js');
	const service = await start(factory, { ...options, log: context.log });
	if (mode === 'serve') {
		// IPv6 bind addresses are unbracketed, but URLs require brackets to
		// separate the address from the port.
		const hostname = options.host.includes(':') ? '[' + options.host + ']' : options.host;
		context.log('Listening at ' + (options.tls_cert ? 'https' : 'http') + '://' + hostname + ':' + service.address.port + '/mcp');
	}
	
	await new Promise(resolve => {
		let closing = false;
		const stop = async function() {
			if (closing) return;
			closing = true;
			// A request already accepted upstream may still complete. Shutdown does
			// not abort xyOps jobs or claim that a cancelled mutation was rolled back.
			const timer = setTimeout(() => process.exit(1), 5000);
			timer.unref();
			try { await service.close(); }
			catch (err) { context.log(err.message); process.exitCode = 1; }
			finally {
				clearTimeout(timer);
				api.request.setKeepAlive(false);
				for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, stop);
				process.stdin.removeListener('end', stop);
				resolve();
			}
		};
		for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
		if (mode === 'stdio') {
			process.stdin.once('end', stop);
			if (process.stdin.readableEnded) stop();
		}
	});
}

module.exports = { main, configuration };
