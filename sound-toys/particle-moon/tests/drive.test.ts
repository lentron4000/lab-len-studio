import { describe, expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { BLAST_MAX, DEPTH_MAX, Simulation } from '../src/sim/simulation';

/** Mean distance of the particles from the centre, in shape radii. */
function spread(sim: Simulation): number {
  let sum = 0;
  for (let j = 0; j < sim.count; j++) sum += Math.hypot(sim.x[j] - 720, sim.y[j] - 450);
  return sum / sim.count / 300;
}

/** Spread at rest, and its peak over 1.5 s after one hit. */
function hit(
  strength: number,
  depth: number,
  mode: keyof typeof PHYSICS_MODES = 'gas',
): { rest: number; peak: number; core: number } {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES[mode];
  sim.moon.enabled = false;
  sim.depth = depth;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 200; i++) sim.step();
  const inCore = (): number => {
    let n = 0;
    for (let j = 0; j < sim.count; j++) if (Math.hypot(sim.x[j] - 720, sim.y[j] - 450) < 300 * 0.35) n++;
    return n;
  };
  const rest = spread(sim);
  const core0 = inCore();
  sim.fire(strength);
  let peak = 0;
  let core = 1;
  for (let i = 0; i < 90; i++) {
    sim.step();
    const s = spread(sim);
    if (s > peak) {
      peak = s;
      core = inCore() / core0;
    }
  }
  return { rest, peak, core };
}

/** Peak spread over 1.5 s after one hit. */
const spreadAfter = (strength: number, depth: number, mode: keyof typeof PHYSICS_MODES = 'gas'): number =>
  hit(strength, depth, mode).peak;

describe('drive', () => {
  it('a kick at full Depth hits like the hardest pad at the default Depth', () => {
    for (const mode of ['gas', 'repel'] as const) {
      const pad = spreadAfter(BLAST_MAX, 0.65, mode);
      const depth = spreadAfter(1, DEPTH_MAX, mode);
      expect(Math.abs(depth - pad) / pad, mode).toBeLessThan(0.12);
    }
    // The poles still blast apart.
    expect(spreadAfter(BLAST_MAX, 0.65, 'repel')).toBeGreaterThan(1.4);
  });

  it('gas breathes at full Depth: a modest swell around a core that stays, not a ring', () => {
    const { rest, peak, core } = hit(1, DEPTH_MAX);
    expect(peak - rest).toBeGreaterThan(0.05);
    // Before, it flew out to a ring (mean spread ~1.5 radii) with the middle emptied.
    expect(peak).toBeLessThan(1);
    expect(core).toBeGreaterThan(0.6);
  });

  it('steady kicks at full Depth keep the shape on screen (blasts recharge between hits)', () => {
    for (const mode of ['gas', 'attract', 'repel'] as const) {
      const sim = new Simulation(1500);
      sim.mode = PHYSICS_MODES[mode];
      sim.moon.enabled = false;
      sim.stateTarget = sim.state = 0.1;
      sim.depth = DEPTH_MAX;
      sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
      for (let i = 0; i < 200; i++) sim.step();
      let on = 0;
      let samples = 0;
      for (let s = 1; s <= 600; s++) {
        if (s % 36 === 1) sim.fire(1);
        sim.step();
        if (s % 20 === 0) {
          for (let j = 0; j < sim.count; j++)
            if (sim.x[j] > 0 && sim.x[j] < 1440 && sim.y[j] > 0 && sim.y[j] < 900) on++;
          samples++;
        }
      }
      expect(on / samples / sim.count).toBeGreaterThan(0.5);
    }
  });

  it('an ordinary kick at the old maximum Depth does not blast', () => {
    // It opens the gas a little; a blast throws it well past its edge.
    const { rest, peak } = hit(1, 1);
    expect(peak - rest).toBeLessThan(0.2);
  });
});
