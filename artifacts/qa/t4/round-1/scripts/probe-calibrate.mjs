import { launch, open, state, VIEWPORTS, sleep, tap } from './lib.mjs';
const b = await launch();
try {
  const vp = VIEWPORTS.desktop;
  const { page, cdp, log } = await open(b, vp, 'http://127.0.0.1:5294/');
  console.log(await state(page));
  await tap(page, cdp, vp, '[data-rate="fast"]');
  for (let i = 0; i < 6; i++) { await sleep(5000); const s = await state(page); console.log((i+1)*5, 's', s.generation, s.lap, s.meta.tick, JSON.stringify(s.lastGen)); }
  console.log(log);
} finally { await b.close(); }
