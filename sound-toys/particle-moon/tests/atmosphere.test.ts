import { expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { DEPTH_MAX, Simulation } from '../src/sim/simulation';

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

/** Ring contrast: how unevenly the particles sit across thin rings (std / mean of density), 0 = even. */
function ringContrast(sim: Simulation): number {
  const re = sim.effectiveRadius();
  const bins = new Array(24).fill(0) as number[];
  for (let i = 0; i < sim.count; i++) {
    const r = Math.hypot(sim.x[i] - CX, sim.y[i] - CY) / (re * 1.1);
    if (r < 1) bins[Math.floor(r * 24)]++;
  }
  const dens = bins.map((n, k) => n / ((k + 1) ** 2 - k ** 2)).slice(2, 22);
  const mean = dens.reduce((a, b) => a + b, 0) / dens.length;
  return Math.sqrt(dens.reduce((a, b) => a + (b - mean) ** 2, 0) / dens.length) / mean;
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
  // A slow, steady drift: well over a pixel every few seconds.
  expect(travel(loose, 3)).toBeGreaterThan(1.5);
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

it('Gas B: with music, loose smoke gathers into rings now and then (more than Gas A); Tight resists', () => {
  /** Ring contrast averaged over 15 s (rings form in patches and come and go). */
  const meanContrast = (sim: Simulation): number => {
    travel(sim, 8);
    let sum = 0;
    for (let k = 0; k < 15; k++) {
      travel(sim, 1);
      sum += ringContrast(sim);
    }
    return sum / 15;
  };
  const b = gasB(0.9, 0.6);
  const a = gasB(0.9, 0.6);
  a.mode = PHYSICS_MODES.gas;
  // Subtle, but there.
  expect(meanContrast(b)).toBeGreaterThan(meanContrast(a) + 0.02);
  // Tight shows no more rings than Gas A's (its own edge ring already reads as some contrast).
  const tight = gasB(0.1, 0.6);
  const tightA = gasB(0.1, 0.6);
  tightA.mode = PHYSICS_MODES.gas;
  travel(tight, 20);
  travel(tightA, 20);
  expect(ringContrast(tight)).toBeLessThan(ringContrast(tightA) + 0.05);
});

it('Gas B: a kick churns it, then it calms', () => {
  const sim = gasB(0.9, 0.6);
  travel(sim, 6);
  const calm = travel(sim, 0.5);
  sim.fire(1);
  const churned = travel(sim, 0.5);
  expect(churned).toBeGreaterThan(calm * 1.3);
  travel(sim, 3);
  expect(travel(sim, 0.5)).toBeLessThan(churned);
});

it('Gas B: full Loose leaves room for the kick; only a full-Deep kick reaches full size', () => {
  const peak = (depth: number): { rest: number; peak: number } => {
    const sim = gasB(1, 0.6);
    sim.depth = depth;
    travel(sim, 15);
    const size = (): number => {
      const d: number[] = [];
      for (let i = 0; i < sim.count; i++)
        if (sim.vaporFade[i] < 0.3) d.push(Math.hypot(sim.x[i] - CX, sim.y[i] - CY));
      d.sort((a, b) => a - b);
      return d[Math.floor(d.length * 0.95)] / R;
    };
    const rest = size();
    sim.fire(1);
    let top = 0;
    for (let s = 0; s < 120; s++) {
      sim.step();
      top = Math.max(top, size());
    }
    return { rest, peak: top };
  };
  const usual = peak(0.65);
  const deep = peak(DEPTH_MAX);
  // Loose sits well below what a full-Deep kick reaches (it used to be within ~7%)...
  expect(deep.rest).toBeLessThan(deep.peak * 0.88);
  // ...and a kick at the usual Depth swells it far less than a full-Deep one.
  expect(usual.peak - usual.rest).toBeLessThan((deep.peak - deep.rest) * 0.6);
});
