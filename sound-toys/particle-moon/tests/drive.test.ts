import { describe, expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { BLAST_MAX, DEPTH_MAX, Simulation } from '../src/sim/simulation';

/** Mean distance of the particles from the centre, in shape radii. */
function spread(sim: Simulation): number {
  let sum = 0;
  for (let j = 0; j < sim.count; j++) sum += Math.hypot(sim.x[j] - 1500, sim.y[j] - 1500);
  return sum / sim.count / 300;
}

/** Spread at rest, and its peak over 1.5 s after one hit. */
function hit(strength: number, depth: number): { rest: number; peak: number } {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES.gas;
  sim.moon.enabled = false;
  sim.depth = depth;
  // A screen far bigger than the shape, so its edge never limits the spread being measured.
  sim.setViewport({ width: 3000, height: 3000, radius: 300, cx: 1500, cy: 1500 }, true);
  for (let i = 0; i < 200; i++) sim.step();
  const rest = spread(sim);
  sim.fire(strength);
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    sim.step();
    peak = Math.max(peak, spread(sim));
  }
  return { rest, peak };
}

/** Peak spread over 1.5 s after one hit. */
const spreadAfter = (strength: number, depth: number): number => hit(strength, depth).peak;

describe('drive', () => {
  it('a kick at full Depth vaporizes like the hardest pad at the default Depth', () => {
    const pad = spreadAfter(BLAST_MAX, 0.65);
    const depth = spreadAfter(1, DEPTH_MAX);
    expect(pad).toBeGreaterThan(1.4);
    expect(Math.abs(depth - pad) / pad).toBeLessThan(0.12);
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
