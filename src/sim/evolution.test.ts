import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createSnapshotStorage } from '../shared/simulation';
import type { BestTrajectory, GenerationStatistics } from '../shared/simulation';
import { Engine } from './engine';
import { ovalFixture } from './fixtures/oval';
import { validateTrack } from './validation';

it('discovers and improves real laps with the default seed, without a driving oracle', () => {
  const track = ovalFixture(); validateTrack(track);
  const history: GenerationStatistics[] = [], records: BestTrajectory[] = [];
  const engine = new Engine(1, track, DEFAULT_SETTINGS, { generation: (s) => history.push(s), best: (b) => records.push(b) });
  const started = performance.now();
  while (engine.generation <= 30) engine.step();
  console.log('T2 seeded 30-generation evidence', JSON.stringify({ ms: performance.now() - started, ticks: engine.tick,
    records: records.map((b) => ({ generation: b.car.generation, fitness: b.fitness, lap: b.lapSeconds, points: b.samples.length / 4 })),
    generations: history.map((h) => ({ generation: h.generation, laps: h.completedLaps, best: h.bestLapSeconds })) }));
  const laps = records.filter((r) => r.lapSeconds !== null);
  expect(laps.length).toBeGreaterThanOrEqual(2);
  expect(laps.at(-1)!.lapSeconds!).toBeLessThan(laps[0]!.lapSeconds!);
  for (const r of records) {
    expect(r.samples[0]).toBe(track.spawn.x); expect(r.samples[1]).toBe(track.spawn.y); expect(r.samples[3]).toBe(0);
    expect(r.samples.length / 4).toBeLessThanOrEqual(602);
    for (let i = 7; i < r.samples.length; i += 4) expect(r.samples[i]!).toBeGreaterThan(r.samples[i - 4]!);
    if (r.lapSeconds !== null) {
      expect(r.samples.at(-1)!).toBeCloseTo(r.lapSeconds, 4);
      expect(r.samples.at(-4)!).toBeCloseTo(track.spawn.x, 3);
      // The recorded car actually travels through all four quadrants.
      const xs = r.samples.filter((_, i) => i % 4 === 0), ys = r.samples.filter((_, i) => i % 4 === 1);
      expect(Math.min(...xs)).toBeLessThan(260); expect(Math.max(...xs)).toBeGreaterThan(940);
      expect(Math.min(...ys)).toBeLessThan(210); expect(Math.max(...ys)).toBeGreaterThan(580);
    }
  }
}, 120000);


it('replays identical genomes, records and car state despite different observation schedules', () => {
  const settings = { ...DEFAULT_SETTINGS, population: 96, eliteCount: 4 };
  const historyA: GenerationStatistics[] = [], historyB: GenerationStatistics[] = [];
  const bestA: BestTrajectory[] = [], bestB: BestTrajectory[] = [];
  const a = new Engine(1, ovalFixture(), settings, { generation: (s) => historyA.push(s), best: (b) => bestA.push(b) });
  const b = new Engine(1, ovalFixture(), settings, { generation: (s) => historyB.push(s), best: (r) => bestB.push(r) });
  const storage = createSnapshotStorage(settings.population);
  for (let i = 0; i < 4000; i++) {
    a.step(); b.step();
    if (i % 7 === 0) { b.select({ runId: 1, generation: b.generation, index: 13 }); b.copyInto(storage); }
  }
  expect(a.tick).toBe(b.tick); expect(a.cars).toEqual(b.cars); expect(a.brains).toEqual(b.brains);
  expect(historyA).toEqual(historyB); expect(bestA).toEqual(bestB);
});
