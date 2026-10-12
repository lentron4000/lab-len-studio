// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

interface ImportMetaEnv {
  /** Mode when the URL names none (see lab-mode.ts); the offline venue build sets `ritual`. */
  readonly VITE_LAB_MODE?: string;
}

/** Bundled worklet source, produced by build/inline-worklet.ts. */
declare module '*?worklet' {
  const source: string;
  export default source;
}
