'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = 'e7a8ae4e2930ed4157163dfb36b3a7035e8846ff';
const runId = 'a1-native-001';
const run = path.join(root, '.tmp', runId);
const manifestFile = path.join(root, 'tasks/a1-admission-candidate.json');
const overlay = ['src/main/controlledAcceptance.ts', 'src/main/controlledApplication.ts', 'src/main/projectIpc.ts', 'src/preload/index.ts', 'src/renderer/src/ControlledRead.tsx'];
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
function verify({ fresh = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(safe(manifestFile), 'utf8'));
  assert.equal(manifest.version, 1); assert.equal(manifest.candidate.sourceCommit, baseline);
  assert.equal(digest(manifest.candidate), manifest.candidateSha256);
  const c = manifest.candidate;
  assert.equal(hash(fs.readFileSync(safe(path.join(run,'candidate.json')))),manifest.candidateSha256,'Candidate payload drift');
  assert.equal(c.runId, runId); assert.deepEqual(c.invocation, { executable: 'node_modules/electron/dist/electron.exe', entry: '.tmp/a1-native-001/artifact/main/index.js', args: ['--munder-controlled-read'] });
  assert.deepEqual(c.timeouts, { app: 60000, bootstrap: 30000, workload: 70000, cleanup: 10000, outer: 115000, fallback: 5000 });
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
function validateResult(result, req) {
  assert.deepEqual(result,{version:1,runId,candidateSha256:req.candidateSha256,nonce:req.nonce,requestSha256:hash(JSON.stringify(req)),result:'PASS',events:['deny','reload','allow','read','display','reload','allow','read','display']});
  return result;
}
module.exports={root,baseline,runId,run,manifestFile,overlay,adapterFiles,hash,digest,git,safe,inventory,environment,validateEnvironment,paths,verify,request,validateResult};
