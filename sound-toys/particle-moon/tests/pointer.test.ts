import { expect, it } from 'vitest';
import { PHYSICS_MODES, type PhysicsModeId } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

/** Particles within `radius` px of a pointer held still over the shape, before and after 3 s. */
function gathered(mode: PhysicsModeId, radius = 40, pole: -1 | 0 | 1 = 0): [before: number, after: number] {
  const sim = new Simulation(1500);
  sim.mode = PHYSICS_MODES[mode];
  sim.pole = pole;
  sim.moon.enabled = false;
  sim.stateTarget = sim.state = 0.6;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 300; i++) sim.step();
  const near = (): number => sim.x.filter((x, j) => Math.hypot(x - 800, sim.y[j] - 420) < radius).length;
  const before = near();
  const p = sim.pointer as unknown as { x: number; y: number; active: boolean };
  p.active = true;
  p.x = 800;
  p.y = 420;
  for (let i = 0; i < 180; i++) sim.step();
  return [before, near()];
}

it('a still pointer: gas ignores it (even as a pole), liquid keeps clear of it, an attract pole gathers liquid', () => {
  // Gas is left to drift on its own: the pointer neither pulls in nor pushes away, pole or not.
  for (const pole of [0, 1] as const) {
    const [gasBefore, gasAfter] = gathered('gas', 40, pole);
    expect(gasAfter).toBeLessThanOrEqual(gasBefore + 4);
    expect(gasAfter).toBeGreaterThanOrEqual(gasBefore - 4);
  }
  // Liquid treats it as a solid object: dots keep 2 px clear of the cursor circle (7.5 px).
  const [, liquidAfter] = gathered('water', 9);
  expect(liquidAfter).toBe(0);
  const [before, after] = gathered('water', 40, 1);
  expect(after).toBeGreaterThan(before * 2);
});
