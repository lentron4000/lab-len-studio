import { expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

it('an untouched gas disc stays calm with the moon passing through it', () => {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES.gas;
  sim.moon.enabled = true;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 10 * 60; i++) sim.step();
  // Then the worst frame over the next 20 seconds.
  let ke = 0;
  for (let i = 0; i < 20 * 60; i++) ke = Math.max(ke, sim.step());
  // Before flat shapes damped depth motion, the moon pumped this to ~100 within ten seconds.
  expect(ke).toBeLessThan(10);
});

it('with no sound the tight disc is perfectly still', () => {
  const sim = new Simulation(1500);
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  sim.stateTarget = sim.state = 0;
  sim.moon.enabled = false;
  for (let i = 0; i < 600; i++) sim.step(); // settle from the starting layout
  const x0 = Float32Array.from(sim.x);
  const y0 = Float32Array.from(sim.y);
  for (let i = 0; i < 120; i++) sim.step();
  let moved = 0;
  for (let j = 0; j < sim.count; j++) moved = Math.max(moved, Math.hypot(sim.x[j] - x0[j], sim.y[j] - y0[j]));
  expect(moved).toBeLessThan(0.01);
  sim.sound = 1;
  for (let i = 0; i < 60; i++) sim.step();
  let stirred = 0;
  for (let j = 0; j < sim.count; j++)
    stirred = Math.max(stirred, Math.hypot(sim.x[j] - x0[j], sim.y[j] - y0[j]));
  expect(stirred).toBeGreaterThan(0.05);
});

it('a loose gas cloud stays centred while the moon orbits it', () => {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES.gas;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  sim.stateTarget = sim.state = 0.9;
  sim.sound = 0.5;
  sim.moon.enabled = true;
  let worst = 0;
  for (let s = 0; s < 60 * 60; s++) {
    sim.step();
    if (s < 300) continue;
    let mx = 0;
    for (let i = 0; i < sim.count; i++) mx += sim.x[i];
    worst = Math.max(worst, Math.abs(mx / sim.count - 720));
  }
  // Before the centring spring, the moon's bow wave carried the whole cloud ±20% of the radius.
  expect(worst / 300).toBeLessThan(0.04);
});
