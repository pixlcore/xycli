const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const sdk = require('@pixlcore/xyops-sdk');
const {
	loadTestConfig, createCheck, createTempDir, runCLI, xy, json,
	call: apiCall
} = require('./helpers/common.js');

test('tickets', async t => {
	loadTestConfig();
	const check = createCheck(t);
	const stamp = Date.now();
	const id = 'tcli_ticket_' + stamp;
	const subject = 'CLI Ticket Test ' + stamp;
	const tagID = 'cli_ticket_tag_' + stamp;
	const temp = createTempDir(t, 'xycli-ticket-test-');
	const bodyFile = Path.join(temp, 'ticket.md');
	const firstFile = Path.join(temp, 'first-attachment.txt');
	const secondFile = Path.join(temp, 'second-attachment.json');
	const traceFile = Path.join(temp, 'trace.jsonl');
	const body = '# Test Ticket\n\n- **Bold item** with `code`\n';
	let ticketCreated = false;
	let tagCreated = false;

	fs.writeFileSync(bodyFile, body);
	fs.writeFileSync(firstFile, 'First Ticket attachment.\n');
	fs.writeFileSync(secondFile, '{\n\t"attachment": true\n}\n');

	try {
		const multiple = await apiCall('getMultiple', { lists: 'all' });
		const event = (multiple.events || []).find( item => item.enabled ) || (multiple.events || [])[0];

		await apiCall('createTag', { id: tagID, title: 'CLI Ticket Tag ' + stamp, icon: 'tag-outline' });
		tagCreated = true;

		await check('dry creation fills web editor defaults', () => {
			const req = json(['ticket', 'create', '--id', id, '--subject', subject, '--dry']);
			assert.equal(req.status, 'open');
			assert.equal(req.type, 'change');
			assert.equal(req.body, '');
			assert.deepEqual(req.assignees, []);
			assert.deepEqual(req.cc, []);
			assert.deepEqual(req.notify, []);
			assert.deepEqual(req.tags, []);
			assert.equal(req.due, 0);
		});

		// Mark cleanup eligible before the combined create/upload command.  If the
		// upload fails after creation, the finally block still removes the Ticket.
		ticketCreated = true;
		const created = json([
			'ticket', 'create', '--id', id, '--subject', subject,
			'--status', 'draft', '--type', 'issue', '--body', '@' + bodyFile,
			'--file', firstFile
		]);

		await check('create keeps Ticket draft and uploads a saved attachment', () => {
			assert.equal(created.id, id);
			assert.equal(created.subject, subject);
			assert.equal(created.status, 'draft');
			assert.equal(created.type, 'issue');
			assert.equal(created.body, body);
			assert.deepEqual(created.assignees, []);
			assert.equal(created.files.length, 1);
			assert.equal(created.files[0].filename, Path.basename(firstFile));
			assert.equal(created.files[0].ticket, id);
		});

		const num = created.num;
		await check('number, hash-number, named number, and ID fetch the same Ticket', () => {
			assert.equal(json(['ticket', String(num)]).id, id);
			assert.equal(json(['ticket', '#' + num]).id, id);
			assert.equal(json(['ticket', 'get', '--number', String(num)]).id, id);
			assert.equal(json(['ticket', 'get', '--id', id]).num, num);
		});

		await check('raw and named Ticket searches find the fixture', () => {
			assert.ok(json(['tickets', '"' + subject + '"']).some( row => row.id == id));
			assert.ok(json(['tickets', '--num', String(num), '--status', 'draft', '--type', 'issue']).some( row => row.id == id));
			assert.ok(json(['ticket', 'list', '--number', String(num)]).some( row => row.id == id));
		});

		await check('human Ticket search paginates and suggests commands', () => {
			const out = xy(['tickets', '--status', 'draft', '--limit', '1']);
			assert.match(out, /TICKET SEARCH RESULTS/);
			assert.match(out, /Other Commands:/);
		});

		await check('close, open, and draft actions translate to sparse status updates', () => {
			assert.deepEqual(json(['ticket', 'update', String(num), 'close', '--dry']), { status: 'closed', id: id });
			assert.deepEqual(json(['ticket', 'update', String(num), 'open', '--dry']), { status: 'open', id: id });
			assert.deepEqual(json(['ticket', 'update', String(num), 'draft', '--dry']), { status: 'draft', id: id });
		});

		json(['ticket', 'update', String(num), '--assign', 'admin', '--tag', tagID]);
		json(['ticket', 'update', String(num), '--assign', 'admin', '--tag', tagID]);
		await check('assign and Tag sugar append without duplicates', () => {
			const row = json(['ticket', String(num)]);
			assert.deepEqual(row.assignees, ['admin']);
			assert.deepEqual(row.tags, [tagID]);
			assert.equal(row.status, 'draft');
		});

		const comment = 'Investigation update:\n\n- **Checked** the `logs`.';
		json(['ticket', String(num), '--comment', comment]);
		await check('comment shortcut stores Markdown while Ticket remains draft', () => {
			const row = json(['ticket', String(num)]);
			const saved = row.changes.filter( change => change.type == 'comment' );
			assert.equal(saved.length, 1);
			assert.equal(saved[0].body, comment);
			assert.equal(row.status, 'draft');
		});

		await check('explicit comment supports stdin and dry run', () => {
			const req = json(['ticket', 'comment', String(num), '--body', '@-', '--dry'], {
				input: '{\n\t"markdown": "text"\n}\n'
			});
			assert.equal(req.id, id);
			assert.equal(req.change.type, 'comment');
			assert.equal(req.change.body, '{\n\t"markdown": "text"\n}\n');
		});

		const files = json(['ticket', 'upload', String(num), '--file', secondFile]);
		await check('dedicated upload always saves the attachment', () => {
			assert.equal(files.length, 2);
			assert.ok(files.some( file => file.filename == Path.basename(secondFile) && file.ticket == id));
		});

		const secondMeta = files.find( file => file.filename == Path.basename(secondFile));
		const downloadedFile = Path.join(temp, 'downloaded-attachment.json');
		await check('download saves exact attachment bytes by File ID', () => {
			const out = xy(['ticket', 'download', String(num), secondMeta.id, downloadedFile]);
			assert.match(out, /Successfully downloaded Ticket file/);
			assert.equal(fs.readFileSync(downloadedFile, 'utf8'), fs.readFileSync(secondFile, 'utf8'));
		});

		await check('download dry run resolves filename and default output path', () => {
			const req = json(['ticket', 'download', String(num), secondMeta.filename, '--dry']);
			assert.equal(req.ticket, id);
			assert.equal(req.number, num);
			assert.equal(req.file, secondMeta.filename);
			assert.equal(req.request.path, secondMeta.path.replace(/^files\//, ''));
			assert.equal(req.request.download, secondMeta.filename);
			assert.equal(req.output, Path.resolve(secondMeta.filename));
		});

		await check('download refuses unknown files and existing destinations', () => {
			xy(['ticket', 'download', String(num), 'missing-file-id'], { fail: true });
			xy(['ticket', 'download', String(num), secondMeta.id, downloadedFile], { fail: true });
		});

		if (event) await apiCall('updateTicket', { id: id, events: [{ id: event.id, params: {} }] });

		await check('human detail renders body, comments, files, and Events', () => {
			const out = xy(['ticket', String(num)]);
			for (const text of [
				'TICKET #' + num, 'Number', '#' + num, 'Ticket ID', id, subject,
				'TICKET BODY', 'Test Ticket', '• Bold item with code',
				'TICKET FILES', Path.basename(firstFile), Path.basename(secondFile), 'Download a file',
				'Comment by admin', 'Investigation update', '• Checked the logs'
			]) assert.ok(out.includes(text), text);
			if (event) {
				assert.match(out, /TICKET EVENTS/);
				assert.ok(out.includes(event.id));
			}
		});

		await check('Ticket detail searches for associated completed Jobs with pagination', () => {
			fs.writeFileSync(traceFile, '');
			runCLI(['ticket', String(num), '--limit', '3', '--page', '2'], {
				preload: Path.join(__dirname, 'helpers/pagination-preload.cjs'),
				env: { XYCLI_PAGINATION_TRACE: traceFile }
			});
			const trace = fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map( line => JSON.parse(line) );
			const search = trace.find( row => row.method == 'searchJobs' );
			assert.deepEqual(search, { method: 'searchJobs', query: 'tickets:' + id, offset: 3, limit: 3 });
		});

		await check('exact ID update skips get_ticket when old arrays are unnecessary', () => {
			fs.writeFileSync(traceFile, '');
			runCLI(['ticket', 'update', id, '--subject', subject + ' Updated', '--dry'], {
				preload: Path.join(__dirname, 'helpers/pagination-preload.cjs'),
				env: { XYCLI_PAGINATION_TRACE: traceFile }
			});
			const trace = fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map( line => JSON.parse(line) );
			assert.ok(!trace.some( row => row.method == 'getTicket'));
		});

		await apiCall('updateTicket', { id: id, future_property: { retained: true } });
		json(['ticket', 'update', id, '--subject', subject + ' Updated']);
		await check('sparse update preserves future Ticket properties', () => {
			const row = json(['ticket', String(num)]);
			assert.equal(row.subject, subject + ' Updated');
			assert.deepEqual(row.future_property, { retained: true });
			assert.equal(row.status, 'draft');
		});

		const rejected = [
			['update', String(num)],
			['update', String(num), '--subjec', 'Typo'],
			['update', String(num), '--status', 'pending'],
			['update', String(num), '--assignees', '{}'],
			['update', String(num), '--tag', 'missing_ticket_tag'],
			['comment', String(num), '--body', ''],
			['upload', String(num), '--file', Path.join(temp, 'missing.txt')],
			['delete', String(num), '--confirm', 'maybe']
		];
		for (const args of rejected) {
			await check('reject Ticket ' + args.slice(0, 4).join(' '), () => xy(['ticket', ...args], { fail: true }));
		}

		await check('unconfirmed delete shows the Ticket and warning toast', () => {
			const out = xy(['ticket', 'delete', String(num)]);
			assert.match(out, /DELETE TICKET/);
			assert.match(out, new RegExp('#' + num));
			assert.match(out, /⚠️[\s\S]*Please confirm the Ticket delete/);
		});

		await check('dry delete resolves number to the internal ID', () => {
			assert.deepEqual(json(['ticket', 'delete', String(num), '--confirm', '--dry']), { id: id });
		});

		json(['ticket', 'delete', String(num), '--confirm']);
		ticketCreated = false;
		await check('confirmed delete removes the Ticket', async () => {
			const { err } = await sdk.api.getTicket({ id: id });
			assert.ok(err);
		});

		for (const topic of [
			'tickets', 'ticket', 'ticket list', 'ticket get', 'ticket create',
			'ticket update', 'ticket comment', 'ticket upload', 'ticket download', 'ticket delete'
		]) {
			await check('help ' + topic, () => assert.ok(xy(['help', ...topic.split(' ')]).length > 100));
		}
	}
	finally {
		const cleanupErrors = [];
		if (ticketCreated) {
			try {
				await sdk.api.deleteTicket({ id: id });
				const result = await sdk.api.getTicket({ id: id });
				if (!result.err) cleanupErrors.push(new Error('Disposable Ticket remains: ' + id));
			}
			catch (error) { cleanupErrors.push(error); }
		}
		if (tagCreated) {
			try {
				await sdk.api.deleteTag({ id: tagID });
				const result = await sdk.api.getTags();
				if (!result.err && result.data.rows.some( tag => tag.id == tagID )) {
					cleanupErrors.push(new Error('Disposable Tag remains: ' + tagID));
				}
			}
			catch (error) { cleanupErrors.push(error); }
		}
		if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Ticket fixture cleanup failed.');
	}
});
