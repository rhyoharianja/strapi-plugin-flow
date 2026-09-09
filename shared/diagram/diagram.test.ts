import { describe, expect, it } from 'vitest';

import {
  ATTACH,
  GRID_SIZE,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  Vec,
  attachPoint,
  findClearLine,
  isInsideAnyPanel,
  minMax,
  range,
} from './geometry';
import { routeConnector, toPath } from './routing';
import {
  TRIGGER_ID,
  buildArrows,
  findFreeSpot,
  isImplicitChain,
  toGraph,
  type DiagramNode,
} from './graph';

/**
 * The canvas is a drawing, so most of it has to be judged by eye — but the routing
 * underneath is arithmetic, and arithmetic is exactly what goes quietly wrong. A connector
 * that runs through a panel, an arrowhead pointing the wrong way, a legacy flow that
 * rearranges itself when opened: all invisible in a screenshot of a simple diagram and
 * obvious in a complicated one.
 */

const panel = (id: string, x: number, y: number): DiagramNode => ({
  id,
  x,
  y,
  resolve: null,
  reject: null,
});

describe('Vec', () => {
  it('does not mutate the receiver', () => {
    const start = new Vec(1, 2);

    start.add(new Vec(10, 10));
    start.scale(5);

    // The version this was ported from mutates, and a forgotten clone corrupts a shared point.
    expect(start.x).toBe(1);
    expect(start.y).toBe(2);
  });

  it('steps back from a point along the incoming direction', () => {
    const moved = new Vec(0, 0).towards(new Vec(100, 0), 10);

    expect(moved.x).toBeCloseTo(90);
    expect(moved.y).toBeCloseTo(0);
  });

  it('returns the point itself when the two coincide, rather than dividing by zero', () => {
    const point = new Vec(5, 5);

    expect(new Vec(5, 5).towards(point)).toEqual(point);
  });

  it('prints space-separated coordinates, rounded, for SVG', () => {
    // Two decimals is enough for a path and keeps generated `d` attributes diffable.
    expect(String(new Vec(1.567, 2))).toBe('1.57 2');
    expect(String(new Vec(1 / 3, 2 / 3))).toBe('0.33 0.67');
  });
});

describe('range', () => {
  it('always includes the maximum, even when the step overshoots', () => {
    expect(range(0, 25, 10)).toEqual([0, 10, 20, 25]);
  });

  it('refuses a non-positive step instead of looping forever', () => {
    expect(() => range(0, 10, 0)).toThrow(/positive step/);
    expect(() => range(0, 10, -1)).toThrow();
  });
});

describe('minMax', () => {
  it('splits two points into corners regardless of their order', () => {
    const { min, max } = minMax(new Vec(10, 2), new Vec(1, 20));

    expect([min.x, min.y]).toEqual([1, 2]);
    expect([max.x, max.y]).toEqual([10, 20]);
  });
});

describe('isInsideAnyPanel', () => {
  const panels = [panel('a', 5, 5)];

  it('finds a point in the middle of a panel', () => {
    const middle = new Vec((5 + PANEL_WIDTH / 2) * GRID_SIZE, (5 + PANEL_HEIGHT / 2) * GRID_SIZE);

    expect(isInsideAnyPanel(panels, middle)).toBe(true);
  });

  it('leaves a lane free one grid unit to the left of the incoming edge', () => {
    // A leg flush against the edge is hard to tell from an arrow that attaches there.
    expect(isInsideAnyPanel(panels, new Vec(4 * GRID_SIZE, 6 * GRID_SIZE))).toBe(true);
    expect(isInsideAnyPanel(panels, new Vec(3 * GRID_SIZE, 6 * GRID_SIZE))).toBe(false);
  });

  it('says no for an empty canvas', () => {
    expect(isInsideAnyPanel([], new Vec(0, 0))).toBe(false);
  });
});

describe('findClearLine', () => {
  it('takes the centre when nothing is in the way', () => {
    const from = new Vec(0, 0);
    const to = new Vec(10 * GRID_SIZE, 4 * GRID_SIZE);

    const line = findClearLine([], from, to, 'x');

    expect(line % GRID_SIZE).toBe(0);
    expect(line).toBeGreaterThanOrEqual(0);
    expect(line).toBeLessThanOrEqual(10 * GRID_SIZE);
  });

  it('avoids a panel sitting on the direct route', () => {
    // A panel straddling the middle of the span, tall enough to block every crossing.
    const blocker = panel('block', 5, 0);
    const from = new Vec(0, 0);
    const to = new Vec(20 * GRID_SIZE, 3 * GRID_SIZE);

    const line = findClearLine([blocker], from, to, 'x');

    const blocked =
      line >= (blocker.x - 1) * GRID_SIZE && line <= (blocker.x + PANEL_WIDTH) * GRID_SIZE;

    expect(blocked).toBe(false);
  });

  it('still returns a grid-aligned number when everything is blocked', () => {
    // Better a connector drawn through a panel than one that fails to draw at all.
    const wall = Array.from({ length: 6 }, (_, index) => panel(`w${index}`, index * 2, 0));

    const line = findClearLine(wall, new Vec(0, 0), new Vec(12 * GRID_SIZE, 2 * GRID_SIZE), 'x');

    expect(Number.isFinite(line)).toBe(true);
    expect(line % GRID_SIZE).toBe(0);
  });
});

describe('toPath', () => {
  it('refuses an empty point list', () => {
    expect(() => toPath([])).toThrow(/at least one point/);
  });

  it('draws a straight segment plus an arrowhead', () => {
    const path = toPath([new Vec(0, 0), new Vec(100, 0)]);

    expect(path.startsWith('M 0 0')).toBe(true);
    // Two strokes back from the tip rather than a marker, which would need a colliding id.
    expect(path.match(/M 100 0 L/g)).toHaveLength(2);
  });

  it('rounds every corner with a quadratic, so no bend is a hard angle', () => {
    const path = toPath([new Vec(0, 0), new Vec(100, 0), new Vec(100, 100)]);

    expect(path).toContain('Q 100 0');
  });

  it('emits no curve for a two-point line', () => {
    expect(toPath([new Vec(0, 0), new Vec(50, 0)])).not.toContain('Q');
  });
});

describe('routeConnector', () => {
  it('runs straight when both ends are level', () => {
    const path = routeConnector([], new Vec(0, 100), new Vec(400, 100));

    expect(path).not.toContain('Q');
  });

  it('uses a single dog-leg when there is room to the right', () => {
    const path = routeConnector([], new Vec(0, 0), new Vec(400, 100));

    // Out, across, in: two bends.
    expect(path.match(/Q/g)).toHaveLength(2);
  });

  it('detours when the target is behind the source', () => {
    const path = routeConnector([], new Vec(400, 0), new Vec(100, 200));

    /*
     * Four bends, because the connector has to leave rightwards, travel vertically on a
     * clear lane, come back left and re-enter. This is the case that makes a link to a panel
     * placed *left* of its parent readable instead of a diagonal scribble.
     */
    expect(path.match(/Q/g)).toHaveLength(4);
  });

  it('keeps a gap at both ends, clear of the handle and the arrowhead', () => {
    const path = routeConnector([], new Vec(0, 100), new Vec(400, 100));

    expect(path.startsWith('M 4 100')).toBe(true);
    expect(path).toContain('390 100');
  });
});

describe('toGraph', () => {
  const step = (id: string) => ({ id });

  it('reads a flow with no positions as the chain it used to be', () => {
    const { nodes, firstStep } = toGraph([step('a'), step('b'), step('c')]);

    // Nothing to migrate: an old flow keeps running in the order it was written.
    expect(firstStep).toBe('a');
    expect(nodes.map((node) => node.resolve)).toEqual(['b', 'c', null]);
  });

  it('lays an implicit chain out left to right', () => {
    const { nodes } = toGraph([step('a'), step('b')]);

    expect(nodes[0]!.y).toBe(nodes[1]!.y);
    expect(nodes[1]!.x).toBeGreaterThan(nodes[0]!.x);
  });

  it('takes an explicit graph at face value', () => {
    const { nodes, firstStep } = toGraph(
      [
        { id: 'a', x: 20, y: 1, resolve: 'c', reject: 'b' },
        { id: 'b', x: 1, y: 9, resolve: null, reject: null },
        { id: 'c', x: 40, y: 1, resolve: null, reject: null },
      ],
      'a'
    );

    expect(firstStep).toBe('a');
    expect(nodes[0]!.resolve).toBe('c');
    expect(nodes[0]!.reject).toBe('b');
    // A panel placed to the left of its parent stays there.
    expect(nodes[1]!.x).toBe(1);
  });

  it('drops an edge to a step that no longer exists', () => {
    const { nodes } = toGraph([{ id: 'a', x: 1, y: 1, resolve: 'deleted' }], 'a');

    expect(nodes[0]!.resolve).toBeNull();
  });

  it('drops a firstStep pointing at a deleted step, rather than promoting another', () => {
    const { firstStep } = toGraph([{ id: 'a', x: 1, y: 1 }], 'gone');

    expect(firstStep).toBeNull();
  });

  it('handles an empty flow', () => {
    expect(toGraph([])).toEqual({ nodes: [], firstStep: null });
  });

  it('treats one dragged panel as making the whole flow explicit', () => {
    // Otherwise a half-derived graph would rearrange itself the moment it was edited.
    expect(isImplicitChain([{ id: 'a' }, { id: 'b', x: 5, y: 5 }])).toBe(false);
    expect(isImplicitChain([{ id: 'a' }, { id: 'b' }])).toBe(true);
    expect(isImplicitChain([{ id: 'a', resolve: 'b' }, { id: 'b' }])).toBe(false);
  });
});

describe('findFreeSpot', () => {
  it('places a new panel clear of the existing ones', () => {
    const nodes = [panel('a', 1, 1), panel('b', 18, 1)];

    const spot = findFreeSpot(nodes, nodes[0]!);

    expect(isInsideAnyPanel(nodes, new Vec(spot.x * GRID_SIZE, spot.y * GRID_SIZE))).toBe(false);
  });

  it('drops to another row once the first is full', () => {
    // One panel per candidate column, so the first row genuinely has no gap left.
    const row = Array.from({ length: 8 }, (_, index) =>
      panel(`p${index}`, 1 + index * (PANEL_WIDTH + 4), 1)
    );

    const spot = findFreeSpot(row, row[0]!);

    expect(spot.y).toBeGreaterThan(1);
  });
});

describe('buildArrows', () => {
  const nodes: DiagramNode[] = [
    { id: 'a', x: 18, y: 1, resolve: 'b', reject: null },
    { id: 'b', x: 35, y: 1, resolve: null, reject: null },
  ];

  it('draws the trigger edge as well as the step edges', () => {
    const arrows = buildArrows(nodes, 'a');

    expect(arrows.map((arrow) => arrow.id)).toContain(`${TRIGGER_ID}:resolve`);
    expect(arrows.find((arrow) => arrow.from === TRIGGER_ID)?.to).toBe('a');
  });

  it('gives every arrow a stable id, so a drag does not rebuild every path', () => {
    const ids = buildArrows(nodes, 'a').map((arrow) => arrow.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(buildArrows(nodes, 'a').map((arrow) => arrow.id)).toEqual(ids);
  });

  it('draws no stubs unless the flow is being edited', () => {
    expect(buildArrows(nodes, 'a').every((arrow) => !arrow.hint)).toBe(true);
  });

  it('offers the trigger a stub when the flow is empty, so there is somewhere to start', () => {
    const arrows = buildArrows([], null, { editing: true });

    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.hint).toBe(true);
    expect(arrows[0]!.kind).toBe('resolve');
  });

  it('never offers the trigger a failure branch — there is nothing before it to fail', () => {
    const arrows = buildArrows([], null, { editing: true, hovered: TRIGGER_ID });

    expect(arrows.some((arrow) => arrow.from === TRIGGER_ID && arrow.kind === 'reject')).toBe(
      false
    );
  });

  it('stubs only the hovered panel, or the canvas fills with dashes', () => {
    const arrows = buildArrows(nodes, 'a', { editing: true, hovered: 'b' });

    const hints = arrows.filter((arrow) => arrow.hint);

    expect(hints.every((arrow) => arrow.from === 'b' || arrow.from === TRIGGER_ID)).toBe(true);
    expect(hints.some((arrow) => arrow.from === 'b' && arrow.kind === 'reject')).toBe(true);
  });

  it('lets a dragged connector follow the pointer instead of its stored target', () => {
    const arrows = buildArrows(nodes, 'a', {
      dragging: { from: 'a', kind: 'resolve', x: 900, y: 400 },
    });

    const dragged = arrows.find((arrow) => arrow.id === 'a:resolve');

    expect(dragged?.to).toBeNull();
    // Ends a little short of the pointer, leaving room for the arrowhead.
    expect(dragged?.d).toContain('890 400');
  });

  it('hides stubs while a connector is being dragged', () => {
    const arrows = buildArrows(nodes, 'a', {
      editing: true,
      hovered: 'b',
      dragging: { from: 'a', kind: 'resolve', x: 500, y: 100 },
    });

    expect(arrows.some((arrow) => arrow.hint)).toBe(false);
  });

  it('routes an arrow between the right attachment points', () => {
    const [triggerArrow] = buildArrows(nodes, 'a');
    const start = attachPoint({ id: TRIGGER_ID, x: 1, y: 1 }, ATTACH.resolve);

    /*
     * Through `Vec` rather than interpolating the numbers: the attachment sits at a third of
     * the panel height, so `start.y` is 53.333…, and a hand-built string would compare
     * against the unrounded float while the path carries the rounded one.
     */
    expect(triggerArrow!.d.startsWith(`M ${new Vec(start.x + 4, start.y)}`)).toBe(true);
  });
});
