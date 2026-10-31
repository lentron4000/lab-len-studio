// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import { compose, type Pixels } from './compose';
import { quilt, QUILT_DEFAULTS, seeded, type Grid } from './quilt';
import { colourGroups, fit, flavour, soften } from './transitions';

/**
 * The heavy parts of making a quilt (choosing its patches, cutting their joins through the photo's
 * pixels, and timing each tile of its transition), off the main thread, so a transition or the beat
 * never stutters while the next is made.
 */

/** A photo the worker can quilt: its cell colours, and its pixels at each size drawn (pixels per cell). */
interface Held {
  grid: Grid;
  pixels: Map<number, Pixels>;
}

export type ToWeaver =
  | { type: 'source'; id: number; grid: Grid }
  | { type: 'pixels'; id: number; unit: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'forget'; id: number }
  | {
      type: 'weave';
      job: number;
      id: number;
      seed: number | null;
      cols: number;
      rows: number;
      unit: number;
      /** Where the photo is laid whole (the textile, first time round), if it is. */
      placed?: { col: number; row: number };
    }
  | {
      /** When each tile turns over in the transition, from its colour (RGBA, across × down). */
      type: 'arrivals';
      job: number;
      colours: ArrayBuffer;
      across: number;
      down: number;
      /** Arrivals evened out between neighbours this many tiles round (soft fronts, not speckle). */
      radius: number;
      fade: number;
    };

/** A woven quilt's pixels (RGBA), or a transition's arrival times (Float32). */
export type FromWeaver =
  { job: number; width: number; height: number; data: ArrayBuffer } | { job: number; arrival: ArrayBuffer };

const held = new Map<number, Held>();

self.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as ToWeaver;
  if (m.type === 'source') held.set(m.id, { grid: m.grid, pixels: new Map() });
  else if (m.type === 'pixels')
    held.get(m.id)?.pixels.set(m.unit, {
      width: m.width,
      height: m.height,
      data: new Uint8ClampedArray(m.data),
    });
  else if (m.type === 'forget') held.delete(m.id);
  else if (m.type === 'arrivals') {
    const colours = new Uint8ClampedArray(m.colours);
    const n = m.across * m.down;
    // Each transition its own flavour (see transitions.ts), so no two feel alike.
    const f = flavour(Math.random);
    const arrival = fit(
      soften(colourGroups(colours, n, Math.random, f, m.across, m.down), m.across, m.down, m.radius),
      m.fade,
    );
    const reply: FromWeaver = { job: m.job, arrival: arrival.buffer as ArrayBuffer };
    (self as unknown as Worker).postMessage(reply, [arrival.buffer]);
  } else {
    const h = held.get(m.id);
    const px = h?.pixels.get(m.unit);
    if (!h || !px) return;
    const { grid } = h;
    const placed = m.placed && { source: 0, grid, col: m.placed.col, row: m.placed.row };
    const q = quilt([grid], m.cols, m.rows, { ...QUILT_DEFAULTS, random: seeded(m.seed ?? 1) }, placed);
    const out = compose(
      [px],
      m.unit,
      m.cols,
      m.rows,
      q.patches,
      QUILT_DEFAULTS.overlap,
      placed && { source: 0, col: placed.col, row: placed.row, cols: grid.cols, rows: grid.rows },
    );
    const reply: FromWeaver = { job: m.job, width: out.width, height: out.height, data: out.data.buffer };
    (self as unknown as Worker).postMessage(reply, [out.data.buffer]);
  }
});
