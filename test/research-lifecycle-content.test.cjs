'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const content = require('../tools/research-lifecycle-content.cjs');

test('permits only exact fixture URL and inert blank document', () => {
  const file = path.resolve(__dirname, '..', '.tmp', 'synthetic space # 中文', 'fixture.html');
  const url = pathToFileURL(file).href;
  const allow = content(file);
  assert.equal(allow(url), true);
  assert.equal(allow('about:blank'), true);
  for (const candidate of [pathToFileURL(path.join(path.dirname(file), 'other.html')).href,
    url + '?x=1', url + '#fragment', url + '/extra', 'file:///C:/Windows/win.ini',
    'file://server/share/fixture.html', 'https://example.invalid/', 'data:text/html,test',
    'javascript:void(0)', 'about:blank#fragment', 'FILE:' + url.slice(5), '', undefined]) {
    assert.equal(allow(candidate), false);
  }
});
