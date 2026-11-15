import { chromium } from './runner/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const out='artifacts/qa/t4/implementation';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
for (const [width,height,touch] of [[1440,900,false],[390,844,true],[844,390,true]]) {
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:touch?3:2,isMobile:touch,hasTouch:touch});
 const page=await context.newPage(),cdp=await context.newCDPSession(page);
 const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 const name=`${width}x${height}`;
 const check=(name,ok,detail)=>{checks.push({name,ok,detail});if(!ok)console.log('FAIL',name,detail);};
 const read=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__gridborn.read(),(_k,v)=>ArrayBuffer.isView(v)?Array.from(v):v)));
 const settled=()=>page.waitForFunction(()=>{const d=window.__gridborn.read();return !d.pending&&!d.queued&&d.snapshot?.runId===d.accepted?.id;});
 const top=()=>page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 const shot=async suffix=>page.screenshot({path:`${out}/${name}-${suffix}.png`});
 const running=async value=>{const state=await read();if(state.desiredRunning!==value)await page.locator('[data-running]').click();await page.waitForFunction(v=>window.__gridborn.read().snapshot?.running===v,value);};
 const rate=async value=>{await page.locator(`[data-rate="${value}"]`).click();await page.waitForFunction(v=>String(window.__gridborn.read().snapshot?.rate)===v,String(value));};
 const draw=async points=>{
  if(!(await read()).drawing)await page.locator('[data-drawing]').click();await top();
  const data=await page.evaluate(()=>{const d=window.__gridborn.read(),r=document.querySelector('.hero-canvas').getBoundingClientRect();return {v:d.view,left:r.left,top:r.top};});
  const coords=points.map(([x,y])=>({x:data.left+x*data.v.scale+data.v.offsetX,y:data.top+y*data.v.scale+data.v.offsetY}));
  if(touch){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...coords[0],id:1}]});
   for(const p of coords.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else{await page.mouse.move(coords[0].x,coords[0].y);await page.mouse.down();for(const p of coords.slice(1))await page.mouse.move(p.x,p.y);await page.mouse.up();}
 };
 try {
 await page.goto('http://127.0.0.1:5194/');await page.waitForFunction(()=>window.__gridborn?.read().snapshot?.tick>80);
 await shot('initial');let d=await read();check('autoplay512',d.accepted.settings.population===512&&d.snapshot.running,d.snapshot.tick);
 const layout=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};return {overflow:document.documentElement.scrollWidth>innerWidth,canvas:rect(document.querySelector('.hero-canvas')),feedback:rect(document.querySelector('.track-feedback')),overlay:rect(document.querySelector('.editor-canvas')),touch:getComputedStyle(document.querySelector('.hero-canvas')).touchAction,bodyTouch:getComputedStyle(document.body).touchAction,small:[...document.querySelectorAll('button,select')].filter(e=>e.getBoundingClientRect().height&&e.getBoundingClientRect().height<44).map(e=>e.textContent)}});
 check('layout/nooverflow',!layout.overflow,layout);check('canvas-visible',layout.canvas.bottom<=height,layout.canvas);check('feedback-nearcanvas',layout.feedback.y-layout.canvas.bottom<55,layout.feedback);check('touch-targets',!layout.small.length,layout.small);
 check('honest-no-lap',await page.locator('[data-no-lap]').isVisible());
 await running(false);d=await read();const tick=d.snapshot.tick;await wait(200);check('pause-no-steps',(await read()).snapshot.tick===tick);
 // Point at a real visible active driver; desktop mouse and mobile genuine CDP tap.
 const target=await page.evaluate(()=>{const d=window.__gridborn.read(),r=document.querySelector('.hero-canvas').getBoundingClientRect(),c=d.snapshot.storage.cars;let i=0;for(;i<d.snapshot.population;i++)if(c[i*8+7]===0&&c[i*8]>720)break;if(i===d.snapshot.population)i=0;return {index:i,x:r.left+c[i*8]*d.view.scale+d.view.offsetX,y:r.top+c[i*8+1]*d.view.scale+d.view.offsetY};});
 if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:target.x,y:target.y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else await page.mouse.click(target.x,target.y);
 await page.waitForFunction(()=>window.__gridborn.read().snapshot?.selected!==null);
 await page.waitForTimeout(150);await shot('inspection');
 const inspection=await page.evaluate(()=>{const d=window.__gridborn.read(),s=d.snapshot,c=s.storage.cars,a=s.selected.index*8,r=document.querySelector('.inspection-panel').getBoundingClientRect();let maxRayError=0;const angles=[-Math.PI/2,-Math.PI/3,-Math.PI/6,0,Math.PI/6,Math.PI/3,Math.PI/2];for(let i=0;i<7;i++){const dist=s.storage.sensors[i*3]*180;maxRayError=Math.max(maxRayError,Math.abs(c[a]+Math.cos(c[a+2]+angles[i])*dist-s.storage.sensors[i*3+1]),Math.abs(c[a+1]+Math.sin(c[a+2]+angles[i])*dist-s.storage.sensors[i*3+2]));}const w=s.storage.weights,act=s.storage.activations;let error=0;for(let j=0;j<10;j++){let n=j<8?j*9:72+(j-8)*9,sum=w[n+8];for(let k=0;k<8;k++)sum+=w[n+k]*act[j<8?k:8+k];error=Math.max(error,Math.abs(Math.tanh(sum)-act[j<8?8+j:16+j-8]));}const canvas=document.querySelector('.inspection-sight canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;const colors=new Set();for(let i=0;i<pixels.length;i+=64)colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);return {top:r.top,bottom:r.bottom,maxRayError,networkError:error,colors:colors.size,steer:document.querySelector('.actual-inspector [data-steer]').textContent,actualSteer:act[16].toFixed(2),selected:s.selected};});
 check('inspection-visible',inspection.top<height&&inspection.bottom>0,inspection);check('actual-rays-coherent',inspection.maxRayError<.05,inspection.maxRayError);check('actual-inference',inspection.networkError<1e-6,inspection.networkError);check('sight-rendered',inspection.colors>3,inspection.colors);
 // Live activations change, preserving same selected identity until the generation ends.
 const act0=(await read()).snapshot.storage.activations;await running(true);await page.waitForTimeout(400);d=await read();check('live-inspector-changes',Array.from(d.snapshot.storage.activations).some((x,i)=>x!==act0[i]));await running(false);
 await page.locator('[data-close]').focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__gridborn.read().snapshot?.selected===null);
 check('escape-restores-focus',await page.evaluate(()=>document.activeElement===document.querySelector('.hero-canvas')));
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__gridborn.read().snapshot?.selected!==null);await page.waitForTimeout(100);check('keyboard-select',true);
 await page.locator('[data-close]').click();await page.waitForFunction(()=>window.__gridborn.read().snapshot?.selected===null);check('close-restores-focus',await page.evaluate(()=>document.activeElement===document.querySelector('.hero-canvas')));
 // Default oval actual learning, record metadata and trajectory retained from worker.
 await running(true);await rate('fast');await page.waitForFunction(()=>window.__gridborn.read().history.completedGenerations>=30,{},{timeout:60000});d=await read();
 const defaultLearning={first:d.history.entries[0].bestLapSeconds,last:d.best.lapSeconds,generations:d.history.completedGenerations,history:d.history.entries,path:Array.from(d.best.samples)};
 check('default-improves',defaultLearning.last<defaultLearning.first, {first:defaultLearning.first,last:defaultLearning.last});check('headless-label',await page.locator('[data-run-label]').textContent()==='Headless');
 await rate('1');await running(false);await top();await shot('evolved');
 // Genuine freehand loop through browser input.
 await running(true);const oldRun=(await read()).accepted.id;
 const oval=Array.from({length:96},(_,i)=>{const a=i/96*Math.PI*2;return [600+370*Math.sin(a),400-220*Math.cos(a)];});
 await draw(oval);await settled();d=await read();check('native-drawing-commits',d.accepted.id>oldRun&&d.accepted.track.id.startsWith('drawn-'),{run:d.accepted.id,id:d.accepted.track.id});
 check('draw-restores-running-intent',!d.drawing&&d.desiredRunning&&d.snapshot.running);
 await rate('fast');await page.waitForFunction(()=>window.__gridborn.read().history.completedGenerations>=30,{},{timeout:60000});d=await read();
 const drawnLearning={first:d.history.entries.find(e=>e.bestLapSeconds!==null)?.bestLapSeconds,last:d.best?.lapSeconds,history:d.history.entries,path:Array.from(d.best.samples),track:{id:d.accepted.track.id,length:d.accepted.track.length,width:d.accepted.track.width}};
 check('drawn-improves',drawnLearning.last<drawnLearning.first,{first:drawnLearning.first,last:drawnLearning.last});
 await rate('1');await running(false);await top();await shot('drawn-evolved');
 const kept=(await read()).accepted.id,keptBest=(await read()).best.lapSeconds;
 await draw(Array.from({length:80},(_,i)=>{const a=i/79*Math.PI*2;return [600+250*Math.sin(a),400+150*Math.sin(2*a)];}));await page.waitForTimeout(100);
 d=await read();check('invalid-preserves-circuit',d.accepted.id===kept&&d.best.lapSeconds===keptBest);check('invalid-useful-feedback',(await page.locator('[data-feedback]').textContent()).includes('cross'));await shot('invalid');
 await page.locator('[data-clear]').click();check('clear-keeps-learning',(await read()).accepted.id===kept);await page.locator('[data-drawing]').click();check('draw-preserves-pause',!(await read()).desiredRunning);
 // All presets must really start and evolve.
 const presets=[];for(const id of ['broad-oval','riverbend','club-circuit']){
 await page.locator('[data-preset]').selectOption(id);await settled();await running(true);await rate('fast');await page.waitForFunction(()=>window.__gridborn.read().snapshot?.generation>=9,{},{timeout:60000});d=await read();presets.push({id,gen:d.snapshot.generation,best:d.best?.lapSeconds,progress:d.best?.fitness});check(`preset-${id}`,d.accepted.track.id===id&&d.snapshot.generation>8&&!d.error);}
 // Rapid intentions through actual controls, including settings while a reset is pending.
 await page.evaluate(()=>{const p=document.querySelector('[data-population]'),c=document.querySelector('[data-preset]');for(let i=0;i<12;i++){p.value=i%2?'1000':'256';p.dispatchEvent(new Event('change',{bubbles:true}));c.value=i%2?'riverbend':'broad-oval';c.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector(`[data-rate="${i%2?'4':'1'}"]`).click();document.querySelector('[data-running]').click();}p.value='512';p.dispatchEvent(new Event('change',{bubbles:true}));c.value='broad-oval';c.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-rate="1"]').click();});
 await settled();d=await read();check('rapid-settles',d.accepted.settings.population===512&&d.accepted.track.id==='broad-oval'&&d.desiredRate===1&&!d.error,{id:d.accepted.id,pop:d.accepted.settings.population,history:d.history.runId});
 // Main-thread invalid reset acknowledgement (development-only protocol probe).
 const accepted=d.accepted.id;await page.evaluate(()=>window.__gridborn.reset({population:5000}));await page.waitForFunction(()=>!window.__gridborn.read().pending);d=await read();check('invalid-reset-keeps-current',d.accepted.id===accepted&&!!d.error,d.error);await running(true);const previous=d.snapshot.tick;await page.waitForTimeout(180);check('invalid-reset-oldrun-continues',(await read()).snapshot.tick>previous);
 // DPR only and tiny canvas while paused; restore without resetting learning.
 await running(false);await top();const stable=(await read()).accepted.id;
 await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});await page.waitForTimeout(100);check('dpr-only',await page.evaluate(()=>document.querySelector('.hero-canvas').width===Math.round(document.querySelector('.hero-canvas').getBoundingClientRect().width)));
 await page.evaluate(()=>{document.querySelector('.track-stage').style.width='1px';document.querySelector('.track-stage').style.height='1px';});await page.waitForTimeout(100);await page.evaluate(()=>{document.querySelector('.track-stage').style.width='';document.querySelector('.track-stage').style.height='';});
 await page.setViewportSize({width:height,height:width});await page.waitForTimeout(100);await page.setViewportSize({width,height});await page.waitForTimeout(100);check('resize-tiny-keeps-run',(await read()).accepted.id===stable);
 await page.emulateMedia({reducedMotion:'reduce'});check('reduced-motion-scroll',await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior==='auto'));
 // Controlled visibility state exercises handler; real OS hide is a separate headed probe.
 await running(true);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await wait(150);
 const hidden1=await read();await wait(200);const hidden2=await read();check('hidden-preference-retained',hidden2.hidden&&hidden2.desiredRunning);check('hidden-no-display-work',hidden1.lastDelivery.tick===hidden2.lastDelivery.tick&&!hidden2.lastDelivery.running);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(100);d=await read();check('resume-without-catchup',d.snapshot.tick-hidden2.lastDelivery.tick<30&&d.snapshot.running,d.snapshot.tick-hidden2.lastDelivery.tick);
 // Four lessons actually paint with live track/history; labels meet a readable floor.
 await running(false);await rate('fast');await running(true);await page.waitForFunction(()=>window.__gridborn.read().history.completedGenerations>=2,{},{timeout:60000});await running(false);await rate('1');
 for(const kind of ['sensors','network','genetics','racing-line']){
 await page.locator(`[data-demo="${kind}"]`).evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(100);await shot(kind);
 const min=await page.locator(`[data-demo="${kind}"]`).evaluate(e=>Math.min(...[...e.querySelectorAll('svg text')].filter(t=>t.getBoundingClientRect().height>0).map(t=>parseFloat(getComputedStyle(t).fontSize)*t.ownerSVGElement.getBoundingClientRect().width/t.ownerSVGElement.viewBox.baseVal.width)));
 check(`${kind}-label-floor`,min>=10.9,min);
 }
 check('line-has-road',await page.locator('[data-demo="racing-line"] [data-road]').getAttribute('d')!=='');
 check('weight-highlight',await page.locator('[data-demo="network"] line[data-adjusted="true"]').count()===1);
 await page.screenshot({path:`${out}/${name}-full.png`,fullPage:true});
 await top();await shot('final');
 await fs.writeFile(`${out}/${name}-learning.json`,JSON.stringify({defaultLearning,drawnLearning,presets},null,2));
 }catch(error){checks.push({name:'script-completed',ok:false,detail:error.stack});console.log(error);}
 check('no-console-errors',errors.length===0,errors);
 results.push({viewport:[width,height],touch,checks,errors});await fs.writeFile(`${out}/smoke-results.json`,JSON.stringify({browser:browser.version(),results},null,2));await context.close();
}
}finally{await browser.close();}
console.log(JSON.stringify(results.map(r=>({viewport:r.viewport,passed:r.checks.filter(x=>x.ok).length,failed:r.checks.filter(x=>!x.ok)})),null,2));
