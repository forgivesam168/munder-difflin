'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('src/renderer/src/ControlledRead.tsx','utf8');
function document() {
 const slots=[],deps=[],effects=[],updates=[];let cursor=0,ec=0,reloads=0,readyResolve,readResolve;
 const calls=[];
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>updates.push(()=>{slots[i]=value;})];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,d){const i=ec++;if(!deps[i]||d.some((v,j)=>v!==deps[i][j])){deps[i]=d;effects.push(fn);}}};
 const window={location:{reload(){reloads++;}},cth:{controlledReadProject(){calls.push('project');return Promise.resolve({projectRoot:'synthetic'});},controlledReadReady(){calls.push('ready');return new Promise(resolve=>{readyResolve=resolve;});},readFile(){calls.push('read');return new Promise(resolve=>{readResolve=resolve;});},controlledReadDisplayed(){calls.push('display');return Promise.resolve();}}};
 const module={exports:{}};const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext('(function(require,module,exports){'+code+'})',{window})(id=>id==='react'?react:require(id),module,module.exports);
 function nodes(n){return n&&typeof n==='object'?[n,...[n.props?.children].flat(Infinity).flatMap(nodes)]:[];}
 function render(){for(const fn of updates.splice(0))fn();cursor=ec=0;const tree=nodes(module.exports.ControlledRead());for(const fn of effects.splice(0))fn();return {reload:tree.find(n=>n.type==='button'&&n.props.children==='Reload and revoke access').props,read:tree.find(n=>n.type==='button'&&n.props.children==='Read file').props};}
 return {render,calls,get reloads(){return reloads;},ready(){readyResolve();},finishRead(){readResolve({ok:false,error:'Denied'});}};
}
// Drain cross-realm async continuations; no elapsed-time Ready assumption.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Reload waits for trusted Ready, busy blocks it, same-document clicks latch before React commit',async()=>{
 const d=document();let ui=d.render();assert.equal(ui.reload.disabled,true);ui.reload.onClick();assert.equal(d.reloads,0);
 await tick();ui=d.render();assert.equal(ui.reload.disabled,true);ui.reload.onClick();assert.equal(d.reloads,0);
 d.ready();await tick();ui=d.render();assert.equal(ui.reload.disabled,false);
 ui.read.onClick();ui=d.render();assert.equal(ui.reload.disabled,true);ui.reload.onClick();assert.equal(d.reloads,0);
 d.finishRead();await tick();ui=d.render();assert.equal(ui.reload.disabled,false);
 // Invoke the SAME closure twice without committing queued setState updates.
 ui.reload.onClick();ui.reload.onClick();assert.equal(d.reloads,1);
 ui=d.render();assert.equal(ui.reload.disabled,true);ui.reload.onClick();assert.equal(d.reloads,1);
 assert.deepEqual(d.calls,['project','ready','read']); // guard adds no IPC/acceptance event
});
test('fresh document waits again; unresolved Ready never automatically reloads or enables controls',async()=>{
 const d=document();d.render();await tick();let ui=d.render();
 for(let i=0;i<5;i++){await tick();ui=d.render();assert.equal(ui.reload.disabled,true);assert.equal(ui.read.disabled,true);ui.reload.onClick();}
 assert.equal(d.reloads,0);assert.deepEqual(d.calls,['project','ready']);
 d.ready();await tick();assert.equal(d.render().reload.disabled,false);
 const next=document();assert.equal(next.render().reload.disabled,true);await tick();assert.equal(next.render().reload.disabled,true);assert.equal(next.reloads,0);
});
