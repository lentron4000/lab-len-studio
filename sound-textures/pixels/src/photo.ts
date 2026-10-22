// Sound Textures — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/** Photo pixels per quilt cell (the textile is 89 × 67 cells of 32). */
export const PHOTO_CELL = 32;
/** The working size's most pixels (the textile's own, about 6 MP), and its shortest side at least. */
export const MAX_AREA = 2848 * 2144;
export const MIN_SIDE = 640;
/** Biggest file accepted. */
export const MAX_BYTES = 20 * 1024 * 1024;

/** How a photo is cut down to work with: its crop (in its own pixels), and the cells it makes. */
export interface WorkingSize {
  cols: number;
  rows: number;
  /** The working copy's size: cols × PHOTO_CELL by rows × PHOTO_CELL. */
  width: number;
  height: number;
  /** The part of the photo used, centred (whole cells only, so a sliver may be trimmed). */
  crop: { x: number; y: number; w: number; h: number };
}

/**
 * Any photo at the same scale as the textile: scaled down to at most MAX_AREA (or up, so its shorter
 * side is at least MIN_SIDE: too few cells and there's nothing to quilt with), then trimmed to whole
 * cells, centred.
 */
export function workingSize(w: number, h: number): WorkingSize {
  let scale = Math.min(1, Math.sqrt(MAX_AREA / (w * h)));
  if (Math.min(w, h) * scale < MIN_SIDE) scale = MIN_SIDE / Math.min(w, h);
  const cols = Math.max(1, Math.floor((w * scale) / PHOTO_CELL));
  const rows = Math.max(1, Math.floor((h * scale) / PHOTO_CELL));
  const width = cols * PHOTO_CELL;
  const height = rows * PHOTO_CELL;
  const cw = width / scale;
  const ch = height / scale;
  return {
    cols,
    rows,
    width,
    height,
    crop: { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch },
  };
}

/** Why a dropped file can't be used, or null if it can. */
export function refusal(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'That isn’t an image. Try a JPEG, PNG or WebP photo.';
  if (file.size > MAX_BYTES) return `That photo is over ${MAX_BYTES / 1024 / 1024} MB. Try a smaller one.`;
  return null;
}
