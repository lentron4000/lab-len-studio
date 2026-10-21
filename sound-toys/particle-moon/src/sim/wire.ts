// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** Geodesic frequency: each icosahedron edge split into this many struts (3V: 92 hubs, 270 struts). */
const FREQUENCY = 3;
/** The wire disc: rings of hubs round a centre hub (ring k holds 6k), as the dome looks from above. */
const DISC_RINGS = 4;

type Vec = [number, number, number];

export interface WireLayout {
  /** Home per particle (y down, z toward the viewer, within the unit sphere), in particle order. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** The wire: pairs of particles (segA[k], segB[k]) joined by a line. */
  segA: Int32Array;
  segB: Int32Array;
  /** Each link's strut, and whether it's one of the strut's two end links (to a hub), which break first. */
  segStrut: Int32Array;
  segHub: Uint8Array;
  /** Each particle's strut, or -1 for a hub. */
  strutOf: Int32Array;
  /** Struts: how many, and each one's midpoint (the centre it tumbles round once it breaks loose). */
  struts: number;
  strutX: Float32Array;
  strutY: Float32Array;
  strutZ: Float32Array;
  /** Distance between neighbours along a strut, for telling a stretched wire from a torn one. */
  spacing: number;
}

/**
 * The wire globe: a geodesic sphere. An icosahedron's faces are subdivided (FREQUENCY) and pushed out
 * onto the sphere; the hubs are particles, and the straight struts between them are lined with the
 * rest, evenly. Lines run between neighbours along each strut, so the frame is the particles
 * themselves. Loose breaks struts off their hubs to float free (see FreeStruts). Each layout point is then given to the particle whose sphere point is nearest it, so the
 * change from the plain globe moves everything as little as possible.
 */
export function wireLayout(sphereX: Float32Array, sphereY: Float32Array, sphereZ: Float32Array): WireLayout {
  const { hubs, struts } = geodesic(FREQUENCY);
  return lineFrame(hubs, struts, [sphereX, sphereY, sphereZ], (px, py, pz, i) => {
    const l = Math.hypot(px, py, pz) || 1;
    return (px * sphereX[i] + py * sphereY[i] + pz * sphereZ[i]) / l;
  });
}

/**
 * The wire disc: the flat frame (see discFrame), lined with particles the same way as the globe's, each
 * point given to the particle whose disc point is nearest it.
 */
export function discWireLayout(discX: Float32Array, discY: Float32Array): WireLayout {
  const { hubs, struts } = discFrame(DISC_RINGS);
  const flat = new Float32Array(discX.length);
  return lineFrame(hubs, struts, [discX, discY, flat], (px, py, _pz, i) => {
    const dx = px - discX[i];
    const dy = py - discY[i];
    return -(dx * dx + dy * dy);
  });
}

/**
 * Hubs and struts lined with the `homes`' particles: hubs first, then the rest along the straight struts.
 * Each layout point goes to the free particle that scores highest by `near` (shuffled order); any
 * particle the frame has no place for keeps its home.
 */
function lineFrame(
  hubs: Vec[],
  struts: [number, number][],
  homes: [Float32Array, Float32Array, Float32Array],
  near: (px: number, py: number, pz: number, i: number) => number,
): WireLayout {
  const count = homes[0].length;

  // Hubs first, then the rest along the struts: as many per strut as fit, one more on some.
  const inner = Math.max(0, count - hubs.length);
  const base = Math.floor(inner / struts.length);
  let extra = inner - base * struts.length;
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const segA: number[] = [];
  const segB: number[] = [];
  const segStrut: number[] = [];
  const segHub: number[] = [];
  const pointStrut: number[] = [];
  const mids: Vec[] = [];
  for (const h of hubs.slice(0, count)) {
    px.push(h[0]);
    py.push(h[1]);
    pz.push(h[2]);
    pointStrut.push(-1);
  }
  let strutLength = 0;
  let gaps = 0;
  // Spread the extras round the sphere rather than bunched on the first struts.
  const step = extra > 0 ? struts.length / extra : Infinity;
  struts.forEach(([a, b], s) => {
    if (a >= count || b >= count) return;
    const m = base + (extra > 0 && Math.floor(s / step) < Math.floor((s + 1) / step) ? (extra--, 1) : 0);
    const A = hubs[a];
    const B = hubs[b];
    const id = mids.length;
    mids.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]);
    const link = (p: number, q: number, hub: boolean): void => {
      segA.push(p);
      segB.push(q);
      segStrut.push(id);
      segHub.push(hub ? 1 : 0);
    };
    let prev = a;
    for (let k = 1; k <= m; k++) {
      // Straight along the strut, as on a real dome.
      const t = k / (m + 1);
      const j = px.length;
      px.push(A[0] + (B[0] - A[0]) * t);
      py.push(A[1] + (B[1] - A[1]) * t);
      pz.push(A[2] + (B[2] - A[2]) * t);
      pointStrut.push(id);
      link(prev, j, k === 1);
      prev = j;
    }
    link(prev, b, true);
    strutLength += Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    gaps += m + 1;
  });

  // Give each layout point to the free particle nearest its direction, in shuffled order.
  const points = px.length;
  const particleOf = new Int32Array(points);
  const taken = new Uint8Array(count);
  const order = Array.from({ length: points }, (_, i) => i);
  for (let i = points - 1; i > 0; i--) {
    const r = (Math.random() * (i + 1)) | 0;
    [order[i], order[r]] = [order[r], order[i]];
  }
  for (const p of order) {
    let best = -1;
    let bestDot = -Infinity;
    for (let i = 0; i < count; i++) {
      if (taken[i]) continue;
      const d = near(px[p], py[p], pz[p], i);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    taken[best] = 1;
    particleOf[p] = best;
  }
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const strutOf = new Int32Array(count).fill(-1);
  for (let p = 0; p < points; p++) {
    const i = particleOf[p];
    x[i] = px[p];
    y[i] = py[p];
    z[i] = pz[p];
    strutOf[i] = pointStrut[p];
  }
  // (Any particle the frame has no place for keeps its home.)
  for (let i = 0; i < count; i++) {
    if (taken[i]) continue;
    x[i] = homes[0][i];
    y[i] = homes[1][i];
    z[i] = homes[2][i];
  }
  return {
    x,
    y,
    z,
    segA: Int32Array.from(segA, (p) => particleOf[p]),
    segB: Int32Array.from(segB, (p) => particleOf[p]),
    segStrut: Int32Array.from(segStrut),
    segHub: Uint8Array.from(segHub),
    strutOf,
    struts: mids.length,
    strutX: Float32Array.from(mids, (m) => m[0]),
    strutY: Float32Array.from(mids, (m) => m[1]),
    strutZ: Float32Array.from(mids, (m) => m[2]),
    spacing: gaps ? strutLength / gaps : 0.1,
  };
}

/** A geodesic sphere of the given frequency: hub points on the unit sphere and the struts (hub pairs). */
export function geodesic(frequency: number): { hubs: Vec[]; struts: [number, number][] } {
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico: Vec[] = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ];
  const faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  // Turn it so a hub sits at the top (y up is -y here): the classic dome, pole up.
  const top = normalize(ico[0]);
  const turn = alignTo(top, [0, -1, 0]);
  const hubs: Vec[] = [];
  const index = new Map<string, number>();
  const hubAt = (p: Vec): number => {
    const q = normalize(turn(p));
    const key = q.map((v) => v.toFixed(5)).join(',');
    let i = index.get(key);
    if (i === undefined) {
      i = hubs.length;
      hubs.push(q);
      index.set(key, i);
    }
    return i;
  };
  const struts = new Map<string, [number, number]>();
  const strut = (a: number, b: number): void => {
    if (a === b) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!struts.has(key)) struts.set(key, [a, b]);
  };
  const f = frequency;
  for (const [ia, ib, ic] of faces) {
    const [A, B, C] = [ico[ia], ico[ib], ico[ic]];
    // Lattice point (i, j) on the face: A + (B − A)·i/f + (C − A)·j/f, with i + j ≤ f.
    const at = (i: number, j: number): number =>
      hubAt([
        A[0] + ((B[0] - A[0]) * i + (C[0] - A[0]) * j) / f,
        A[1] + ((B[1] - A[1]) * i + (C[1] - A[1]) * j) / f,
        A[2] + ((B[2] - A[2]) * i + (C[2] - A[2]) * j) / f,
      ]);
    for (let i = 0; i <= f; i++)
      for (let j = 0; i + j <= f; j++) {
        const p = at(i, j);
        if (i + j < f) {
          strut(p, at(i + 1, j));
          strut(p, at(i, j + 1));
          strut(at(i + 1, j), at(i, j + 1));
        }
      }
  }
  return { hubs, struts: [...struts.values()] };
}

/**
 * A flat frame for the disc: a hub at the centre and `rings` rings of them round it (ring k at radius
 * k / rings, 6k hubs evenly round it, so the outermost is the rim), with struts round each ring and
 * across between neighbouring rings, triangulated so it reads as the dome seen from above.
 */
export function discFrame(rings: number): { hubs: Vec[]; struts: [number, number][] } {
  const hubs: Vec[] = [[0, 0, 0]];
  const struts: [number, number][] = [];
  let prevStart = 0;
  let prevN = 1;
  for (let k = 1; k <= rings; k++) {
    const n = 6 * k;
    const start = hubs.length;
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n;
      hubs.push([(k / rings) * Math.cos(a), (k / rings) * Math.sin(a), 0]);
    }
    for (let j = 0; j < n; j++) struts.push([start + j, start + ((j + 1) % n)]);
    if (prevN === 1) for (let j = 0; j < n; j++) struts.push([0, start + j]);
    else {
      // Zip the two rings together by angle: always step on the ring whose next hub comes sooner.
      let i = 0;
      let j = 0;
      struts.push([prevStart, start]);
      while (i + j < prevN + n - 1) {
        if (j >= n || (i < prevN && (i + 1) / prevN <= (j + 1) / n)) i++;
        else j++;
        struts.push([prevStart + (i % prevN), start + (j % n)]);
      }
    }
    prevStart = start;
    prevN = n;
  }
  return { hubs, struts };
}

function normalize(p: Vec): Vec {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

/** The rotation taking unit vector `from` onto unit vector `to` (Rodrigues). */
function alignTo(from: Vec, to: Vec): (p: Vec) => Vec {
  const k: Vec = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  const s = Math.hypot(k[0], k[1], k[2]);
  const c = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (s < 1e-9) return c > 0 ? (p) => p : (p) => [-p[0], -p[1], -p[2]];
  const u: Vec = [k[0] / s, k[1] / s, k[2] / s];
  return (p) => {
    const d = u[0] * p[0] + u[1] * p[1] + u[2] * p[2];
    const x: Vec = [u[1] * p[2] - u[2] * p[1], u[2] * p[0] - u[0] * p[2], u[0] * p[1] - u[1] * p[0]];
    return [
      p[0] * c + x[0] * s + u[0] * d * (1 - c),
      p[1] * c + x[1] * s + u[1] * d * (1 - c),
      p[2] * c + x[2] * s + u[2] * d * (1 - c),
    ];
  };
}

/** Where on the State range (0 Tight … 1 Loose) the first and the last struts break loose. */
const BREAK_FROM = 0.08;
const BREAK_TO = 0.85;
/** Seconds (easing time) for a strut to come away, and to settle back into the frame. */
const BREAK_SECONDS = 0.25;
const REJOIN_SECONDS = 0.5;
/** A free strut: how far out it drifts at full Loose (shape radii, from its place), its tumble (turns a second), and its wander. */
const FLOAT_OUT = [0.12, 0.55] as const;
const TUMBLE = [0.05, 0.3] as const;
const WANDER = 0.05;

/**
 * Loose takes the geodesic globe apart: each strut has its own point on the State range where it
 * breaks off its hubs, and from there floats free as a rigid bar, drifting out and tumbling slowly
 * about its middle. Back toward Tight, each eases home and rejoins the frame. A kick's opening counts
 * as Loose, so a hit snaps a few struts away for a moment.
 */
export class FreeStruts {
  /** Per strut: 0 = in the frame, 1 = floating free (eased). */
  readonly free: Float32Array;
  private readonly at: Float32Array;
  private readonly out: Float32Array;
  private readonly spin: Float32Array;
  private readonly angle: Float32Array;
  private readonly axis: Float32Array;
  private readonly phase: Float32Array;
  /** Each strut's tumble this step, as a row-major 3×3 matrix. */
  private readonly turn: Float32Array;
  private time = 0;
  private loose = 0;
  private readonly flat: boolean;

  /** `flat`: the struts tumble in the plane (the disc's), not every which way. */
  constructor(
    private readonly layout: WireLayout,
    flat = false,
  ) {
    this.flat = flat;
    const n = layout.struts;
    this.free = new Float32Array(n);
    this.at = new Float32Array(n);
    this.out = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.angle = new Float32Array(n);
    this.axis = new Float32Array(n * 3);
    this.phase = new Float32Array(n * 3);
    this.turn = new Float32Array(n * 9);
    for (let s = 0; s < n; s++) {
      this.at[s] = BREAK_FROM + (BREAK_TO - BREAK_FROM) * Math.random();
      this.out[s] = FLOAT_OUT[0] + (FLOAT_OUT[1] - FLOAT_OUT[0]) * Math.random();
      this.spin[s] =
        2 * Math.PI * (TUMBLE[0] + (TUMBLE[1] - TUMBLE[0]) * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      const u = 2 * Math.random() - 1;
      const a = 2 * Math.PI * Math.random();
      const r = Math.sqrt(1 - u * u);
      this.axis.set(flat ? [0, 0, 1] : [r * Math.cos(a), u, r * Math.sin(a)], s * 3);
      for (let k = 0; k < 3; k++) this.phase[s * 3 + k] = 2 * Math.PI * Math.random();
      this.turn[s * 9] = this.turn[s * 9 + 4] = this.turn[s * 9 + 8] = 1;
    }
  }

  /** Advances one 1/60 s step at this looseness (0–1). */
  step(loose: number): void {
    const dt = 1 / 60;
    this.time += dt;
    this.loose = loose;
    const breaking = 1 - Math.exp(-dt / BREAK_SECONDS);
    const rejoining = 1 - Math.exp(-dt / REJOIN_SECONDS);
    for (let s = 0; s < this.free.length; s++) {
      const target = loose > this.at[s] ? 1 : 0;
      this.free[s] += (target - this.free[s]) * (target > this.free[s] ? breaking : rejoining);
      if (this.free[s] < 1e-3 && !target) {
        this.free[s] = 0;
        this.angle[s] = 0;
        continue;
      }
      this.angle[s] += this.spin[s] * dt * this.free[s];
      // Rodrigues: the tumble so far about this strut's own axis.
      const c = Math.cos(this.angle[s]);
      const n = Math.sin(this.angle[s]);
      const [x, y, z] = [this.axis[s * 3], this.axis[s * 3 + 1], this.axis[s * 3 + 2]];
      const t = 1 - c;
      this.turn.set(
        [
          t * x * x + c,
          t * x * y - n * z,
          t * x * z + n * y,
          t * x * y + n * z,
          t * y * y + c,
          t * y * z - n * x,
          t * x * z - n * y,
          t * y * z + n * x,
          t * z * z + c,
        ],
        s * 9,
      );
    }
  }

  /**
   * Particle i's home with its strut (if it has broken loose) carried off: drifted out from its place,
   * tumbled about its middle, wandering a little. Frame point (px, py, pz) in, result in `out`.
   */
  place(i: number, px: number, py: number, pz: number, out: Float32Array): void {
    const s = this.layout.strutOf[i];
    const f = s < 0 ? 0 : this.free[s];
    if (!f) {
      out[0] = px;
      out[1] = py;
      out[2] = pz;
      return;
    }
    const { strutX, strutY, strutZ } = this.layout;
    const cx = strutX[s];
    const cy = strutY[s];
    const cz = strutZ[s];
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const m = this.turn;
    const o = s * 9;
    const drift = 1 + this.out[s] * this.loose;
    const w = WANDER * this.loose;
    const p = s * 3;
    const qx =
      cx * drift + m[o] * dx + m[o + 1] * dy + m[o + 2] * dz + w * Math.sin(this.time * 0.7 + this.phase[p]);
    const qy =
      cy * drift +
      m[o + 3] * dx +
      m[o + 4] * dy +
      m[o + 5] * dz +
      w * Math.sin(this.time * 0.6 + this.phase[p + 1]);
    const qz =
      cz * drift +
      m[o + 6] * dx +
      m[o + 7] * dy +
      m[o + 8] * dz +
      w * Math.sin(this.time * 0.8 + this.phase[p + 2]) * (this.flat ? 0 : 1);
    out[0] = px + (qx - px) * f;
    out[1] = py + (qy - py) * f;
    out[2] = pz + (qz - pz) * f;
  }
}
