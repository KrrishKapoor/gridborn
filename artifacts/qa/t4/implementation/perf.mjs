import { chromium } from './runner/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
const rows=[],raw=[];
function percentile(a,p){return [...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];}
try{
await page.goto('http://127.0.0.1:5194/');await page.waitForFunction(()=>window.__gridborn?.read().snapshot?.tick>0);
for(const population of [512,1000]) for(const age of ['early','evolved']) for(const rate of ['1','4','fast']) {
 await page.locator('[data-population]').selectOption(String(population));
 await page.waitForFunction(p=>{const d=window.__gridborn.read();return !d.pending&&!d.queued&&d.accepted.settings.population===p;},population);
 await page.locator('[data-rate="1"]').click();await page.locator('.control-rail [data-reset]').click();
 await page.waitForFunction(()=>{const d=window.__gridborn.read();return !d.pending&&!d.queued&&d.snapshot?.generation===1;});
 if(age==='evolved'){await page.locator('[data-rate="fast"]').click();await page.waitForFunction(()=>window.__gridborn.read().snapshot?.generation>=16,{},{timeout:60000});}
 await page.locator(`[data-rate="${rate}"]`).click();
 await page.waitForTimeout(1000);
 const before=await page.evaluate(()=>{const d=window.__gridborn.read();window.__gridborn.begin();return {gen:d.snapshot.generation,tick:d.snapshot.tick}});
 await page.waitForTimeout(5000);
 const data=await page.evaluate(()=>window.__gridborn.end());const f=data.frames,d=data.deliveries;
 const seconds=(f.at(-1)[0]-f[0][0])/1000, intervals=f.slice(1).map((x,i)=>x[0]-f[i][0]);
 const steps=d.reduce((s,x)=>s+x[2],0),compute=d.reduce((s,x)=>s+x[3],0);
 let motion=0;for(let i=1;i<f.length;i++)if(f[i][6]!==f[i-1][6])motion++;
 let changed=0;for(let i=1;i<f.length;i++)if(f[i][4]!==f[i-1][4])changed++;
 const row={population,age,rate,fromGeneration:before.gen,toGeneration:d.at(-1)?.[5],fps:(f.length-1)/seconds,frameP95:percentile(intervals,.95),costMean:f.reduce((s,x)=>s+x[1],0)/f.length,costP95:percentile(f.map(x=>x[1]),.95),freshStateShare:changed/(f.length-1),presentationMotionShare:motion/(f.length-1),snapshotsPerSecond:d.length/seconds,stepsPerSecond:steps/seconds,workerMsPerStep:compute/steps,workerBusyShare:compute/(seconds*1000),meanAlive:d.reduce((s,x)=>s+x[4],0)/d.length,meanDrawn:f.filter(x=>x[3]>=0).reduce((s,x)=>s+x[3],0)/f.filter(x=>x[3]>=0).length};
 rows.push(row);raw.push({population,age,rate,...data});console.log(JSON.stringify(row));
 await fs.writeFile('artifacts/qa/t4/implementation/performance.json',JSON.stringify({browser:browser.version(),hardware:'Apple M5, 24 GB, macOS 27.2',viewport:[1440,900],dpr:2,warmupSeconds:1,sampleSeconds:5,rows,errors},null,2));
}
await fs.writeFile('artifacts/qa/t4/implementation/performance-raw.json',JSON.stringify(raw));
}finally{await browser.close();}
