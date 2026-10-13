import { expect, it } from 'vitest';
import { PHYSICS_MODES, type PhysicsModeId } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

/** Particles within 40 px of a pointer held still over the shape, before and after 3 s. */
function gathered(mode: PhysicsModeId): [before: number, after: number] {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES[mode];
  sim.moon.enabled = false;
  sim.stateTarget = sim.state = 0.6;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 300; i++) sim.step();
  const near = (): number => sim.x.filter((x, j) => Math.hypot(x - 800, sim.y[j] - 420) < 40).length;
  const before = near();
  const p = sim.pointer as unknown as { x: number; y: number; active: boolean };
  p.active = true;
  p.x = 800;
  p.y = 420;
  for (let i = 0; i < 180; i++) sim.step();
  return [before, near()];
}

it('gas and water are not drawn to the pointer; attract still is', () => {
  for (const mode of ['gas', 'water'] as const) {
    const [before, after] = gathered(mode);
    // Held still, it neither pulls particles in nor pushes them away.
    expect(after).toBeLessThanOrEqual(before + 4);
    expect(after).toBeGreaterThanOrEqual(before - 4);
  }
  const [before, after] = gathered('attract');
  expect(after).toBeGreaterThan(before * 2);
});
