import { chromium } from './runner/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const out='artifacts/qa/t4/implementation';
for(const file of ['runtime','validation']) {
 let source=execFileSync('git',['show',`32a6bf520754bf7444d978353e2c69537dcc0179:src/sim/${file}.ts`],{encoding:'utf8'});
 source=source.replaceAll("'../shared/","'../../../../src/shared/");
 for(const local of ['engine','physics','geometry'])source=source.replaceAll(`'./${local}'`,`'../../../../src/sim/${local}'`);
 source=source.replaceAll("'./validation'","'./baseline-validation'");
 await fs.writeFile(`${out}/baseline-${file}.ts`,source);
}
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
try {
 await page.goto('http://127.0.0.1:5194/');await page.waitForFunction(()=>window.__gridborn?.read().snapshot);await page.locator('[data-running]').click();
 const controlled=await page.evaluate(async()=>{
  const {WorkerRuntime:Old}=await import('/artifacts/qa/t4/implementation/baseline-runtime.ts');
  const {WorkerRuntime:Current}=await import('/src/sim/runtime.ts');
  const {validateTrack:oldValidate}=await import('/artifacts/qa/t4/implementation/baseline-validation.ts');
  const {validateTrack:currentValidate}=await import('/src/sim/validation.ts');
  const {ovalFixture}=await import('/src/sim/fixtures/oval.ts');
  const {DEFAULT_SETTINGS,snapshotTransferList}=await import('/src/shared/simulation.ts');
  class Host {
   time=0; tasks=new Map(); next=0;events=[];
   constructor(Type){this.runtime=new Type(this);}
   now(){return this.time;}
   schedule(callback,delay){const id=++this.next;this.tasks.set(id,{callback,at:this.time+Math.max(1e-6,delay)});return id;}
   cancel(id){this.tasks.delete(id);}
   send(event,transfer=[]){const copy=structuredClone(event,{transfer});this.events.push({type:copy.type,runId:copy.runId,time:this.time,tick:copy.snapshot?.tick,steps:copy.snapshot?.steps});if(copy.type==='snapshot')this.runtime.receive(structuredClone({type:'recycle',runId:copy.snapshot.runId,storage:copy.snapshot.storage},{transfer:snapshotTransferList(copy.snapshot.storage)}));}
   reset(id=10,settings={}){this.runtime.receive({type:'reset',runId:id,track:ovalFixture(),settings:{...DEFAULT_SETTINGS,population:16,eliteCount:2,...settings}});}
   advance(until){let limit=100000;while(this.tasks.size&&limit--){const [id,t]=[...this.tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(t.at>until)break;this.tasks.delete(id);this.time=t.at;t.callback();}if(!limit)throw Error('host queue failed to advance');}
  }
  const result={};for(const [name,Type]of[['baseline',Old],['current',Current]]){
   const rates=[];for(const rate of [1,4]){const h=new Host(Type);h.reset();h.runtime.receive({type:'set-rate',runId:10,rate});h.runtime.receive({type:'set-running',runId:10,running:true});h.events=[];h.advance(10000);const snapshots=h.events.filter(e=>e.type==='snapshot'&&e.steps>0);rates.push({rate,snapshotsPerSecond:snapshots.length/10,ticks:h.runtime.engine.tick,stepsPerSnapshot:snapshots.reduce((a,b)=>a+b.steps,0)/snapshots.length});}
   const h=new Host(Type);h.reset();h.runtime.receive({type:'set-running',runId:10,running:true});for(let i=0;i<8;i++)h.runtime.receive(i%2?{type:'set-running',runId:10,running:1}:{type:'set-rate',runId:10,rate:3});h.reset(11,{population:5000});h.advance(100);const errors=h.events.filter(e=>e.type==='error');result[name]={rates,errorCount:errors.length,invalidResetAcknowledged:errors.some(e=>e.runId===11),acceptedRun:h.runtime.engine.runId,oldRunTick:h.runtime.engine.tick};
  }
  const track=ovalFixture(),outer=track.walls.slice(track.walls.length/2),{x,y}=track.startLine.a,walls=new Float32Array(outer.length+16);walls.set(outer);walls.set([x,y,x+2,y,x+2,y,x+2,y+2,x+2,y+2,x,y+2,x,y+2,x,y],outer.length);
  for(const [name,validate]of[['baseline',oldValidate],['current',currentValidate]]){try{validate({...track,walls});result[name].fakeInnerAccepted=true;}catch(e){result[name].fakeInnerAccepted=false;result[name].fakeInnerError=e.message;}}
  return result;
 });
 const realWorker=await page.evaluate(async()=>{
  const {ovalFixture}=await import('/src/sim/fixtures/oval.ts');const {DEFAULT_SETTINGS,snapshotTransferList}=await import('/src/shared/simulation.ts');
  return await new Promise((resolve,reject)=>{
   const worker=new Worker('/src/sim/worker.ts',{type:'module'}),history=[],records=[];let resetError=false,run10Tick=0;
   const timeout=setTimeout(()=>{worker.terminate();reject(Error('worker regression timeout'));},60000);
   worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(Error(e.message));};
   worker.onmessage=({data:e})=>{
    if(e.type==='snapshot'){if(e.snapshot.runId===10)run10Tick=e.snapshot.tick;worker.postMessage({type:'recycle',runId:e.snapshot.runId,storage:e.snapshot.storage},snapshotTransferList(e.snapshot.storage));}
    if(e.type==='ready'&&e.runId===10){worker.postMessage({type:'set-running',runId:10,running:true});for(let i=0;i<8;i++)worker.postMessage(i%2?{type:'set-running',runId:10,running:1}:{type:'set-rate',runId:10,rate:3});worker.postMessage({type:'reset',runId:11,track:ovalFixture(),settings:{...DEFAULT_SETTINGS,population:5000}});setTimeout(()=>worker.postMessage({type:'reset',runId:12,track:ovalFixture(),settings:DEFAULT_SETTINGS}),150);}
    if(e.type==='error'&&e.runId===11)resetError=true;
    if(e.type==='ready'&&e.runId===12){worker.postMessage({type:'set-rate',runId:12,rate:'fast'});worker.postMessage({type:'set-running',runId:12,running:true});}
    if(e.type==='best'&&e.trajectory.car.runId===12)records.push({generation:e.trajectory.car.generation,lap:e.trajectory.lapSeconds,fitness:e.trajectory.fitness,samples:Array.from(e.trajectory.samples)});
    if(e.type==='generation'&&e.statistics.runId===12){history.push(e.statistics);if(history.length===30){clearTimeout(timeout);worker.terminate();resolve({resetError,run10Tick,fixtureFirst:history[0].bestLapSeconds,fixtureLast:Math.min(...history.map(x=>x.bestLapSeconds??Infinity)),history,records});}}
   };
   worker.postMessage({type:'reset',runId:10,track:ovalFixture(),settings:DEFAULT_SETTINGS});
  });
 });
 await fs.writeFile(`${out}/regression-results.json`,JSON.stringify({controlled,realWorker},null,2));
 console.log(JSON.stringify({controlled,realWorker:{resetError:realWorker.resetError,run10Tick:realWorker.run10Tick,fixtureFirst:realWorker.fixtureFirst,fixtureLast:realWorker.fixtureLast}},null,2));
}finally{await browser.close();}
