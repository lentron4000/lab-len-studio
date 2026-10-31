// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/** The part of the video shown, as a share of it (0–1) from its top left: it covers the screen, centred. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The video, scaled to cover a screen of that shape and centred: the part of it that shows. */
export function cover(videoWidth: number, videoHeight: number, width: number, height: number): Crop {
  if (videoWidth <= 0 || videoHeight <= 0 || width <= 0 || height <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const video = videoWidth / videoHeight;
  const screen = width / height;
  // Wider than the screen: its sides are cut off; taller: its top and bottom.
  if (video > screen) {
    const w = screen / video;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = video / screen;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** The screen in tiles: how many across and down, and how far the first starts before the edge (px). */
export interface Grid {
  across: number;
  down: number;
  /** Tiles overhang both edges equally, so the picture stays centred. */
  offsetX: number;
  offsetY: number;
}

/** Tiles `tile` px a side over a screen `width` × `height` px. */
export function gridOf(width: number, height: number, tile: number): Grid {
  const t = Math.max(1, tile);
  const across = Math.max(1, Math.ceil(width / t));
  const down = Math.max(1, Math.ceil(height / t));
  return { across, down, offsetX: (across * t - width) / 2, offsetY: (down * t - height) / 2 };
}
