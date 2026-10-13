import { describe, expect, it } from 'vitest';
import { PHYSICS_MODES, type PhysicsModeId } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

/** Step (after one kick) at which the inner and outer particles are pushed furthest out. */
function peakSteps(mode: PhysicsModeId, state: number): { inner: number; outer: number } {
  const sim = new Simulation(2000);
  sim.mode = PHYSICS_MODES[mode];
  sim.moon.enabled = false;
  sim.stateTarget = sim.state = state;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 300; i++) sim.step();
  const r0 = Array.from({ length: sim.count }, (_, j) => Math.hypot(sim.x[j] - 720, sim.y[j] - 450));
  const max = Math.max(...r0);
  const inner = r0.flatMap((r, j) => (r < 0.35 * max ? [j] : []));
  const outer = r0.flatMap((r, j) => (r > 0.8 * max ? [j] : []));
  const spread = (ids: number[]): number =>
    ids.reduce((s, j) => s + Math.hypot(sim.x[j] - 720, sim.y[j] - 450) - r0[j], 0) / ids.length;
  sim.fire(1);
  const best = { inner: [0, -Infinity], outer: [0, -Infinity] };
  for (let s = 1; s <= 90; s++) {
    sim.step();
    const a = spread(inner);
    const b = spread(outer);
    if (a > best.inner[1]) best.inner = [s, a];
    if (b > best.outer[1]) best.outer = [s, b];
  }
  return { inner: best.inner[0], outer: best.outer[0] };
}

describe('water ripple', () => {
  it('reaches the centre before the rim', () => {
    const { inner, outer } = peakSteps('water', 0.1);
    expect(outer).toBeGreaterThan(inner + 6);
  });

  it('travels faster when tight than when loose', () => {
    expect(peakSteps('water', 0.1).outer).toBeLessThan(peakSteps('water', 0.6).outer);
  });
});
