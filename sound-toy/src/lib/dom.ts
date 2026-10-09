// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/**
 * getElementById that checks what it found. A missing or mistyped control is a markup bug,
 * so it fails loudly at startup instead of misbehaving later.
 *
 * @example byId('state', HTMLInputElement)
 */
export function byId(id: string): HTMLElement;
export function byId<T extends HTMLElement>(id: string, type: abstract new () => T): T;
export function byId(id: string, type: abstract new () => HTMLElement = HTMLElement): HTMLElement {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Sound Toy: #${id} is missing or not a ${type.name}`);
  return el;
}

export function radios(name: string): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)];
}

/** Sets the CSS custom property the range track uses to paint its filled portion. */
export function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

/** True for key presses that are plain shortcuts (no modifier, not typing into a field). */
export function isShortcut(e: KeyboardEvent, key: string): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return false;
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'radio') return false;
  if (t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return false;
  return e.key.toLowerCase() === key;
}
