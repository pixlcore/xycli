// Record pagination at the SDK boundary without logging authentication or data.
const fs = require('node:fs');
const sdk = require('@pixlcore/xyops-sdk');
const original = sdk.api;

sdk.api = new Proxy({}, {
	get(target, method) {
		return async function(params, ...rest) {
			const trace = { method };
			for (const key of ['query', 'offset', 'limit', 'page']) {
				if (params && (key in params)) trace[key] = params[key];
			}
			
			fs.appendFileSync(process.env.XYCLI_PAGINATION_TRACE, JSON.stringify(trace) + '\n');
			return original[method](params, ...rest);
		};
	}
});
