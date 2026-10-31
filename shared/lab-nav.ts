// Len Studio Lab — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.
//
// The lab's navigation, shared by its experiments: each has a drawer (a two-line burger beside its
// name) that leads up to the lab and down into its other experiments and their variations.

/** The lab's projects, as the lab's build publishes them (/projects/index.json; see scripts/lab-manifest.mjs). */
export interface Manifest {
  current: string;
  groups: { name: string; projects: Project[] }[];
}

export interface Project {
  path: string;
  title: string;
  summary: string;
  /** Ways into it: each a query or path relative to the project's URL ("" is the project itself). */
  variations: { title: string; href: string }[];
}

/** Where the drawer's navigation is: the lab, a group of it, or a project of a group. */
export type Level =
  { at: 'lab' } | { at: 'group'; group: number } | { at: 'project'; group: number; project: number };

export interface NavOptions {
  /**
   * This page's project (its path): it and its group are marked as where you are. Choosing it goes home;
   * choosing its group opens it (or, if this is all there is in it, goes home too).
   */
  here: string;
  /** This page's variation (its href), marked as where you are among its project's. */
  current?: string;
  /** The drawer's own home view. */
  home: () => void;
  go: (level: Level) => void;
}

/** A project's URL (or one of its variations'). */
export const urlOf = (path: string, href = ''): string => `/${path}/${href}`;

let loading: Promise<Manifest | null> | null = null;

/** The lab's projects (fetched once), or null where there's no lab to be had (a page opened from disk). */
export function loadManifest(): Promise<Manifest | null> {
  loading ??= fetch('/projects/index.json')
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  return loading;
}

/** Where a project sits in the lab, or null if it isn't in it. */
export function locate(manifest: Manifest, path: string): { group: number; project: number } | null {
  for (let group = 0; group < manifest.groups.length; group++) {
    const project = manifest.groups[group].projects.findIndex((p) => p.path === path);
    if (project >= 0) return { group, project };
  }
  return null;
}

/**
 * Renders a level of the lab into `view`: a back link one level up (none at the top), its heading, and its
 * entries (groups, projects, or a project's variations), each drilling down or leading out to the
 * experiment. Where you are (this page's group, project and variation) is shown active and leads home.
 */
export function renderLevel(view: HTMLElement, manifest: Manifest, level: Level, opts: NavOptions): void {
  const back = (label: string, to: () => void): HTMLButtonElement => {
    const b = el('button', 'back', `‹ ${label}`);
    b.type = 'button';
    b.addEventListener('click', to);
    return b;
  };
  const list = el('ul', 'nav');
  const row = (title: string, detail: string, action: string | (() => void), mark?: string): void => {
    const li = el('li', mark ? 'active' : '');
    const item = typeof action === 'string' ? el('a') : el('button');
    if (typeof action === 'string') (item as HTMLAnchorElement).href = action;
    else {
      (item as HTMLButtonElement).type = 'button';
      item.addEventListener('click', action);
    }
    const name = el('span', 'name', title);
    // Where you are: a green dot (as the MIDI light's, connected), its words there for screen readers.
    if (mark) {
      const dot = el('span', 'here');
      dot.title = mark;
      dot.append(el('span', 'unseen', mark));
      name.append(dot);
    }
    item.append(name);
    if (detail) item.append(el('span', 'detail', detail));
    li.append(item);
    list.append(li);
  };
  const here = "You're here";

  if (level.at === 'lab') {
    view.replaceChildren(
      el('h2', '', 'Lab'),
      list,
      el('p', 'note', 'Leaving this page clears anything you’ve added to it.'),
    );
    manifest.groups.forEach((g, group) => {
      const n = g.projects.length;
      const detail = `${n} ${n === 1 ? 'experiment' : 'experiments'}`;
      const ours = g.projects.some((p) => p.path === opts.here);
      // (This page's group: marked; it opens like any other, unless this page is all there is in it.)
      if (ours && n === 1) row(g.name, detail, opts.home, here);
      else row(g.name, detail, () => opts.go({ at: 'group', group }), ours ? here : undefined);
    });
    return;
  }
  const g = manifest.groups[level.group];
  if (level.at === 'group') {
    view.replaceChildren(
      back('Back to Lab', () => opts.go({ at: 'lab' })),
      el('h2', '', g.name),
      list,
    );
    // (Each by its name alone: no description.)
    g.projects.forEach((p, project) => {
      if (p.path === opts.here) row(p.title, '', opts.home, here);
      else if (p.variations.length > 1)
        row(p.title, '', () => opts.go({ at: 'project', group: level.group, project }));
      else row(p.title, '', urlOf(p.path, p.variations[0]?.href));
    });
    return;
  }
  const p = g.projects[level.project];
  // (Back one level: to its group.)
  const up = back(`Back to ${g.name}`, () => opts.go({ at: 'group', group: level.group }));
  view.replaceChildren(up, el('h2', '', p.title), list);
  for (const v of p.variations) {
    if (p.path === opts.here && v.href === opts.current) row(v.title, '', opts.home, here);
    else row(v.title, '', urlOf(p.path, v.href));
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}
