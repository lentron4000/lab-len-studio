// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;

/** Earth's 23.4° obliquity, leaned 20° toward the viewer so you look slightly over the north pole. */
export const GLOBE_AXIS: Vec3 = ((): Vec3 => {
  const tilt = 23.4 * DEG;
  const lean = 20 * DEG;
  return [Math.sin(tilt) * Math.cos(lean), -Math.cos(tilt) * Math.cos(lean), Math.sin(lean)];
})();

/** Rotation by `angle` about unit `axis` (Rodrigues' formula). */
export function rotation(axis: Vec3, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [x, y, z] = axis;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}
