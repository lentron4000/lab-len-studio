// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** Shapes per size; each particle keeps one for life, so its outline doesn't flicker. */
export const STAMP_VARIANTS = 8;

/**
 * A pixel-art blob as horizontal runs of cells: [dx, dy, length, …], offsets from the top-left of an
 * (n + 2)-cell box whose middle n×n holds the body (the border is room for bumps).
 */
export type Stamp = Int8Array;

const cache = new Map<number, Stamp[]>();

/** The stamp variants for a body n cells across. */
export function stampsFor(n: number): Stamp[] {
  let stamps = cache.get(n);
  if (!stamps) {
    stamps = Array.from({ length: STAMP_VARIANTS }, (_, v) => makeStamp(n, v));
    cache.set(n, stamps);
  }
  return stamps;
}

/**
 * Pixel-circle body (corners cut from size 3 up), edge cells nibbled away, and a bump or two stuck on,
 * so no two particles share a clean outline. Seeded by size and variant: the same every run.
 */
function makeStamp(n: number, variant: number): Stamp {
  const random = mulberry32(n * 101 + variant * 7919 + 1);
  const box = n + 2;
  const on = new Uint8Array(box * box);
  const r2 = (n / 2) ** 2 * 0.85;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2;
      const dy = y + 0.5 - n / 2;
      if (n <= 2 || dx * dx + dy * dy <= r2) on[(y + 1) * box + x + 1] = 1;
    }
  const filled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < box && y < box && on[y * box + x] === 1;
  const edge = (x: number, y: number): boolean =>
    !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1);
  // Nibble the rim, but leave most of the body.
  if (n >= 2) {
    let count = on.reduce((a, b) => a + b, 0);
    const keep = Math.ceil(count * 0.65);
    for (let y = 0; y < box; y++)
      for (let x = 0; x < box; x++)
        if (count > keep && filled(x, y) && edge(x, y) && random() < 0.3) {
          on[y * box + x] = 0;
          count--;
        }
  }
  // Stick on bumps: empty cells touching the body.
  const bumps = variant % 4 === 0 ? 0 : 1 + ((random() * Math.max(1, n / 2)) | 0);
  for (let k = 0, tries = 0; k < bumps && tries < 40; tries++) {
    const x = (random() * box) | 0;
    const y = (random() * box) | 0;
    if (filled(x, y)) continue;
    if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
      on[y * box + x] = 1;
      k++;
    }
  }
  const runs: number[] = [];
  for (let y = 0; y < box; y++)
    for (let x = 0; x < box; x++) {
      if (!filled(x, y) || filled(x - 1, y)) continue;
      let w = 1;
      while (filled(x + w, y)) w++;
      runs.push(x, y, w);
    }
  return Int8Array.from(runs);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
