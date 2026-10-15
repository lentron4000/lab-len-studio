import { expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { Simulation } from '../src/sim/simulation';

function sim(mode: 'gas' | 'water' = 'gas'): Simulation {
  const s = new Simulation(1200);
  s.mode = PHYSICS_MODES[mode];
  s.moon.enabled = false;
  s.stateTarget = s.state = 0.3;
  s.setViewport({ width: 1440, height: 900, radius: 280, cx: 720, cy: 450 }, true);
  for (let i = 0; i < 120; i++) s.step();
  return s;
}

it('a kick swings State toward Loose, harder kicks further, then it eases back to the slider', () => {
  const soft = sim();
  const hard = sim();
  const rest = hard.slider;
  soft.fire(0.4);
  hard.fire(1);
  soft.step();
  hard.step();
  expect(hard.slider).toBeGreaterThan(rest + 0.05);
  expect(hard.slider - rest).toBeGreaterThan((soft.slider - rest) * 1.8);
  for (let i = 0; i < 90; i++) hard.step();
  expect(hard.slider - rest).toBeLessThan(0.01);
});

it('Depth follows loudness: the same kick hits deeper in loud music than in quiet', () => {
  const spread = (gain: number): number => {
    const s = sim();
    s.depthGain = gain;
    const r = (): number => {
      let sum = 0;
      for (let i = 0; i < s.count; i++) sum += Math.hypot(s.x[i] - 720, s.y[i] - 450);
      return sum / s.count;
    };
    const rest = r();
    s.fire(1);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      s.step();
      peak = Math.max(peak, r());
    }
    return peak - rest;
  };
  expect(spread(1.5)).toBeGreaterThan(spread(0.5) * 1.5);
});
