'use strict';
// Fixed repository-local builder. No Electron, package manager, lifecycle scripts,
// external downloads or old out/package inputs are executed by this command.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const binding=require('./a1-candidate.cjs');
async function buildCandidate() {
  const {root,run,baseline}=binding;
  binding.git('merge-base','--is-ancestor',baseline,'HEAD'); // Archive remains fixed; a later scoped checkpoint is reproducible.
  for(const name of ['package.json','package-lock.json','electron.vite.config.ts']) assert.equal(binding.git('hash-object','--path='+name,name).toString().trim(),binding.git('rev-parse',baseline+':'+name).toString().trim());
  assert.ok(!fs.existsSync(run)&&!fs.existsSync(binding.manifestFile),'Candidate already exists; no overwrite/retry');
  const stage=path.join(root,'.tmp/a1-build-source-007');
  assert.ok(!fs.existsSync(stage),'Build source already exists');
  binding.safe(path.join(root,'.tmp'));fs.mkdirSync(stage);
  // Git archive contains only committed paths. Compatibility worktree never enters.
  const inputs=['src','docs','resources','package.json','package-lock.json','electron.vite.config.ts','tsconfig.json','tsconfig.node.json','tsconfig.web.json'];
  const archive=cp.execFileSync('git',['archive','--format=tar',baseline,...inputs],{cwd:root,maxBuffer:100*1024*1024});
  cp.execFileSync('tar',['-xf','-','-C',stage],{input:archive,windowsHide:true});
  for(const p of binding.overlay)fs.copyFileSync(binding.safe(path.join(root,p)),path.join(stage,p));
  const {resolveConfig}=await import('electron-vite'),{build}=await import('vite');
  const watched=new Set();
  const resolved=await resolveConfig({root:stage,configFile:path.join(stage,'electron.vite.config.ts'),envFile:false,
    build:{write:false},define:{__POSTHOG_KEY__:'""'},logLevel:'error',plugins:[{name:'a1-input-identity',buildEnd(){for(const file of this.getWatchFiles())watched.add(file.split('?')[0]);}}]},'build','production');
  const outputs={};
  for(const target of ['main','preload','renderer']) {
    const result=await build(resolved.config[target]);assert.ok(!Array.isArray(result));outputs[target]=result.output;
  }
  const chunks=outputs.main.filter(o=>o.type==='chunk'),controlled=chunks.find(o=>o.facadeModuleId?.endsWith('/controlledApplication.ts'));
  assert.ok(controlled);const seen=new Set();
  function visit(name){if(seen.has(name))return;seen.add(name);const chunk=chunks.find(c=>c.fileName===name);if(!chunk){assert.ok(name==='electron'||name.startsWith('node:'),'Unexpected controlled dependency');return;}
    for(const id of Object.keys(chunk.modules))assert.ok(!/\/src\/main\/(index|config|pty|analytics|integrations)\.ts$/.test(id),'Controlled graph includes services');
    for(const id of chunk.imports)visit(id);
  }
  visit(controlled.fileName);for(const chunk of chunks)assert.equal(path.basename(chunk.fileName),chunk.fileName);
  fs.mkdirSync(run);
  for(const target of ['main','preload','renderer'])for(const output of outputs[target]){
    assert.ok(!path.isAbsolute(output.fileName)&&!output.fileName.split('/').includes('..'));
    const dest=path.join(run,'artifact',target,output.fileName);fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,output.type==='chunk'?output.code:output.source,{flag:'wx'});
  }
  for(const file of ['slack-trigger.cjs','kg-core.cjs'])fs.copyFileSync(path.join(stage,'src/main',file),path.join(run,'artifact/main',file),fs.constants.COPYFILE_EXCL);
  for(const group of ['app-data','helper-data'])for(const key of ['home','userprofile','appdata','localappdata','temp','tmp'])fs.mkdirSync(path.join(run,group,key),{recursive:true});
  fs.mkdirSync(path.join(run,'project'));fs.writeFileSync(path.join(run,'project/readme.txt'),'A1 synthetic read\n',{flag:'wx'});
  const sourceInputs={};
  for(const file of [...watched,...['package.json','package-lock.json','electron.vite.config.ts'].map(p=>path.join(stage,p))].sort()) {
    const rel=path.relative(stage,file).replaceAll('\\','/');if(rel.startsWith('../')||path.isAbsolute(rel)||!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
    sourceInputs[rel]={sha256:binding.hash(fs.readFileSync(file)),blob:binding.overlay.includes(rel)?null:binding.git('rev-parse',baseline+':'+rel).toString().trim()};
  }
  const map=files=>Object.fromEntries(files.map(p=>[p,binding.hash(fs.readFileSync(path.join(root,p)))]));
  const systemRoot=process.env.SystemRoot;assert.ok(systemRoot);binding.safe(systemRoot);
  const candidate={sourceCommit:baseline,runId:binding.runId,sourceInputs,overlaySha256:map(binding.overlay),adapterSha256:map(binding.adapterFiles),
    build:{command:'node tools/a1-build.cjs',mode:'production',sourceDirectory:'.tmp/a1-build-source-007',write:'memory bundle then exclusive artifact files',envFile:false,posthogKey:'empty',
      node:process.version,dependencies:Object.fromEntries(['typescript','electron-vite','vite','esbuild'].map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'))).version]))},
    outputs:binding.inventory(path.join(run,'artifact')),electron:{version:JSON.parse(fs.readFileSync(path.join(root,'node_modules/electron/package.json'))).version,files:binding.inventory(path.join(root,'node_modules/electron/dist'))},
    powershellSha256:binding.hash(fs.readFileSync(binding.safe(binding.paths().powershell))),nodeSha256:binding.hash(fs.readFileSync(binding.safe(process.execPath))),
    systemRoot,configurationSha256:binding.digest({child:binding.environment(systemRoot),helper:binding.environment(systemRoot,true)}),
    syntheticProject:{root:'.tmp/a1-native-007/project',files:{'readme.txt':binding.hash('A1 synthetic read\n')}},
    invocation:{executable:'node_modules/electron/dist/electron.exe',entry:'.tmp/a1-native-007/artifact/main/index.js',args:['--munder-controlled-read']},
    contract:binding.contract,timeouts:binding.timeouts(),
    receipt:{requestVersion:1,resultVersion:binding.contract.version,supervisorVersion:1,sequence:['deny','reload','allow','read','display','reload','allow','read','display'],finish:'normal close'},
    limitations:['Native run NOT EXECUTED; no native dialog/full-app/worker/company PASS','Job accounting is not task completion; bound app result also required','Hashes are freshness, not authenticity or loaded-code attestation','Trusted local OS/SystemRoot and existing PowerShell runtime; no OS sandbox/credential isolation','Concurrent same-user changes and hostile launchers not isolated','Ordinary app services bundled but excluded from controlled load graph; dependencies not repackaged']};
  const manifest={version:1,candidateSha256:binding.digest(candidate),candidate,nativeAuthorization:'CLOSED: authorization.json absent; no automatic permit writer'};
  fs.writeFileSync(path.join(run,'candidate.json'),JSON.stringify(candidate),{flag:'wx'});
  fs.writeFileSync(binding.manifestFile,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  binding.verify();console.log(JSON.stringify({candidateSha256:manifest.candidateSha256,outputs:Object.keys(candidate.outputs).length,sourceInputs:Object.keys(sourceInputs).length,status:'BUILT_NOT_RUN'}));
}
if(require.main===module){if(process.argv.length!==2)throw Error('No builder arguments accepted');buildCandidate().catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports=buildCandidate;
