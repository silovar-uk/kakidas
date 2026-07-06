/*
 * Text Review Studio v0.6.0
 * Static contract checks for the offline UI shell.
 * No browser, network, or external dependency required.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const requiredFiles = ['app.js', 'diff-core.js', 'styles.css', 'manifest.webmanifest', 'assets/app-icon.png'];
requiredFiles.forEach(file => assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`));

[
  'control-sidebar', 'profileSelect', 'sideSearchInput', 'ruleStrengthList',
  'strictModeTop', 'strictModeSide', 'exceptionsDrawer', 'baselineCompare',
  'afterCompare', 'gutterMap', 'reviewRail'
].forEach(token => assert.ok(html.includes(token), `missing UI anchor: ${token}`));

const actions = [...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]);
const unhandled = [...new Set(actions)].filter(action => !app.includes(`case '${action}'`) && action !== 'scroll-top');
assert.deepStrictEqual(unhandled, [], `unhandled data-action values: ${unhandled.join(', ')}`);

[
  'function renderProfile()', 'function renderExceptions()', 'function keepRule(id)',
  'function setProfile(value)', 'function toggleStrict()', "rule-badge", "keep-rule"
].forEach(token => assert.ok(app.includes(token) || css.includes(token), `missing preference behavior: ${token}`));

const markerBlock = css.slice(css.lastIndexOf('/* Diff markers'));
assert.ok(markerBlock.includes('.diff-add'), 'missing marker rule for additions');
assert.ok(markerBlock.includes('linear-gradient'), 'differences should use marker-style backgrounds');
assert.ok(markerBlock.includes('.diff-del'), 'missing marker rule for deletions');
assert.ok(!/\.diff-add\s*\{[^}]*text-decoration:\s*underline/i.test(markerBlock), 'additions must not rely on underline');

console.log('v0.6.0 UI contract tests: passed');
