const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Path = require('node:path');
const { loadTestConfig, createCheck, createTempDir, xy, call, cleanupFixtures } = require('./helpers/common.js');

test('sync', async t => {
	loadTestConfig();
	const check = createCheck(t);
	
	// Use unique, disabled definitions with no active triggers. The Plugin and
	// Event source code is stored but never executed by this suite.
	const stamp = Date.now();
	const prefix = 'cli_sync_test_' + stamp + '_';
	const categoryID = prefix + 'category';
	const deleteCategoryID = prefix + 'delete_category';
	const pluginID = prefix + 'plugin';
	const eventID = prefix + 'event';
	const categoryTitle = 'CLI Sync Test ' + stamp + ' Category';
	const deleteCategoryTitle = 'CLI Sync Test ' + stamp + ' Delete Category';
	const pluginTitle = 'CLI Sync Test ' + stamp + ' Plugin';
	const eventTitle = 'CLI Sync Test ' + stamp + ' Event';
	const temp = createTempDir(t, 'xycli-sync-test-');
	const syncRoot = Path.join(temp, 'active-sync-tree');
	const deleteSetupRoot = Path.join(temp, 'delete-setup');
	
	const originalCategoryNotes = 'Original category notes';
	const originalPluginNotes = 'Original plugin notes';
	const originalEventNotes = 'Original event notes';
	const originalPluginScript = '#!/usr/bin/env node\nconsole.log("original plugin");\n';
	const originalEventScript = '#!/bin/bash\necho "original event"\n';
	const updatedCategoryNotes = 'Updated by filesystem sync';
	const updatedPluginNotes = 'Updated Plugin metadata from XYPDF';
	const updatedEventNotes = 'Updated Event metadata from XYPDF';
	const updatedPluginScript = '#!/usr/bin/env node\nconsole.log("updated plugin");\n';
	const updatedEventScript = '#!/bin/bash\necho "updated event"\n';
	const downCategoryNotes = 'Updated remotely for downsync';
	const downPluginNotes = 'Remote Plugin metadata for downsync';
	const downEventNotes = 'Remote Event metadata for downsync';
	const downPluginScript = '#!/usr/bin/env node\nconsole.log("remote plugin");\n';
	const downEventScript = '#!/bin/bash\necho "remote event"\n';
	const governedState = {
		['category-' + categoryID]: true,
		['plugin-' + pluginID]: true,
		['event-' + eventID]: true
	};
	const mixedState = {
		['category-' + categoryID]: true
	};
	let originalSyncState = {};
	let capturedSyncState = false;
	
	function slugify(title) {
		// Match setupSync() exactly so the test locates its own generated files
		// without depending on directory enumeration order.
		return title.replace(/\W+/g, '-').replace(/\-+$/, '').replace(/^\-+/, '');
	}
	
	function readXYPDF(file) {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	}
	
	function writeXYPDF(file, data) {
		fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
	}
	
	function copyIntoSyncTree(file) {
		// setup exports every object in each selected list. Copy only this suite's
		// files into the directory used for the actual sync, so unrelated server
		// definitions are never candidates for updates.
		const destination = Path.join(syncRoot, Path.basename(file));
		fs.copyFileSync(file, destination);
		return destination;
	}
	
	async function getFixtures() {
		const data = await call('getMultiple', { lists: 'categories,plugins,events', state: 1 });
		return {
			category: data.categories.find(item => item.id === categoryID),
			deleteCategory: data.categories.find(item => item.id === deleteCategoryID),
			plugin: data.plugins.find(item => item.id === pluginID),
			event: data.events.find(item => item.id === eventID),
			syncState: (data.state && data.state.sync) || {}
		};
	}
	
	try {
		let group;
		
		await check('local server has a target group and preserves existing sync state', async () => {
			const data = await call('getMultiple', { lists: 'groups', state: 1 });
			group = data.groups[0];
			assert.ok(group, 'At least one server group is required');
			
			// The sync map is a single authoritative global object. Preserve any map
			// already present on the developer's server and restore it in finally.
			originalSyncState = JSON.parse(JSON.stringify((data.state && data.state.sync) || {}));
			capturedSyncState = true;
		});
		
		await check('create disposable sync definitions', async () => {
			await call('createCategory', {
				id: categoryID,
				title: categoryTitle,
				enabled: false,
				color: 'blue',
				icon: 'folder-outline',
				notes: originalCategoryNotes,
				actions: [],
				limits: []
			});
			
			// This unreferenced Category is reserved for the delete-mode lifecycle.
			// Keeping it separate lets the main Category remain attached to the Event.
			await call('createCategory', {
				id: deleteCategoryID,
				title: deleteCategoryTitle,
				enabled: false,
				color: 'gray',
				icon: 'trash-can-outline',
				notes: 'Disposable delete-mode fixture',
				actions: [],
				limits: []
			});
			
			await call('createPlugin', {
				id: pluginID,
				title: pluginTitle,
				enabled: false,
				type: 'event',
				command: '/usr/bin/node',
				script: originalPluginScript,
				params: [{ id: 'script', title: 'Script', type: 'code', value: '', required: false }],
				groups: [],
				format: '',
				uid: '',
				gid: '',
				kill: 'parent',
				runner: false,
				notes: originalPluginNotes
			});
			
			await call('createEvent', {
				id: eventID,
				title: eventTitle,
				enabled: false,
				category: categoryID,
				plugin: pluginID,
				params: { script: originalEventScript },
				fields: [],
				tags: [],
				targets: [group.id],
				algo: 'random',
				notes: originalEventNotes,
				actions: [],
				limits: [],
				triggers: []
			});
		});
		
		await check('sync setup exports selected resource types', () => {
			const output = xy([
				'sync', 'setup', 'categories', 'plugins', 'events',
				'--file_props', 'script,params.script'
			], { cwd: temp });
			
			assert.match(output, /SYNC SETUP/);
			assert.match(output, /Setup complete!/);
		});
		
		const categoryExport = Path.join(temp, 'categories', slugify(categoryTitle) + '.json');
		const pluginExport = Path.join(temp, 'plugins', slugify(pluginTitle) + '.json');
		const pluginScriptExport = Path.join(temp, 'plugins', slugify(pluginTitle) + '-script.js');
		const eventExport = Path.join(temp, 'events', slugify(eventTitle) + '.json');
		const eventScriptExport = Path.join(temp, 'events', slugify(eventTitle) + '-params.script.sh');
		
		await check('setup writes valid XYPDF and external property files', () => {
			const category = readXYPDF(categoryExport);
			const plugin = readXYPDF(pluginExport);
			const event = readXYPDF(eventExport);
			
			assert.equal(category.type, 'xypdf');
			assert.equal(category.version, '1.0');
			assert.equal(category.items.length, 1);
			assert.equal(category.items[0].type, 'category');
			assert.equal(category.items[0].data.id, categoryID);
			assert.equal(plugin.items[0].data.id, pluginID);
			assert.equal(plugin.items[0].data.script, '(External)');
			assert.equal(event.items[0].data.id, eventID);
			assert.equal(event.items[0].data.params.script, '(External)');
			
			for (const payload of [category, plugin, event]) {
				for (const key of ['created', 'modified', 'revision', 'sort_order', 'username']) {
					assert.ok(!(key in payload.items[0].data), 'Export omits ' + key);
				}
			}
			
			assert.equal(fs.readFileSync(pluginScriptExport, 'utf8'), originalPluginScript);
			assert.equal(fs.readFileSync(eventScriptExport, 'utf8'), originalEventScript);
		});
		
		let categoryFile, pluginFile, pluginScriptFile, eventFile, eventScriptFile;
		
		await check('prepare isolated arbitrary-layout sync tree', () => {
			fs.mkdirSync(syncRoot, { recursive: true });
			categoryFile = copyIntoSyncTree(categoryExport);
			pluginFile = copyIntoSyncTree(pluginExport);
			pluginScriptFile = copyIntoSyncTree(pluginScriptExport);
			eventFile = copyIntoSyncTree(eventExport);
			eventScriptFile = copyIntoSyncTree(eventScriptExport);
			assert.equal(fs.readdirSync(syncRoot).length, 5);
		});
		
		await check('edit XYPDF metadata and external source files', () => {
			const category = readXYPDF(categoryFile);
			const plugin = readXYPDF(pluginFile);
			const event = readXYPDF(eventFile);
			
			category.items[0].data.notes = updatedCategoryNotes;
			plugin.items[0].data.notes = updatedPluginNotes;
			event.items[0].data.notes = updatedEventNotes;
			
			writeXYPDF(categoryFile, category);
			writeXYPDF(pluginFile, plugin);
			writeXYPDF(eventFile, event);
			fs.writeFileSync(pluginScriptFile, updatedPluginScript);
			fs.writeFileSync(eventScriptFile, updatedEventScript);
		});
		
		await check('dry upsync previews every update without changing xyOps', async () => {
			const output = xy([
				'sync', syncRoot, '--up', 'categories,plugins,events', '--dry'
			], { cwd: temp });
			const fixtures = await getFixtures();
			
			assert.match(output, /DRY RUN/);
			assert.match(output, /API REQUEST PREVIEW: update_category/);
			assert.match(output, /API REQUEST PREVIEW: update_plugin/);
			assert.match(output, /API REQUEST PREVIEW: update_event/);
			assert.match(output, /API REQUEST PREVIEW: update_global_state/);
			assert.equal(fixtures.category.notes, originalCategoryNotes);
			assert.equal(fixtures.plugin.notes, originalPluginNotes);
			assert.equal(fixtures.plugin.script, originalPluginScript);
			assert.equal(fixtures.event.notes, originalEventNotes);
			assert.equal(fixtures.event.params.script, originalEventScript);
			assert.deepEqual(fixtures.syncState, originalSyncState);
			for (const item of [fixtures.category, fixtures.plugin, fixtures.event]) {
				assert.ok(!Object.prototype.hasOwnProperty.call(item, 'sync'), 'Dry upsync leaves resources free of sync metadata');
			}
		});
		
		await check('upsync applies XYPDF and external property changes', async () => {
			const output = xy([
				'sync', syncRoot, '--up', 'categories,plugins,events'
			], { cwd: temp });
			const fixtures = await getFixtures();
			
			assert.match(output, /Updating category/);
			assert.match(output, /Updating plugin/);
			assert.match(output, /Updating event/);
			assert.equal(fixtures.category.notes, updatedCategoryNotes);
			assert.equal(fixtures.plugin.notes, updatedPluginNotes);
			assert.equal(fixtures.plugin.script, updatedPluginScript);
			assert.equal(fixtures.event.notes, updatedEventNotes);
			assert.equal(fixtures.event.params.script, updatedEventScript);
			assert.deepEqual(fixtures.syncState, governedState);
			for (const item of [fixtures.category, fixtures.plugin, fixtures.event]) {
				assert.ok(!Object.prototype.hasOwnProperty.call(item, 'sync'), 'Upsync leaves resources free of sync metadata');
			}
		});
		
		await check('unchanged upsync is a no-op', async () => {
			const before = await getFixtures();
			const output = xy([
				'sync', syncRoot, '--up', 'categories,plugins,events', '--verbose'
			], { cwd: temp });
			const after = await getFixtures();
			
			assert.doesNotMatch(output, /Updating (category|plugin|event)/);
			assert.doesNotMatch(output, /API REQUEST: update_global_state/);
			assert.equal(after.category.revision, before.category.revision);
			assert.equal(after.plugin.revision, before.plugin.revision);
			assert.equal(after.event.revision, before.event.revision);
			assert.deepEqual(after.syncState, governedState);
		});
		
		await check('change xyOps resources for downsync', async () => {
			await call('updateCategory', { id: categoryID, notes: downCategoryNotes });
			await call('updatePlugin', { id: pluginID, notes: downPluginNotes, script: downPluginScript });
			await call('updateEvent', { id: eventID, notes: downEventNotes, params: { script: downEventScript } });
			
			const fixtures = await getFixtures();
			assert.equal(fixtures.category.notes, downCategoryNotes);
			assert.equal(fixtures.plugin.notes, downPluginNotes);
			assert.equal(fixtures.plugin.script, downPluginScript);
			assert.equal(fixtures.event.notes, downEventNotes);
			assert.equal(fixtures.event.params.script, downEventScript);
			assert.deepEqual(fixtures.syncState, governedState);
		});
		
		await check('dry downsync previews writes without changing files or state', async () => {
			const before = [categoryFile, pluginFile, pluginScriptFile, eventFile, eventScriptFile].map(file => fs.readFileSync(file, 'utf8'));
			const output = xy([
				'sync', syncRoot, '--down', 'categories,plugins,events', '--dry'
			], { cwd: temp });
			const after = [categoryFile, pluginFile, pluginScriptFile, eventFile, eventScriptFile].map(file => fs.readFileSync(file, 'utf8'));
			const fixtures = await getFixtures();
			
			assert.match(output, /DRY RUN/);
			assert.equal((output.match(/WRITING FILE:/g) || []).length, 3);
			assert.match(output, /API REQUEST PREVIEW: update_global_state/);
			assert.deepEqual(after, before);
			assert.deepEqual(fixtures.syncState, governedState);
		});
		
		await check('downsync writes files and clears global sync governance', async () => {
			const output = xy([
				'sync', syncRoot, '--down', 'categories,plugins,events'
			], { cwd: temp });
			const category = readXYPDF(categoryFile);
			const plugin = readXYPDF(pluginFile);
			const event = readXYPDF(eventFile);
			const fixtures = await getFixtures();
			
			assert.match(output, /Updating category/);
			assert.match(output, /Updating plugin/);
			assert.match(output, /Updating event/);
			assert.equal(category.items[0].data.notes, downCategoryNotes);
			assert.equal(plugin.items[0].data.notes, downPluginNotes);
			assert.equal(plugin.items[0].data.script, '(External)');
			assert.equal(event.items[0].data.notes, downEventNotes);
			assert.equal(event.items[0].data.params.script, '(External)');
			assert.equal(fs.readFileSync(pluginScriptFile, 'utf8'), downPluginScript);
			assert.equal(fs.readFileSync(eventScriptFile, 'utf8'), downEventScript);
			assert.deepEqual(fixtures.syncState, {});
			for (const item of [fixtures.category, fixtures.plugin, fixtures.event]) {
				assert.ok(!Object.prototype.hasOwnProperty.call(item, 'sync'), 'Downsync leaves resources free of sync metadata');
			}
		});
		
		await check('unchanged downsync and state are a no-op', async () => {
			const files = [categoryFile, pluginFile, pluginScriptFile, eventFile, eventScriptFile];
			const before = files.map(file => fs.readFileSync(file, 'utf8'));
			const output = xy([
				'sync', syncRoot, '--down', 'categories,plugins,events', '--verbose'
			], { cwd: temp });
			const after = files.map(file => fs.readFileSync(file, 'utf8'));
			const fixtures = await getFixtures();
			
			assert.doesNotMatch(output, /Updating (category|plugin|event)/);
			assert.doesNotMatch(output, /API REQUEST: update_global_state/);
			assert.deepEqual(after, before);
			assert.deepEqual(fixtures.syncState, {});
		});
		
		await check('mixed directions govern only up-only resource types', async () => {
			const output = xy([
				'sync', syncRoot,
				'--up', 'categories,plugins',
				'--down', 'plugins,events'
			], { cwd: temp });
			const fixtures = await getFixtures();
			
			assert.doesNotMatch(output, /Updating (category|plugin|event)/);
			assert.deepEqual(fixtures.syncState, mixedState);
		});
		
		let deleteCategoryFile;
		let categoriesBeforeDelete;
		
		await check('prepare and verify a complete Category delete inventory', async () => {
			fs.mkdirSync(deleteSetupRoot, { recursive: true });
			xy(['sync', 'setup', 'categories'], { cwd: deleteSetupRoot });
			
			const deleteSyncRoot = Path.join(deleteSetupRoot, 'categories');
			const sourceFiles = fs.readdirSync(deleteSyncRoot)
				.filter(file => file.match(/\.json$/i))
				.map(file => Path.join(deleteSyncRoot, file));
			const sourceByID = new Map();
			
			for (const file of sourceFiles) {
				const payload = readXYPDF(file);
				const id = payload.items && payload.items[0] && payload.items[0].data && payload.items[0].data.id;
				assert.ok(id, 'Every Category source has an ID');
				assert.ok(!sourceByID.has(id), 'Category ID is exported exactly once: ' + id);
				sourceByID.set(id, file);
			}
			
			categoriesBeforeDelete = (await call('getMultiple', { lists: 'categories' })).categories;
			assert.equal(sourceByID.size, categoriesBeforeDelete.length, 'Export contains every Category');
			for (const category of categoriesBeforeDelete) {
				assert.ok(sourceByID.has(category.id), 'Export contains Category: ' + category.id);
			}
			
			deleteCategoryFile = sourceByID.get(deleteCategoryID);
			assert.ok(deleteCategoryFile, 'Disposable delete Category was exported');
		});
		
		await check('malformed XYPDF aborts delete mode', async () => {
			const validSource = fs.readFileSync(deleteCategoryFile, 'utf8');
			writeXYPDF(deleteCategoryFile, { type: 'xypdf', version: '1.0', items: [] });
			
			const output = xy([
				'sync', Path.dirname(deleteCategoryFile), '--up', 'categories', '--down', 'false', '--delete', 'categories'
			], { cwd: temp });
			const fixtures = await getFixtures();
			
			assert.match(output, /empty, malformed or missing items array/);
			assert.doesNotMatch(output, /Deleting category/);
			assert.ok(fixtures.deleteCategory, 'Malformed source did not delete its Category');
			assert.deepEqual(fixtures.syncState, mixedState, 'Malformed input leaves global sync governance untouched');
			fs.writeFileSync(deleteCategoryFile, validSource);
		});
		
		await check('dry delete previews removal without changing xyOps', async () => {
			fs.unlinkSync(deleteCategoryFile);
			const output = xy([
				'sync', Path.dirname(deleteCategoryFile), '--up', 'categories', '--down', 'false', '--delete', 'categories', '--dry'
			], { cwd: temp });
			const fixtures = await getFixtures();
			
			assert.match(output, /DRY RUN/);
			assert.match(output, new RegExp('Deleting category.*' + deleteCategoryTitle));
			assert.match(output, /API REQUEST PREVIEW: delete_category/);
			assert.match(output, /API REQUEST PREVIEW: update_global_state/);
			assert.ok(fixtures.deleteCategory, 'Dry delete preserved its Category');
			assert.deepEqual(fixtures.syncState, mixedState, 'Dry delete preserves global sync governance');
		});
		
		await check('delete mode removes only the missing disposable Category', async () => {
			// Recheck the live inventory immediately before the destructive command.
			// If another process added or removed a Category after setup, stop here.
			const categoriesImmediatelyBefore = (await call('getMultiple', { lists: 'categories' })).categories;
			assert.deepEqual(
				categoriesImmediatelyBefore.map(item => item.id).sort(),
				categoriesBeforeDelete.map(item => item.id).sort(),
				'Live Category inventory is unchanged since the verified export'
			);
			
			const output = xy([
				'sync', Path.dirname(deleteCategoryFile), '--up', 'categories', '--down', 'false', '--delete', 'categories'
			], { cwd: temp });
			const fixtures = await getFixtures();
			const categoriesAfterDelete = (await call('getMultiple', { lists: 'categories' })).categories;
			const expectedIDs = categoriesBeforeDelete.map(item => item.id).filter(id => id !== deleteCategoryID).sort();
			const actualIDs = categoriesAfterDelete.map(item => item.id).sort();
			
			assert.match(output, new RegExp('Deleting category.*' + deleteCategoryTitle));
			assert.equal(fixtures.deleteCategory, undefined);
			assert.deepEqual(actualIDs, expectedIDs, 'No other Categories were deleted');
			assert.ok(fixtures.category && fixtures.plugin && fixtures.event, 'Resources outside the missing fixture remain');
			assert.deepEqual(fixtures.syncState, Object.fromEntries(expectedIDs.map(id => ['category-' + id, true])), 'Up-only delete mode tracks the remaining Category sources');
		});
	}
	finally {
		const cleanupErrors = [];
		
		// Restore the developer's complete pre-test governance map. Do this even
		// when a lifecycle assertion fails after an up-only sync changed the map.
		if (capturedSyncState) {
			try {
				await call('updateGlobalState', { sync: originalSyncState });
				const restored = await call('getMultiple', { lists: 'categories', state: 1 });
				assert.deepEqual((restored.state && restored.state.sync) || {}, originalSyncState);
			}
			catch (error) { cleanupErrors.push(error); }
		}
		
		// Consumers must be deleted before the Plugin and Category they reference.
		// Prefix matching also catches a partial create before its response returned.
		try {
			await cleanupFixtures([
				{ list: 'events', method: 'deleteEvent', match: item => item.id === eventID || (item.title || '').startsWith('CLI Sync Test ' + stamp) },
				{ list: 'plugins', method: 'deletePlugin', match: item => item.id === pluginID || (item.title || '').startsWith('CLI Sync Test ' + stamp) },
				{ list: 'categories', method: 'deleteCategory', match: item => [categoryID, deleteCategoryID].includes(item.id) || (item.title || '').startsWith('CLI Sync Test ' + stamp) }
			]);
		}
		catch (error) { cleanupErrors.push(error); }
		
		if (cleanupErrors.length) {
			throw new AggregateError(cleanupErrors, 'Sync fixture or global-state cleanup failed. Check the local server before rerunning.');
		}
	}
});
