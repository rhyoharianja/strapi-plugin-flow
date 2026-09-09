import * as React from "react";
import { Box, Typography } from "@strapi/design-system";

import {
  ATTACH,
  GRID_SIZE,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  Vec,
  attachPoint,
} from "../../../shared/diagram/geometry";
import {
  TRIGGER_ID,
  TRIGGER_POSITION,
  buildArrows,
  type DiagramNode,
  type EdgeKind,
} from "../../../shared/diagram/graph";

/**
 * The flow, as a canvas you can rearrange.
 *
 * Two gestures, and they are deliberately different things:
 *
 * - **Drag a panel** to move it. Positions snap to the grid and are saved with the flow.
 * - **Drag a handle** (✓ success, ✗ failure) onto another panel to connect it. Drop on empty
 *   space to disconnect.
 *
 * What you cannot do is bend a connector by hand, and that is a decision rather than a gap.
 * Arrows are recomputed from panel positions on every render, so moving a panel re-routes
 * everything around whatever is now in its way. Stored waypoints would survive that move and
 * leave a line crossing straight through a panel, with nothing to say which bends had been
 * placed on purpose. The approach is the one Directus uses for its own flow editor, for the
 * same reason.
 *
 * The geometry — routing, obstacle avoidance, how an old array-ordered flow is read as a
 * graph — lives in `shared/diagram` and is unit-tested there. This file is the gestures and
 * the drawing.
 */

const PANEL_PX = PANEL_WIDTH * GRID_SIZE;
const PANEL_PY = PANEL_HEIGHT * GRID_SIZE;

/** How close a dropped connector has to land to count as hitting a panel. */
const SNAP_RADIUS = 90;

/** Room to the right and below the furthest panel, so there is somewhere to drag to. */
const CANVAS_MARGIN = 6;

export interface CanvasNode extends DiagramNode {
  /** Operation label, or the trigger's name. */
  title: string;
  subtitle?: string;
}

export interface FlowCanvasProps {
  nodes: CanvasNode[];
  firstStep: string | null;
  triggerTitle: string;
  triggerSubtitle?: string;
  selectedId: string | null;
  editing: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (from: string, kind: EdgeKind, to: string | null) => void;
}

/** Pointer position in canvas pixels, which is what the geometry works in. */
const toCanvasPoint = (element: HTMLElement, event: PointerEvent | React.PointerEvent): Vec => {
  const box = element.getBoundingClientRect();

  return new Vec(event.clientX - box.left, event.clientY - box.top);
};

type Drag =
  | { kind: "panel"; id: string; grabX: number; grabY: number; moved: boolean }
  | { kind: "edge"; id: string; edge: EdgeKind; at: Vec };

export const FlowCanvas = ({
  nodes,
  firstStep,
  triggerTitle,
  triggerSubtitle,
  selectedId,
  editing,
  onSelect,
  onMove,
  onConnect,
}: FlowCanvasProps) => {
  const surface = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);

  const trigger: CanvasNode = {
    id: TRIGGER_ID,
    ...TRIGGER_POSITION,
    resolve: firstStep,
    reject: null,
    title: triggerTitle,
    subtitle: triggerSubtitle,
  };

  const all = React.useMemo(() => [trigger, ...nodes], [nodes, firstStep, triggerTitle]);

  /*
   * Sized to the content plus a margin, so the container scrolls rather than clipping — and
   * so there is always empty grid to drag a panel into.
   */
  const size = React.useMemo(() => {
    const right = Math.max(...all.map((node) => node.x + PANEL_WIDTH), 20);
    const bottom = Math.max(...all.map((node) => node.y + PANEL_HEIGHT), 12);

    return {
      width: (right + CANVAS_MARGIN) * GRID_SIZE,
      height: (bottom + CANVAS_MARGIN) * GRID_SIZE,
    };
  }, [all]);

  const arrows = React.useMemo(
    () =>
      buildArrows(nodes, firstStep, {
        editing,
        hovered,
        dragging:
          drag?.kind === "edge"
            ? { from: drag.id, kind: drag.edge, x: drag.at.x, y: drag.at.y }
            : undefined,
      }),
    [nodes, firstStep, editing, hovered, drag]
  );

  /*
   * Live values for the window listeners, which are attached once per gesture and would
   * otherwise close over the render that started it.
   */
  const latest = React.useRef({ drag, all, onMove, onConnect });
  latest.current = { drag, all, onMove, onConnect };

  /** Set for one tick after a real drag, so the release does not also count as a click. */
  const draggedRecently = React.useRef(false);

  /**
   * The panel whose incoming attachment is nearest a dropped connector, if any is close.
   *
   * Reads the live node list rather than the one captured when the drag began: a panel can
   * be moved by something else mid-gesture, and dropping onto where it *used* to be would
   * connect the wrong operation.
   */
  const panelNear = (point: Vec, exclude: string): string | null => {
    let best: { id: string; distance: number } | null = null;

    for (const node of latest.current.all) {
      if (node.id === exclude || node.id === TRIGGER_ID) continue;

      const distance = point.to(attachPoint(node, ATTACH.in)).length();

      if (distance <= SNAP_RADIUS && (best === null || distance < best.distance)) {
        best = { id: node.id, distance };
      }
    }

    return best?.id ?? null;
  };

  /*
   * The gesture lives on the window, not on the canvas element, and this is the fix for a
   * real bug rather than a precaution.
   *
   * With the handlers on the canvas, a `pointerup` released outside it — over the drawer,
   * the page header, another window — never reached them, so `drag` stayed set. Nothing
   * checked that the button was still down either, so every subsequent mouse *move* kept
   * dragging the panel: it followed the cursor forever and no other panel could be clicked
   * again. Two independent mistakes with one symptom.
   *
   * Listening on the window means the release is always seen; `event.buttons === 0` is the
   * belt to that braces, ending a drag whose release was somehow still missed.
   */

  React.useEffect(() => {
    if (!drag) return;

    const onMoveEvent = (event: PointerEvent) => {
      const state = latest.current.drag;

      if (!state || !surface.current) return;

      // No button down means the release was missed; end the gesture rather than follow on.
      if (event.buttons === 0) {
        setDrag(null);
        return;
      }

      const point = toCanvasPoint(surface.current, event);

      if (state.kind === "edge") {
        setDrag({ ...state, at: point });
        return;
      }

      /*
       * Snapped to the grid as it moves, not on release: a panel that lands somewhere other
       * than where it was dropped feels broken, even when the final position is tidier.
       */
      const x = Math.max(0, Math.round((point.x - state.grabX) / GRID_SIZE));
      const y = Math.max(0, Math.round((point.y - state.grabY) / GRID_SIZE));

      const node = latest.current.all.find((candidate) => candidate.id === state.id);

      if (node && (node.x !== x || node.y !== y)) {
        latest.current.onMove(state.id, x, y);
        // Remembered so the click that follows a real drag does not also select the panel.
        setDrag({ ...state, moved: true });
      }
    };

    const onUpEvent = (event: PointerEvent) => {
      const state = latest.current.drag;

      if (state?.kind === "edge" && surface.current) {
        const point = toCanvasPoint(surface.current, event);

        // Dropping on empty space disconnects, which is the only way to remove an edge.
        latest.current.onConnect(state.id, state.edge, panelNear(point, state.id));
      }

      if (state?.kind === "panel" && state.moved) {
        // Swallow the click this release is about to produce.
        draggedRecently.current = true;
        window.setTimeout(() => {
          draggedRecently.current = false;
        }, 0);
      }

      setDrag(null);
    };

    window.addEventListener("pointermove", onMoveEvent);
    window.addEventListener("pointerup", onUpEvent);
    window.addEventListener("pointercancel", onUpEvent);

    return () => {
      window.removeEventListener("pointermove", onMoveEvent);
      window.removeEventListener("pointerup", onUpEvent);
      window.removeEventListener("pointercancel", onUpEvent);
    };
    // Only whether a drag is in progress matters; the values are read through the ref.
  }, [drag !== null]);

  const startPanelDrag = (node: CanvasNode) => (event: React.PointerEvent) => {
    // The trigger is the one fixed point on the canvas; everything hangs off it.
    if (!editing || node.id === TRIGGER_ID) return;
    if (event.button !== 0 || !surface.current) return;

    const point = toCanvasPoint(surface.current, event);

    setDrag({
      kind: "panel",
      id: node.id,
      // Remember where in the panel it was grabbed, so it does not jump under the cursor.
      grabX: point.x - node.x * GRID_SIZE,
      grabY: point.y - node.y * GRID_SIZE,
      moved: false,
    });
  };

  const startEdgeDrag = (node: CanvasNode, edge: EdgeKind) => (event: React.PointerEvent) => {
    if (!editing || !surface.current) return;
    if (event.button !== 0) return;

    // Otherwise the panel underneath starts moving as well.
    event.stopPropagation();

    setDrag({ kind: "edge", id: node.id, edge, at: attachPoint(node, ATTACH[edge]) });
  };

  return (
    <Box
      background="neutral100"
      hasRadius
      borderColor="neutral200"
      borderStyle="solid"
      borderWidth="1px"
      style={{ overflow: "auto", maxHeight: "60vh" }}
    >
      <div
        ref={surface}
        style={{
          position: "relative",
          width: size.width,
          height: size.height,
          // The grid is the affordance: it says positions are discrete before anything moves.
          backgroundImage:
            "radial-gradient(var(--neutral300, #c0c0cf) 1px, transparent 1px)",
          backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          cursor: drag?.kind === "panel" ? "grabbing" : "default",
          touchAction: "none",
        }}
      >
        <svg
          width={size.width}
          height={size.height}
          style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
        >
          {arrows.map((arrow) => (
            <path
              key={arrow.id}
              d={arrow.d}
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={arrow.hint ? "4 4" : undefined}
              stroke={
                arrow.kind === "reject"
                  ? "var(--danger600, #d02b20)"
                  : "var(--primary600, #4945ff)"
              }
              opacity={arrow.hint ? 0.45 : 1}
            />
          ))}
        </svg>

        {all.map((node) => {
          const isTrigger = node.id === TRIGGER_ID;

          return (
            <div
              key={node.id}
              onPointerDown={startPanelDrag(node)}
              onPointerEnter={() => setHovered(node.id)}
              onPointerLeave={() => setHovered((current) => (current === node.id ? null : current))}
              style={{
                position: "absolute",
                left: node.x * GRID_SIZE,
                top: node.y * GRID_SIZE,
                width: PANEL_PX,
                height: PANEL_PY,
                cursor: editing && !isTrigger ? "grab" : "default",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (draggedRecently.current) return;
                  onSelect(node.id);
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: isTrigger
                    ? "var(--secondary100, #eaf5ff)"
                    : "var(--neutral0, #ffffff)",
                  border: `${selectedId === node.id ? 2 : 1}px solid ${
                    selectedId === node.id
                      ? "var(--primary600, #4945ff)"
                      : isTrigger
                        ? "var(--secondary600, #66b7f1)"
                        : "var(--neutral200, #dcdce4)"
                  }`,
                  boxShadow:
                    selectedId === node.id ? "0 0 0 3px var(--primary100, #f0f0ff)" : "none",
                  cursor: "inherit",
                  overflow: "hidden",
                }}
              >
                <Typography variant="pi" fontWeight="bold" ellipsis>
                  {node.title}
                </Typography>
                {node.subtitle ? (
                  <Box paddingTop={1}>
                    <Typography variant="pi" textColor="neutral600" ellipsis>
                      {node.subtitle}
                    </Typography>
                  </Box>
                ) : null}
              </button>

              {editing
                ? (["resolve", "reject"] as const)
                    // Nothing runs before the trigger, so it has no failure branch.
                    .filter((edge) => !(isTrigger && edge === "reject"))
                    .map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        aria-label={
                          edge === "resolve"
                            ? `Connect ${node.title} on success`
                            : `Connect ${node.title} on failure`
                        }
                        title={edge === "resolve" ? "On success" : "On failure"}
                        onPointerDown={startEdgeDrag(node, edge)}
                        style={{
                          position: "absolute",
                          left: ATTACH[edge].x - 9,
                          top: ATTACH[edge].y - 9,
                          width: 18,
                          height: 18,
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "50%",
                          border: "2px solid var(--neutral0, #ffffff)",
                          background:
                            edge === "resolve"
                              ? "var(--primary600, #4945ff)"
                              : "var(--danger600, #d02b20)",
                          color: "#fff",
                          fontSize: 10,
                          lineHeight: 1,
                          cursor: "crosshair",
                        }}
                      >
                        {edge === "resolve" ? "✓" : "✗"}
                      </button>
                    ))
                : null}
            </div>
          );
        })}
      </div>
    </Box>
  );
};
