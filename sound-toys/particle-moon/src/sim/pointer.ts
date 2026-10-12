// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** Pointer (mouse, pen or touch) position, smoothed velocity and activity over the canvas. */
export class Pointer {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** 0–1, rises with movement and decays when still. Scales gravity in the fluid modes. */
  activity = 0;
  active = false;
  private dx = 0;
  private dy = 0;

  attach(el: HTMLElement): void {
    el.addEventListener('pointermove', (e) => {
      if (this.active) {
        this.dx += e.clientX - this.x;
        this.dy += e.clientY - this.y;
      }
      this.x = e.clientX;
      this.y = e.clientY;
      this.active = true;
    });
    el.addEventListener('pointerdown', (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
      this.active = true;
    });
    const leave = (): void => {
      this.active = false;
      this.activity = 0;
    };
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointercancel', leave);
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') leave(); // touch: lifting the finger removes the pointer
    });
  }

  /** Called once per simulation step. */
  step(): void {
    this.vx = this.vx * 0.6 + this.dx * 0.4;
    this.vy = this.vy * 0.6 + this.dy * 0.4;
    this.dx = 0;
    this.dy = 0;
    const speed = Math.hypot(this.vx, this.vy);
    this.activity = Math.max(this.activity * 0.95, Math.min(1, speed / 12));
  }
}
