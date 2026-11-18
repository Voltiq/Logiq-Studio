/*
 * Swing's layout managers, worked out the way Swing does, so the designer draws a panel (or the window) with a
 * FlowLayout, GridLayout or BorderLayout as it will look when the program runs. No layout ("null") places each
 * component where its setBounds says.
 */
import type { Box } from "./geometry";

export type FlowAlign = "left" | "center" | "right";
export type Region = "NORTH" | "SOUTH" | "EAST" | "WEST" | "CENTER";

export type Layout =
  | { kind: "flow"; align: FlowAlign; hgap: number; vgap: number }
  | { kind: "grid"; rows: number; cols: number; hgap: number; vgap: number }
  | { kind: "border"; hgap: number; vgap: number };

export type LayoutKind = Layout["kind"];

export const REGIONS: Region[] = ["NORTH", "WEST", "CENTER", "EAST", "SOUTH"];

/** What Swing's constructors without arguments give. */
export function defaultLayout(kind: LayoutKind): Layout {
  switch (kind) {
    case "flow":
      return { kind, align: "center", hgap: 5, vgap: 5 };
    case "grid":
      return { kind, rows: 2, cols: 2, hgap: 0, vgap: 0 };
    case "border":
      return { kind, hgap: 0, vgap: 0 };
  }
}

/** The room inside a container's border: a titled border takes some at the top and the sides. */
export interface Insets {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export const NO_INSETS: Insets = { top: 0, left: 0, bottom: 0, right: 0 };
/** About what Windows' TitledBorder takes, with the designer's 12 px text. */
export const TITLED_INSETS: Insets = { top: 20, left: 7, bottom: 7, right: 7 };

/** A component as a layout sees it: its name, its preferred size, its region (BorderLayout). */
export interface Item {
  name: string;
  w: number;
  h: number;
  region?: Region;
}

/** Where each item goes in a container of that size, relative to the container's corner. */
export function layoutItems(layout: Layout, size: { w: number; h: number }, items: Item[], ins: Insets = NO_INSETS): Map<string, Box> {
  const out = new Map<string, Box>();
  const W = Math.max(0, size.w - ins.left - ins.right);
  const H = Math.max(0, size.h - ins.top - ins.bottom);
  if (layout.kind === "flow") {
    // Rows from the top, wrapping when the next one doesn't fit; each row lined up and centred in its height.
    const { hgap, vgap } = layout;
    let y = ins.top + vgap;
    let row: Item[] = [];
    let rowW = 0;
    let rowH = 0;
    const flush = () => {
      if (!row.length) return;
      const free = W - rowW;
      let x = ins.left + hgap + (layout.align === "center" ? free / 2 : layout.align === "right" ? free : 0);
      for (const it of row) {
        out.set(it.name, { x: Math.round(x), y: Math.round(y + (rowH - it.h) / 2), w: it.w, h: it.h });
        x += it.w + hgap;
      }
      y += rowH + vgap;
    };
    for (const it of items) {
      // rowW counts the gaps: hgap before each and after the last.
      const need = (row.length ? rowW : hgap) + it.w + hgap;
      if (row.length && need > W) {
        flush();
        row = [];
        rowW = 0;
        rowH = 0;
      }
      rowW = (row.length ? rowW : hgap) + it.w + hgap;
      rowH = Math.max(rowH, it.h);
      row.push(it);
    }
    flush();
    return out;
  }
  if (layout.kind === "grid") {
    // Rows win over columns when both are given, as in Swing.
    const n = items.length;
    if (!n) return out;
    const rows = layout.rows > 0 ? layout.rows : Math.ceil(n / Math.max(1, layout.cols));
    const cols = layout.rows > 0 ? Math.ceil(n / rows) : Math.max(1, layout.cols);
    const { hgap, vgap } = layout;
    const cw = Math.floor((W - (cols - 1) * hgap) / cols);
    const ch = Math.floor((H - (rows - 1) * vgap) / rows);
    // What doesn't divide evenly is shared out on both sides.
    const ox = ins.left + Math.floor((W - (cw * cols + (cols - 1) * hgap)) / 2);
    const oy = ins.top + Math.floor((H - (ch * rows + (rows - 1) * vgap)) / 2);
    items.forEach((it, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      out.set(it.name, { x: ox + c * (cw + hgap), y: oy + r * (ch + vgap), w: Math.max(0, cw), h: Math.max(0, ch) });
    });
    return out;
  }
  // BorderLayout: north and south across, their preferred heights; west and east between, their widths; the
  // centre takes the rest. The last one added to a region is the one shown.
  const { hgap, vgap } = layout;
  const at = new Map<Region, Item>();
  for (const it of items) at.set(it.region ?? "CENTER", it);
  let top = ins.top;
  let bottom = ins.top + H;
  let left = ins.left;
  let right = ins.left + W;
  const n = at.get("NORTH");
  if (n) {
    out.set(n.name, { x: left, y: top, w: right - left, h: n.h });
    top += n.h + vgap;
  }
  const s = at.get("SOUTH");
  if (s) {
    out.set(s.name, { x: left, y: bottom - s.h, w: right - left, h: s.h });
    bottom -= s.h + vgap;
  }
  const e = at.get("EAST");
  if (e) {
    out.set(e.name, { x: right - e.w, y: top, w: e.w, h: Math.max(0, bottom - top) });
    right -= e.w + hgap;
  }
  const w = at.get("WEST");
  if (w) {
    out.set(w.name, { x: left, y: top, w: w.w, h: Math.max(0, bottom - top) });
    left += w.w + hgap;
  }
  const c = at.get("CENTER");
  if (c) out.set(c.name, { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) });
  return out;
}

/** BorderLayout: the region a point (relative to the container) is nearest to, by the container's fifths. */
export function regionAt(size: { w: number; h: number }, x: number, y: number): Region {
  const fx = x / Math.max(1, size.w);
  const fy = y / Math.max(1, size.h);
  if (fy < 0.25) return "NORTH";
  if (fy > 0.75) return "SOUTH";
  if (fx < 0.25) return "WEST";
  if (fx > 0.75) return "EAST";
  return "CENTER";
}

/** Flow and grid: where in the order a point falls, among the boxes in their order (index to insert before). */
export function indexAt(boxes: Box[], x: number, y: number): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    // Above this one's row, or in its row and left of its middle.
    if (y < b.y) return i;
    if (y < b.y + b.h && x < b.x + b.w / 2) return i;
  }
  return boxes.length;
}

/** The Java that makes the layout. */
export function layoutCode(l: Layout): string {
  switch (l.kind) {
    case "flow":
      return `new FlowLayout(FlowLayout.${l.align.toUpperCase()}, ${l.hgap}, ${l.vgap})`;
    case "grid":
      return `new GridLayout(${l.rows}, ${l.cols}, ${l.hgap}, ${l.vgap})`;
    case "border":
      return `new BorderLayout(${l.hgap}, ${l.vgap})`;
  }
}

/** Reads `new FlowLayout(…)`, `new GridLayout(…)` or `new BorderLayout(…)` (white space removed); null for anything else. */
export function parseLayout(s: string): Layout | null {
  let m = /^new (?:java\.awt\.)?FlowLayout\((.*)\)$/.exec(s);
  if (m) {
    const args = m[1] ? m[1].split(",") : [];
    const al = /^(?:FlowLayout\.)?(LEFT|CENTER|RIGHT|LEADING|TRAILING)$/.exec(args[0] ?? "CENTER");
    if (!al || args.length === 2 || args.length > 3 || !args.slice(1).every((a) => /^\d+$/.test(a))) return null;
    const align: FlowAlign = al[1] === "LEFT" || al[1] === "LEADING" ? "left" : al[1] === "RIGHT" || al[1] === "TRAILING" ? "right" : "center";
    return { kind: "flow", align, hgap: args[1] ? +args[1] : 5, vgap: args[2] ? +args[2] : 5 };
  }
  m = /^new (?:java\.awt\.)?GridLayout\((\d+),(\d+)(?:,(\d+),(\d+))?\)$/.exec(s);
  if (m) return { kind: "grid", rows: +m[1], cols: +m[2], hgap: m[3] ? +m[3] : 0, vgap: m[4] ? +m[4] : 0 };
  if (/^new (?:java\.awt\.)?GridLayout\(\)$/.test(s)) return { kind: "grid", rows: 1, cols: 0, hgap: 0, vgap: 0 };
  m = /^new (?:java\.awt\.)?BorderLayout\((?:(\d+),(\d+))?\)$/.exec(s);
  if (m) return { kind: "border", hgap: m[1] ? +m[1] : 0, vgap: m[2] ? +m[2] : 0 };
  return null;
}

/** Reads a BorderLayout constraint: `BorderLayout.NORTH` or `"North"`. */
export function parseRegion(s: string): Region | null {
  const m = /^(?:BorderLayout\.)?(NORTH|SOUTH|EAST|WEST|CENTER)$/.exec(s) ?? /^"(North|South|East|West|Center)"$/.exec(s);
  return m ? (m[1].toUpperCase() as Region) : null;
}
