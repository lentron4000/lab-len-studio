// Types for lab-dev.mjs (plain JS, shared by the lab's experiments' Vite configs).

/** A Vite plugin (cast to Vite's Plugin where it's used: this folder has no Vite of its own). */
export interface LabDevServer {
  name: string;
  apply: 'serve';
  configureServer: (server: unknown) => void;
}

export function labDevServer(here: string): LabDevServer;
