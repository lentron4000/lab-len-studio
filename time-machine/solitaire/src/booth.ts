// Time Machine — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import type { Crop } from './fit';
import { CARD_SHAPE } from './solitaire';

/**
 * The photo booth: an oval on the screen for your face, in a box the shape of a card (the photo's that
 * box). Boxes are px from the top left, on the screen or in the video.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The oval's box on a screen this size: a card's shape, as tall as fits, centred. */
export function ovalOf(width: number, height: number): Box {
  const h = Math.min(height * 0.62, (width * 0.8) / CARD_SHAPE);
  const w = h * CARD_SHAPE;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** How the video's shown: its size, the part of it that covers the screen, the screen's size, mirrored or not. */
export interface Shown {
  videoWidth: number;
  videoHeight: number;
  crop: Crop;
  width: number;
  height: number;
  mirror: boolean;
}

/** A box in the video, where it is on the screen. */
export function toScreen(box: Box, s: Shown): Box {
  const sx = s.width / (s.crop.w * s.videoWidth);
  const sy = s.height / (s.crop.h * s.videoHeight);
  const x = (box.x - s.crop.x * s.videoWidth) * sx;
  const y = (box.y - s.crop.y * s.videoHeight) * sy;
  const w = box.w * sx;
  return { x: s.mirror ? s.width - x - w : x, y, w, h: box.h * sy };
}

/** A box on the screen, where it is in the video (unmirrored: as the camera sees it). */
export function toVideo(box: Box, s: Shown): Box {
  const x = s.mirror ? s.width - box.x - box.w : box.x;
  const vx = (s.crop.w * s.videoWidth) / s.width;
  const vy = (s.crop.h * s.videoHeight) / s.height;
  return {
    x: s.crop.x * s.videoWidth + x * vx,
    y: s.crop.y * s.videoHeight + box.y * vy,
    w: box.w * vx,
    h: box.h * vy,
  };
}

/** Whether a face (its box on the screen) fills the oval: about its middle, and about the right size. */
export function fits(face: Box, oval: Box): boolean {
  const dx = face.x + face.w / 2 - (oval.x + oval.w / 2);
  const dy = face.y + face.h / 2 - (oval.y + oval.h / 2);
  const size = face.w / oval.w;
  return Math.abs(dx) < oval.w * 0.16 && Math.abs(dy) < oval.h * 0.16 && size > 0.42 && size < 1;
}
