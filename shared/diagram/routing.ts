import {
  GRID_SIZE,
  Vec,
  findClearLine,
  type PanelBox,
} from './geometry';

/**
 * Turn a list of waypoints into an SVG path with rounded corners and an arrowhead.
 *
 * Corners are quadratic curves rather than arcs: the two points either side of a bend are
 * pulled back along their own legs and the bend becomes the control point, which gives a
 * consistent radius without any trigonometry and without caring which way the corner turns.
 */
export const toPath = (points: Vec[]): string => {
  if (points.length === 0) throw new Error('toPath() needs at least one point');

  const last = points[points.length - 1]!;

  let path = `M ${points[0]!}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1]!;
    const bend = points[index]!;
    const after = points[index + 1]!;

    path += ` L ${before.towards(bend)} Q ${bend} ${after.towards(bend)}`;
  }

  path += ` L ${last}`;

  // Two strokes back from the tip, rather than a filled marker: a marker would need an
  // SVG <defs> id, and ids collide the moment two canvases share a page.
  const head = 7;
  path += ` M ${last} L ${last.add(new Vec(-head, -head))}`;
  path += ` M ${last} L ${last.add(new Vec(-head, head))}`;

  return path;
};

/** Keep the line clear of the handle it leaves from and the arrowhead it ends in. */
const START_GAP = 4;
const END_GAP = 10;

/** How far a cramped route steps out before turning. */
const DETOUR = 2 * GRID_SIZE;

/**
 * Route an orthogonal connector from one point to another, avoiding panels.
 *
 * Three cases, in order of how good they look:
 *
 * 1. **Level** — same `y`, so a straight line.
 * 2. **Roomy** — the target is far enough right for a single dog-leg: out, across, in.
 * 3. **Cramped** — the target is level with or behind the source, so the connector has to
 *    leave, travel vertically on a clear line, and come back. This is what makes a link to a
 *    panel placed to the *left* of its parent readable instead of a diagonal scribble.
 *
 * `panels` is only consulted to choose the turning leg; the endpoints are fixed by the
 * attachment points, so a connector always meets its panel square on.
 */
export const routeConnector = (panels: PanelBox[], from: Vec, to: Vec): string => {
  const start = new Vec(from.x + START_GAP, from.y);
  const end = new Vec(to.x - END_GAP, to.y);

  if (start.y === end.y) return toPath([start, end]);

  if (start.x + 3 * GRID_SIZE < end.x) {
    const turn = findClearLine(
      panels,
      new Vec(start.x + DETOUR, start.y),
      new Vec(end.x - DETOUR, end.y),
      'x'
    );

    return toPath([start, new Vec(turn, start.y), new Vec(turn, end.y), end]);
  }

  const lane = findClearLine(
    panels,
    new Vec(start.x + DETOUR, start.y),
    new Vec(end.x - DETOUR, end.y),
    'y'
  );

  return toPath([
    start,
    new Vec(start.x + DETOUR, start.y),
    new Vec(start.x + DETOUR, lane),
    new Vec(end.x - DETOUR, lane),
    new Vec(end.x - DETOUR, end.y),
    end,
  ]);
};
