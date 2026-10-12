# Lab · Len Studio

Experiments shared at [lab.len.studio](https://lab.len.studio).

## Layout

```
sound-toys/<toy>/          one folder per sound toy
<experiment>/<version>/    anything else, with a folder per version
lab.json                   which project is the landing page
scripts/build-lab.mjs      builds everything into out/
```

A project is any folder (one or two levels down) whose `package.json` has a `lab` entry:

```json
"lab": { "title": "Particle Moon", "summary": "One line for the project listing." }
```

It is served at the path that mirrors its folder, e.g. `lab.len.studio/sound-toys/particle-moon/`, and
built with its own `npm run build -- --base=/<path>/`. Each project keeps its own dependencies and tests.

## The site

- `/` shows the project named `current` in `lab.json`. To feature another project, change that line
  and push to `main`.
- `/projects/` lists every project.

`node scripts/build-lab.mjs` builds the whole site into `out/` (Node 20.19+). On Netlify the site's base
directory is the repo root and `netlify.toml` runs that script.
