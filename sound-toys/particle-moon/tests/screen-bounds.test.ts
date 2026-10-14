import { expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { BLAST_MAX, CAMERA_DISTANCE, DEPTH_MAX, Simulation } from '../src/sim/simulation';

it('nothing leaves the screen, whatever hits it (for projection)', () => {
  const W = 1280;
  const H = 720;
  for (const mode of ['gas', 'water', 'attract', 'repel'] as const) {
    for (const globe of [0, 1]) {
      const sim = new Simulation(1500);
      sim.mode = PHYSICS_MODES[mode];
      sim.moon.enabled = mode === 'attract' || mode === 'repel';
      sim.shapeTarget = sim.globe = globe;
      sim.stateTarget = sim.state = 0.75;
      sim.depth = DEPTH_MAX;
      sim.sound = 1;
      sim.setViewport({ width: W, height: H, radius: 220, cx: W / 2, cy: H / 2 }, true);
      const camera = 220 * CAMERA_DISTANCE;
      let out = 0;
      for (let s = 0; s < 20 * 60; s++) {
        if (s % 40 === 0) sim.fire(BLAST_MAX);
        sim.step();
        for (let i = 0; i < sim.count; i++) {
          const ps = camera / (camera - sim.z[i]);
          const qx = W / 2 + (sim.x[i] - W / 2) * ps;
          const qy = H / 2 + (sim.y[i] - H / 2) * ps;
          if (qx < 0 || qx > W || qy < 0 || qy > H) out++;
        }
      }
      expect(out, `${mode} ${globe ? 'globe' : 'disc'}`).toBe(0);
    }
  }
});
