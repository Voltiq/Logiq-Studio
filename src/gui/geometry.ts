/*
 * Placing components: snapping to the edges and centres of the other
 * components and of the window (with guide lines to show it), else to the
 * grid; aligning and sizing several at once.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A guide line: vertical at x (from y1 to y2) or horizontal at y. */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

export function bounds(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bt = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bt - y };
}

/** The lines something can snap to along one axis: the others' edges and centres, and the window's. */
function lines(others: Box[], frame: { w: number; h: number }, axis: "x" | "y"): number[] {
  const out = axis === "x" ? [0, frame.w / 2, frame.w] : [0, frame.h / 2, frame.h];
  for (const o of others) {
    const [p, s] = axis === "x" ? [o.x, o.w] : [o.y, o.h];
    out.push(p, p + s / 2, p + s);
  }
  return out;
}

/** The nearest line to any of the points, within `threshold`: how far to move, and to where. */
function nearest(points: number[], targets: number[], threshold: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const p of points) {
    for (const t of targets) {
      const d = t - p;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    }
  }
  return best;
}

function guide(axis: "x" | "y", at: number, moved: Box, others: Box[], frame: { w: number; h: number }): Guide {
  // The line spans the moved box and the boxes it lines up with.
  const touching = others.filter((o) => (axis === "x" ? [o.x, o.x + o.w / 2, o.x + o.w] : [o.y, o.y + o.h / 2, o.y + o.h]).some((v) => Math.abs(v - at) < 0.5));
  const all = [moved, ...touching];
  if (axis === "x") {
    const from = touching.length ? Math.min(...all.map((b) => b.y)) : 0;
    const to = touching.length ? Math.max(...all.map((b) => b.y + b.h)) : frame.h;
    return { axis, at, from, to };
  }
  const from = touching.length ? Math.min(...all.map((b) => b.x)) : 0;
  const to = touching.length ? Math.max(...all.map((b) => b.x + b.w)) : frame.w;
  return { axis, at, from, to };
}

export interface SnapOptions {
  grid: number;
  /** Snap to other components and the window. */
  smart: boolean;
  threshold?: number;
}

/** Where a box being moved lands: lined up with something near, else on the grid. */
export function snapMove(box: Box, others: Box[], frame: { w: number; h: number }, o: SnapOptions): { box: Box; guides: Guide[] } {
  const th = o.threshold ?? 5;
  const out = { ...box };
  const guides: Guide[] = [];
  const g = Math.max(1, o.grid);
  const sx = o.smart ? nearest([box.x, box.x + box.w / 2, box.x + box.w], lines(others, frame, "x"), th) : null;
  out.x = sx ? box.x + sx.delta : Math.round(box.x / g) * g;
  const sy = o.smart ? nearest([box.y, box.y + box.h / 2, box.y + box.h], lines(others, frame, "y"), th) : null;
  out.y = sy ? box.y + sy.delta : Math.round(box.y / g) * g;
  if (sx) guides.push(guide("x", sx.at, out, others, frame));
  if (sy) guides.push(guide("y", sy.at, out, others, frame));
  return { box: out, guides };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** A box resized by dragging one of its handles by (dx, dy), with the moving edges snapped. */
export function snapResize(start: Box, handle: Handle, dx: number, dy: number, others: Box[], frame: { w: number; h: number }, o: SnapOptions, min = { w: 8, h: 8 }): { box: Box; guides: Guide[] } {
  const th = o.threshold ?? 5;
  const g = Math.max(1, o.grid);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const guides: Guide[] = [];
  const snap = (v: number, axis: "x" | "y") => {
    if (o.smart) {
      const s = nearest([v], lines(others, frame, axis), th);
      if (s) return { v: v + s.delta, at: s.at };
    }
    return { v: Math.round(v / g) * g, at: null as number | null };
  };
  const hits: { axis: "x" | "y"; at: number }[] = [];
  if (handle.includes("w")) {
    const s = snap(left + dx, "x");
    left = Math.min(s.v, right - min.w);
    if (s.at !== null) hits.push({ axis: "x", at: s.at });
  }
  if (handle.includes("e")) {
    const s = snap(right + dx, "x");
    right = Math.max(s.v, left + min.w);
    if (s.at !== null) hits.push({ axis: "x", at: s.at });
  }
  if (handle.includes("n")) {
    const s = snap(top + dy, "y");
    top = Math.min(s.v, bottom - min.h);
    if (s.at !== null) hits.push({ axis: "y", at: s.at });
  }
  if (handle.includes("s")) {
    const s = snap(bottom + dy, "y");
    bottom = Math.max(s.v, top + min.h);
    if (s.at !== null) hits.push({ axis: "y", at: s.at });
  }
  const box = { x: left, y: top, w: right - left, h: bottom - top };
  for (const h of hits) guides.push(guide(h.axis, h.at, box, others, frame));
  return { box, guides };
}

export type AlignKind = "left" | "right" | "top" | "bottom" | "centerX" | "centerY" | "sameWidth" | "sameHeight" | "spreadX" | "spreadY";

/** Aligns or sizes boxes against the first one (the one selected first), or spreads them evenly. */
export function align(boxes: Box[], kind: AlignKind): Box[] {
  if (boxes.length < 2) return boxes;
  const first = boxes[0];
  const all = bounds(boxes);
  switch (kind) {
    case "left":
      return boxes.map((b) => ({ ...b, x: first.x }));
    case "right":
      return boxes.map((b) => ({ ...b, x: first.x + first.w - b.w }));
    case "top":
      return boxes.map((b) => ({ ...b, y: first.y }));
    case "bottom":
      return boxes.map((b) => ({ ...b, y: first.y + first.h - b.h }));
    case "centerX":
      return boxes.map((b) => ({ ...b, x: Math.round(first.x + first.w / 2 - b.w / 2) }));
    case "centerY":
      return boxes.map((b) => ({ ...b, y: Math.round(first.y + first.h / 2 - b.h / 2) }));
    case "sameWidth":
      return boxes.map((b) => ({ ...b, w: first.w }));
    case "sameHeight":
      return boxes.map((b) => ({ ...b, h: first.h }));
    case "spreadX":
    case "spreadY": {
      // Equal gaps between them, the outer two staying where they are.
      const x = kind === "spreadX";
      const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => (x ? p.b.x - q.b.x : p.b.y - q.b.y));
      const total = order.reduce((n, p) => n + (x ? p.b.w : p.b.h), 0);
      const gap = ((x ? all.w : all.h) - total) / (boxes.length - 1);
      const out = [...boxes];
      let pos = x ? all.x : all.y;
      for (const p of order) {
        out[p.i] = x ? { ...p.b, x: Math.round(pos) } : { ...p.b, y: Math.round(pos) };
        pos += (x ? p.b.w : p.b.h) + gap;
      }
      return out;
    }
  }
}

/** Keeps a box inside the window (at least partly visible). */
export function clampInto(b: Box, frame: { w: number; h: number }): Box {
  return { ...b, x: Math.max(-b.w + 8, Math.min(frame.w - 8, b.x)), y: Math.max(-b.h + 8, Math.min(frame.h - 8, b.y)) };
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
