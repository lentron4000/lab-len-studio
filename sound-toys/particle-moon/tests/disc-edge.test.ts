import { expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';

const CX = 720;
const CY = 450;

/** The outline of the union of dots, sampled all round: its nearest and furthest reach from centre (px). */
function outline(sim: Simulation): [number, number] {
  const r = sim.dotRadius();
  let lo = Infinity;
  let hi = 0;
  for (let k = 0; k < 720; k++) {
    const t = (k / 720) * 2 * Math.PI;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    let reach = 0;
    for (let i = 0; i < sim.count; i++) {
      const px = sim.x[i] - CX;
      const py = sim.y[i] - CY;
      const across = -px * uy + py * ux;
      if (Math.abs(across) < r)
        reach = Math.max(reach, px * ux + py * uy + Math.sqrt(r * r - across * across));
    }
    lo = Math.min(lo, reach);
    hi = Math.max(hi, reach);
  }
  return [lo, hi];
}

/** Sample points (every half pixel) inside radius `edge` that no dot covers. */
function holes(sim: Simulation, edge: number): number {
  const r = sim.dotRadius();
  const cell = Math.ceil(r);
  const grid = new Map<string, number[]>();
  for (let i = 0; i < sim.count; i++) {
    const key = `${Math.floor(sim.x[i] / cell)},${Math.floor(sim.y[i] / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), i]);
  }
  let open = 0;
  for (let py = CY - edge; py <= CY + edge; py += 0.5) {
    for (let px = CX - edge; px <= CX + edge; px += 0.5) {
      if (Math.hypot(px - CX, py - CY) > edge - 1) continue;
      const gx = Math.floor(px / cell);
      const gy = Math.floor(py / cell);
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1 && !hit; dx++)
          hit = (grid.get(`${gx + dx},${gy + dy}`) ?? []).some(
            (i) => (sim.x[i] - px) ** 2 + (sim.y[i] - py) ** 2 < r * r,
          );
      if (!hit) open++;
    }
  }
  return open;
}

it('the silent, tight disc is a solid circle with a smooth edge, at any particle count', () => {
  for (const [count, radius] of [
    [1200, 180],
    [2800, 300],
  ]) {
    const sim = new Simulation(count);
    sim.setViewport({ width: 1440, height: 900, radius, cx: CX, cy: CY }, true);
    sim.stateTarget = sim.state = 0;
    sim.moon.enabled = false;
    for (let s = 0; s < 300; s++) sim.step();
    const [lo, hi] = outline(sim);
    // A plain phyllotaxis rim scalloped the edge by ~10 px.
    expect(hi - lo).toBeLessThan(0.6);
    expect(holes(sim, lo)).toBe(0);
  }
});
