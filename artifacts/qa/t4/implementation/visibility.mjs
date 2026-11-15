import { chromium } from './runner/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:false,ignoreDefaultArgs:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
try {
 await page.goto('http://127.0.0.1:5194/');await page.waitForFunction(()=>window.__gridborn?.read().snapshot?.tick>40);
 const cdp=await page.context().newCDPSession(page);
 await page.evaluate(()=>{window.visibilityLog=[];document.addEventListener('visibilitychange',()=>window.visibilityLog.push({hidden:document.hidden,time:performance.now()}));});
 // Playwright enables focus emulation; turn it off to exercise actual OS visibility.
 await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
 const before=await page.evaluate(()=>window.__gridborn.read().lastDelivery);
 const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();
 await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
 await page.waitForTimeout(500);
 const hidden1=await page.evaluate(()=>({hidden:document.hidden,delivery:window.__gridborn.read().lastDelivery,desired:window.__gridborn.read().desiredRunning}));
 await page.waitForTimeout(1000);
 const hidden2=await page.evaluate(()=>({hidden:document.hidden,delivery:window.__gridborn.read().lastDelivery,desired:window.__gridborn.read().desiredRunning}));
 await other.close();await page.bringToFront();await page.waitForTimeout(150);
 const resumed=await page.evaluate(()=>({hidden:document.hidden,delivery:window.__gridborn.read().lastDelivery,desired:window.__gridborn.read().desiredRunning,log:window.visibilityLog}));
 const results={before,hidden1,hidden2,resumed,passed:hidden1.hidden&&hidden2.hidden&&hidden1.delivery.tick===hidden2.delivery.tick&&!hidden2.delivery.running&&hidden2.desired&&!resumed.hidden&&resumed.delivery.running&&resumed.delivery.tick-hidden2.delivery.tick<30};
 await fs.writeFile('artifacts/qa/t4/implementation/visibility-results.json',JSON.stringify(results,null,2));console.log(results);
}finally{await browser.close();}
