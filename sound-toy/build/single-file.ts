// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".
import type { Plugin } from 'vite';
import type { OutputAsset, OutputChunk } from 'rollup';

/**
 * Inlines the built entry script and stylesheet into index.html, producing one self-contained page
 * that runs from disk (needed for Web MIDI and audio input outside a web server) or from a sandboxed host.
 * Assumes one JS chunk and one CSS asset, which the `single` mode config guarantees.
 */
export function singleFile(): Plugin {
  return {
    name: 'sound-toy:single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (f): f is OutputAsset => f.type === 'asset' && f.fileName.endsWith('.html'),
      );
      if (!html) return;
      let source = String(html.source);
      const inlined: string[] = [];
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          const chunk: OutputChunk = file;
          const tag = new RegExp(`<script[^>]*src="[^"]*${escape(chunk.fileName)}"[^>]*></script>`);
          // Inline module scripts are deferred like external ones, so the DOM is ready when it runs.
          source = source.replace(tag, '');
          source = source.replace('</body>', () => `<script type="module">\n${chunk.code}</script>\n</body>`);
          inlined.push(file.fileName);
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escape(file.fileName)}"[^>]*>`);
          source = source.replace(tag, () => `<style>\n${String(file.source)}</style>`);
          inlined.push(file.fileName);
        }
      }
      for (const name of inlined) Reflect.deleteProperty(bundle, name);
      html.source = source;
    },
  };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
