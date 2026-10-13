import { test } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

function shape(sim: Simulation): string {
  const n = sim.count, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = sim.x[i] - sim.x[j], dy = sim.y[i] - sim.y[j];
    if (dx * dx + dy * dy < 100) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); }
  let drops = 0, stray = 0, elong = 0;
  for (const g of groups.values()) {
    if (g.length < 8) { stray += g.length; continue; }
    drops++;
    const mx = g.reduce((s, i) => s + sim.x[i], 0) / g.length, my = g.reduce((s, i) => s + sim.y[i], 0) / g.length;
    let a = 0, b = 0, c = 0;
    for (const i of g) { const dx = sim.x[i] - mx, dy = sim.y[i] - my; a += dx * dx; b += dx * dy; c += dy * dy; }
    const t = (a + c) / 2, d = Math.sqrt(((a - c) / 2) ** 2 + b * b);
    elong += Math.sqrt((t + d) / Math.max(1e-6, t - d));
  }
  return `${drops} drops, elongation ${(elong / drops).toFixed(2)}, stray ${stray}`;
}

test('probe', () => {
  for (const st of [0.1, 0.5, 0.9, 1]) {
    const sim = new Simulation(2400);
    sim.mode = PHYSICS_MODES.water;
    sim.moon.enabled = false;
    sim.stateTarget = sim.state = st;
    sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
    for (let i = 0; i < 900; i++) sim.step();
    const rows = [`settled ${shape(sim)}`];
    const r0 = Array.from({ length: sim.count }, (_, j) => Math.hypot(sim.x[j] - 720, sim.y[j] - 450));
    let move = 0;
    for (let s = 1; s <= 60 * 30; s++) {
      if (s % 36 === 0) sim.fire(1);
      sim.step();
      if (s < 120) { let d = 0; for (let j = 0; j < sim.count; j++) d += Math.abs(Math.hypot(sim.x[j] - 720, sim.y[j] - 450) - r0[j]); move = Math.max(move, d / sim.count); }
      if (s % 900 === 0) { let r = 0; for (let j = 0; j < sim.count; j++) r += Math.hypot(sim.x[j] - 720, sim.y[j] - 450); rows.push(`${s / 60}s ${shape(sim)}, mean r ${(r / sim.count / 300).toFixed(2)}`); }
    }
    rows.push(`sway ${move.toFixed(1)}px`);
    console.log(`RESULT state ${st}: ${rows.join(' | ')}`);
  }
});
