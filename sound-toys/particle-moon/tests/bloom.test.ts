import { expect, it } from 'vitest';
import { Bloom, BLOOM_SECONDS } from '../src/sim/bloom';
import { Simulation } from '../src/sim/simulation';

it('grows the circle out from its centre over three seconds, ending with each particle at home', () => {
  const sim = new Simulation(1200);
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 400 }, true);
  const homeX = Float32Array.from(sim.x);
  const homeY = Float32Array.from(sim.y);
  const bloom = new Bloom(sim, 720, 400);
  const extent = (): number => {
    let r = 0;
    for (let i = 0; i < sim.count; i++) r = Math.max(r, Math.hypot(sim.x[i] - 720, sim.y[i] - 400));
    return r;
  };

  expect(BLOOM_SECONDS).toBe(3);
  bloom.update(0);
  expect(extent()).toBeLessThan(1); // a point at the centre
  let last = 0;
  for (let t = 0.1; t <= BLOOM_SECONDS; t += 0.1) {
    bloom.update(t);
    const r = extent();
    expect(r).toBeGreaterThan(last); // only ever grows
    last = r;
  }
  bloom.update(BLOOM_SECONDS);
  expect(bloom.done(BLOOM_SECONDS)).toBe(true);
  for (let i = 0; i < sim.count; i++) {
    expect(sim.x[i]).toBeCloseTo(homeX[i], 3);
    expect(sim.y[i]).toBeCloseTo(homeY[i], 3);
  }
});
