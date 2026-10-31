// In development, the lab around an experiment as the live site has it: its navigation
// (/projects/index.json, as the lab's build writes it), and the other experiments, served from the
// lab's last full build (out/; `node scripts/build-lab.mjs` from the repo root makes it).
//
// A Vite plugin: labDevServer('sound-toys/particle-moon') in that experiment's vite.config.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { findProjects, labManifest } from './lab-manifest.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'out');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** @param {string} here this experiment's path (it's served by Vite itself, as usual) */
export function labDevServer(here) {
  return {
    name: 'lab-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/projects/index.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(labManifest(ROOT)));
      });
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/';
        const path = decodeURIComponent(url.split('?')[0]);
        // (Hidden ones too: they're not listed, but they're there.)
        const others = findProjects(ROOT);
        const project = others.find(
          (p) => p.path !== here && (path === `/${p.path}` || path.startsWith(`/${p.path}/`)),
        );
        if (!project) return next();
        if (path === `/${project.path}`) {
          res.statusCode = 302;
          res.setHeader(
            'Location',
            `/${project.path}/${url.includes('?') ? url.slice(url.indexOf('?')) : ''}`,
          );
          return res.end();
        }
        let file = normalize(join(OUT, path));
        if (!file.startsWith(OUT)) return next();
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(
            `<body style="font:14px/1.5 system-ui;background:#0b0b0c;color:#f2f2f0;padding:40px">` +
              `<p><b>${project.path}</b> isn't built yet.</p>` +
              `<p>From the repo root, run <code>node scripts/build-lab.mjs</code>, then come back.</p></body>`,
          );
        }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
  };
}
