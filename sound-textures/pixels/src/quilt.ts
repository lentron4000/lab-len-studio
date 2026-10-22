// Sound Textures — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/** A grid of cells: `rgb` holds three bytes per cell, row by row. */
export interface Grid {
  cols: number;
  rows: number;
  rgb: Uint8Array;
}

export interface QuiltOptions {
  /** Patch size in cells, and how many cells neighbouring patches overlap by. */
  block: number;
  overlap: number;
  /**
   * Each patch is chosen at random from the `choices` best fits for what's already laid. More is more
   * varied and less faithful; 1 always takes the best (and tends to copy the source back out whole).
   */
  choices: number;
  /** A patch fitting worse than this many times the best, plus `slack` per cell compared, is never taken. */
  worst: number;
  slack: number;
  /**
   * Once a patch is taken, source positions within this many cells of it can't be taken again in the
   * same quilt: otherwise one good fit turns up again and again, a visible repeat.
   */
  reuse: number;
  /** Random numbers in [0, 1). */
  random: () => number;
}

export const QUILT_DEFAULTS: Omit<QuiltOptions, 'random'> = {
  block: 10,
  overlap: 3,
  choices: 8,
  worst: 3,
  slack: 3 * 40 * 40,
  reuse: 3,
};

/** Where an already-known region sits in the output: copied in first and never changed. */
export interface Placement {
  /** Which of the sources it is (its cells are that source's, from its top left). */
  source: number;
  grid: Grid;
  col: number;
  row: number;
}

/**
 * A quilt: its cells' colours, and where each came from (see `origin`), so the same layout can be
 * drawn from a finer copy of the source.
 */
export interface Quilt extends Grid {
  from: Uint32Array;
  /** The patches, in the order they were laid (each clipped to the grid), to redraw it from finer copies. */
  patches: Patch[];
}

/** A patch as laid: `w` × `h` cells from (sx, sy) in source `source`, at (col, row) in the quilt. */
export interface Patch {
  source: number;
  sx: number;
  sy: number;
  col: number;
  row: number;
  w: number;
  h: number;
}

/** Packs a source cell (source index, column, row) into one number, as `Quilt.from` holds them. */
const pack = (source: number, x: number, y: number): number => ((source << 24) | (y << 12) | x) >>> 0;

/** Where a quilt cell came from: [source index, column, row] in that source. */
export function origin(from: number): [source: number, x: number, y: number] {
  return [from >>> 24, from & 0xfff, (from >>> 12) & 0xfff];
}

/**
 * Image quilting (Efros & Freeman, 2001) on cells: fills a `cols` × `rows` grid with patches of the
 * sources, laid in rows that overlap. Each patch is picked at random from those that best match the
 * cells already laid where it lands (the overlaps, and any placed region), and each overlap is cut
 * along its best-matching path, so patches meet along the source's own edges rather than in straight
 * lines. Copying whole patches carries the source's shapes, strokes and outlines; the random choice
 * makes each quilt new.
 */
export function quilt(
  sources: readonly Grid[],
  cols: number,
  rows: number,
  opts: QuiltOptions,
  placed?: Placement,
): Quilt {
  const { block: B, overlap: O } = opts;
  const out = new Uint8Array(cols * rows * 3);
  const from = new Uint32Array(cols * rows);
  const patches: Patch[] = [];
  /** Per cell: 0 empty, 1 laid by a patch (may still be cut over), 2 placed (fixed). */
  const state = new Uint8Array(cols * rows);
  if (placed) place(placed, cols, rows, out, from, state);
  // A placed region's border band (within `overlap` cells of each edge that has quilt beyond it):
  // patches are laid over it too, though they never change it here, so a finer drawing has quilt
  // under the band to cut its join through (see compose).
  const edge = new Uint8Array(cols * rows);
  if (placed) {
    const { col, row, grid } = placed;
    for (let y = Math.max(0, row); y < Math.min(rows, row + grid.rows); y++)
      for (let x = Math.max(0, col); x < Math.min(cols, col + grid.cols); x++) {
        const nearLeft = col > 0 && x - col < O;
        const nearRight = col + grid.cols < cols && col + grid.cols - 1 - x < O;
        const nearTop = row > 0 && y - row < O;
        const nearBottom = row + grid.rows < rows && row + grid.rows - 1 - y < O;
        if (nearLeft || nearRight || nearTop || nearBottom) edge[y * cols + x] = 1;
      }
  }

  const step = B - O;
  // Every patch position in every source.
  const candidates: [src: number, x: number, y: number][] = [];
  sources.forEach((s, k) => {
    for (let y = 0; y + B <= s.rows; y++) for (let x = 0; x + B <= s.cols; x++) candidates.push([k, x, y]);
  });

  // Scratch: the cells a candidate is compared against (offset in the block, and their colour).
  const cmpDx = new Int32Array(B * B);
  const cmpDy = new Int32Array(B * B);
  const cmpRgb = new Int32Array(B * B * 3);
  const bestErr = new Float64Array(opts.choices);
  const bestIdx = new Int32Array(opts.choices);
  /** Per candidate: already taken, or too near one that was (see `reuse`). */
  const used = new Uint8Array(candidates.length);
  let usedCount = 0;
  const indexOf = sources.map((s, k) => {
    const first = candidates.findIndex(([si]) => si === k);
    const across = s.cols - B + 1;
    return (x: number, y: number): number => first + y * across + x;
  });

  for (let by = 0; by < rows; by += step)
    for (let bx = 0; bx < cols; bx += step) {
      const w = Math.min(B, cols - bx);
      const h = Math.min(B, rows - by);
      let empty = 0;
      let onEdge = 0;
      let n = 0;
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const c = (by + dy) * cols + bx + dx;
          if (!state[c]) {
            empty++;
            continue;
          }
          onEdge += edge[c];
          cmpDx[n] = dx;
          cmpDy[n] = dy;
          cmpRgb[n * 3] = out[c * 3];
          cmpRgb[n * 3 + 1] = out[c * 3 + 1];
          cmpRgb[n * 3 + 2] = out[c * 3 + 2];
          n++;
        }
      if (!empty && !onEdge) continue;

      // The `choices` best-fitting candidates (sum of squared colour differences over the known cells).
      // (Every position used up, on a big enough screen: they're all free again.)
      if (usedCount >= candidates.length) {
        used.fill(0);
        usedCount = 0;
      }
      let pick: number;
      if (!n) {
        do pick = Math.floor(opts.random() * candidates.length);
        while (used[pick]);
      } else {
        bestErr.fill(Infinity);
        for (let k = 0; k < candidates.length; k++) {
          if (used[k]) continue;
          const [si, sx, sy] = candidates[k];
          const s = sources[si];
          const limit = bestErr[opts.choices - 1];
          let err = 0;
          for (let m = 0; m < n && err < limit; m++) {
            const o = ((sy + cmpDy[m]) * s.cols + sx + cmpDx[m]) * 3;
            const r = s.rgb[o] - cmpRgb[m * 3];
            const g = s.rgb[o + 1] - cmpRgb[m * 3 + 1];
            const b = s.rgb[o + 2] - cmpRgb[m * 3 + 2];
            err += r * r + g * g + b * b;
          }
          if (err >= limit) continue;
          // Insert, keeping the list sorted.
          let at = opts.choices - 1;
          while (at > 0 && bestErr[at - 1] > err) {
            bestErr[at] = bestErr[at - 1];
            bestIdx[at] = bestIdx[at - 1];
            at--;
          }
          bestErr[at] = err;
          bestIdx[at] = k;
        }
        const cap = bestErr[0] * opts.worst + opts.slack * n;
        let usable = 0;
        while (usable < opts.choices && bestErr[usable] <= cap) usable++;
        pick = bestIdx[Math.floor(opts.random() * Math.max(1, usable))];
      }
      const [si, sx, sy] = candidates[pick];
      const s = sources[si];
      for (let y = Math.max(0, sy - opts.reuse); y <= Math.min(s.rows - B, sy + opts.reuse); y++)
        for (let x = Math.max(0, sx - opts.reuse); x <= Math.min(s.cols - B, sx + opts.reuse); x++)
          if (!used[indexOf[si](x, y)]) {
            used[indexOf[si](x, y)] = 1;
            usedCount++;
          }
      lay(sources[si], si, sx, sy, bx, by, w, h, O, cols, out, from, state);
      patches.push({ source: si, sx, sy, col: bx, row: by, w, h });
    }
  return { cols, rows, rgb: out, from, patches };
}

/** Copies a placed region into the output (clipped to it) and fixes it there. */
function place(
  { source, grid, col, row }: Placement,
  cols: number,
  rows: number,
  out: Uint8Array,
  from: Uint32Array,
  state: Uint8Array,
): void {
  for (let y = 0; y < grid.rows; y++)
    for (let x = 0; x < grid.cols; x++) {
      const ox = col + x;
      const oy = row + y;
      if (ox < 0 || oy < 0 || ox >= cols || oy >= rows) continue;
      const c = oy * cols + ox;
      out.set(grid.rgb.subarray((y * grid.cols + x) * 3, (y * grid.cols + x) * 3 + 3), c * 3);
      from[c] = pack(source, x, y);
      state[c] = 2;
    }
}

/**
 * Lays a patch: empty cells take it; cells already laid keep their colour on the near side of the
 * best-matching cut through each overlap (left and top); placed cells never change.
 */
function lay(
  s: Grid,
  si: number,
  sx: number,
  sy: number,
  bx: number,
  by: number,
  w: number,
  h: number,
  O: number,
  cols: number,
  out: Uint8Array,
  from: Uint32Array,
  state: Uint8Array,
): void {
  const diff = (dx: number, dy: number): number => {
    const c = (by + dy) * cols + bx + dx;
    if (!state[c]) return 0;
    const o = ((sy + dy) * s.cols + sx + dx) * 3;
    const r = s.rgb[o] - out[c * 3];
    const g = s.rgb[o + 1] - out[c * 3 + 1];
    const b = s.rgb[o + 2] - out[c * 3 + 2];
    return r * r + g * g + b * b;
  };
  // keep[dy * w + dx]: the cell stays as it was (left of the vertical cut, or above the horizontal one).
  const keep = new Uint8Array(w * h);
  const ow = Math.min(O, w);
  const oh = Math.min(O, h);
  if (bx > 0) {
    const path = cut(h, ow, (along, across) => diff(across, along));
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < path[dy]; dx++) keep[dy * w + dx] = 1;
  }
  if (by > 0) {
    const path = cut(w, oh, (along, across) => diff(along, across));
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < path[dx]; dy++) keep[dy * w + dx] = 1;
  }
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      const c = (by + dy) * cols + bx + dx;
      if (state[c] === 2 || (state[c] === 1 && keep[dy * w + dx])) continue;
      const o = ((sy + dy) * s.cols + sx + dx) * 3;
      out[c * 3] = s.rgb[o];
      out[c * 3 + 1] = s.rgb[o + 1];
      out[c * 3 + 2] = s.rgb[o + 2];
      from[c] = pack(si, sx + dx, sy + dy);
      state[c] = 1;
    }
}

/**
 * The cheapest path through an overlap strip `length` long and `width` across, moving at most one cell
 * across per step (dynamic programming). Returns, per step along it, where the patch starts: cells
 * before that keep what was there.
 */
function cut(length: number, width: number, cost: (along: number, across: number) => number): Int32Array {
  const acc = new Float64Array(length * width);
  for (let a = 0; a < length; a++)
    for (let x = 0; x < width; x++) {
      let prev = 0;
      if (a > 0) {
        prev = acc[(a - 1) * width + x];
        if (x > 0) prev = Math.min(prev, acc[(a - 1) * width + x - 1]);
        if (x < width - 1) prev = Math.min(prev, acc[(a - 1) * width + x + 1]);
      }
      acc[a * width + x] = cost(a, x) + prev;
    }
  const path = new Int32Array(length);
  let x = 0;
  for (let k = 1; k < width; k++) if (acc[(length - 1) * width + k] < acc[(length - 1) * width + x]) x = k;
  for (let a = length - 1; a >= 0; a--) {
    path[a] = x;
    if (a === 0) break;
    let best = x;
    for (const nx of [x - 1, x + 1])
      if (nx >= 0 && nx < width && acc[(a - 1) * width + nx] < acc[(a - 1) * width + best]) best = nx;
    x = best;
  }
  return path;
}

/** The grid mirrored left to right. */
export function mirror(g: Grid): Grid {
  const rgb = new Uint8Array(g.rgb.length);
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++)
      rgb.set(
        g.rgb.subarray((y * g.cols + x) * 3, (y * g.cols + x) * 3 + 3),
        (y * g.cols + g.cols - 1 - x) * 3,
      );
  return { cols: g.cols, rows: g.rows, rgb };
}

/** Seeded random numbers in [0, 1) (mulberry32): the same seed always quilts the same textile. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
