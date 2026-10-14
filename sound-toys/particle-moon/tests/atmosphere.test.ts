import { expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

const R = 280;
const CX = 720;
const CY = 450;

function gasB(state: number, sound: number): Simulation {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES.gasB;
  sim.moon.enabled = false;
  sim.stateTarget = sim.state = state;
  sim.sound = sound;
  sim.bpm = 120;
  sim.setViewport({ width: 1440, height: 900, radius: R, cx: CX, cy: CY }, true);
  return sim;
}

/** How far motion round the centre follows the rings (their alternating directions), px/step. */
function bandFollow(sim: Simulation): number {
  const re = sim.effectiveRadius();
  const { vx, vy } = sim as unknown as { vx: Float32Array; vy: Float32Array };
  let f = 0;
  for (let i = 0; i < sim.count; i++) {
    const ox = sim.x[i] - CX;
    const oy = sim.y[i] - CY;
    const r = Math.hypot(ox, oy) || 1;
    f += ((vx[i] * -oy + vy[i] * ox) / r) * Math.sin(2 * Math.PI * 2 * (r / re));
  }
  return f / sim.count;
}

/** Mean distance the particles travel over `seconds`. */
function travel(sim: Simulation, seconds: number): number {
  const x0 = Float32Array.from(sim.x);
  const y0 = Float32Array.from(sim.y);
  for (let s = 0; s < seconds * 60; s++) sim.step();
  let d = 0;
  for (let i = 0; i < sim.count; i++) d += Math.hypot(sim.x[i] - x0[i], sim.y[i] - y0[i]);
  return d / sim.count;
}

it('Gas B with no sound: still at Tight, drifting like smoke toward Loose', () => {
  const tight = gasB(0, 0);
  travel(tight, 6);
  expect(travel(tight, 3)).toBeLessThan(0.05);
  const loose = gasB(0.9, 0);
  travel(loose, 6);
  expect(travel(loose, 3)).toBeGreaterThan(5);
});

it('Gas B: after the music stops, a Tight disc packs back into a solid circle', () => {
  const sim = gasB(0, 0);
  sim.setViewport({ width: 1440, height: 900, radius: 200, cx: CX, cy: CY }, true);
  sim.sound = 0.7;
  for (let s = 0; s < 10 * 60; s++) {
    if (s % 36 === 0) sim.fire(1);
    sim.step();
  }
  sim.sound = 0;
  travel(sim, 6);
  const r = sim.dotRadius();
  let open = 0;
  for (let py = CY - 190; py <= CY + 190; py += 2)
    for (let px = CX - 190; px <= CX + 190; px += 2) {
      if (Math.hypot(px - CX, py - CY) > 190) continue;
      let hit = false;
      for (let i = 0; i < sim.count && !hit; i++) hit = (sim.x[i] - px) ** 2 + (sim.y[i] - py) ** 2 < r * r;
      if (!hit) open++;
    }
  // The rings' shear used to leave it full of holes (thousands of open pixels).
  expect(open).toBeLessThan(10);
});

it('Gas B: sound stirs it into rings drifting in alternating directions; Tight resists', () => {
  const loose = gasB(0.9, 0.6);
  const moved = travel(loose, 8);
  expect(bandFollow(loose)).toBeGreaterThan(0.15);
  const tight = gasB(0.1, 0.6);
  expect(travel(tight, 8)).toBeLessThan(moved * 0.5);
});

it('Gas B: a kick shatters the rings, and they settle back', () => {
  const sim = gasB(0.9, 0.6);
  travel(sim, 6);
  const before = bandFollow(sim);
  sim.fire(1);
  travel(sim, 0.2);
  expect(bandFollow(sim)).toBeLessThan(before * 0.6);
  travel(sim, 2);
  expect(bandFollow(sim)).toBeGreaterThan(before * 0.75);
});
