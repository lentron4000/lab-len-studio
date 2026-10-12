// Builds the whole lab into out/ for lab.len.studio.
//
// A project is any folder, one or two levels down, whose package.json has a "lab" entry
// ({ title, summary }). Each is built with its own npm scripts under the path that mirrors its
// folder (sound-toys/particle-moon → /sound-toys/particle-moon/). Then:
//   /            serves the project named "current" in lab.json (a rewrite, so it keeps the root URL)
//   /projects/   lists every project
//
// Usage: node scripts/build-lab.mjs        (from the repo root; needs Node 20.19+)

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'out');
const SKIP = new Set(['node_modules', 'out', 'scripts', 'dist']);

/** Folders one or two levels down with a package.json that has a "lab" entry. */
function findProjects() {
  const projects = [];
  const visit = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const pkgPath = join(path, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.lab) projects.push({ dir: path, path: relative(ROOT, path), ...pkg.lab });
      } else if (depth < 2) {
        visit(path, depth + 1);
      }
    }
  };
  visit(ROOT, 1);
  return projects.sort((a, b) => a.path.localeCompare(b.path));
}

function run(cwd, args) {
  execFileSync('npm', args, { cwd, stdio: 'inherit' });
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const label = (folder) => folder.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

function listingPage(projects, current) {
  const groups = Map.groupBy(projects, (p) => p.path.split('/')[0]);
  const sections = [...groups]
    .map(([group, items]) => {
      const rows = items
        .map(
          (p) => `      <li>
        <a href="/${p.path}/">${escape(p.title)}</a>${p.path === current ? ' <span class="now">now showing</span>' : ''}
        <p>${escape(p.summary ?? '')}</p>
      </li>`,
        )
        .join('\n');
      return `    <section>
      <h2>${escape(label(group))}</h2>
      <ul>
${rows}
      </ul>
    </section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lab · Len Studio</title>
    <style>
      :root { color-scheme: light dark; --ink: #111214; --muted: #6c7078; --paper: #ffffff; }
      @media (prefers-color-scheme: dark) { :root { --ink: #eceae6; --muted: #8c8a86; --paper: #0b0b0c; } }
      body { margin: 0; padding: 48px 16px; background: var(--paper); color: var(--ink);
        font: 15px/1.5 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
      main { max-width: 640px; margin: 0 auto; }
      h1 { font-size: 15px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; margin: 0 0 48px; }
      h2 { font-size: 12px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin: 0 0 16px; }
      section { margin-bottom: 40px; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { margin-bottom: 20px; }
      a { color: inherit; }
      p { margin: 4px 0 0; color: var(--muted); }
      .now { font-size: 12px; color: var(--muted); margin-left: 8px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Lab</h1>
${sections}
    </main>
  </body>
</html>
`;
}

const lab = JSON.parse(readFileSync(join(ROOT, 'lab.json'), 'utf8'));
const projects = findProjects();
if (!projects.some((p) => p.path === lab.current)) {
  throw new Error(`lab.json: "current" is ${lab.current}, which isn't a project (${projects.map((p) => p.path).join(', ')})`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const headers = [];
for (const p of projects) {
  console.log(`\n▸ ${p.path}`);
  if (!existsSync(join(p.dir, 'node_modules'))) run(p.dir, ['ci']);
  run(p.dir, ['run', 'build', '--', `--base=/${p.path}/`]);
  cpSync(join(p.dir, 'dist'), join(OUT, p.path), { recursive: true });
  // Vite fingerprints everything under assets/, so it can be cached forever.
  headers.push(`/${p.path}/assets/*\n  Cache-Control: public, max-age=31536000, immutable`);
}

mkdirSync(join(OUT, 'projects'), { recursive: true });
writeFileSync(join(OUT, 'projects', 'index.html'), listingPage(projects, lab.current));
writeFileSync(join(OUT, '_redirects'), `/  /${lab.current}/  200\n`);
writeFileSync(join(OUT, '_headers'), headers.join('\n') + '\n');
console.log(`\nBuilt ${projects.length} project(s) into out/. Landing page: ${lab.current}`);
