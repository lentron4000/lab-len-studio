import { expect, it } from 'vitest';
import { PHYSICS_MODES } from '../src/sim/physics-modes';
import { BLAST_MAX, CAMERA_DISTANCE, DEPTH_MAX, Simulation } from '../src/sim/simulation';

it('blasts spend themselves before the screen edge, staying round and not bunching up (for projection)', () => {
  const W = 1280;
  const H = 720;
  const R = 215; // the layout's radius for this screen with the controls hidden
  for (const mode of ['gas', 'water', 'attract', 'repel'] as const) {
    for (const [globe, moon] of [
      [0, false],
      [1, false],
      [0, true],
      [1, true],
    ] as const) {
      const sim = new Simulation(1500);
      sim.mode = PHYSICS_MODES[mode];
      sim.moon.enabled = moon;
      sim.shapeTarget = sim.globe = globe;
      sim.stateTarget = sim.state = 0.5;
      sim.depth = DEPTH_MAX;
      sim.sound = 1;
      sim.setViewport({ width: W, height: H, radius: R, cx: W / 2, cy: H / 2 }, true);
      const camera = R * CAMERA_DISTANCE;
      let off = 0;
      let crowd = 0;
      let wide = 0;
      let tall = 0;
      for (let s = 0; s < 15 * 60; s++) {
        if (s % 40 === 0) sim.fire(s % 120 === 0 ? BLAST_MAX : 1);
        sim.step();
        let near = 0;
        for (let i = 0; i < sim.count; i++) {
          const ps = camera / (camera - sim.z[i]);
          const qx = Math.abs(sim.x[i] - W / 2) * ps;
          const qy = Math.abs(sim.y[i] - H / 2) * ps;
          if (qx > W / 2 || qy > H / 2) off++;
          wide = Math.max(wide, qx);
          tall = Math.max(tall, qy);
          if (qx > W / 2 - 30 || qy > H / 2 - 30) near++;
        }
        crowd = Math.max(crowd, near / sim.count);
      }
      const label = `${mode} ${globe ? 'globe' : 'disc'}${moon ? ' with the moon' : ''}`;
      expect(off, label).toBe(0);
      expect(crowd, label).toBeLessThan(0.01);
      // Round: on a wide screen it spreads no further sideways than up and down. (The moon draws a
      // bulge toward itself as it passes, so this holds without it.)
      if (!moon) expect(wide / tall, label).toBeLessThan(1.08);
    }
  }
});
