'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const extract = require('../tools/research-lifecycle-callbacks.cjs');

const navigation = "win.webContents.on('did-start-navigation', (details) => {});";
const gone = "wc.on('render-process-gone', () => {});";
const destroyed = "wc.on('destroyed', () => {});";
const body = `${navigation}\n${gone}\n${destroyed}`;
const wrap = value => `function createWindow() { ${value} }`;

test('extracts all three current production callbacks without executing main', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8');
  const callbacks = extract(source);
  assert.deepEqual([...callbacks.keys()], ['did-start-navigation', 'render-process-gone', 'destroyed']);
  for (const callback of callbacks.values()) assert.match(callback, /projectRootGrants/);
});

test('ignores registrations outside createWindow', () => {
  assert.equal(extract(`${wrap(body)}\n${destroyed}`).size, 3);
});

for (const [name, source, error] of [
  ['missing event', wrap(`${navigation}\n${gone}`), /Missing lifecycle/],
  ['duplicate event', wrap(`${body}\n${destroyed}`), /Duplicate lifecycle/],
  ['duplicate template event', wrap(body + '\nwc.on(`destroyed`, () => {});'), /Duplicate lifecycle/],
  ['nested template event', wrap(`${navigation}\n${gone}\n` + 'if (enabled) { wc.on(`destroyed`, () => {}); }'), /must be direct/],
  ['wrong template receiver', wrap(`${navigation}\n${gone}\n` + 'other.on(`destroyed`, () => {});'), /Wrong lifecycle receiver/],
  ['wrong receiver', wrap(body.replace('wc.on', 'other.on')), /Wrong lifecycle receiver/],
  ['window instead of webContents', wrap(body.replace('win.webContents.on', 'win.on')), /Wrong lifecycle receiver/],
  ['once instead of on', wrap(body.replace('wc.on', 'wc.once')), /Expected on/],
  ['conditional registration', wrap(`${navigation}\n${gone}\nif (enabled) { ${destroyed} }`), /must be direct/],
  ['nested function registration', wrap(`${navigation}\n${gone}\nfunction later() { ${destroyed} }`), /must be direct/],
  ['callback reference', wrap(body.replace("'destroyed', () => {}", "'destroyed', callback")), /Expected inline/],
  ['extra argument', wrap(body.replace("'destroyed', () => {}", "'destroyed', () => {}, extra")), /Expected inline/],
  ['duplicate factory', `${wrap(body)}\n${wrap(body)}`, /exactly one createWindow/],
  ['missing factory', body, /exactly one createWindow/],
  ['invalid syntax', `${wrap(body)}\nfunction {`, /Invalid lifecycle source/]
]) {
  test(`rejects ${name}`, () => assert.throws(() => extract(source), error));
}
