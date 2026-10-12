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
    expect(pad).toBeGreaterThan(1.6);
    expect(Math.abs(depth - pad) / pad).toBeLessThan(0.12);
  });

  it('an ordinary kick at the old maximum Depth does not blast', () => {
    expect(spreadAfter(1, 1)).toBeLessThan(1);
  });
});
