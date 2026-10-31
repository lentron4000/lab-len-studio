// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import type { Patch } from './quilt';

/** RGBA pixels, row by row (an ImageData's shape). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** A source laid whole in the quilt (the original, first time round): `cols` × `rows` cells at (col, row). */
export interface Whole {
  source: number;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/**
 * Draws a quilt from full-resolution copies of its sources, `unit` pixels to a cell. The patches are
 * laid again in order, but where each overlaps what's already there, the join is cut through the
 * pixels themselves, along the path where the two differ least (so it follows the yarn's own edges,
 * not the cells'). A `whole` source is laid last, its border cut the same way on all four sides
 * within `overlap` cells of its edge, so it meets the quilt round it without a straight line.
 */
export function compose(
  sources: readonly Pixels[],
  unit: number,
  cols: number,
  rows: number,
  patches: readonly Patch[],
  overlap: number,
  whole?: Whole,
): Pixels {
  const W = cols * unit;
  const H = rows * unit;
  const out = new Uint8ClampedArray(W * H * 4);
  const painted = new Uint8Array(W * H);
  const band = overlap * unit;

  for (const p of patches) {
    const src = sources[p.source];
    const X0 = p.col * unit;
    const Y0 = p.row * unit;
    const w = p.w * unit;
    const h = p.h * unit;
    const SX = p.sx * unit;
    const SY = p.sy * unit;
    // How far a patch pixel is from what's already there (nothing there: free to take).
    const diff = (x: number, y: number): number => {
      const o = (Y0 + y) * W + X0 + x;
      if (!painted[o]) return 0;
      return dist(src.data, ((SY + y) * src.width + SX + x) * 4, out, o * 4);
    };
    const keep = new Uint8Array(w * h);
    if (p.col > 0) {
      const path = cut(h, Math.min(band, w), (along, across) => diff(across, along));
      for (let y = 0; y < h; y++) keep.fill(1, y * w, y * w + path[y]);
    }
    if (p.row > 0) {
      const path = cut(w, Math.min(band, h), (along, across) => diff(along, across));
      for (let x = 0; x < w; x++) for (let y = 0; y < path[x]; y++) keep[y * w + x] = 1;
    }
    for (let y = 0; y < h; y++) {
      const row = (Y0 + y) * W + X0;
      const srow = ((SY + y) * src.width + SX) * 4;
      for (let x = 0; x < w; x++) {
        if (painted[row + x] && keep[y * w + x]) continue;
        copy(src.data, srow + x * 4, out, (row + x) * 4);
        painted[row + x] = 1;
      }
    }
  }

  if (whole) layWhole(sources[whole.source], whole, unit, band, W, H, out, painted);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { width: W, height: H, data: out };
}

/**
 * Lays a whole source over the quilt: inside its border band, a best-matching cut on each side
 * decides where it takes over; deeper in, it's all its own. (Any of its area the patches left bare
 * is its own too.)
 */
function layWhole(
  src: Pixels,
  whole: Whole,
  unit: number,
  band: number,
  W: number,
  H: number,
  out: Uint8ClampedArray,
  painted: Uint8Array,
): void {
  const X0 = whole.col * unit;
  const Y0 = whole.row * unit;
  // The part of it on the output.
  const x0 = Math.max(0, X0);
  const y0 = Math.max(0, Y0);
  const x1 = Math.min(W, X0 + whole.cols * unit);
  const y1 = Math.min(H, Y0 + whole.rows * unit);
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0;
  const h = y1 - y0;
  const at = (x: number, y: number): number => ((y - Y0) * src.width + (x - X0)) * 4;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (!painted[y * W + x]) {
        copy(src.data, at(x, y), out, (y * W + x) * 4);
        painted[y * W + x] = 1;
      }
  const diff = (x: number, y: number): number => dist(src.data, at(x, y), out, (y * W + x) * 4);
  // Per row: where it starts (left cut) and ends (right cut); per column, likewise top and bottom.
  // A side cut off by the screen's edge has no band: it runs to the edge.
  const from = new Int32Array(h);
  const to = new Int32Array(h).fill(w);
  const fromY = new Int32Array(w);
  const toY = new Int32Array(w).fill(h);
  const bw = Math.min(band, w);
  const bh = Math.min(band, h);
  if (X0 >= 0) from.set(cut(h, bw, (a, b) => diff(x0 + b, y0 + a)));
  if (X0 + whole.cols * unit <= W) {
    const path = cut(h, bw, (a, b) => diff(x1 - 1 - b, y0 + a));
    for (let y = 0; y < h; y++) to[y] = w - path[y];
  }
  if (Y0 >= 0) fromY.set(cut(w, bh, (a, b) => diff(x0 + a, y0 + b)));
  if (Y0 + whole.rows * unit <= H) {
    const path = cut(w, bh, (a, b) => diff(x0 + a, y1 - 1 - b));
    for (let x = 0; x < w; x++) toY[x] = h - path[x];
  }
  for (let y = 0; y < h; y++)
    for (let x = from[y]; x < to[y]; x++) {
      if (y < fromY[x] || y >= toY[x]) continue;
      copy(src.data, at(x0 + x, y0 + y), out, ((y0 + y) * W + x0 + x) * 4);
    }
}

function dist(a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number): number {
  const r = a[i] - b[j];
  const g = a[i + 1] - b[j + 1];
  const bl = a[i + 2] - b[j + 2];
  return r * r + g * g + bl * bl;
}

function copy(a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number): void {
  b[j] = a[i];
  b[j + 1] = a[i + 1];
  b[j + 2] = a[i + 2];
}

/**
 * The cheapest path through a strip `length` long and `width` across, moving at most one pixel across
 * per step. Returns, per step along it, how far across it runs: what's before that is kept as it was.
 */
export function cut(
  length: number,
  width: number,
  cost: (along: number, across: number) => number,
): Int32Array {
  const acc = new Float64Array(length * width);
  for (let a = 0; a < length; a++)
    for (let x = 0; x < width; x++) {
      let prev = 0;
      if (a > 0) {
        const r = (a - 1) * width;
        prev = acc[r + x];
        if (x > 0 && acc[r + x - 1] < prev) prev = acc[r + x - 1];
        if (x < width - 1 && acc[r + x + 1] < prev) prev = acc[r + x + 1];
      }
      acc[a * width + x] = cost(a, x) + prev;
    }
  const path = new Int32Array(length);
  let x = 0;
  const last = (length - 1) * width;
  for (let k = 1; k < width; k++) if (acc[last + k] < acc[last + x]) x = k;
  for (let a = length - 1; a >= 0; a--) {
    path[a] = x;
    if (a === 0) break;
    const r = (a - 1) * width;
    let best = x;
    if (x > 0 && acc[r + x - 1] < acc[r + best]) best = x - 1;
    if (x < width - 1 && acc[r + x + 1] < acc[r + best]) best = x + 1;
    x = best;
  }
  return path;
}
