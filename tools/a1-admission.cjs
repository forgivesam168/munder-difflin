'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const binding=require('./a1-candidate.cjs');
const write=require('./research-write-receipt.cjs');
// No arbitrary argv/executable/root, no permit writer. A Human-authorized next
// turn may create ONE exact permit; merely verifying/building never creates it.
function validatePermit(permit, candidate, now=Date.now()) {
  assert.deepEqual(Object.keys(permit).sort(),['candidateSha256','expiresAt','runId','version']);
  assert.equal(permit.version,1);assert.equal(permit.runId,binding.runId);assert.equal(permit.candidateSha256,candidate.candidateSha256);
  assert.ok(Number.isSafeInteger(permit.expiresAt)&&permit.expiresAt>now&&permit.expiresAt-now<=600000,'Permit must expire within ten minutes');
}
async function run() {
  assert.equal(process.platform,'win32');
  const manifest=binding.verify();
  const permitPath=path.join(binding.run,'authorization.json');
  const permit=JSON.parse(fs.readFileSync(binding.safe(permitPath),'utf8'));validatePermit(permit,manifest);
  const req=binding.request(manifest,crypto.randomBytes(32).toString('hex'));
  // Atomic consumption, plus immutable request: all failures use up the attempt.
  fs.renameSync(permitPath,path.join(binding.run,'authorization.used.json'));
  fs.writeFileSync(path.join(binding.run,'request.json'),JSON.stringify(req),{flag:'wx'});
  const receipt={version:1,run:binding.run,runId:binding.runId,candidateSha256:manifest.candidateSha256,requestSha256:binding.digest(req),
    phase:'prepared',result:'INCOMPLETE',cleanup:'UNVERIFIED',persistenceFailed:false};
  const persist=()=>write(path.join(binding.run,'supervisor-receipt.json'),receipt);
  persist();
  return require('./windows-lifecycle-transport.cjs')({powershell:binding.paths().powershell,
    helperArgs:['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(binding.root,'tools/a1-supervisor.ps1')],
    run:binding.run,env:binding.environment(manifest.candidate.systemRoot,true),receipt,persist,mode:{success:'A1_PASS'},outerMs:manifest.candidate.timeouts.outer,
    bootstrapMs:manifest.candidate.timeouts.bootstrap,fallbackMs:manifest.candidate.timeouts.fallback,
    spawn:require('node:child_process').spawn,
    inspect:complete=>{
      assert.equal(complete.candidateSha256,manifest.candidateSha256);
      assert.equal(complete.requestSha256,binding.digest(req));
      binding.verify({fresh:false});
      const raw=fs.readFileSync(binding.safe(path.join(binding.paths().appData,'a1-result.json')));
      const terminal=binding.validateResult(JSON.parse(raw),req,{allowFailure:true});
      receipt.terminal={result:terminal.result,phase:terminal.phase,reason:terminal.reason};
      receipt.trace=binding.validateTrace(binding.safe(path.join(binding.run,'a1-event-trace.jsonl')),req,terminal,
        {allowMissing:terminal.result!=='PASS'});
      assert.deepEqual(JSON.parse(fs.readFileSync(binding.safe(path.join(binding.run,'request.json')))),req);
      receipt.resultSha256=binding.hash(raw);
    },
    accept:()=>assert.equal(receipt.terminal.result,'PASS')});
}
if(require.main===module) {
  const arg=process.argv.slice(2);assert.ok(arg.length===1&&['--verify','--run'].includes(arg[0]),'Only --verify or --run accepted');
  if(arg[0]==='--verify')console.log(JSON.stringify({candidateSha256:binding.verify().candidateSha256,gate:fs.existsSync(path.join(binding.run,'authorization.json'))?'PERMIT_PRESENT_NOT_CONSUMED':'CLOSED',nativeExecuted:false}));
  else run().then(result=>{console.log(JSON.stringify(result.receipt));process.exitCode=result.exitCode;},()=>{console.error('A1 admission refused; no retry');process.exitCode=1;});
}
module.exports={validatePermit,run};
