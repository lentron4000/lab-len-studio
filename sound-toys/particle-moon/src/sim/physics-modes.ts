// Sound Toy — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT. If you use or adapt this, credit "Sound Toy by Lenny Ford (len.studio)".

export type PhysicsModeId = 'gas' | 'gasB' | 'water';

/**
 * Behaviour at the fully open ("cloud") end of the State slider. The solid end is shared by all
 * modes (see SOLID); in between, the step interpolates. Distances are tuned for a 230 px shape
 * radius and scaled with the real size, so the feel doesn't change with the window.
 */
export interface PhysicsMode {
  /** Spring stiffness towards each particle's home position. */
  spring: number;
  /** Fraction of the home spring kept at the cloud end (0 = particles are free to flow). */
  homeWeight: number;
  /** Strength of the soft round wall that holds free particles (disc). */
  contain: number;
  /** Wall radius as a fraction of the shape radius (disc). */
  containRadius: number;
  /** Shell that holds free particles on the globe: inner and outer radius (fractions) and strength. */
  shellInner: number;
  shellOuter: number;
  shellStrength: number;
  /** Thermostat target speed: keeps gas molecules moving in straight lines. 0 = off. */
  speed: number;
  /** Velocity kept per step. */
  damping: number;
  /** Random thermal kick per step. */
  thermal: number;
  /** Visual jitter added at draw time (vibration), in pixels at full energy. */
  jitter: number;
  /** Pointer gravity (negative repels). */
  pointerGravity: number;
  /** How strongly the pointer drags nearby particles along with its motion. */
  pointerWake: number;
  /** Particle–particle repulsion, cohesion and viscosity. */
  repulsion: number;
  cohesion: number;
  viscosity: number;
  /** Interaction range in mean particle spacings. */
  range: number;
  /**
   * How a kick turns it to vapour (0 = not at all): the opened particles wander and slow instead of
   * speeding up, and some evaporate, drifting off before condensing back.
   */
  vapor: number;
  /** Pointer pull and wake at the fully loose end, relative to tight (free particles fling easily). */
  loosePointer: number;
  /** Loosest the State slider takes it (0–1): the slider's loose end maps to this. */
  looseCap: number;
  /** State at the slider's loose end, the whole slider scaled to fit (0–1); looseCap then clips it. */
  looseRange: number;
  /** Kicks travel out from the centre as a ripple instead of moving everything at once (0 or 1). */
  ripple: number;
  /**
   * Atmosphere (0–1): banded, swirling flow like Jupiter's, stirred by sound, the pointer and kicks
   * (still when nothing stirs it; see the simulation's ATMO_ constants).
   */
  atmosphere: number;
  description: string;
}

/** The packed state every mode starts from. */
export const SOLID = { spring: 0.25, damping: 0.88, thermal: 0.25 } as const;

export const PHYSICS_MODES: Record<PhysicsModeId, PhysicsMode> = {
  gas: {
    spring: 0.006,
    homeWeight: 0,
    contain: 0.0018,
    containRadius: 1.2,
    shellInner: 0.78,
    shellOuter: 1.22,
    shellStrength: 0.006,
    speed: 1.5,
    damping: 0.999,
    thermal: 0.06,
    jitter: 0.35,
    pointerGravity: 2600,
    pointerWake: 0.12,
    repulsion: 0.45,
    cohesion: 0,
    viscosity: 0,
    range: 1.1,
    vapor: 1,
    ripple: 0,
    atmosphere: 0,
    looseCap: 1,
    looseRange: 0.9,
    loosePointer: 1,
    description:
      'Air. Molecules fly in straight lines and bounce off each other. Sweep the pointer through to push a current; it diffuses back.',
  },
  gasB: {
    spring: 0.006,
    homeWeight: 0,
    contain: 0.0018,
    containRadius: 1.2,
    shellInner: 0.78,
    shellOuter: 1.22,
    shellStrength: 0.006,
    speed: 1.5,
    damping: 0.999,
    thermal: 0.06,
    jitter: 0.35,
    pointerGravity: 2600,
    pointerWake: 0.12,
    repulsion: 0.45,
    cohesion: 0,
    viscosity: 0,
    range: 1.1,
    vapor: 1,
    ripple: 0,
    atmosphere: 1,
    looseCap: 1,
    looseRange: 0.9,
    loosePointer: 1,
    description:
      'Gas B: an atmosphere. Banded rings drift in opposite directions and slow currents swirl through them. Music or the pointer stirs it, a kick shatters the bands into eddies, and Tight resists.',
  },
  water: {
    spring: 0.006,
    homeWeight: 0,
    contain: 0.01,
    containRadius: 0.95,
    shellInner: 0.97,
    shellOuter: 1.0,
    shellStrength: 0.03,
    speed: 0,
    damping: 0.99,
    thermal: 0.03,
    jitter: 0.25,
    pointerGravity: 3600,
    pointerWake: 0.2,
    repulsion: 0.5,
    cohesion: 0.5,
    viscosity: 0.05,
    range: 2,
    vapor: 0,
    ripple: 1,
    atmosphere: 0,
    looseCap: 0.75,
    looseRange: 1,
    loosePointer: 0.35,
    description:
      'Liquid. No fixed positions, only cohesion and surface tension. It swirls, pulls into tendrils and pools back together.',
  },
};
