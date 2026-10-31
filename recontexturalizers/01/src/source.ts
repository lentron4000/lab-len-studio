// Recontexturalizers — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import type { Grid } from './quilt';
import { CELLS, COLS, ROWS } from './textile';

/** The pixelated textile as a grid of cells. */
export function textile(): Grid {
  const rgb = new Uint8Array(COLS * ROWS * 3);
  CELLS.forEach((line, y) => {
    for (let x = 0; x < COLS; x++)
      for (let k = 0; k < 3; k++)
        rgb[(y * COLS + x) * 3 + k] = parseInt(line.slice(x * 6 + k * 2, x * 6 + k * 2 + 2), 16);
  });
  return { cols: COLS, rows: ROWS, rgb };
}
