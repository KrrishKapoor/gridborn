import { launch, open, VIEWPORTS, sleep, stage, ui, qa, shot } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4394/';
const b = await launch();
try {
  for (const vp of Object.values(VIEWPORTS)) {
    const { page, log, context } = await open(b, url, vp);
    await sleep(1500);
    const st = await stage(page);
    console.log(vp.name, JSON.stringify(st), JSON.stringify(await ui(page)), JSON.stringify(await qa(page)), JSON.stringify(log));
    const demos = await page.evaluate(() => [...document.querySelectorAll('[data-demo]')].map(d => ({ demo: d.dataset.demo, controls: [...d.querySelectorAll('input,button,select,label')].map(e => `${e.tagName}${e.type ? ':' + e.type : ''}:${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40)}`) })));
    console.log(JSON.stringify(demos));
    await context.close();
  }
} finally { await b.close(); }
