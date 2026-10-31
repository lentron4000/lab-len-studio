// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Simulation } from '../sim/simulation';

/** A press that moves less than this (px) and lets go within this (ms) is a tap, not a drag. */
const TAP_SLOP = 8;
const TAP_MS = 350;

/**
 * Click (or touch) and drag on the canvas orbits the camera round the shape; let go and it drifts on
 * a moment. While held, the pointer doesn't also stir the particles. Hovering still does. `onGrab` hears
 * each grab; `onTap`, each press that was a tap instead (barely moved, quickly let go), and where.
 */
export function attachOrbit(
  canvas: HTMLCanvasElement,
  sim: Simulation,
  onGrab?: () => void,
  onTap?: (x: number, y: number) => void,
): void {
  let held: number | null = null;
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || held !== null) return;
    held = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    lastT = downT = e.timeStamp;
    sim.pointer.active = false;
    onGrab?.();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== held) return;
    const dt = (e.timeStamp - lastT) / 1000;
    sim.camera.drag(e.clientX - lastX, e.clientY - lastY, dt, Math.max(80, sim.viewport.radius));
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = e.timeStamp;
    // (The pointer's own listener has just marked it active: the drag is the camera's, not a stir.)
    sim.pointer.active = false;
  });
  const letGo = (e: PointerEvent): void => {
    if (e.pointerId !== held) return;
    held = null;
    sim.camera.release();
    const still = Math.hypot(e.clientX - downX, e.clientY - downY) < TAP_SLOP;
    if (e.type === 'pointerup' && still && e.timeStamp - downT < TAP_MS) onTap?.(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', letGo);
  canvas.addEventListener('pointercancel', letGo);
}
