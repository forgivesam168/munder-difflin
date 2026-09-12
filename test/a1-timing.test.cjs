'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ControlledAcceptance,A1_SEQUENCE}=require('./load-ts.cjs')('src/main/controlledAcceptance.ts');
const binding=require('../tools/a1-candidate.cjs');
const {phaseMs}=binding.contract;
function harness() {
  let now=0,id=0,terminal,failures=0;
  const pending=new Map();
  const clock={now:()=>now,setTimeout(fn,ms){const key=++id;pending.set(key,{fn,at:now+ms});return key;},clearTimeout(key){pending.delete(key);}};
  const state=new ControlledAcceptance(r=>terminal=r,()=>failures++,clock);
  return {state,pending,get terminal(){return terminal;},get failures(){return failures;},
    advance(ms,fire=true){now+=ms;if(fire)for(const [key,timer] of [...pending])if(timer.at<=now){pending.delete(key);timer.fn();}},
    due(){return [...pending.values()][0]?.at;}};
}
function sequence(h){for(const event of A1_SEQUENCE)event==='display'?h.state.display('A1 synthetic read\n'):h.state.observe(event);}
test('before trusted Ready: startup timeout has a distinct phase/reason and exits once',()=>{
  const h=harness();h.advance(phaseMs.startup);assert.deepEqual(h.terminal,{result:'FAIL',phase:'startup',reason:'STARTUP_TIMEOUT',events:[]});
  h.state.ready();h.state.finish();assert.equal(h.failures,1);assert.equal(h.pending.size,0);
});
test('Ready starts one fixed Human deadline; delayed event cannot escape startup expiry',()=>{
  const h=harness();h.advance(phaseMs.startup-1);h.state.ready();assert.equal(h.due(),phaseMs.startup-1+phaseMs.human);
  h.advance(phaseMs.human);assert.equal(h.terminal.reason,'HUMAN_INTERACTION_TIMEOUT');assert.equal(h.terminal.phase,'human');
  const late=harness();late.advance(phaseMs.startup,false);late.state.ready();assert.equal(late.terminal.reason,'STARTUP_TIMEOUT');
});
test('reload Ready and partial progress never reset total Human budget',()=>{
  const h=harness();h.state.ready();const deadline=h.due();
  h.advance(1000);h.state.observe('deny');h.state.observe('reload');h.state.ready();assert.equal(h.due(),deadline);
  h.advance(1000);h.state.observe('allow');h.state.observe('read');h.state.display('A1 synthetic read\n');assert.equal(h.due(),deadline);
  h.advance(phaseMs.human-2000);assert.equal(h.terminal.reason,'HUMAN_INTERACTION_TIMEOUT');assert.equal(h.terminal.events.length,5);
});
test('out-of-sequence and wrong display fail immediately with diagnostics',()=>{
  for(const action of [s=>s.observe('allow'),s=>s.display('wrong')]){const h=harness();h.state.ready();action(h.state);assert.equal(h.terminal.reason,'SEQUENCE_MISMATCH');assert.equal(h.failures,1);}
});
test('final display starts a short close budget; Ready cannot renew it',()=>{
  const h=harness();h.state.ready();h.advance(1000);sequence(h);assert.equal(h.due(),1000+phaseMs.close);
  h.state.ready();h.advance(phaseMs.close);assert.equal(h.terminal.reason,'CLOSE_TIMEOUT');assert.equal(h.terminal.phase,'close');assert.deepEqual(h.terminal.events,[...A1_SEQUENCE]);
});
test('complete sequence requires normal close; incomplete close and renderer-gone differ',()=>{
  const h=harness();h.state.ready();sequence(h);assert.equal(h.terminal,undefined);h.state.finish();assert.equal(h.terminal.reason,'PASS');assert.equal(h.failures,0);assert.equal(h.pending.size,0);
  const incomplete=harness();incomplete.state.ready();incomplete.state.finish();assert.equal(incomplete.terminal.reason,'NORMAL_CLOSE_INCOMPLETE');
  const gone=harness();gone.state.ready();gone.state.rendererGone();assert.equal(gone.terminal.reason,'RENDERER_GONE');assert.equal(gone.failures,1);
});
test('Human deadline wins over queued progress even if timer callback has not run',()=>{
  const h=harness();h.state.ready();h.advance(phaseMs.human,false);sequence(h);assert.equal(h.terminal.reason,'HUMAN_INTERACTION_TIMEOUT');assert.deepEqual(h.terminal.events,[]);
});
test('single contract derives strict inner < Job < outer with cleanup/fallback bounds',()=>{
  const t=binding.timeouts();assert.equal(t.workload,phaseMs.startup+phaseMs.human+phaseMs.close+t.launchMargin);
  assert.equal(t.outer,t.bootstrap+t.workload+t.cleanup+t.outerMargin);
  binding.validateTimeouts({contract:binding.contract,timeouts:t});
  for(const outer of [t.workload,t.workload+t.cleanup,t.outer-1])assert.throws(()=>binding.validateTimeouts({contract:binding.contract,timeouts:{...t,outer}}),/timing budgets/);
  assert.throws(()=>binding.validateTimeouts({contract:{...binding.contract,phaseMs:{...phaseMs,human:0}},timeouts:t}),/contract/);
  assert.throws(()=>binding.validateTimeouts({timeouts:t}),/Missing or mismatched/);
});
test('terminal diagnostics remain request-bound; Human failure is never task PASS',()=>{
  const req=binding.request({candidateSha256:'a'.repeat(64),candidate:{configurationSha256:'b'.repeat(64)}},'c'.repeat(64));
  const h=harness();h.state.ready();h.advance(phaseMs.human);
  const result={version:binding.contract.version,runId:binding.runId,candidateSha256:req.candidateSha256,nonce:req.nonce,requestSha256:binding.digest(req),...h.terminal};
  binding.validateResult(result,req,{allowFailure:true});assert.throws(()=>binding.validateResult(result,req),/HUMAN_INTERACTION_TIMEOUT/);
  for(const delta of [{phase:'close'},{reason:'PASS'},{nonce:'d'.repeat(64)},{requestSha256:'d'.repeat(64)},{candidateSha256:'d'.repeat(64)},{runId:'a1-native-001'},{extra:true}])assert.throws(()=>binding.validateResult({...result,...delta},req,{allowFailure:true}));
});
