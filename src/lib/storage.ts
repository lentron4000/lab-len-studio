// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/**
 * Per-browser preferences. Storage can be missing or throw (private windows, blocked site data,
 * sandboxed frames); every setting here is a convenience, so failures fall back silently.
 */
export const StorageKey = {
  AudioInput: 'sound-toy:audio-input',
  MidiMap: 'sound-toy:midi-map',
  Night: 'sound-toy:night',
} as const;
export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];

/** Keys used before the project was renamed; read once so existing settings carry over. */
const LEGACY: Record<StorageKey, string> = {
  [StorageKey.AudioInput]: 'pc-audio-in',
  [StorageKey.MidiMap]: 'pc-midi-map',
  [StorageKey.Night]: 'pc-night',
};

export function load(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key) ?? localStorage.getItem(LEGACY[key]);
  } catch {
    return null;
  }
}

export function save(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the setting lasts for this session only.
  }
}
