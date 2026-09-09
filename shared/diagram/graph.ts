import {
  ATTACH,
  GRID_SIZE,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  Vec,
  attachPoint,
  type PanelBox,
} from './geometry';
import { routeConnector } from './routing';

/**
 * The flow as a graph, and the arrows drawn for it.
 *
 * A flow used to be a strictly ordered array: the engine ran `steps[0]`, then `steps[1]`, and
 * stopped at the first failure. The canvas needs more than that — a panel can be placed
 * anywhere and can branch on success or failure — so a step now carries a position and two
 * outgoing edges.
 *
 * **Old flows keep working, and that is the point of `toGraph`.** A flow saved before the
 * canvas existed has no positions and no edges at all, so it is read as the chain it was:
 * each step resolves to the next in the array. Nothing has to be migrated, and a flow only
 * gains explicit edges the first time someone drags one.
 */

/** The trigger is drawn as a panel but is not a step, so it needs a reserved id. */
export const TRIGGER_ID = '$trigger';

/** What either kind of outgoing edge means. */
export type EdgeKind = 'resolve' | 'reject';

/** A step's canvas position and outgoing edges, as stored on the flow. */
export interface StepGraph {
  /** Grid units. Absent on flows saved before the canvas existed. */
  x?: number;
  y?: number;
  /** Step id to run on success. */
  resolve?: string | null;
  /** Step id to run on failure. Without one, a failure ends the run. */
  reject?: string | null;
}

export interface GraphStep extends StepGraph {
  id: string;
}

/** A node as the canvas draws it: a resolved position and resolved edges. */
export interface DiagramNode extends PanelBox {
  resolve: string | null;
  reject: string | null;
}

export interface Graph {
  nodes: DiagramNode[];
  /** The step the trigger runs first, or null for an empty flow. */
  firstStep: string | null;
}

/** Where the trigger panel sits. Fixed, because it is the one thing that cannot be moved. */
export const TRIGGER_POSITION = { x: 1, y: 1 } as const;

/** Horizontal and vertical stride when laying out a flow that has never been positioned. */
const STRIDE_X = PANEL_WIDTH + 4;
const STRIDE_Y = PANEL_HEIGHT + 3;

/**
 * Whether this flow predates the canvas.
 *
 * True only when *nothing* has been positioned or linked. A single dragged panel or edge
 * makes the flow explicit, and from then on its stored shape is taken at face value — a
 * half-derived, half-explicit graph would rearrange itself as soon as it was edited.
 */
export const isImplicitChain = (steps: GraphStep[]): boolean =>
  steps.every(
    (step) =>
      step.x === undefined &&
      step.y === undefined &&
      (step.resolve === undefined || step.resolve === null) &&
      (step.reject === undefined || step.reject === null)
  );

/**
 * Resolve a flow's steps into a graph the canvas can draw and the engine can walk.
 *
 * `firstStep` is given explicitly by flows that have been edited on the canvas, because the
 * trigger's own edge is a real edge — deleting the first panel should not silently promote
 * whichever step happens to be next in the array.
 */
export const toGraph = (steps: GraphStep[], firstStep?: string | null): Graph => {
  if (steps.length === 0) return { nodes: [], firstStep: null };

  if (isImplicitChain(steps)) {
    return {
      nodes: steps.map((step, index) => ({
        id: step.id,
        x: TRIGGER_POSITION.x + (index + 1) * STRIDE_X,
        y: TRIGGER_POSITION.y,
        resolve: steps[index + 1]?.id ?? null,
        reject: null,
      })),
      firstStep: steps[0]!.id,
    };
  }

  const known = new Set(steps.map((step) => step.id));

  /** An edge to a step that no longer exists is dropped rather than drawn into nothing. */
  const edge = (target: string | null | undefined): string | null =>
    target && known.has(target) ? target : null;

  const nodes = steps.map((step, index) => ({
    id: step.id,
    // A step added by something other than the canvas still needs somewhere to go.
    x: step.x ?? TRIGGER_POSITION.x + (index + 1) * STRIDE_X,
    y: step.y ?? TRIGGER_POSITION.y,
    resolve: edge(step.resolve),
    reject: edge(step.reject),
  }));

  return { nodes, firstStep: edge(firstStep) ?? null };
};

/**
 * Somewhere to put a new panel so it does not land on an existing one.
 *
 * Walks right from the parent, then down, taking the first free cell. Placing it on top of
 * another panel and leaving the user to discover the overlap is the alternative.
 */
export const findFreeSpot = (
  nodes: PanelBox[],
  near: PanelBox = TRIGGER_POSITION as PanelBox
): { x: number; y: number } => {
  const taken = (x: number, y: number) =>
    nodes.some((node) => Math.abs(node.x - x) < PANEL_WIDTH && Math.abs(node.y - y) < PANEL_HEIGHT);

  for (let row = 0; row < 40; row += 1) {
    const y = near.y + row * STRIDE_Y;

    for (let column = 1; column < 8; column += 1) {
      const x = near.x + column * STRIDE_X;

      if (!taken(x, y)) return { x, y };
    }
  }

  return { x: near.x + STRIDE_X, y: near.y + STRIDE_Y };
};

/** One drawn connector. */
export interface Arrow {
  /** Stable across renders, so React does not rebuild every path on a drag. */
  id: string;
  d: string;
  kind: EdgeKind;
  from: string;
  to: string | null;
  /** A dashed stub inviting a connection, rather than a real edge. */
  hint?: boolean;
}

export interface ArrowOptions {
  /** Where the connector being dragged currently ends, in pixels. */
  dragging?: { from: string; kind: EdgeKind; x: number; y: number };
  /** Panel under the pointer, which gets stub arrows so its handles are discoverable. */
  hovered?: string | null;
  /** Stubs are only worth drawing while the flow is being edited. */
  editing?: boolean;
}

/**
 * Build every connector for the canvas.
 *
 * Arrows are derived here on each render rather than stored. That is what keeps a diagram
 * honest: move a panel and its connectors re-route around whatever is now in the way, with
 * no stale waypoints to reconcile.
 */
export const buildArrows = (
  nodes: DiagramNode[],
  firstStep: string | null,
  options: ArrowOptions = {}
): Arrow[] => {
  const { dragging, hovered, editing = false } = options;

  const trigger: DiagramNode = {
    id: TRIGGER_ID,
    ...TRIGGER_POSITION,
    resolve: firstStep,
    reject: null,
  };

  const all = [trigger, ...nodes];
  const boxes: PanelBox[] = all;
  const byId = new Map(all.map((node) => [node.id, node]));

  const arrows: Arrow[] = [];

  const push = (node: DiagramNode, kind: EdgeKind) => {
    const origin = attachPoint(node, ATTACH[kind]);

    // A connector being dragged follows the pointer, so it must win over the stored edge.
    if (dragging && dragging.from === node.id && dragging.kind === kind) {
      arrows.push({
        id: `${node.id}:${kind}`,
        d: routeConnector(boxes, origin, new Vec(dragging.x, dragging.y)),
        kind,
        from: node.id,
        to: null,
      });

      return;
    }

    const targetId = node[kind];
    const target = targetId ? byId.get(targetId) : undefined;

    if (target) {
      arrows.push({
        id: `${node.id}:${kind}`,
        d: routeConnector(boxes, origin, attachPoint(target, ATTACH.in)),
        kind,
        from: node.id,
        to: target.id,
      });

      return;
    }

    /*
     * A stub, so an unconnected handle is visible before it is grabbed. Shown for the
     * trigger always — an empty flow needs somewhere to start — and otherwise only for the
     * panel under the pointer, or the canvas fills with dashes.
     */
    const worthHinting = editing && !dragging && (node.id === TRIGGER_ID || hovered === node.id);

    // The trigger has no failure branch: there is nothing before it to fail.
    if (worthHinting && !(node.id === TRIGGER_ID && kind === 'reject')) {
      arrows.push({
        id: `${node.id}:${kind}:hint`,
        d: routeConnector(boxes, origin, new Vec(origin.x + 3 * GRID_SIZE, origin.y)),
        kind,
        from: node.id,
        to: null,
        hint: true,
      });
    }
  };

  for (const node of all) {
    push(node, 'resolve');
    push(node, 'reject');
  }

  return arrows;
};
