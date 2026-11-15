import { chromium } from './runner/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try {for(const [width,height,touch] of [[1440,900,false],[390,844,true],[844,390,true]]) {
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:touch?3:2,isMobile:touch,hasTouch:touch});
 const page=await context.newPage(),errors=[],workers=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});page.on('worker',w=>workers.push(w.url()));
 await page.goto('http://127.0.0.1:4194/');await page.waitForFunction(()=>document.querySelector('[data-generation]').textContent==='01');await page.waitForTimeout(2200);
 const noHook=await page.evaluate(()=>!('__gridborn' in window));
 await page.screenshot({path:`artifacts/qa/t4/implementation/production-${width}x${height}.png`});
 await page.locator('[data-running]').click();await page.locator('.hero-canvas').focus();await page.keyboard.press('Enter');await page.waitForSelector('.inspection-panel:not([hidden])');await page.waitForTimeout(100);
 await page.screenshot({path:`artifacts/qa/t4/implementation/production-${width}x${height}-inspection.png`});
 const inspector=await page.locator('.actual-inspector [data-steer]').textContent();await page.locator('[data-close]').click();
 await page.locator('[data-drawing]').click();await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 const r=await page.locator('.editor-canvas').boundingBox(),pad=Math.min(16,r.width/20,r.height/20),scale=Math.min((r.width-2*pad)/1200,(r.height-2*pad)/800),ox=(r.width-1200*scale)/2,oy=(r.height-800*scale)/2;
 const points=Array.from({length:96},(_,i)=>{const a=i/96*Math.PI*2;return {x:r.x+ox+(600+370*Math.sin(a))*scale,y:r.y+oy+(400-220*Math.cos(a))*scale};});
 if(touch){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1}]});for(const p of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(p.x,p.y);await page.mouse.up();}
 await page.waitForFunction(()=>document.querySelector('[data-feedback]').textContent.includes('Your circuit')&&!document.querySelector('[data-feedback]').textContent.includes('Applying'));
 await page.locator('[data-running]').click();await page.locator('[data-rate="fast"]').click();await page.waitForFunction(()=>Number(document.querySelector('[data-generation]').textContent)>=5,{},{timeout:60000});
 await page.locator('[data-rate="1"]').click();await page.locator('[data-running]').click();await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:`artifacts/qa/t4/implementation/production-${width}x${height}-drawn.png`});
 const lap=await page.locator('[data-lap-value]').textContent();const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,feedbackBottom:document.querySelector('.track-feedback').getBoundingClientRect().bottom}));
 results.push({viewport:[width,height],noHook,workers,inspector,drawnLap:lap,layout,errors,passed:noHook&&workers.length===1&&workers[0].includes('/assets/worker-')&&inspector.length>0&&lap.includes('s')&&!layout.overflow&&errors.length===0});
 await context.close();
}await fs.writeFile('artifacts/qa/t4/implementation/production-results.json',JSON.stringify(results,null,2));console.log(results);}finally{await browser.close();}
