// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/**
 * Emoji mode (an easter egg: E): the picture's pixels drawn as emoji, each the one whose colour is
 * nearest the pixel's. The emoji are drawn and measured in this device's own emoji font (Apple's,
 * Google's and Microsoft's differ), so the matches hold everywhere; any it can't draw are left out.
 * Shared by the Recontexturalizers: 01 matches here, on the CPU; 02 (live video) matches the same way
 * on the GPU, from `measure()`.
 */

/** Colourful emoji, roughly by colour. (No joined sequences: they fall apart on older systems.) */
const EMOJI = [
  // Reds
  '🍎',
  '🍓',
  '🍒',
  '❤️',
  '🌹',
  '🍅',
  '🌶️',
  '🎈',
  '🧨',
  '🍉',
  '🦀',
  '🛑',
  '📕',
  '🥵',
  '💋',
  '🚒',
  '🍁',
  // Oranges
  '🍊',
  '🧡',
  '🎃',
  '🥕',
  '🦊',
  '🏀',
  '🍑',
  '🔥',
  '🦁',
  '🍂',
  '🦐',
  '🍤',
  '🧶',
  // Yellows
  '🍋',
  '🍌',
  '💛',
  '🌻',
  '⭐',
  '🌟',
  '🐥',
  '🧀',
  '🌽',
  '🌕',
  '🐝',
  '🍯',
  '☀️',
  '🌼',
  '🐤',
  '🎗️',
  // Greens
  '🍏',
  '🥝',
  '🥦',
  '🥒',
  '💚',
  '🍀',
  '🌿',
  '🐸',
  '🐢',
  '🌵',
  '🥑',
  '🌲',
  '🦖',
  '🍐',
  '🥬',
  '🐊',
  '🦎',
  '🌳',
  // Blues
  '💙',
  '🫐',
  '🐳',
  '🌊',
  '🧊',
  '💎',
  '🦋',
  '🐬',
  '🌀',
  '🧢',
  '🐋',
  '👖',
  '🥏',
  '🧿',
  // Purples and pinks
  '💜',
  '🍇',
  '🔮',
  '🦄',
  '☂️',
  '🍆',
  '👾',
  '💗',
  '🌸',
  '🌷',
  '🦩',
  '🎀',
  '🐷',
  '🍬',
  '🧠',
  '💖',
  '🌺',
  '🪀',
  // Whites and greys
  '🤍',
  '🥚',
  '☁️',
  '🐑',
  '🦢',
  '🍚',
  '🦴',
  '🐼',
  '⛄',
  '🧻',
  '🐚',
  '🥛',
  '🐘',
  '🗿',
  // Browns and blacks
  '🖤',
  '🎱',
  '🦇',
  '🍫',
  '☕',
  '🐻',
  '🥔',
  '🪵',
  '🤎',
  '🍩',
  '🐾',
  '🌑',
  '🕷️',
  '🥥',
  '🍪',
  '🐴',
  // Faces and oddities
  '😀',
  '😍',
  '🤩',
  '🥳',
  '😎',
  '🤡',
  '👽',
  '💩',
  '👀',
  '👄',
  '😈',
  '🤖',
  '👹',
  '🌈',
  '🍄',
  '🧬',
];

const FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
/** Size emoji are measured at (px). */
const MEASURE = 32;
/** Below this share of their square covered, an emoji is taken as not drawable here (blank). */
const MIN_COVER = 0.12;
/** Each pixel takes one of its CHOICES nearest emoji, any within NEAR_ENOUGH × the nearest's distance. */
const CHOICES = 3;
export const NEAR_ENOUGH = 1.6;
/** Behind each emoji, its pixel's own colour at this brightness, so the mosaic still reads as the picture. */
export const BACKING = 0.32;

/** The emoji this device can draw, each with its colour (average over what it covers) and how much it covers. */
export interface Measured {
  glyphs: string[];
  /** Per glyph: average colour (0–1) and coverage (0–1). */
  rgb: Float32Array;
  cover: Float32Array;
}

let measured: Measured | null = null;

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draws an emoji centred in a square `px` a side. */
export function drawGlyph(
  c: CanvasRenderingContext2D,
  glyph: string,
  x: number,
  y: number,
  px: number,
): void {
  c.font = `${Math.round(px * 0.84)}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(glyph, x + px / 2, y + px / 2 + px * 0.04);
}

/** The emoji this device can draw, measured (once). */
export function measure(): Measured {
  if (measured) return measured;
  const c = canvasOf(MEASURE, MEASURE);
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const glyphs: string[] = [];
  const rgb: number[] = [];
  const cover: number[] = [];
  for (const g of EMOJI) {
    x.clearRect(0, 0, MEASURE, MEASURE);
    drawGlyph(x, g, 0, 0, MEASURE);
    const d = x.getImageData(0, 0, MEASURE, MEASURE).data;
    let r = 0;
    let gr = 0;
    let b = 0;
    let a = 0;
    let colourful = 0;
    for (let i = 0; i < d.length; i += 4) {
      const w = d[i + 3] / 255;
      r += d[i] * w;
      gr += d[i + 1] * w;
      b += d[i + 2] * w;
      a += w;
      if (w > 0.5 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 24)
        colourful++;
    }
    const share = a / (MEASURE * MEASURE);
    // Blank (not drawn here), or drawn as a plain outline box or mono glyph: left out.
    if (
      share < MIN_COVER ||
      (colourful < 6 && !['🤍', '☁️', '🖤', '🎱', '🌑', '🐼', '🗿', '🦢', '🐑'].includes(g))
    )
      continue;
    glyphs.push(g);
    rgb.push(r / a / 255, gr / a / 255, b / a / 255);
    cover.push(share);
  }
  measured = { glyphs, rgb: Float32Array.from(rgb), cover: Float32Array.from(cover) };
  return measured;
}

/** Emoji at one tile size: all of them drawn in a strip, and the nearest one to any colour. */
export interface EmojiSet {
  tile: number;
  atlas: HTMLCanvasElement;
  count: number;
  /**
   * An emoji (its place in the atlas) near in colour to (r, g, b) (0–255), seen over its backing: one of
   * the few nearest, chosen by `salt` (0–1; fixed per place, so the mosaic varies but doesn't flicker).
   */
  pick(r: number, g: number, b: number, salt: number): number;
}

const sets = new Map<number, EmojiSet>();

/** The emoji drawn at `tile` device pixels a side (made once per size). */
export function emojiSet(tile: number): EmojiSet {
  const t = Math.max(4, Math.round(tile));
  const have = sets.get(t);
  if (have) return have;
  const m = measure();
  const count = m.glyphs.length;
  const atlas = canvasOf(t * count, t);
  const a = atlas.getContext('2d')!;
  m.glyphs.forEach((g, i) => drawGlyph(a, g, i * t, 0, t));
  // The nearest few emoji, per colour (5 bits a channel), worked out as needed.
  const cache = new Int16Array(32768 * CHOICES).fill(-1);
  const counts = new Uint8Array(32768);
  const pick = (r: number, g: number, b: number, salt: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (counts[key]) return cache[key * CHOICES + Math.floor(salt * counts[key])];
    const R = r / 255;
    const G = g / 255;
    const B = b / 255;
    const near: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      // What's seen: the emoji where it covers, its pixel's own colour (dimmed) where it doesn't.
      const c = m.cover[i];
      const er = m.rgb[i * 3] * c + R * BACKING * (1 - c);
      const eg = m.rgb[i * 3 + 1] * c + G * BACKING * (1 - c);
      const eb = m.rgb[i * 3 + 2] * c + B * BACKING * (1 - c);
      // (02 matches on the GPU with this same distance, in its render.ts: change them together.)
      // Weighted by how the eye sees each channel ("redmean"), with the emoji's own colour also counted,
      // so a match is by colour and not only by brightness.
      const dr = er - R;
      const dg = eg - G;
      const db = eb - B;
      const mean = (er + R) / 2;
      let d = (2 + mean) * dr * dr + 4 * dg * dg + (3 - mean) * db * db;
      const hr = m.rgb[i * 3] - R;
      const hg = m.rgb[i * 3 + 1] - G;
      const hb = m.rgb[i * 3 + 2] - B;
      d += 0.6 * (hr * hr + hg * hg + hb * hb);
      near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    // The nearest, and any of the next few nearly as near.
    let n = 1;
    while (n < CHOICES && n < near.length && near[n][0] <= near[0][0] * NEAR_ENOUGH + 0.004) n++;
    for (let k = 0; k < n; k++) cache[key * CHOICES + k] = near[k][1];
    counts[key] = n;
    return cache[key * CHOICES + Math.floor(salt * n)];
  };
  const set = { tile: t, atlas, count, pick };
  sets.set(t, set);
  return set;
}
