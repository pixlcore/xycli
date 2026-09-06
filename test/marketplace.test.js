const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTestConfig, createCheck, xy, json, call: apiCall } = require('./helpers/common.js');

test('marketplace', async t => {
	loadTestConfig();
	const check = createCheck(t);
	const marketplaceID = 'pixlcore/xyplug-ai';
	let original = [];
	let cleanupAllowed = false;
	let pluginID = '';
	
	try {
		original = (await apiCall('getPlugins')).rows;
		assert.ok(!original.some(plugin => plugin.marketplace && (plugin.marketplace.id == marketplaceID)),
			marketplaceID + ' must be uninstalled before running this suite');
		cleanupAllowed = true;
		
		await check('search by positional text', () => {
			const rows = json(['marketplace', 'AI Generation', '--limit', '5']);
			assert.ok(Array.isArray(rows));
			assert.ok(rows.some(product => product.id == marketplaceID));
			assert.ok(rows.every(product => product.type == 'plugin'));
		});
		
		await check('search filters and descending sort', () => {
			const rows = json([
				'marketplace', '--query', 'AI', '--plugin_type', 'event',
				'--author', 'pixl core', '--license', 'mit', '--requires', 'npx',
				'--tags', 'AI', '--status', 'not', '--sort_by', 'modified',
				'--sort_dir', 'desc', '--limit', '10'
			]);
			assert.ok(rows.some(product => product.id == marketplaceID));
			assert.ok(rows.every(product => product.plugin_type == 'event'));
		});
		
		await check('repeated list filters require all values', () => {
			const rows = json(['marketplace', '--tags', 'AI', '--tags', 'Prompt', '--requires', 'npx']);
			assert.ok(rows.some(product => product.id == marketplaceID));
		});
		
		await check('human search pagination and suggestions', () => {
			const out = xy(['marketplace', '--limit', '1']);
			assert.match(out, /PLUGIN MARKETPLACE/);
			assert.match(out, /page 1 of/i);
			assert.match(out, /Other Commands:/);
		});
		
		await check('README image cleanup preserves useful text and links', () => {
			const clean = require('../lib/marketplace.js').cleanMarketplaceReadme([
				'<p align="center"><img src="logo.png" alt="Logo"/></p>',
				'<h1 align="center">Example Plugin</h1>',
				'[![Version](badge.svg)](https://example.com/releases)',
				'![Screenshot](screen.png)',
				'\x1b[31mBody\x1b[0m'
			].join('\n'));
			assert.doesNotMatch(clean, /<img|!\[/i);
			assert.doesNotMatch(clean, /\x1b/);
			assert.match(clean, /^# Example Plugin/m);
			assert.match(clean, /\[Version\]\(https:\/\/example\.com\/releases\)/);
			assert.match(clean, /Body/);
		});
		
		await check('JSON details include listing, version and original README', () => {
			const detail = json(['marketplace', marketplaceID]);
			assert.equal(detail.item.id, marketplaceID);
			assert.equal(detail.item.type, 'plugin');
			assert.equal(detail.item.plugin_type, 'event');
			assert.equal(detail.version, detail.item.versions[0]);
			assert.match(detail.text, /<img/i);
			assert.match(detail.text, /Plugin Parameters/);
		});
		
		await check('human details show summary and terminal-safe full README', () => {
			const out = xy(['marketplace', 'get', marketplaceID]);
			assert.match(out, /MARKETPLACE PLUGIN SUMMARY/);
			assert.match(out, /PLUGIN README/);
			assert.match(out, /AI Generation Plugin/);
			assert.match(out, /Environment Variables/);
			assert.match(out, /Not Installed/);
			assert.doesNotMatch(out, /<img|!\[/i);
		});
		
		const preview = json(['marketplace', 'install', marketplaceID, '--version', 'v1.0.9']);
		pluginID = preview.plugin.id;
		
		await check('human install preview focuses on the Plugin definition', () => {
			const out = xy(['marketplace', 'install', marketplaceID, '--version', 'v1.0.9']);
			assert.match(out, /MARKETPLACE PLUGIN INSTALL PREVIEW/);
			assert.match(out, /Plugin Name:\s+AI Generation/);
			assert.match(out, /Author:\s+PixlCore/);
			assert.match(out, /Version:\s+v1\.0\.9/);
			assert.match(out, /This is the Plugin definition that will be created/);
			assert.match(out, new RegExp('"id": "' + pluginID + '"'));
			assert.match(out, /⚠️[\s\S]*Preview only\./);
			assert.doesNotMatch(out, /"product":|"operation":|"preview": true|"warnings":/);
		});
		
		await check('scripted preview extracts source without mutating Plugin data', () => {
			const marketplace = require('../lib/marketplace.js');
			const plugin = { id: 'sample', command: 'node', script: 'console.log("Hello");\n' };
			const display = marketplace.prepareMarketplacePreviewPlugin(plugin);
			assert.equal(display.script, plugin.script);
			assert.ok(!('script' in display.plugin));
			assert.equal(plugin.script, 'console.log("Hello");\n');
		});
		
		await check('scripted Marketplace Plugin shows source below preview JSON', () => {
			const out = xy(['marketplace', 'install', 'pixlcore/xyplug-upgrade']);
			const script_pos = out.indexOf('PLUGIN SCRIPT');
			assert.ok(script_pos > 0);
			assert.doesNotMatch(out.slice(0, script_pos), /"script":/);
			assert.match(out.slice(script_pos), /Auto Upgrade Plugin for xyOps/);
			assert.match(out.slice(script_pos), /const fs = require\('fs'\);/);
		});
		
		await check('install defaults to a complete create preview', () => {
			assert.equal(preview.preview, true);
			assert.equal(preview.operation, 'create');
			assert.equal(preview.marketplace.id, marketplaceID);
			assert.equal(preview.product.id, marketplaceID);
			assert.equal(preview.version, 'v1.0.9');
			assert.deepEqual(preview.warnings, []);
			assert.deepEqual(preview.plugin.marketplace, { id: marketplaceID, version: 'v1.0.9' });
			assert.equal(preview.plugin.type, 'event');
			assert.ok(!('created' in preview.plugin));
			assert.ok(!('modified' in preview.plugin));
			assert.ok(!('revision' in preview.plugin));
			assert.ok(!('username' in preview.plugin));
			assert.ok(!('uid' in preview.plugin));
			assert.ok(!('gid' in preview.plugin));
		});
		
		await check('preview does not install Plugin', () => {
			assert.deepEqual(json(['plugins', '--id', pluginID]), []);
		});
		
		await check('false confirmation and dry confirmation remain previews', () => {
			assert.equal(json(['marketplace', 'install', marketplaceID, '--confirm', 'false']).preview, true);
			assert.equal(json(['marketplace', 'install', marketplaceID, '--confirm', '--dry']).preview, true);
			assert.deepEqual(json(['plugins', '--id', pluginID]), []);
		});
		
		const rejected = [
			['get', 'invalid-id'],
			['get', marketplaceID, '--unknown', 'x'],
			['install'],
			['install', marketplaceID, '--unknown', 'x'],
			['install', marketplaceID, '--confirm', 'yes'],
			['--plugin_type', 'bogus'],
			['--status', 'outdated'],
			['--sort_by', 'bogus'],
			['--sort_dir', 'sideways'],
			['--query', 'AI', 'extra search']
		];
		for (const args of rejected) {
			await check('reject marketplace ' + args.join(' '), () => xy(['marketplace', ...args], { fail: true }));
		}
		
		const installed = json(['marketplace', 'install', marketplaceID, '--version', 'v1.0.9', '--confirm']);
		
		await check('confirmed install creates selected Marketplace version', () => {
			assert.equal(installed.operation, 'created');
			assert.equal(installed.plugin.id, pluginID);
			assert.equal(installed.plugin.marketplace.id, marketplaceID);
			assert.equal(installed.plugin.marketplace.version, 'v1.0.9');
			assert.match(installed.plugin.command, /1\.0\.9/);
			assert.ok(!('uid' in installed.plugin));
			assert.ok(!('gid' in installed.plugin));
		});
		
		await check('installed product is reported as outdated', () => {
			const rows = json(['marketplace', '--query', 'AI Generation', '--status', 'installed']);
			assert.ok(rows.some(product => product.id == marketplaceID));
			const out = xy(['marketplace', marketplaceID]);
			assert.match(out, /Outdated/);
			assert.match(out, new RegExp(pluginID));
			assert.match(out, /v1\.0\.9/);
		});
		
		const upgradePreview = json(['marketplace', 'install', marketplaceID]);
		await check('latest installation previews an update', () => {
			assert.equal(upgradePreview.operation, 'update');
			assert.equal(upgradePreview.version, upgradePreview.product.versions[0]);
			assert.equal(upgradePreview.plugin.id, pluginID);
		});
		
		const upgraded = json(['marketplace', 'install', marketplaceID, '--confirm']);
		await check('confirmed upgrade updates Plugin and Marketplace version', () => {
			assert.equal(upgraded.operation, 'updated');
			assert.equal(upgraded.plugin.id, pluginID);
			assert.equal(upgraded.plugin.marketplace.version, upgraded.marketplace.version);
			assert.equal(upgraded.plugin.marketplace.version, upgradePreview.product.versions[0]);
			assert.match(upgraded.plugin.command, new RegExp(upgraded.marketplace.version.replace(/^v/, '').replace(/\./g, '\\.')));
			assert.ok(upgraded.plugin.revision > installed.plugin.revision);
		});
		
		await check('latest version is reported as up to date', () => {
			assert.match(xy(['marketplace', marketplaceID]), /Up to Date/);
			assert.match(xy(['plugin', pluginID]), /Marketplace/);
		});
		
		json(['plugin', 'delete', pluginID, '--confirm']);
		
		await check('delete returns product to not-installed state', () => {
			assert.deepEqual(json(['plugins', '--id', pluginID]), []);
			const rows = json(['marketplace', '--query', 'AI Generation', '--status', 'not']);
			assert.ok(rows.some(product => product.id == marketplaceID));
		});
		
		for (const topic of ['marketplace', 'marketplace list', 'marketplace search', 'marketplace get', 'marketplace install']) {
			await check('help ' + topic, () => assert.match(xy(['help', ...topic.split(' ')]), /Marketplace/i));
		}
		
		await check('existing Plugins remain unchanged', async () => {
			assert.deepEqual((await apiCall('getPlugins')).rows, original);
		});
	}
	finally {
		// Only clean up after confirming this product was absent at suite start.
		// This catches failures after a successful create but before normal delete.
		if (cleanupAllowed) {
			const rows = (await apiCall('getPlugins')).rows.filter(plugin => {
				return plugin.marketplace && (plugin.marketplace.id == marketplaceID);
			});
			for (const plugin of rows) await apiCall('deletePlugin', { id: plugin.id });
		}
	}
});
