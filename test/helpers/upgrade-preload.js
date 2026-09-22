// Replace npm registry access and the final npm process for offline CLI tests.
const fs = require('node:fs');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');

global.fetch = async function(url, options) {
	if (process.env.XYCLI_TEST_REQUEST_FILE) {
		fs.writeFileSync(process.env.XYCLI_TEST_REQUEST_FILE, JSON.stringify({
			url: url,
			headers: options.headers
		}));
	}
	
	if (process.env.XYCLI_TEST_FETCH_ERROR) {
		throw new Error(process.env.XYCLI_TEST_FETCH_ERROR);
	}
	
	var status = Number(process.env.XYCLI_TEST_HTTP_STATUS || 200);
	return {
		ok: (status >= 200) && (status < 300),
		status: status,
		async json() {
			return { version: process.env.XYCLI_TEST_LATEST_VERSION };
		}
	};
};

cp.spawn = function(command, options) {
	if (process.env.XYCLI_TEST_SPAWN_FILE) {
		fs.writeFileSync(process.env.XYCLI_TEST_SPAWN_FILE, JSON.stringify({
			command: command,
			shell: options.shell,
			stdio: options.stdio,
			windowsHide: options.windowsHide
		}));
	}
	
	var child = new EventEmitter();
	process.nextTick(() => {
		if (process.env.XYCLI_TEST_SPAWN_ERROR) child.emit('error', new Error(process.env.XYCLI_TEST_SPAWN_ERROR));
		else child.emit('close', Number(process.env.XYCLI_TEST_SPAWN_EXIT || 0), null);
	});
	return child;
};
