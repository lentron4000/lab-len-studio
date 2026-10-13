import { describe, expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { BLAST_MAX, DEPTH_MAX, Simulation } from '../src/sim/simulation';

/** Peak mean distance from the centre (in shape radii) over 1.5 s after one hit. */
function spreadAfter(strength: number, depth: number): number {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES.gas;
  sim.moon.enabled = false;
  sim.depth = depth;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 200; i++) sim.step();
  sim.fire(strength);
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    sim.step();
    let sum = 0;
    for (let j = 0; j < sim.count; j++) sum += Math.hypot(sim.x[j] - 720, sim.y[j] - 450);
    peak = Math.max(peak, sum / sim.count / 300);
  }
  return peak;
}

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
    expect(spreadAfter(1, 1)).toBeLessThan(1);
  });
});
