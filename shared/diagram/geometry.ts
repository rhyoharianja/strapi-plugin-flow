/**
 * Grid geometry for the flow canvas.
 *
 * Ported from the approach Directus uses for its own flow editor, which is worth explaining
 * because it is not the obvious one: there is **no graph library**. Panels sit on a grid,
 * arrows are *derived* from panel positions on every render, and the routing is orthogonal
 * with rounded corners and simple obstacle avoidance. Nothing about an edge is stored except
 * which panel it points at.
 *
 * That has a consequence worth stating up front: **an arrow's shape is never edited, only
 * its endpoints.** Dragging a connector means dragging where it *attaches*; the path between
 * is recomputed. Storing hand-placed waypoints would mean every panel move could leave a
 * line crossing through a panel, with no way to know which bends were deliberate.
 *
 * Everything here is pure and free of React, Strapi and the DOM, so the geometry can be
 * tested without a browser — which is the only practical way to be sure a router is right.
 */

/** Pixels per grid unit. Panel positions are stored in grid units, not pixels. */
export const GRID_SIZE = 20;

/** Panel size in grid units. 13 × 5 is 260 × 100 pixels. */
export const PANEL_WIDTH = 13;
export const PANEL_HEIGHT = 5;

/**
 * An immutable 2D point.
 *
 * Deliberately immutable, unlike the version this was ported from: there, `add` and `mul`
 * mutate the receiver, so call sites have to remember `.clone()` first and a forgotten clone
 * corrupts a shared point silently. Returning new instances costs nothing at this scale.
 */
export class Vec {
  constructor(
    readonly x: number,
    readonly y: number
  ) {}

  add(other: Vec): Vec {
    return new Vec(this.x + other.x, this.y + other.y);
  }

  scale(factor: number): Vec {
    return new Vec(this.x * factor, this.y * factor);
  }

  /** Vector from this point to `point`. */
  to(point: Vec): Vec {
    return new Vec(point.x - this.x, point.y - this.y);
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  equals(point: Vec): boolean {
    return this.x === point.x && this.y === point.y;
  }

  /**
   * A point `distance` away from `point`, on the line back towards this one.
   *
   * Used to cut the corners of an orthogonal path: the two points either side of a bend are
   * pulled in, and the bend itself becomes the control point of a quadratic curve.
   */
  towards(point: Vec, distance = 10): Vec {
    if (this.equals(point)) return point;

    const direction = this.to(point);
    const scale = distance / direction.length();

    // Step back from `point` along the incoming direction.
    return point.add(direction.scale(-scale));
  }

  /** SVG coordinates are space-separated, which is what makes this useful in a template. */
  toString(): string {
    return `${round(this.x)} ${round(this.y)}`;
  }
}

/** Trim floating-point noise so generated paths are stable and diffable. */
const round = (value: number): number => Math.round(value * 100) / 100;

/** Where an arrow attaches to a panel, in pixels from the panel's top-left corner. */
export const ATTACH = {
  /** Incoming edges land on the left, vertically centred. */
  in: new Vec(0, (PANEL_HEIGHT / 2) * GRID_SIZE),
  /** Success leaves the right edge at one third height. */
  resolve: new Vec(PANEL_WIDTH * GRID_SIZE, (PANEL_HEIGHT / 3) * GRID_SIZE),
  /** Failure leaves the right edge at two thirds, far enough not to overlap `resolve`. */
  reject: new Vec(PANEL_WIDTH * GRID_SIZE, ((PANEL_HEIGHT * 2) / 3) * GRID_SIZE),
} as const;

/** A panel as the canvas positions it. Grid units, not pixels. */
export interface PanelBox {
  id: string;
  x: number;
  y: number;
}

/** Convert a panel's grid position plus an attachment offset into pixels. */
export const attachPoint = (panel: PanelBox, offset: Vec): Vec =>
  new Vec(panel.x * GRID_SIZE + offset.x, panel.y * GRID_SIZE + offset.y);

export const minMax = (a: Vec, b: Vec): { min: Vec; max: Vec } => ({
  min: new Vec(Math.min(a.x, b.x), Math.min(a.y, b.y)),
  max: new Vec(Math.max(a.x, b.x), Math.max(a.y, b.y)),
});

/**
 * Inclusive range from `min` to `max` in steps of `step`.
 *
 * `max` is always the last entry even when the step does not divide the span evenly, so a
 * caller scanning for a gap never misses the far edge.
 */
export const range = (min: number, max: number, step: number): number[] => {
  if (step <= 0) throw new Error('range() needs a positive step, or it will not terminate');

  const points: number[] = [];

  for (let value = min; value < max; value += step) points.push(value);

  points.push(max);

  return points;
};

/**
 * Whether a point falls inside any panel.
 *
 * The box is widened by one grid unit on the left so a vertical leg does not run flush
 * against a panel's incoming edge, where it would be hard to tell apart from an arrow that
 * actually attaches there.
 */
export const isInsideAnyPanel = (panels: PanelBox[], point: Vec): boolean =>
  panels.some(
    (panel) =>
      point.x >= (panel.x - 1) * GRID_SIZE &&
      point.x <= (panel.x + PANEL_WIDTH) * GRID_SIZE &&
      point.y >= panel.y * GRID_SIZE &&
      point.y <= (panel.y + PANEL_HEIGHT) * GRID_SIZE
  );

/**
 * Pick the grid line on `axis` for a connector's turning leg, avoiding panels.
 *
 * Candidate lines are tested along the whole span the leg would cross, so a line is only
 * accepted if it is clear for its entire length rather than merely at its midpoint. The
 * search starts at the centre and alternates outwards, so the chosen route stays as close to
 * the direct path as the obstacles allow.
 *
 * When nothing is clear it returns the midpoint anyway: a connector drawn through a panel is
 * poor, but a connector that fails to draw is worse.
 */
export const findClearLine = (
  panels: PanelBox[],
  from: Vec,
  to: Vec,
  axis: 'x' | 'y'
): number => {
  const other = axis === 'x' ? 'y' : 'x';
  const { min, max } = minMax(from, to);

  const alignedMin = Math.floor(min[axis] / GRID_SIZE) * GRID_SIZE;
  const alignedMax = Math.ceil(max[axis] / GRID_SIZE) * GRID_SIZE;

  const candidates = range(alignedMin, alignedMax, GRID_SIZE);
  const crossings = range(
    min[other],
    max[other],
    (axis === 'x' ? PANEL_HEIGHT : PANEL_WIDTH) * GRID_SIZE
  );

  const clear = candidates.map((candidate) =>
    crossings.every(
      (crossing) =>
        !isInsideAnyPanel(
          panels,
          axis === 'x' ? new Vec(candidate, crossing) : new Vec(crossing, candidate)
        )
    )
  );

  const centre = Math.floor(clear.length / 2);

  for (let step = 0; step <= centre + 1; step += 1) {
    for (const index of step === 0 ? [centre] : [centre - step, centre + step]) {
      if (index >= 0 && index < clear.length && clear[index]) return candidates[index]!;
    }
  }

  return alignedMin + Math.floor((alignedMax - alignedMin) / 2 / GRID_SIZE) * GRID_SIZE;
};
