// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Look } from './render/renderer';

/**
 * Modes, chosen by the `m` URL parameter (`?m=ritual`). Each locks the toy to one look and decides
 * what it offers; `len` is the master mode with everything unlocked, for demos. No parameter, or
 * one this build doesn't know, gives the plain day toy.
 */
export interface LabMode {
  name: string;
  /** The look the toy is locked to, or null when the viewer can switch (N, or the Mode buttons). */
  look: Look | null;
  /** Keys summon formations; the Summon and Intensity controls are shown. */
  formations: boolean;
}

export const MODES: Record<string, LabMode> = {
  day: { name: 'day', look: 'day', formations: false },
  night: { name: 'night', look: 'night', formations: false },
  ritual: { name: 'ritual', look: 'ritual', formations: true },
  len: { name: 'len', look: null, formations: true },
};

/**
 * The mode for this page. `fallback` is the build's default (the offline venue build opens in
 * ritual), used when the URL doesn't name one.
 */
export function labMode(search: string, fallback = 'day'): LabMode {
  const requested = new URLSearchParams(search).get('m')?.toLowerCase();
  if (requested && Object.hasOwn(MODES, requested)) return MODES[requested];
  return Object.hasOwn(MODES, fallback) ? MODES[fallback] : MODES.day;
}
