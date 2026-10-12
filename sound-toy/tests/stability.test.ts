import { expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

it('an untouched gas disc stays calm with the moon passing through it', () => {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES.gas;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 10 * 60; i++) sim.step();
  // Then the worst frame over the next 20 seconds.
  let ke = 0;
  for (let i = 0; i < 20 * 60; i++) ke = Math.max(ke, sim.step());
  // Before flat shapes damped depth motion, the moon pumped this to ~100 within ten seconds.
  expect(ke).toBeLessThan(10);
});
