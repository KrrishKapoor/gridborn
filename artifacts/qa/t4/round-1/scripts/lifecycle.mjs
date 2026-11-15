// node lifecycle.mjs <devUrl> <prodUrl>
import { launch, open, sleep, tap, state, VIEWPORTS, save, SHOTS } from './lib.mjs';
import { execSync } from 'node:child_process';
const dev = process.argv[2] ?? 'http://127.0.0.1:5294/', prod = process.argv[3] ?? 'http://127.0.0.1:4294/';
const vp = VIEWPORTS.desktop; const out = {};
const browser = await launch();
const sizes = (page) => page.evaluate(() => {
  const small = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el || el.closest('[hidden]')) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"]') && !(el instanceof SVGElement)) continue; const r = el.getBoundingClientRect(); if (!r.width) continue;
    let s = parseFloat(cs.fontSize); if (el instanceof SVGElement) { const m = el.getScreenCTM(); if (m) s *= Math.hypot(m.a, m.b); }
    if (s < 10.95) small.push({ t: n.textContent.trim().slice(0, 30), px: +s.toFixed(1), cls: el.getAttribute('class') }); }
  return { small, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
try {
  // 1. Real-worker M2 + queued invalid reset, through the DEV app (diagnostics only to issue internal resets).
  {
    const { context, page, log } = await open(browser, vp, dev);
    await sleep(800);
    const acc = await page.evaluate(() => window.__gridborn.read().accepted.id);
    await page.evaluate((id) => { for (let i = 0; i < 8; i++) window.__qa.worker.postMessage(i % 2 ? { type: 'set-running', runId: id, running: 1 } : { type: 'set-rate', runId: id, rate: 3 }); }, acc);
    await sleep(300);
    const errs8 = await page.evaluate(() => window.__qa.errors.length);
    const t0 = await page.evaluate(() => window.__qa.latestMeta.tick);
    await page.evaluate(() => window.__gridborn.reset({ population: 5000 }));
    await sleep(500);
    const r1 = await page.evaluate(() => { const d = window.__gridborn.read(); return { pending: d.pending, accepted: d.accepted.id, error: d.error, feedback: document.querySelector('[data-feedback]').textContent, lastError: window.__qa.errors.at(-1), tick: window.__qa.latestMeta.tick, running: window.__qa.latestMeta.running }; });
    await page.screenshot({ path: `${SHOTS}/dev-1440x900-error-recovery.png` });
    await page.evaluate(() => { window.__gridborn.reset({ population: 5000 }); window.__gridborn.reset({ population: 256 }); });
    await page.waitForFunction(() => window.__qa.latestMeta.pop === 256, null, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    const r2 = await page.evaluate(() => { const d = window.__gridborn.read(); return { pending: d.pending, queued: d.queued, accepted: d.accepted.id, pop: d.accepted.settings.population, error: d.error, feedback: document.querySelector('[data-feedback]').textContent, uiPop: document.querySelector('[data-population]').value }; });
    out.m2RealWorker = { malformedErrors: errs8, invalidAfterExhaustion: { ...r1, ticksAdvanced: r1.tick > t0 }, invalidThenQueuedValid: r2, log };
    // 2. History bounded: 128 cars, fast, > 256 generations.
    await page.selectOption('[data-population]', '128');
    await page.waitForFunction(() => window.__qa.latestMeta.pop === 128, null, { timeout: 8000 });
    await tap(page, null, vp, '[data-rate="fast"]');
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize);
    const t = Date.now();
    await page.waitForFunction(() => window.__gridborn.read().history.completedGenerations > 300, null, { timeout: 240000, polling: 1000 });
    const h = await page.evaluate(() => { const d = window.__gridborn.read(); return { completed: d.history.completedGenerations, entries: d.history.entries.length, first: d.history.entries[0].generation, last: d.history.entries.at(-1).generation, label: document.querySelector('.fitness [data-history-label]')?.textContent ?? document.querySelector('[data-history-label]').textContent, racingLabel: document.querySelector('[data-demo=racing-line] [data-history-label]').textContent, sparkPoints: document.querySelector('[data-fitness]').innerHTML.length, heap: performance.memory?.usedJSHeapSize }; });
    out.history = { ...h, heap0, seconds: (Date.now() - t) / 1000 };
    await tap(page, null, vp, '[data-rate="1"]');
    // 3. Detached-buffer and clone check on the displayed snapshot.
    out.cloneOk = await page.evaluate(() => { try { const d = window.__gridborn.read(); return d.snapshot.storage.cars.length === 128 * 8; } catch (e) { return String(e); } });
    // 4. pagehide disposal (persisted=false) and bfcache (persisted=true).
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await sleep(300);
    const bf = await page.evaluate(() => ({ terminated: window.__qa.terminated, app: document.querySelector('#app').children.length }));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const raf0 = await page.evaluate(() => window.__qa.rafTotal); await sleep(800);
    const ph = await page.evaluate(() => ({ terminated: window.__qa.terminated, app: document.querySelector('#app').children.length, raf: window.__qa.rafTotal, diag: typeof window.__gridborn }));
    out.pagehide = { bfcachePersisted: bf, disposed: { ...ph, rafAdvanced: ph.raf - raf0 } };
    out.devLog = log;
    await context.close();
  }
  // 5. HMR: touch (mtime only, no content change) a runtime module and watch the dev page.
  {
    const { context, page, log } = await open(browser, vp, dev);
    await page.evaluate(() => { window.__marker = 1; });
    execSync('touch src/runtime/presentation.ts', { cwd: new URL('../../../../../', import.meta.url).pathname });
    await sleep(3000);
    const r = await page.evaluate(() => ({ marker: window.__marker ?? null, workers: window.__qa.workers, terminated: window.__qa.terminated, apps: document.querySelectorAll('.gridborn').length, running: window.__qa.latestMeta?.running }));
    out.hmrTouch = { ...r, note: 'marker null => full reload happened', log };
    await context.close();
  }
  // 6. Real hiding attempt (headless): second tab to front.
  {
    const { context, page } = await open(browser, vp, prod);
    const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront(); await sleep(1000);
    const h = await page.evaluate(() => ({ hidden: document.hidden, vis: document.visibilityState, running: window.__qa.latestMeta.running }));
    const cdp = await context.newCDPSession(page);
    let frozen = null; try { await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(1000); await cdp.send('Page.setWebLifecycleState', { state: 'active' }); frozen = await page.evaluate(() => ({ hidden: document.hidden, running: window.__qa.latestMeta.running, errors: window.__qa.errors.length })); } catch (e) { frozen = String(e); }
    out.realHidingAttempt = { secondTabFront: h, freezeThenActive: frozen };
    await context.close();
  }
  // 7. Reduced motion (production).
  {
    const { context, page, log } = await open(browser, vp, prod, { reducedMotion: 'reduce' });
    await sleep(1500);
    const r = await page.evaluate(() => ({ scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior, running: window.__qa.latestMeta.running, drawn: window.__qa.cur?.n, matches: matchMedia('(prefers-reduced-motion: reduce)').matches }));
    out.reducedMotion = { ...r, log };
    await context.close();
  }
  // 8. Label sizes at intermediate widths (production).
  out.widths = {};
  for (const [w, h, touch] of [[601, 900, false], [700, 1000, true], [800, 1000, false], [1000, 700, false], [1024, 768, true], [667, 375, true]]) {
    const v = { name: `${w}x${h}`, viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch };
    const { context, page, log } = await open(browser, v, prod);
    await sleep(800);
    const s = await sizes(page);
    const hero = await page.evaluate(() => { const r = document.querySelector('.hero-canvas').getBoundingClientRect(); const f = document.querySelector('.track-feedback').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, h: r.height, feedbackBottom: f.bottom, innerHeight }; });
    out.widths[v.name] = { smallCount: s.small.length, small: s.small.slice(0, 12), overflow: s.overflow, hero, errors: log.pageErrors.length + log.console.length };
    await page.screenshot({ path: `${SHOTS}/width-${v.name}.png` });
    await context.close();
  }
} finally { await browser.close(); }
save('raw/lifecycle.json', out);
console.log(JSON.stringify(out, (k, v) => (k === 'small' && Array.isArray(v) ? v.slice(0, 5) : v), 1));
