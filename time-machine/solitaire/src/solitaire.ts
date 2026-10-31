// Time Machine — Copyright (c) 2026 Lenny Ford, Len Studio (https://len.studio)
// SPDX-License-Identifier: MIT.

/**
 * Solitaire, won: cards come off the piles at the top one at a time, fall, bounce along the bottom, a
 * little lower each time (each bounce setting them turning a little), and fly off a side. (Drawn without clearing, each leaves a trail of itself.)
 * Everything's in screen px, from the top left; speeds and gravity scale with the screen's height.
 */
export interface Card {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** How much of its speed it keeps at a bounce. */
  bounce: number;
  /** Turned (radians, clockwise), and turning (radians a second): the bounces set it going. */
  angle: number;
  spin: number;
}

/** A card's height, as a share of the screen's; its width, as a share of its height (a playing card). */
const CARD_HEIGHT = 0.26;
export const CARD_SHAPE = 2.5 / 3.5;
/** Falling: screen heights a second, a second. Across: screen heights a second, at least and at most. */
const GRAVITY = 2.4;
const ACROSS_MIN = 0.25;
const ACROSS_MAX = 0.75;
/** The piles: four, along the top right, as on the table. */
export const PILES = 4;
/** At a bounce, the turning: half of it kept, and a kick of up to this either way (radians a second). */
const SPIN_KICK = 1.1;

/** The next card off pile `pile` (0 to PILES − 1), off to one side or the other. */
export function deal(width: number, height: number, pile: number, random: () => number = Math.random): Card {
  const h = height * CARD_HEIGHT;
  const w = h * CARD_SHAPE;
  const gap = w * 0.18;
  const x = width - gap - (PILES - pile) * (w + gap);
  const speed = height * (ACROSS_MIN + (ACROSS_MAX - ACROSS_MIN) * random());
  return {
    x,
    y: gap,
    w,
    h,
    vx: random() < 0.75 ? -speed : speed,
    vy: -height * 0.3 * random(),
    bounce: 0.7 + 0.2 * random(),
    angle: 0,
    spin: 0,
  };
}

/** Moves a card on by `dt` seconds; false once it's gone off a side. */
export function step(
  card: Card,
  dt: number,
  width: number,
  height: number,
  random: () => number = Math.random,
): boolean {
  card.vy += GRAVITY * height * dt;
  card.x += card.vx * dt;
  card.y += card.vy * dt;
  card.angle += card.spin * dt;
  // The bottom: a bounce, and a knock that turns it a little.
  if (card.y + card.h > height) {
    card.y = height - card.h;
    card.vy = -Math.abs(card.vy) * card.bounce;
    card.spin = card.spin * 0.5 + (random() * 2 - 1) * SPIN_KICK;
  }
  return card.x + card.w > 0 && card.x < width;
}
