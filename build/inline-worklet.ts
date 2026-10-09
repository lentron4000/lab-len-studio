// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import { resolve } from 'node:path';
import { build } from 'esbuild';
import type { Plugin } from 'vite';

const SUFFIX = '?worklet';

/**
 * `import source from './processor.ts?worklet'` bundles the module (and its imports) with esbuild
 * and returns the code as a string. The page loads it into an AudioWorklet through a Blob URL,
 * which keeps the worklet working in single-file builds and sandboxed hosts where a separate
 * script file or data: URL would be refused.
 */
export function inlineWorklet(): Plugin {
  return {
    name: 'sound-toy:inline-worklet',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.endsWith(SUFFIX)) return null;
      const resolved = await this.resolve(id.slice(0, -SUFFIX.length), importer, { skipSelf: true });
      return resolved ? resolved.id + SUFFIX : null;
    },
    async load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const entry = id.slice(0, -SUFFIX.length);
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2020',
        minify: true,
        legalComments: 'none',
        metafile: true,
      });
      // Metafile paths are relative to the cwd; Vite treats watch files as imports, so make them absolute.
      for (const input of Object.keys(result.metafile.inputs)) this.addWatchFile(resolve(input));
      return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
    },
  };
}
