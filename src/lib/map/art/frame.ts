// What the waterfall drawings share with the rest of the map: their 8 directions and the box each is drawn in.

/** Directions, clockwise from north: 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * A drawing's box, in units of the icon's width (its size): w wide and h tall, with the icon's
 * point (a waterfall's lip) at (ax, ay) from its top left.
 */
export interface Frame {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** How far the water of a waterfall falling SE or SW leans toward the drop, across per down. */
export const LEAN = 0.12;
/** How far the water of a waterfall falling E or W runs out toward the drop, across per down. */
export const SHEAR = 0.5;
