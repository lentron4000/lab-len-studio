import { expect, it } from 'vitest';
import { Bloom, BLOOM_SECONDS } from '../src/sim/bloom';
import { Simulation } from '../src/sim/simulation';

it('starts every particle at the loader and ends with each at home', () => {
  const sim = new Simulation(1200);
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 400 }, true);
  const homeX = Float32Array.from(sim.x);
  const homeY = Float32Array.from(sim.y);
  const bloom = new Bloom(sim, 720, 400);

  expect(bloom.update(0)).toBe(0);
  let born = 0;
  for (let t = 0; t <= BLOOM_SECONDS; t += 0.1) {
    const now = bloom.update(t);
    expect(now).toBeGreaterThanOrEqual(born); // births only accumulate
    born = now;
  }
  expect(bloom.update(BLOOM_SECONDS)).toBe(sim.count);
  expect(bloom.done(BLOOM_SECONDS)).toBe(true);
  for (let i = 0; i < sim.count; i++) {
    expect(sim.x[i]).toBeCloseTo(homeX[i], 3);
    expect(sim.y[i]).toBeCloseTo(homeY[i], 3);
    expect(sim.excite[i]).toBeCloseTo(0, 5);
  }
});
