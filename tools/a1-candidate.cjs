'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = '40c4aefc227358b949bcf190119cf4c96f98c52a';
const contract = require('../src/shared/a1-contract.json');
const runId = contract.runId;
const run = path.join(root, '.tmp', runId);
const manifestFile = path.join(root, 'tasks/a1-admission-candidate-002.json');
const overlay = ['src/main/controlledAcceptance.ts', 'src/main/controlledApplication.ts', 'src/shared/a1-contract.json', 'src/preload/index.ts', 'src/renderer/src/ControlledRead.tsx'];
const adapterFiles = ['tools/a1-candidate.cjs', 'tools/a1-build.cjs', 'tools/a1-admission.cjs', 'tools/a1-supervisor.ps1', 'tools/windows-lifecycle-transport.cjs', 'tools/research-job-preflight.ps1', 'tools/research-write-receipt.cjs'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const git = (...args) => cp.execFileSync('git', args, { cwd: root });
function safe(file) {
  assert.equal(path.resolve(file), file);
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    assert.ok(!fs.lstatSync(current).isSymbolicLink(), 'Linked candidate path refused');
  }
  assert.equal(fs.realpathSync(file), file);
  return file;
}
function inventory(directory) {
  safe(directory);
  const result = {};
  function visit(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), st = fs.lstatSync(file);
      assert.ok(!st.isSymbolicLink(), 'Candidate links refused');
      if (st.isDirectory()) visit(file);
      else { assert.ok(st.isFile()); result[path.relative(directory, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file)); }
    }
  }
  visit(directory); return result;
}
function environment(systemRoot, helper = false) {
  assert.match(systemRoot, /^[A-Za-z]:\\[^\0]+$/);
  const data = path.join(run, helper ? 'helper-data' : 'app-data');
  const env = { SystemRoot: systemRoot, ComSpec: path.join(systemRoot, 'System32/cmd.exe'), PATHEXT: '.COM;.EXE;.BAT;.CMD',
    PATH: path.join(systemRoot, 'System32'), DO_NOT_TRACK: '1', TUNNELMOLE_TELEMETRY: '0', NODE_DISABLE_COMPILE_CACHE: '1',
    POWERSHELL_TELEMETRY_OPTOUT: '1', POWERSHELL_UPDATECHECK: 'Off', PSModuleAnalysisCachePath: path.join(run, 'helper-data/module-cache') };
  for (const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']) env[key] = path.join(data, key.toLowerCase());
  if (!helper) { env.MUNDER_A1_PROJECT = path.join(run, 'project'); env.MUNDER_A1_APP_DATA = data; }
  return env;
}
function validateEnvironment(actual, expected) { assert.deepEqual(actual, expected, 'A1 environment must exactly match fixed projection'); return actual; }
function paths() {
  return { run, entry: path.join(run, 'artifact/main/index.js'), executable: path.join(root, 'node_modules/electron/dist/electron.exe'),
    powershell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', project: path.join(run, 'project'), appData: path.join(run, 'app-data') };
}
function timeouts(value = contract) {
  assert.deepEqual(value, contract, 'A1 contract drift');
  for (const n of [...Object.values(value.phaseMs), ...Object.values(value.supervisorMs), value.unboundMs])
    assert.ok(Number.isSafeInteger(n) && n > 0 && n < 2147483647, 'Invalid bounded timer');
  const inner = Object.values(value.phaseMs).reduce((a, b) => a + b, 0);
  const { bootstrap, launchMargin, cleanup, outerMargin, fallback } = value.supervisorMs;
  const workload = inner + launchMargin;
  const outer = bootstrap + workload + cleanup + outerMargin;
  assert.ok(inner < workload && workload + cleanup < outer && outer + fallback < 2147483647);
  return { ...value.phaseMs, bootstrap, launchMargin, workload, cleanup, outerMargin, outer, fallback };
}
function validateTimeouts(candidate) {
  assert.deepEqual(candidate.contract, contract, 'Missing or mismatched A1 contract');
  assert.deepEqual(candidate.timeouts, timeouts(candidate.contract), 'Inconsistent A1 timing budgets');
}
function verify({ fresh = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(safe(manifestFile), 'utf8'));
  assert.equal(manifest.version, 1); assert.equal(manifest.candidate.sourceCommit, baseline);
  assert.equal(digest(manifest.candidate), manifest.candidateSha256);
  const c = manifest.candidate;
  assert.equal(hash(fs.readFileSync(safe(path.join(run,'candidate.json')))),manifest.candidateSha256,'Candidate payload drift');
  assert.equal(c.runId, runId); assert.deepEqual(c.invocation, { executable: 'node_modules/electron/dist/electron.exe', entry: '.tmp/a1-native-002/artifact/main/index.js', args: ['--munder-controlled-read'] });
  validateTimeouts(c);
  assert.deepEqual(Object.keys(c.adapterSha256).sort(), [...adapterFiles].sort());
  for (const [p,h] of Object.entries(c.adapterSha256)) assert.equal(hash(fs.readFileSync(safe(path.join(root,p)))),h,'Adapter drift');
  assert.deepEqual(Object.keys(c.overlaySha256).sort(), [...overlay].sort());
  for (const [p,h] of Object.entries(c.overlaySha256)) assert.equal(hash(fs.readFileSync(safe(path.join(root,p)))),h,'Overlay drift');
  for (const [p,info] of Object.entries(c.sourceInputs)) {
    assert.ok(!path.isAbsolute(p) && !p.split('/').includes('..'));
    if (info.blob) { assert.equal(git('rev-parse',baseline+':'+p).toString().trim(),info.blob); assert.equal(hash(git('cat-file','blob',info.blob)),info.sha256); }
  }
  assert.deepEqual(inventory(path.join(run,'artifact')), c.outputs, 'Runnable artifact drift');
  assert.deepEqual(inventory(path.join(root,'node_modules/electron/dist')), c.electron.files, 'Electron distribution drift');
  assert.equal(hash(fs.readFileSync(safe(paths().powershell))),c.powershellSha256);
  assert.equal(hash(fs.readFileSync(safe(process.execPath))),c.nodeSha256);
  assert.deepEqual(inventory(paths().project), { 'readme.txt': hash('A1 synthetic read\n') });
  assert.equal(c.configurationSha256,digest({child:environment(c.systemRoot),helper:environment(c.systemRoot,true)}));
  if(fresh) {
    for(const name of ['request.json','authorization.used.json','native-attempt.json','supervisor-receipt.json']) assert.ok(!fs.existsSync(path.join(run,name)), 'Attempt already consumed');
    for(const group of ['app-data','helper-data']) {
      const dir=path.join(run,group);safe(dir);
      assert.deepEqual(fs.readdirSync(dir).sort(),['appdata','home','localappdata','temp','tmp','userprofile']);
      for(const name of fs.readdirSync(dir)) {const p=path.join(dir,name);safe(p);assert.ok(fs.statSync(p).isDirectory());assert.equal(fs.readdirSync(p).length,0);}
    }
  }
  return manifest;
}
function request(manifest, nonce) {
  assert.match(nonce,/^[a-f0-9]{64}$/);
  return {version:1,runId,candidateSha256:manifest.candidateSha256,environmentSha256:manifest.candidate.configurationSha256,nonce};
}
function validateResult(result, req, { allowFailure = false } = {}) {
  assert.deepEqual(Object.keys(result).sort(), ['version','runId','candidateSha256','nonce','requestSha256','result','phase','reason','events'].sort());
  assert.equal(result.version, contract.version); assert.equal(result.runId, runId);
  assert.equal(result.candidateSha256, req.candidateSha256); assert.equal(result.nonce, req.nonce);
  assert.equal(result.requestSha256, hash(JSON.stringify(req)));
  const sequence = ['deny','reload','allow','read','display','reload','allow','read','display'];
  assert.ok(['startup','human','close'].includes(result.phase));
  assert.ok(Array.isArray(result.events) && result.events.length <= sequence.length + 1 && result.events.every(e => typeof e === 'string'));
  if (result.result === 'PASS') {
    assert.equal(result.reason, 'PASS'); assert.equal(result.phase, 'close'); assert.deepEqual(result.events, sequence);
  } else {
    assert.equal(result.result, 'FAIL');
    assert.ok(['STARTUP_TIMEOUT','HUMAN_INTERACTION_TIMEOUT','CLOSE_TIMEOUT','RENDERER_GONE','SEQUENCE_MISMATCH','NORMAL_CLOSE_INCOMPLETE'].includes(result.reason));
    const timeoutPhase = { STARTUP_TIMEOUT:'startup', HUMAN_INTERACTION_TIMEOUT:'human', CLOSE_TIMEOUT:'close' }[result.reason];
    if (timeoutPhase) assert.equal(result.phase, timeoutPhase);
    if (result.reason !== 'SEQUENCE_MISMATCH') assert.deepEqual(result.events, sequence.slice(0, result.events.length));
    if (result.phase === 'startup' && result.reason !== 'SEQUENCE_MISMATCH') assert.deepEqual(result.events, []);
    if (result.phase === 'close' && result.reason !== 'SEQUENCE_MISMATCH') assert.deepEqual(result.events, sequence);
    assert.ok(allowFailure, 'A1 task failed: ' + result.reason);
  }
  return result;
}
module.exports={root,baseline,runId,run,manifestFile,overlay,adapterFiles,hash,digest,git,safe,inventory,environment,validateEnvironment,paths,verify,request,validateResult,contract,timeouts,validateTimeouts};
