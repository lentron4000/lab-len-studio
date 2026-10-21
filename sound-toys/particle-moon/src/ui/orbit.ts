// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Simulation } from '../sim/simulation';

/**
 * Click (or touch) and drag on the canvas orbits the camera round the shape; let go and it drifts on
 * a moment. While held, the pointer doesn't also stir the particles. Hovering still does. `onGrab` hears
 * each grab.
 */
export function attachOrbit(canvas: HTMLCanvasElement, sim: Simulation, onGrab?: () => void): void {
  let held: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || held !== null) return;
    held = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = e.timeStamp;
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
  };
  canvas.addEventListener('pointerup', letGo);
  canvas.addEventListener('pointercancel', letGo);
}
