// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { labDevServer } from '../../scripts/lab-dev.mjs';
import { BANNER, HTML_BANNER } from './build/banner';
import { inlineWorklet } from './build/inline-worklet';
import { singleFile } from './build/single-file';

/**
 * `vite build`                → dist/        static site for labs.len.studio
 * `vite build --mode single`  → dist-single/ one self-contained index.html (runs from disk)
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [
      inlineWorklet(),
      {
        name: 'sound-toy:html-banner',
        transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n${HTML_BANNER}`),
      },
      ...(single ? [singleFile()] : []),
      // In development: the lab's navigation, and its other experiments (see scripts/lab-dev.mjs).
      labDevServer('sound-toys/particle-moon') as Plugin,
    ],
    // Keep /*! licence comments through minification (Vite drops them by default).
    esbuild: { legalComments: 'inline' },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      sourcemap: !single,
      cssCodeSplit: !single,
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : 4096,
      rollupOptions: {
        output: { banner: BANNER, ...(single ? { inlineDynamicImports: true } : {}) },
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      testTimeout: 60_000,
    },
  };
});
