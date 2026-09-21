// Force the help document through the same CRLF checkout transformation Git
// commonly applies on Windows, so this regression is covered on every runner.
const fs = require('node:fs');
const Path = require('node:path');
const readFileSync = fs.readFileSync;

fs.readFileSync = function(file) {
	var contents = readFileSync.apply(this, arguments);
	var filename = String(file);
	var is_help = (Path.basename(filename) == 'help.md') &&
		(Path.basename(Path.dirname(filename)) == 'docs');
	
	if (is_help && (typeof(contents) == 'string')) {
		return contents.replace(/\r?\n/g, '\r\n');
	}
	
	return contents;
};
