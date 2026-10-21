import { describe, expect, it } from 'vitest';
import { FreeStruts, geodesic, wireLayout } from '../src/sim/wire';

function fibonacciSphere(n: number): [Float32Array, Float32Array, Float32Array] {
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const z = new Float32Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    y[i] = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y[i] * y[i]);
    x[i] = Math.cos(i * golden) * r;
    z[i] = Math.sin(i * golden) * r;
  }
  return [x, y, z];
}

describe('wire globe', () => {
  it('is a 3V geodesic sphere: 92 hubs, 270 struts, a hub at the top', () => {
    const { hubs, struts } = geodesic(3);
    expect(hubs).toHaveLength(92);
    expect(struts).toHaveLength(270);
    expect(Math.min(...hubs.map((h) => h[1]))).toBeCloseTo(-1, 5);
    // Every hub joins five (the icosahedron's corners) or six struts.
    const degree = new Array<number>(hubs.length).fill(0);
    for (const [a, b] of struts) {
      degree[a]++;
      degree[b]++;
    }
    expect(degree.filter((d) => d === 5)).toHaveLength(12);
    expect(degree.every((d) => d === 5 || d === 6)).toBe(true);
  });

  it.each([1200, 2800])('gives all %i particles a place on the frame, with short even links', (n) => {
    const layout = wireLayout(...fibonacciSphere(n));
    let far = 0;
    for (let i = 0; i < n; i++) far = Math.max(far, Math.hypot(layout.x[i], layout.y[i], layout.z[i]));
    expect(far).toBeLessThanOrEqual(1.0001);
    // One link per gap along every strut: hubs plus the particles between them, less nothing.
    expect(layout.segA.length).toBe(n - 92 + 270);
    for (let k = 0; k < layout.segA.length; k++) {
      const a = layout.segA[k];
      const b = layout.segB[k];
      const d = Math.hypot(layout.x[a] - layout.x[b], layout.y[a] - layout.y[b], layout.z[a] - layout.z[b]);
      expect(d).toBeLessThan(layout.spacing * 1.6);
    }
  });

  it('breaks its struts free toward Loose, a few at a time, and rejoins them at Tight', () => {
    const layout = wireLayout(...fibonacciSphere(1500));
    const struts = new FreeStruts(layout);
    const freed = (): number => Array.from(struts.free).filter((f) => f > 0.5).length;
    for (let k = 0; k < 120; k++) struts.step(0);
    expect(freed()).toBe(0);
    for (let k = 0; k < 120; k++) struts.step(0.45);
    expect(freed()).toBeGreaterThan(layout.struts * 0.2);
    expect(freed()).toBeLessThan(layout.struts * 0.8);
    for (let k = 0; k < 120; k++) struts.step(1);
    expect(freed()).toBe(layout.struts);
    // Back at Tight every particle is home on the frame again.
    for (let k = 0; k < 600; k++) struts.step(0);
    const out = new Float32Array(3);
    for (let i = 0; i < 1500; i++) {
      struts.place(i, layout.x[i], layout.y[i], layout.z[i], out);
      expect(Math.hypot(out[0] - layout.x[i], out[1] - layout.y[i], out[2] - layout.z[i])).toBeLessThan(1e-6);
    }
  });
});
