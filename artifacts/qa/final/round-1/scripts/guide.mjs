// Final QA: the new drawing guide and Escape/focus fixes, at all three viewports, real mouse / CDP touch.
// Usage: node guide.mjs <url> <prod|dev>
import { launch, open, VIEWPORTS, sleep, stage, ui, qa, shot, Recorder, save, stroke, ellipse, heroAlpha, press, tap, waitFor } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4394/', mode = process.argv[3] || 'prod';
const only = process.argv[4];
const b = await launch();
const all = [];
function superellipse(cx, cy, a, bb, n = 4, k = 120) { const p = []; for (let i = 0; i <= k; i++) { const t = -Math.PI / 2 + (i / k) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t); p.push({ x: cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), y: cy + bb * Math.sign(s) * Math.abs(s) ** (2 / n) }); } return p; }
const resets = (page) => page.evaluate(() => __qa.resets.length);
const runOf = (page) => page.evaluate(() => __qa.last?.runId);
const draftPixels = (page) => page.evaluate(() => { const c = document.querySelector('.editor-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
const brackets = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.track-stage'), '::before').display + '/' + getComputedStyle(document.querySelector('.track-stage'), '::after').display);
async function guideProbe(page) {
  const st = await stage(page), s = st.scale, ox = st.offsetX, oy = st.offsetY;
  const pts = { letterbox: ox > 4 ? [ox / 2, st.height / 2] : [st.width / 2, Math.max(2, oy / 2)], band: [ox + 20 * s, oy + 400 * s], insideOffRoad: [ox + 600 * s, oy + 400 * s] };
  const [lb, band, inside] = await heroAlpha(page, [pts.letterbox, pts.band, pts.insideOffRoad]);
  // dashed guide line at world x = inset (track width 92 -> 54) over many y; take max alpha
  const inset = 54, line = []; for (let y = 120; y < 680; y += 9) for (const dx of [-0.6, 0, 0.6]) line.push([ox + inset * s + dx, oy + y * s]);
  const la = await heroAlpha(page, line);
  // guide stroke is opaque #246b32; road fill/cars/glow differ in colour or alpha
  const isGuide = (p) => p[3] > 200 && Math.abs(p[0] - 36) < 30 && Math.abs(p[1] - 107) < 30 && Math.abs(p[2] - 50) < 30;
  const lineMax = Math.max(...la.map((p) => p[3])), lineDark = la.filter(isGuide).length;
  return { letterboxA: lb[3], bandA: band[3], insideA: inside[3], lineMax, lineDark, guideCss: { x: ox + inset * s, y: oy + inset * s, w: (1200 - 2 * inset) * s, h: (800 - 2 * inset) * s } };
}
try {
  for (const [key, vp] of Object.entries(VIEWPORTS)) {
    if (only && only !== key) continue;
    const R = new Recorder(`${mode} ${vp.name} guide`); const tag = `${mode}-${vp.name}-guide`;
    const { page, log, context, cdp } = await open(b, url, vp);
    await waitFor(page, () => window.__qa?.events.ready.length && __qa.last);
    await sleep(500);
    // Before drawing: no guide, brackets shown.
    const before = await guideProbe(page);
    R.check('no guide/shade before drawing', before.letterboxA === 0 && before.bandA === 0 && before.lineDark === 0, before);
    R.check('corner brackets visible before drawing', (await brackets(page)) === 'block/block', { b: await brackets(page) });
    // Enter drawing.
    await press(page, cdp, vp, '[data-drawing]'); await sleep(250);
    const g = await guideProbe(page), u = await ui(page);
    R.check('drawing: shaded letterbox (outside world)', g.letterboxA >= 18 && g.letterboxA <= 40, g);
    R.check('drawing: shaded road-clearance band inside world', g.bandA >= 18 && g.bandA <= 40, g);
    R.check('drawing: interior of guide not shaded', g.insideA === 0, g);
    R.check('drawing: dashed guide line drawn', g.lineDark >= 10 && g.lineMax > 200, { lineDark: g.lineDark, lineMax: g.lineMax });
    R.check('drawing: corner brackets hidden', (await brackets(page)) === 'none/none');
    R.check('drawing: hint mentions dashed guide + Escape', /dashed guide/.test(u.hint) && /Escape/.test(u.hint), { hint: u.hint });
    R.check('drawing: overlay owns input, cars suspended', u.editorPE === 'auto' && u.runLabel === 'Waiting' && u.drawingPressed === 'true', u);
    await page.locator('.track-stage').scrollIntoViewIfNeeded();
    await shot(page, `${tag}-01-drawing-guide`);
    await page.locator('.track-stage').screenshot({ path: `${process.cwd()}/../screens/${tag}-01b-stage-crop.png` });
    // Overlay click ownership: tap where a car is drawn -> no selection command.
    const carCss = await page.evaluate(() => { const c = __qa.lastFrameCars; return c.length ? [c[0], c[1]] : null; });
    const selBefore = await page.evaluate(() => __qa.commands.filter((c) => c.type === 'select').length);
    if (carCss) {
      const st = await stage(page); const p = { x: st.left + st.offsetX + carCss[0] * st.scale, y: st.top + st.offsetY + carCss[1] * st.scale };
      await tap(page, cdp, vp, p.x, p.y); await sleep(300);
    }
    const selAfter = await page.evaluate(() => __qa.commands.filter((c) => c.type === 'select').length);
    R.check('drawing: tap on a car does not select (overlay owns click)', carCss && selAfter === selBefore, { selBefore, selAfter });
    const tapFeedback = (await ui(page)).feedback;
    // Escape mid-stroke: must cancel, and release after Escape must NOT commit.
    const r0 = await resets(page), run0 = await runOf(page);
    const loop = ellipse(600, 400, 400, 250, { n: 90 });
    let midActive = null, midDraft = 0, afterEscDraft = -1, focusVisibleMid = null;
    await stroke(page, cdp, vp, loop.slice(0, 50), { beforeUp: async () => {
      midActive = await page.evaluate(() => document.activeElement?.className); focusVisibleMid = await page.evaluate(() => document.activeElement.matches(':focus-visible'));
      midDraft = await draftPixels(page);
      if (key === 'desktop') await shot(page, `${tag}-02-mid-stroke`);
      await page.keyboard.press('Escape'); await sleep(120);
      afterEscDraft = await draftPixels(page);
      // continue the gesture after Escape, then release
      const st = await stage(page);
      for (const p of loop.slice(50)) { const c = { x: st.left + st.offsetX + p.x * st.scale, y: st.top + st.offsetY + p.y * st.scale };
        if (vp.touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y, id: 1 }] }); else await page.mouse.move(c.x, c.y); }
    } });
    await sleep(400);
    const afterEsc = await ui(page);
    R.check('pointerdown focuses the editor canvas', midActive === 'editor-canvas', { midActive });
    R.check('mouse/touch focus on editor shows no keyboard focus ring', focusVisibleMid === false, { focusVisibleMid });
    R.check('draft visible mid-stroke, erased by Escape', midDraft > 50 && afterEscDraft === 0, { midDraft, afterEscDraft });
    R.check('release after Escape does not commit', (await resets(page)) === r0 && (await runOf(page)) === run0 && afterEsc.drawingPressed === 'true' && (await draftPixels(page)) === 0, { resets: await resets(page), r0, afterEsc });
    // Valid loop hugging the guide (all well inside the world after road width).
    const hug = await (async () => {
      const out = {};
      for (const [name, pts] of [['ellipse-530x330', ellipse(600, 400, 530, 330, { n: 110 })], ['superellipse-525x325', superellipse(600, 400, 525, 325, 4, 140)]]) {
        const rBefore = await resets(page);
        if ((await ui(page)).drawingPressed !== 'true') { await press(page, cdp, vp, '[data-drawing]'); await sleep(200); }
        await stroke(page, cdp, vp, pts); await sleep(500);
        out[name] = { committed: (await resets(page)) > rBefore, feedback: (await ui(page)).feedback };
        if (out[name].committed) { await waitFor(page, (n) => __qa.events.ready.length >= n, rBefore + 1).catch(() => {}); }
      }
      return out;
    })();
    R.check('loops drawn right inside the guide are accepted', hug['ellipse-530x330'].committed && hug['superellipse-525x325'].committed, hug);
    // After commit: drawing off, guide gone, brackets back, focus on hero without ring, overlay inert.
    const post = await ui(page), pg = await guideProbe(page);
    R.check('after commit: drawing ended and overlay inert', post.drawingPressed === 'false' && post.editorPE === 'none', post);
    R.check('after commit: focus restored to hero (not body/editor)', post.active === 'hero-canvas', { active: post.active });
    R.check('after commit: restored focus has no visible ring for pointer users', post.activeFocusVisible === false, { fv: post.activeFocusVisible });
    R.check('after commit: guide and shading removed', pg.letterboxA === 0 && pg.bandA === 0 && pg.lineDark === 0, pg);
    R.check('after commit: brackets restored', (await brackets(page)) === 'block/block');
    await waitFor(page, () => __qa.last && __qa.last.running && __qa.last.tick > 30).catch(() => {});
    await shot(page, `${tag}-03-after-commit-learning`);
    // Outside the guide but inside the world (road would leave the world): reject with feedback, keep track.
    await press(page, cdp, vp, '[data-drawing]'); await sleep(200);
    const rA = await resets(page), runA = await runOf(page);
    await stroke(page, cdp, vp, ellipse(600, 400, 575, 375, { n: 110 })); await sleep(400);
    const band = await ui(page);
    R.check('stroke crossing the guide into the shaded band is rejected with clear feedback', (await resets(page)) === rA && /edge|drawing area|room for the road/i.test(band.feedback), { feedback: band.feedback });
    R.check('rejected stroke keeps previous run running/paused state', (await runOf(page)) === runA, {});
    R.check('rejected draft stays visible (red) until next action', (await draftPixels(page)) > 50);
    await shot(page, `${tag}-04-reject-band`);
    // Stroke into the letterbox, outside the world.
    const wide = vp.name === '390x844' ? ellipse(600, 400, 420, 470, { n: 110 }) : ellipse(600, 400, 680, 300, { n: 110 });
    await stroke(page, cdp, vp, wide); await sleep(400);
    const lb = await ui(page);
    R.check('stroke into the shaded letterbox is rejected with clear feedback', (await resets(page)) === rA && /drawing area|edge/i.test(lb.feedback), { feedback: lb.feedback });
    await shot(page, `${tag}-05-reject-letterbox`);
    // Clear drawing removes the red draft, keeps drawing mode and guide.
    await press(page, cdp, vp, '[data-clear]'); await sleep(200);
    R.check('Clear drawing erases the draft, keeps guide', (await draftPixels(page)) === 0 && (await guideProbe(page)).bandA > 0 && (await ui(page)).drawingPressed === 'true');
    // Reset learning while drawing keeps drawing mode and guide.
    await press(page, cdp, vp, '[data-reset]'); await sleep(600);
    const afterReset = await ui(page), gr = await guideProbe(page);
    R.check('Reset learning while drawing keeps guide and drawing mode', afterReset.drawingPressed === 'true' && gr.bandA > 0 && gr.lineDark >= 10, { afterReset, gr });
    // Stop drawing via the button: guide removed, focus not stolen from the button.
    await press(page, cdp, vp, '[data-drawing]'); await sleep(250);
    const stop = await ui(page), sg = await guideProbe(page);
    R.check('Stop drawing removes guide', sg.bandA === 0 && sg.letterboxA === 0 && sg.lineDark === 0, sg);
    R.check('Stop drawing leaves focus where the user is (button), no hero steal', !vp.touch ? /BUTTON|^$/.test(stop.active) || stop.active === '' : true, { active: stop.active });
    // Preset while drawing ends drawing and removes guide.
    await press(page, cdp, vp, '[data-drawing]'); await sleep(200);
    await page.selectOption('[data-preset]', { index: 2 }); await sleep(600);
    const pp = await ui(page), pgd = await guideProbe(page);
    R.check('Preset while drawing ends drawing and removes guide', pp.drawingPressed === 'false' && pgd.bandA === 0, { pp, pgd });
    // Resize mid-stroke cancels; guide re-fit to new size.
    await press(page, cdp, vp, '[data-drawing]'); await sleep(200);
    const rR = await resets(page);
    await stroke(page, cdp, vp, ellipse(600, 400, 380, 240, { n: 80 }).slice(0, 60), { beforeUp: async () => {
      await page.setViewportSize({ width: vp.width - 60, height: vp.height }); await sleep(300);
      const st = await stage(page); const ps = ellipse(600, 400, 380, 240, { n: 80 }).slice(60);
      for (const p of ps) { const c = { x: st.left + st.offsetX + p.x * st.scale, y: st.top + st.offsetY + p.y * st.scale };
        if (vp.touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y, id: 1 }] }); else await page.mouse.move(c.x, c.y); }
    } });
    await sleep(400);
    const rg = await guideProbe(page);
    R.check('resize mid-stroke cancels without commit', (await resets(page)) === rR && (await draftPixels(page)) === 0);
    R.check('guide refits after resize', rg.bandA > 0 && rg.lineDark >= 10 && (rg.letterboxA > 0 || rg.letterboxA === 0), rg);
    await shot(page, `${tag}-06-after-resize-guide`);
    await page.setViewportSize({ width: vp.width, height: vp.height }); await sleep(300);
    // Touch-specific: touchcancel and a second finger.
    if (vp.touch) {
      const rT = await resets(page);
      await stroke(page, cdp, vp, ellipse(600, 400, 380, 240, { n: 80 }), { beforeUp: async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); } });
      R.check('touchcancel mid-stroke never commits', (await resets(page)) === rT && (await draftPixels(page)) === 0);
      // second finger during a stroke is ignored; primary finishes a valid loop
      const st = await stage(page), pts = ellipse(600, 400, 380, 240, { n: 80 }).map((p) => ({ x: st.left + st.offsetX + p.x * st.scale, y: st.top + st.offsetY + p.y * st.scale }));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts[0], id: 1 }] });
      for (let i = 1; i < pts.length; i++) {
        const tps = [{ ...pts[i], id: 1 }]; if (i > 20 && i < 30) tps.push({ x: st.left + st.width / 2, y: st.top + st.height / 2 + (i - 25), id: 2 });
        await cdp.send('Input.dispatchTouchEvent', { type: i === 21 ? 'touchStart' : 'touchMove', touchPoints: tps });
        // i >= 30: a touchMove with only finger 1 releases finger 2 (CDP semantics)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(500);
      const mt = await ui(page);
      R.check('second finger ignored; primary stroke still commits a valid loop', (await resets(page)) === rT + 1, { feedback: mt.feedback, drawing: mt.drawingPressed });
    } else {
      // Keyboard user: toggling Draw via keyboard keeps focus on the button; Escape with no stroke does nothing harmful.
      await page.locator('[data-drawing]').focus(); const rk = await resets(page);
      if ((await ui(page)).drawingPressed === 'false') await page.keyboard.press('Enter');
      await sleep(150); await page.keyboard.press('Escape'); await sleep(150);
      const k = await ui(page);
      R.check('keyboard: Draw toggle keeps focus on visible button with ring', /BUTTON/.test(k.active) || k.active === '', { k });
      const fvBtn = await page.evaluate(() => document.activeElement.matches(':focus-visible'));
      R.check('keyboard: Draw button focus ring visible', fvBtn);
      await shot(page, `${tag}-07-keyboard-draw-focus`);
      await page.keyboard.press('Enter'); await sleep(150);
      R.check('keyboard: Escape without stroke harmless; Enter stops drawing', (await resets(page)) === rk && (await ui(page)).drawingPressed === 'false');
    }
    const errs = await page.evaluate(() => __qa.errors);
    const own = log.console.filter((m) => !/willReadFrequently/.test(m)); // QA readback warning only
    R.check('no console/page/request errors', !own.length && !log.pageErrors.length && !log.requestFailed.length && !log.badResponses.length && !errs.length, { ...log, console: own, qaReadbackWarnings: log.console.length - own.length, errs });
    R.check('no horizontal overflow', (await ui(page)).overflowX === 0);
    all.push({ ...R.summary(), results: R.results, tapFeedback });
    await context.close();
  }
} finally { await b.close(); }
save(`guide-${mode}${only ? '-' + only : ''}.json`, all);
console.log(JSON.stringify(all.map(({ label, passed, total, failed }) => ({ label, passed, total, failed }))));
