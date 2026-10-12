// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/**
 * Formations: shapes the particles can be summoned into. Each is a list of strokes (lines and
 * arcs) in unit coordinates, centred on 0 with y down (screen), fitting inside a radius of 1.
 * The sigils are original designs.
 */

export type FormationId =
  | 'circle'
  | 'pentagram'
  | 'inverted'
  | 'hexagram'
  | 'ouroboros'
  | 'eye'
  | 'sigil1'
  | 'sigil2'
  | 'sigil3'
  | 'sigil4'
  | 'sigil5'
  | 'sigil6';

/** A line or circular arc. `width` is the stroke's thickness at its start and end. */
export type Stroke =
  | { kind: 'line'; ax: number; ay: number; bx: number; by: number; width?: readonly [number, number] }
  | {
      kind: 'arc';
      cx: number;
      cy: number;
      r: number;
      a0: number;
      a1: number;
      width?: readonly [number, number];
    };

export interface Formation {
  name: string;
  strokes: readonly Stroke[];
  /** Turns slowly, one revolution per this many bars (the ouroboros chasing its tail). */
  turnBars?: number;
  /** Opens like an eye when summoned and blinks now and then. */
  blinks?: boolean;
}

const TAU = Math.PI * 2;
const LINE_WIDTH = 0.035;

const line = (ax: number, ay: number, bx: number, by: number, width?: readonly [number, number]): Stroke => ({
  kind: 'line',
  ax,
  ay,
  bx,
  by,
  width,
});
const arc = (
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  width?: readonly [number, number],
): Stroke => ({
  kind: 'arc',
  cx,
  cy,
  r,
  a0,
  a1,
  width,
});
const ring = (r: number, cx = 0, cy = 0): Stroke => arc(cx, cy, r, 0, TAU);

/** Points on a circle of radius r, starting at angle a0 (screen angles: -π/2 is up). */
function vertices(count: number, r: number, a0: number): [number, number][] {
  return Array.from({ length: count }, (_, k) => {
    const a = a0 + (k * TAU) / count;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** A closed path through the given points, in order. */
function path(points: readonly [number, number][], closed = true): Stroke[] {
  const out: Stroke[] = [];
  const n = closed ? points.length : points.length - 1;
  for (let k = 0; k < n; k++) {
    const [ax, ay] = points[k];
    const [bx, by] = points[(k + 1) % points.length];
    out.push(line(ax, ay, bx, by));
  }
  return out;
}

/** Five-pointed star drawn as one continuous line; `up` puts a point at the top. */
function star(up: boolean, r = 0.9): Stroke[] {
  const v = vertices(5, r, up ? -Math.PI / 2 : Math.PI / 2);
  return path([v[0], v[2], v[4], v[1], v[3]]);
}

/** Spiral from r0 to r1 over `turns`, as short segments. */
function spiral(r0: number, r1: number, turns: number, segments = 64): Stroke[] {
  const points: [number, number][] = [];
  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    const a = -Math.PI / 2 + t * turns * TAU;
    const r = r0 + (r1 - r0) * t;
    points.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return path(points, false);
}

/** Almond eye: lids meet at ±0.95 and open 0.42 above and below the centre. */
function eye(): Stroke[] {
  const c = 0.95;
  const h = 0.42;
  const r = (h * h + c * c) / (2 * h);
  const off = r - h;
  const side = Math.atan2(off, c);
  return [
    arc(0, off, r, -Math.PI + side, -side), // upper lid
    arc(0, -off, r, side, Math.PI - side), // lower lid
    ring(0.32),
    line(0, -0.24, 0, 0.24, [0.07, 0.07]), // slit pupil
  ];
}

export const FORMATIONS: Record<FormationId, Formation> = {
  circle: { name: 'Summoning circle', strokes: [ring(0.95), ring(0.8)] },
  pentagram: { name: 'Pentagram', strokes: star(true) },
  inverted: { name: 'Inverted pentagram', strokes: star(false) },
  hexagram: {
    name: 'Hexagram',
    strokes: [...path(vertices(3, 0.9, -Math.PI / 2)), ...path(vertices(3, 0.9, Math.PI / 2))],
  },
  ouroboros: {
    name: 'Ouroboros',
    // Thick at the head, thinning to the tail, which stops just short of the head.
    strokes: [arc(0, 0, 0.78, 0, TAU - 0.4, [0.16, 0.02])],
    turnBars: 16,
  },
  eye: { name: 'Eye', strokes: eye(), blinks: true },
  sigil1: {
    name: 'Gate',
    strokes: [
      line(0, -0.74, 0, 0.6),
      line(-0.45, -0.35, 0.45, -0.35),
      line(-0.28, 0.12, 0.28, 0.12),
      ring(0.15, 0, -0.88),
      arc(0, 0.6, 0.32, 0, Math.PI),
    ],
  },
  sigil2: {
    name: 'Trident',
    strokes: [
      line(0, -0.95, 0, 0.95),
      line(-0.5, -0.85, -0.5, -0.4),
      line(0.5, -0.85, 0.5, -0.4),
      arc(0, -0.4, 0.5, 0, Math.PI),
      ring(0.2, 0, 0.42),
    ],
  },
  sigil3: {
    name: 'Descent',
    strokes: [
      ...path(vertices(3, 0.75, Math.PI / 2)),
      ring(0.28),
      ...vertices(3, 0.75, Math.PI / 2).map(([x, y]) => line(x, y, x * 1.3, y * 1.3)),
    ],
  },
  sigil4: {
    name: 'Horned cross',
    strokes: [
      arc(0, -0.15, 0.62, 0.15 * Math.PI, 0.85 * Math.PI),
      arc(0, -0.4, 0.6, 0.15 * Math.PI, 0.85 * Math.PI),
      line(0, -0.95, 0, 0.95),
      line(-0.35, 0.62, 0.35, 0.62),
    ],
  },
  sigil5: {
    name: 'Coil',
    strokes: [...spiral(0.05, 0.78, 3), line(-0.68, 0.68, 0.68, -0.68)],
  },
  sigil6: {
    name: 'Hourglass',
    strokes: [
      ...path([
        [-0.6, -0.85],
        [0.6, -0.85],
        [-0.6, 0.85],
        [0.6, 0.85],
      ]),
      line(-0.86, 0, 0.86, 0),
      ring(0.09, -0.96, 0),
      ring(0.09, 0.96, 0),
    ],
  },
};

/**
 * The "great" version, summoned from the upper octave: the shape drawn smaller inside a double
 * ring, the classic seal. The circle itself becomes a triple ring with twelve marks.
 */
export function great(id: FormationId): Formation {
  const f = FORMATIONS[id];
  if (id === 'circle') {
    const marks = vertices(12, 1, -Math.PI / 2).map(([x, y]) => line(x * 0.72, y * 0.72, x * 0.84, y * 0.84));
    return {
      ...f,
      name: `Great ${f.name.toLowerCase()}`,
      strokes: [ring(0.97), ring(0.88), ring(0.62), ...marks],
    };
  }
  return {
    ...f,
    name: `${f.name} in the circle`,
    strokes: [ring(0.97), ring(0.88), ...f.strokes.map((s) => scaleStroke(s, 0.78))],
  };
}

function scaleStroke(s: Stroke, k: number): Stroke {
  const width = s.width ? ([s.width[0] * k, s.width[1] * k] as const) : undefined;
  return s.kind === 'line'
    ? { ...s, ax: s.ax * k, ay: s.ay * k, bx: s.bx * k, by: s.by * k, width }
    : { ...s, cx: s.cx * k, cy: s.cy * k, r: s.r * k, width };
}

export function strokeLength(s: Stroke): number {
  return s.kind === 'line' ? Math.hypot(s.bx - s.ax, s.by - s.ay) : Math.abs(s.a1 - s.a0) * s.r;
}

/** Point and unit normal at t (0–1) along a stroke. */
function along(s: Stroke, t: number): [x: number, y: number, nx: number, ny: number] {
  if (s.kind === 'line') {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = Math.hypot(dx, dy) || 1;
    return [s.ax + dx * t, s.ay + dy * t, -dy / len, dx / len];
  }
  const a = s.a0 + (s.a1 - s.a0) * t;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return [s.cx + s.r * c, s.cy + s.r * sn, c, sn];
}

/**
 * Spreads `count` points evenly along the strokes (by length), each nudged across the stroke
 * within its width so lines have body. Returns interleaved x, y.
 */
export function samplePoints(strokes: readonly Stroke[], count: number, random = Math.random): Float32Array {
  const out = new Float32Array(count * 2);
  if (count === 0 || strokes.length === 0) return out;
  const lengths = strokes.map(strokeLength);
  const total = lengths.reduce((a, b) => a + b, 0);
  let written = 0;
  let carry = 0;
  for (let s = 0; s < strokes.length; s++) {
    // Carry the rounding remainder forward so the counts add up exactly.
    const exact = (count * lengths[s]) / total + carry;
    const n = s === strokes.length - 1 ? count - written : Math.round(exact);
    carry = exact - n;
    const [w0, w1] = strokes[s].width ?? [LINE_WIDTH, LINE_WIDTH];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5 + (random() - 0.5) * 0.6) / n;
      const [x, y, nx, ny] = along(strokes[s], Math.min(1, Math.max(0, t)));
      const w = (w0 + (w1 - w0) * t) * (random() - 0.5);
      out[written * 2] = x + nx * w;
      out[written * 2 + 1] = y + ny * w;
      written++;
    }
  }
  return out;
}

/**
 * Matches particles to targets by angle around the centre, so the swarm swirls into the shape
 * rather than criss-crossing. `px`/`py` are particle offsets from the centre; `targets` is
 * interleaved x, y. Returns, per particle, the index of its target.
 */
export function assignByAngle(
  px: ArrayLike<number>,
  py: ArrayLike<number>,
  targets: Float32Array,
): Int32Array {
  const n = px.length;
  const byAngle = (xs: (i: number) => number, ys: (i: number) => number): number[] => {
    const order = Array.from({ length: n }, (_, i) => i);
    const angle = new Float64Array(n);
    for (let i = 0; i < n; i++) angle[i] = Math.atan2(ys(i), xs(i));
    return order.sort((a, b) => angle[a] - angle[b]);
  };
  const particles = byAngle(
    (i) => px[i],
    (i) => py[i],
  );
  const points = byAngle(
    (i) => targets[i * 2],
    (i) => targets[i * 2 + 1],
  );
  const out = new Int32Array(n);
  for (let k = 0; k < n; k++) out[particles[k]] = points[k];
  return out;
}
