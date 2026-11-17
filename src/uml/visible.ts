/*
 * What of a large diagram is on screen. A diagram with hundreds of classes
 * draws only the boxes in view (plus a margin, so panning doesn't show
 * gaps) and the lines that touch them or cross the view.
 */
import type { Point, Positions, UmlNode } from "./diagram";

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

/** Diagrams up to this size are drawn whole; culling only pays for itself above it. */
export const CULL_ABOVE = 80;

/** The part of the diagram (in diagram coordinates) that the stage shows, with a margin around it. */
export function viewRect(view: Viewport, stage: { w: number; h: number }, margin = 240) {
  return { x0: (-view.x - margin) / view.k, y0: (-view.y - margin) / view.k, x1: (stage.w - view.x + margin) / view.k, y1: (stage.h - view.y + margin) / view.k };
}

/** The ids of the boxes that are in view. */
export function visibleNodes(nodes: UmlNode[], positions: Positions, view: Viewport, stage: { w: number; h: number }, margin = 240): Set<string> {
  const r = viewRect(view, stage, margin);
  const out = new Set<string>();
  for (const n of nodes) {
    const p = positions[n.id];
    if (p && p.x < r.x1 && p.x + n.w > r.x0 && p.y < r.y1 && p.y + n.h > r.y0) out.add(n.id);
  }
  return out;
}

/** Whether a line is worth drawing: it ends at a box in view, or it passes through the view. */
export function lineInView(points: Point[], from: string, to: string, shown: Set<string>, view: Viewport, stage: { w: number; h: number }): boolean {
  if (shown.has(from) || shown.has(to)) return true;
  const r = viewRect(view, stage, 0);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0;
}
