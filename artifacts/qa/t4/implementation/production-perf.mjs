import { chromium } from './runner/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[],raw=[];
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
// External observation only: production source has no diagnostics or sample hooks.
await context.addInitScript(()=>{
 const NativeWorker=window.Worker,nativeRAF=window.requestAnimationFrame.bind(window);
 let sampling=false,frames=[],deliveries=[],last=null,callbackMs=0,motion=0,drawn=0;
 window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',({data:e})=>{if(e.type==='snapshot'){const s=e.snapshot;last={tick:s.tick,generation:s.generation,rate:s.rate,running:s.running,population:s.population};if(sampling)deliveries.push([performance.now(),s.tick,s.steps,s.computeMs,s.alive,s.generation]);}});}};
 window.requestAnimationFrame=callback=>nativeRAF(time=>{const start=performance.now();callback(time);callbackMs+=performance.now()-start;});
 const clear=CanvasRenderingContext2D.prototype.clearRect,translate=CanvasRenderingContext2D.prototype.translate;
 CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.classList.contains('hero-canvas')){motion=0;drawn=0;}return clear.apply(this,args);};
 CanvasRenderingContext2D.prototype.translate=function(x,y){if(this.canvas.classList.contains('hero-canvas')){drawn++;motion+=x*(drawn*8+1)+y*(drawn*8+2);}return translate.call(this,x,y);};
 function observe(time){if(sampling)frames.push([time,callbackMs,last?.tick??0,drawn,motion]);callbackMs=0;nativeRAF(observe);}nativeRAF(observe);
 window.__probe={read:()=>last,begin(){sampling=true;frames=[];deliveries=[];callbackMs=0;},end(){sampling=false;return {frames,deliveries};}};
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
const pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];
try {
await page.goto('http://127.0.0.1:4194/');await page.waitForFunction(()=>window.__probe.read()?.tick>0);
for(const population of [512,1000])for(const age of ['early','evolved'])for(const rate of ['1','4','fast']){
 await page.locator('[data-population]').selectOption(String(population));
 await page.waitForFunction(p=>window.__probe.read()?.population===p,population);
 await page.locator('[data-rate="1"]').click();await page.locator('.control-rail [data-reset]').click();
 await page.waitForFunction(()=>window.__probe.read()?.generation===1&&window.__probe.read()?.tick<60);
 if(age==='evolved'){await page.locator('[data-rate="fast"]').click();await page.waitForFunction(()=>window.__probe.read()?.generation>=16,{},{timeout:60000});}
 await page.locator(`[data-rate="${rate}"]`).click();await page.waitForFunction(r=>String(window.__probe.read()?.rate)===r,rate);await page.waitForTimeout(1000);
 const before=await page.evaluate(()=>{const d=window.__probe.read();window.__probe.begin();return d;});await page.waitForTimeout(5000);
 const data=await page.evaluate(()=>window.__probe.end()),f=data.frames,d=data.deliveries,seconds=(f.at(-1)[0]-f[0][0])/1000;
 const intervals=f.slice(1).map((x,i)=>x[0]-f[i][0]),steps=d.reduce((sum,x)=>sum+x[2],0),compute=d.reduce((sum,x)=>sum+x[3],0);
 let fresh=0,motion=0;for(let i=1;i<f.length;i++){if(f[i][2]!==f[i-1][2])fresh++;if(f[i][4]!==f[i-1][4])motion++;}
 const row={population,age,rate,fromGeneration:before.generation,toGeneration:d.at(-1)[5],fps:(f.length-1)/seconds,frameP95:pct(intervals,.95),costMean:f.reduce((sum,x)=>sum+x[1],0)/f.length,costP95:pct(f.map(x=>x[1]),.95),freshStateShare:fresh/(f.length-1),presentationMotionShare:motion/(f.length-1),snapshotsPerSecond:d.length/seconds,stepsPerSecond:steps/seconds,workerMsPerStep:compute/steps,workerBusyShare:compute/(seconds*1000),meanAlive:d.reduce((sum,x)=>sum+x[4],0)/d.length,meanDrawn:f.reduce((sum,x)=>sum+x[3],0)/f.length};
 // UI intent to worker acknowledgement, on the built app. No simulation API is injected.
 row.pauseAckMs=await page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-running]').click();while(window.__probe.read()?.running){if(performance.now()-start>2000)throw Error('pause acknowledgement timeout');await new Promise(r=>setTimeout(r,1));}return performance.now()-start;});
 await page.locator('[data-running]').click();
 rows.push(row);raw.push({population,age,rate,...data});console.log(JSON.stringify(row));
 await fs.writeFile('artifacts/qa/t4/implementation/production-performance.json',JSON.stringify({browser:browser.version(),hardware:'Apple M5, 24 GB, macOS 27.2',viewport:[1440,900],dpr:2,warmupSeconds:1,sampleSeconds:5,source:'Built dist/, externally observed Worker events, rAF callbacks and hero Canvas2D translations; no application diagnostics',rows,errors},null,2));
}
await fs.writeFile('artifacts/qa/t4/implementation/production-performance-raw.json',JSON.stringify(raw));
}finally{await browser.close();}
