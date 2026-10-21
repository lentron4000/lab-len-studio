// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Look } from './render/renderer';

/**
 * Modes, chosen by the `m` URL parameter (`?m=ritual`). Each locks the toy to one look and decides
 * what it offers; `len` is the master mode with everything unlocked, for demos. No parameter, or
 * one this build doesn't know, gives the plain toy (it opens on Day or Night, as the system is set, and
 * switches between just those two). `party` and `night` are the same mode (Party's look is 'night').
 */
export interface LabMode {
  name: string;
  /** The look the toy is locked to, or null when the viewer can switch (N, or the Mode buttons). */
  look: Look | null;
  /** Keys summon formations; the Summon and Intensity controls are shown. */
  formations: boolean;
  /** The looks the viewer can switch between (N, or the Mode buttons), when the look isn't locked. */
  looks: readonly Look[];
}

const ALL_LOOKS: readonly Look[] = ['day', 'dark', 'night', 'ritual', 'wire', 'refract'];

export const MODES: Record<string, LabMode> = {
  day: { name: 'day', look: null, formations: false, looks: ['day', 'dark'] },
  night: { name: 'night', look: 'night', formations: false, looks: ['night'] },
  party: { name: 'night', look: 'night', formations: false, looks: ['night'] },
  ritual: { name: 'ritual', look: 'ritual', formations: true, looks: ['ritual'] },
  wire: { name: 'wire', look: 'wire', formations: true, looks: ['wire'] },
  refract: { name: 'refract', look: 'refract', formations: true, looks: ['refract'] },
  len: { name: 'len', look: null, formations: true, looks: ALL_LOOKS },
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
