'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const binding=require('../tools/a1-candidate.cjs'),admission=require('../tools/a1-admission.cjs');
const {ControlledAcceptance,A1_SEQUENCE,controlledAcceptance}=require('./load-ts.cjs')('src/main/controlledAcceptance.ts');
const payload={runId:binding.runId,contract:binding.contract,configurationSha256:'b'.repeat(64)};
const candidate={candidateSha256:binding.digest(payload)};
const req=binding.request({candidateSha256:candidate.candidateSha256,candidate:{configurationSha256:'b'.repeat(64)}},'c'.repeat(64));
const good={version:binding.contract.version,phase:'close',reason:'PASS',runId:binding.runId,candidateSha256:req.candidateSha256,nonce:req.nonce,requestSha256:binding.digest(req),result:'PASS',events:[...A1_SEQUENCE]};
function transport(accept=()=>{},inspect=()=>{}) {
  const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kills:0,kill(){this.kills++},unref(){}});
  const timers=new Map(),receipt={result:'INCOMPLETE',cleanup:'UNVERIFIED',persistenceFailed:false};
  const pending=require('../tools/windows-lifecycle-transport.cjs')({powershell:'fixed',helperArgs:[],run:'run',env:{},receipt,persist(){},accept,inspect,mode:{success:'A1_PASS'},outerMs:binding.timeouts().outer,bootstrapMs:binding.timeouts().bootstrap,fallbackMs:binding.timeouts().fallback,spawn:()=>child,
    setTimeout(fn,ms){const k={};timers.set(k,{fn,ms});return k;},clearTimeout(k){timers.delete(k);}});
  return {child,timers,receipt,pending};
}
const native={Member:true,ActiveProcesses:0,ChildExit:0,TimedOut:false,RootFailed:false,RootTimedOut:false,TerminationSucceeded:false,ReceiptWriteFailed:false,SuspendedBeforeClose:false,QueryErrorCode:null,TerminationErrorCode:null};
function complete(h,n=native){h.child.stdout.write(JSON.stringify({phase:'ready'})+'\n');h.child.stdout.write(JSON.stringify({phase:'complete',run:'run',native:n})+'\n');h.child.emit('close',0,null);}
test('Human permit is exact, expiring and distinct from verify/build',()=>{
 const p={version:1,runId:binding.runId,candidateSha256:candidate.candidateSha256,expiresAt:2000};
 admission.validatePermit(p,candidate,1000);
 for(const change of [{candidateSha256:'d'.repeat(64)},{runId:'other'},{expiresAt:1000},{expiresAt:9999999},{executable:'anything'},{version:'1'}])assert.throws(()=>admission.validatePermit({...p,...change},candidate,1000));
 assert.ok(!fs.existsSync(path.join(binding.run,'authorization.json')));
});
test('fixed environment refuses missing, extra, aliases and host fallback',()=>{
 const env=binding.environment('C:\\Windows');binding.validateEnvironment({...env},env);
 for(const key of Object.keys(env)){const bad={...env};delete bad[key];assert.throws(()=>binding.validateEnvironment(bad,env));}
 for(const bad of [{...env,CODEX_HOME:'host'},{...env,HOME:'host'},{...env,home:env.HOME}])assert.throws(()=>binding.validateEnvironment(bad,env));
 assert.equal(env.MUNDER_A1_PROJECT,binding.paths().project);
 assert.deepEqual(binding.paths().entry,path.join(binding.run,'artifact/main/index.js'));
});
test('task sequence requires both fresh consents, read deliveries, renderer acknowledgements and normal close',()=>{
 for(const omit of [-1,...A1_SEQUENCE.map((_,i)=>i)]){let actual;const state=new ControlledAcceptance(r=>actual=r);state.ready();A1_SEQUENCE.forEach((e,i)=>{if(i!==omit)state.observe(e);});state.finish();assert.equal(actual.result,omit===-1?'PASS':'FAIL');}
 for(const reason of ['timeout','bad-content','repeat']){let actual;const state=new ControlledAcceptance(r=>actual=r);state.ready();for(const e of A1_SEQUENCE)state.observe(e);if(reason==='bad-content')state.display('wrong');if(reason==='repeat')state.observe('read');reason==='timeout'?state.rendererGone():state.finish();assert.equal(actual.result,'FAIL');}
});
test('bound result rejects stale candidate/nonce/request, partial and supervisor-only PASS',()=>{
 binding.validateResult(good,req);
 for(const delta of [{candidateSha256:'d'.repeat(64)},{nonce:'d'.repeat(64)},{requestSha256:'d'.repeat(64)},{events:[]},{result:'INCOMPLETE'},{version:1}])assert.throws(()=>binding.validateResult({...good,...delta},req));
 assert.throws(()=>binding.validateResult({result:'PASS',ActiveProcesses:0},req));
});
test('real product result producer writes request-bound receipt only on completed close',t=>{
 const base=fs.mkdtempSync(path.join(binding.root,'.tmp/a1-result-test-'));const appData=path.join(base,'app-data');fs.mkdirSync(appData);
 t.after(()=>{assert.ok(base.startsWith(path.join(binding.root,'.tmp/a1-result-test-')));fs.rmSync(base,{recursive:true});});
 fs.writeFileSync(path.join(base,'request.json'),JSON.stringify(req));
 fs.writeFileSync(path.join(base,'candidate.json'),JSON.stringify(payload));
 const producer=controlledAcceptance({appData,projectRoot:path.join(base,'project')});
 producer.ready();
 for(const e of A1_SEQUENCE){if(e==='display')producer.display('A1 synthetic read\n');else producer.observe(e);}
 assert.ok(!fs.existsSync(path.join(appData,'a1-result.json')));producer.finish();
 binding.validateResult(JSON.parse(fs.readFileSync(path.join(appData,'a1-result.json'))),req);
 assert.throws(()=>controlledAcceptance({appData,projectRoot:path.join(base,'project')}),/already exists/);
});
test('helper exit0 with missing result fails while successful Job-empty remains separate',async()=>{
 const h=transport(()=>{throw Error('missing result')});complete(h);const r=await h.pending;assert.equal(r.exitCode,1);assert.equal(r.receipt.cleanup,'VERIFIED_EMPTY');
});
test('valid task result cannot override unknown or nonempty cleanup',async()=>{
 for(const delta of [{ActiveProcesses:1},{Member:false},{QueryErrorCode:87}]){const h=transport(()=>binding.validateResult(good,req));complete(h,{...native,...delta});assert.equal((await h.pending).exitCode,1);}
});
test('bound task result plus root0 and observed empty job is the only complete outcome',async()=>{
 const h=transport(()=>binding.validateResult(good,req));complete(h);const r=await h.pending;assert.equal(r.exitCode,0);assert.equal(r.receipt.result,'A1_PASS');assert.equal(r.receipt.cleanup,'VERIFIED_EMPTY');
});
test('contract outer timeout targets only retained helper and fallback never establishes cleanup',async()=>{
 const h=transport();[...h.timers.values()].find(t=>t.ms===binding.timeouts().outer).fn();assert.equal(h.child.kills,1);[...h.timers.values()].find(t=>t.ms===binding.timeouts().fallback).fn();const r=await h.pending;assert.equal(r.exitCode,1);assert.equal(r.receipt.cleanup,'UNVERIFIED');
});


test('nonzero app exit retains bound terminal diagnostics independently of Job timeout',async()=>{
 const terminal={...good,result:'FAIL',phase:'human',reason:'HUMAN_INTERACTION_TIMEOUT',events:[]};
 const h=transport(()=>assert.fail('Failed root must not reach success acceptance'),()=>{
   binding.validateResult(terminal,req,{allowFailure:true});h.receipt.terminal=terminal;
 });
 complete(h,{...native,ChildExit:1,RootFailed:true});const result=await h.pending;
 assert.equal(result.exitCode,1);assert.equal(result.receipt.cleanup,'VERIFIED_EMPTY');
 assert.equal(result.receipt.terminal.reason,'HUMAN_INTERACTION_TIMEOUT');assert.equal(result.receipt.native.TimedOut,false);
});
