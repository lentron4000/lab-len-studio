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
    f += ((vx[i] * -oy + vy[i] * ox) / r) * Math.sin(2 * Math.PI * 2.5 * (r / re));
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

it('Gas B is still and round with no sound', () => {
  for (const state of [0, 0.9]) {
    const sim = gasB(state, 0);
    travel(sim, 6); // the starting layout relaxes, then nothing moves
    // (A loose cloud keeps easing apart by a fraction of a pixel for a while; invisible.)
    expect(travel(sim, 3), `state ${state}`).toBeLessThan(0.3);
  }
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
