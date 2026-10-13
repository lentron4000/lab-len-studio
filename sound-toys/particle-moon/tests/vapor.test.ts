import { describe, expect, it } from 'vitest';
import { PHYSICS_MODES, type PhysicsModeId } from '../src/sim/physics-modes';
import { BLAST_MAX, Simulation } from '../src/sim/simulation';

/** Share of particles evaporated 0.5 s after one hit. */
function evaporatedAfter(strength: number, mode: PhysicsModeId = 'gas'): number {
  const sim = new Simulation(2000);
  sim.mode = PHYSICS_MODES[mode];
  sim.moon.enabled = false;
  sim.stateTarget = sim.state = 0.1;
  sim.setViewport({ width: 1440, height: 900, radius: 300, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 200; i++) sim.step();
  sim.fire(strength);
  for (let i = 0; i < 30; i++) sim.step();
  return sim.vapor.filter((v) => v > 0.1).length / sim.count;
}

describe('gas vapor', () => {
  it('evaporates more of the gas the harder it is hit', () => {
    const soft = evaporatedAfter(0.5);
    const full = evaporatedAfter(1);
    const hard = evaporatedAfter(BLAST_MAX);
    expect(soft).toBeLessThan(full);
    expect(full).toBeLessThan(hard);
    expect(full).toBeLessThan(0.15);
    expect(hard).toBeGreaterThan(0.15);
  });

  it('leaves the other modes alone', () => {
    expect(evaporatedAfter(BLAST_MAX, 'water')).toBe(0);
  });
});
