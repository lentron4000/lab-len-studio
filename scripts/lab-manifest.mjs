// The lab's projects, as the build and each project's navigation see them.
//
// A project is any folder, one or two levels down, whose package.json has a "lab" entry:
//   { "title": "…", "summary": "…", "variations": [{ "title": "…", "href": "?m=…" }], "hidden": true }
// ("variations" is optional: the ways into it, each a query or path relative to the project's URL.
// "hidden" is optional too: built and served at its URL, but not listed, so only those given it find it.)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP = new Set(['node_modules', 'out', 'scripts', 'dist']);

/** Folders one or two levels down with a package.json that has a "lab" entry, sorted by path. */
export function findProjects(root) {
  const projects = [];
  const visit = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const pkgPath = join(path, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.lab) projects.push({ dir: path, path: relative(root, path), ...pkg.lab });
      } else if (depth < 2) {
        visit(path, depth + 1);
      }
    }
  };
  visit(root, 1);
  return projects.sort((a, b) => a.path.localeCompare(b.path));
}

/** A folder name as a heading: "sound-toys" → "Sound Toys". */
export const label = (folder) => folder.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * What the projects' navigation reads (served at /projects/index.json): the landing project, and the
 * projects in groups by their top folder, each with its URL path, title, summary and variations.
 */
export function labManifest(root) {
  const { current } = JSON.parse(readFileSync(join(root, 'lab.json'), 'utf8'));
  const projects = findProjects(root).filter((p) => !p.hidden);
  const groups = Map.groupBy(projects, (p) => p.path.split('/')[0]);
  return {
    current,
    groups: [...groups].map(([folder, items]) => ({
      name: label(folder),
      projects: items.map(({ path, title, summary, variations }) => ({
        path,
        title,
        summary: summary ?? '',
        variations: variations ?? [],
      })),
    })),
  };
}
