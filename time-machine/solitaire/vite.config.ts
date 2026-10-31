// Time Machine — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
import { defineConfig, type Plugin } from 'vite';
import { labDevServer } from '../../scripts/lab-dev.mjs';

export default defineConfig({
  base: './',
  // In development: the lab's navigation, and its other experiments (see scripts/lab-dev.mjs).
  plugins: [labDevServer('time-machine/solitaire') as Plugin],
});
