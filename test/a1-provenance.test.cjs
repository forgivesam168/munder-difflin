'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const binding = require('../tools/a1-candidate.cjs');
const { A1EventTrace } = require('./load-ts.cjs')('src/main/a1EventTrace.ts');

function passFixture(t) {
  const root = fs.mkdtempSync(path.join(binding.root, '.tmp', 'a1-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = { runId: binding.runId, contract: binding.contract, configurationSha256: 'b'.repeat(64) };
  const req = binding.request({ candidateSha256: binding.digest(candidate), candidate }, 'c'.repeat(64));
  let now = 0;
  const trace = new A1EventTrace(root, req.runId, req.candidateSha256, binding.digest(req), () => now++);
  trace.record('application-start', { documentGeneration: 0 });
  trace.setDocumentGeneration(1); trace.record('document-load-request'); trace.record('navigation-finished'); trace.record('ready');
  trace.record('acceptance-event', { acceptanceEvent: 'deny' });
  trace.record('reload-handler-entry', { reloadActionId: 'reload-1', targetDocumentGeneration: 2 });
  trace.record('acceptance-event', { acceptanceEvent: 'reload', reloadActionId: 'reload-1', targetDocumentGeneration: 2 });
  trace.record('reload-invocation', { reloadActionId: 'reload-1', targetDocumentGeneration: 2 });
  trace.setDocumentGeneration(2); trace.record('navigation-start', { reloadActionId: 'reload-1', sourceDocumentGeneration: 1 });
  trace.record('navigation-finished', { reloadActionId: 'reload-1', sourceDocumentGeneration: 1 }); trace.record('ready');
  for (const event of ['allow','read','display']) trace.record('acceptance-event', { acceptanceEvent: event });
  trace.record('reload-handler-entry', { reloadActionId: 'reload-2', targetDocumentGeneration: 3 });
  trace.record('acceptance-event', { acceptanceEvent: 'reload', reloadActionId: 'reload-2', targetDocumentGeneration: 3 });
  trace.record('reload-invocation', { reloadActionId: 'reload-2', targetDocumentGeneration: 3 });
  trace.setDocumentGeneration(3); trace.record('navigation-start', { reloadActionId: 'reload-2', sourceDocumentGeneration: 2 });
  trace.record('navigation-finished', { reloadActionId: 'reload-2', sourceDocumentGeneration: 2 }); trace.record('ready');
  for (const event of ['allow','read','display']) trace.record('acceptance-event', { acceptanceEvent: event });
  trace.record('window-close'); trace.record('result-publication');
  const result = { version: binding.contract.version, runId: req.runId, candidateSha256: req.candidateSha256,
    nonce: req.nonce, requestSha256: binding.digest(req), result: 'PASS', phase: 'close', reason: 'PASS',
    events: ['deny','reload','allow','read','display','reload','allow','read','display'] };
  return { root, req, result, trace };
}

test('A1 trace schema binds identity, generations, actions and terminal ordering', t => {
  const { req, result, trace } = passFixture(t);
  const checked = binding.validateTrace(trace.path, req, result);
  assert.equal(checked.status, 'VERIFIED');
  assert.equal(checked.acceptanceEvents.length, 9);
  const records = fs.readFileSync(trace.path, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  for (const record of records) {
    assert.ok(!Object.hasOwn(record, 'content'));
    assert.ok(!Object.hasOwn(record, 'path'));
    assert.ok(!Object.hasOwn(record, 'environment'));
  }
});

test('A1 PASS cannot be accepted with missing or corrupt provenance', t => {
  const { root, req, result, trace } = passFixture(t);
  assert.throws(() => binding.validateTrace(path.join(root, 'missing.jsonl'), req, result), /trace missing/);
  const corrupt = path.join(root, 'corrupt.jsonl');
  const first = JSON.parse(fs.readFileSync(trace.path, 'utf8').split(/\r?\n/)[0]);
  first.candidateSha256 = 'd'.repeat(64);
  fs.writeFileSync(corrupt, JSON.stringify(first));
  assert.throws(() => binding.validateTrace(corrupt, req, result));
});
