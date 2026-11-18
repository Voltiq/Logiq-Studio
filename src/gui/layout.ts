/*
 * Layouts, worked out the way Swing and JavaFX do, so the designer draws a panel (or the window) as it will look
 * when the program runs: Swing's FlowLayout, GridLayout and BorderLayout; JavaFX's VBox, HBox, FlowPane,
 * GridPane, BorderPane and StackPane. No layout places each component where its bounds say.
 */
import type { Box } from "./geometry";

export type FlowAlign = "left" | "center" | "right";
export type Region = "NORTH" | "SOUTH" | "EAST" | "WEST" | "CENTER";

export type Layout =
  /** Swing's FlowLayout; JavaFX's FlowPane has no gaps at its edges (`edges: false`). */
  | { kind: "flow"; align: FlowAlign; hgap: number; vgap: number; edges?: false }
  | { kind: "grid"; rows: number; cols: number; hgap: number; vgap: number }
  /** Swing's BorderLayout, JavaFX's BorderPane (no gaps). */
  | { kind: "border"; hgap: number; vgap: number }
  /** JavaFX: a column (VBox) or a row (HBox); `fill` stretches what can grow across it. */
  | { kind: "vbox"; spacing: number; fill: boolean }
  | { kind: "hbox"; spacing: number; fill: boolean }
  /** JavaFX: each column as wide and each row as high as what is in it. */
  | { kind: "gridpane"; hgap: number; vgap: number }
  /** JavaFX: all on top of each other, centred. */
  | { kind: "stack" };

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
    case "vbox":
    case "hbox":
      return { kind, spacing: 0, fill: true };
    case "gridpane":
      return { kind, hgap: 0, vgap: 0 };
    case "stack":
      return { kind };
  }
}

/** JavaFX's panes with their layout, as FXML names them (no layout: a Pane or AnchorPane). */
export const FX_PANES: { kind: LayoutKind; fx: string }[] = [
  { kind: "vbox", fx: "VBox" },
  { kind: "hbox", fx: "HBox" },
  { kind: "flow", fx: "FlowPane" },
  { kind: "gridpane", fx: "GridPane" },
  { kind: "border", fx: "BorderPane" },
  { kind: "stack", fx: "StackPane" },
];

/** A JavaFX pane's layout as made without settings. */
export function defaultFxLayout(kind: LayoutKind): Layout {
  if (kind === "flow") return { kind, align: "left", hgap: 0, vgap: 0, edges: false };
  return defaultLayout(kind);
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

/**
 * A component as a layout sees it: its name, its preferred size, its region (border layouts), its cell (GridPane),
 * and whether it can grow wider or higher than that (Swing stretches everything; in JavaFX a button keeps its size
 * while a text field fills a VBox's width).
 */
export interface Item {
  name: string;
  w: number;
  h: number;
  region?: Region;
  cell?: { row: number; col: number };
  growW?: boolean;
  growH?: boolean;
}

/** Where each item goes in a container of that size, relative to the container's corner. */
export function layoutItems(layout: Layout, size: { w: number; h: number }, items: Item[], ins: Insets = NO_INSETS): Map<string, Box> {
  const out = new Map<string, Box>();
  const W = Math.max(0, size.w - ins.left - ins.right);
  const H = Math.max(0, size.h - ins.top - ins.bottom);
  if (layout.kind === "flow") {
    // Rows from the top, wrapping when the next one doesn't fit; each row lined up and centred in its height.
    const { hgap, vgap } = layout;
    // Swing keeps a gap at the edges too; JavaFX only between.
    const edge = layout.edges === false ? 0 : 1;
    let y = ins.top + vgap * edge;
    let row: Item[] = [];
    let rowW = 0;
    let rowH = 0;
    const flush = () => {
      if (!row.length) return;
      const free = W - rowW;
      let x = ins.left + hgap * edge + (layout.align === "center" ? free / 2 : layout.align === "right" ? free : 0);
      for (const it of row) {
        out.set(it.name, { x: Math.round(x), y: Math.round(y + (rowH - it.h) / 2), w: it.w, h: it.h });
        x += it.w + hgap;
      }
      y += rowH + vgap;
    };
    for (const it of items) {
      // rowW counts the gaps: between them, and (in Swing) before the first and after the last.
      const need = (row.length ? rowW + hgap : 2 * hgap * edge) + it.w;
      if (row.length && need > W) {
        flush();
        row = [];
        rowW = 0;
        rowH = 0;
      }
      rowW = (row.length ? rowW + hgap : 2 * hgap * edge) + it.w;
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
  if (layout.kind === "vbox" || layout.kind === "hbox") {
    // One after another from the top left, each its preferred size; across, what can grow fills the box.
    const down = layout.kind === "vbox";
    let at = down ? ins.top : ins.left;
    for (const it of items) {
      const w = down && layout.fill && it.growW ? W : it.w;
      const h = !down && layout.fill && it.growH ? H : it.h;
      out.set(it.name, down ? { x: ins.left, y: at, w, h } : { x: at, y: ins.top, w, h });
      at += (down ? h : w) + layout.spacing;
    }
    return out;
  }
  if (layout.kind === "stack") {
    // On top of each other, each as big as it may be (up to the pane), centred.
    for (const it of items) {
      const w = it.growW ? W : Math.min(it.w, W || it.w);
      const h = it.growH ? H : Math.min(it.h, H || it.h);
      out.set(it.name, { x: Math.round(ins.left + (W - w) / 2), y: Math.round(ins.top + (H - h) / 2), w, h });
    }
    return out;
  }
  if (layout.kind === "gridpane") {
    // Each column as wide as its widest, each row as high as its highest; in its cell, from the top left.
    const cols: number[] = [];
    const rows: number[] = [];
    for (const it of items) {
      const { row, col } = it.cell ?? { row: 0, col: 0 };
      cols[col] = Math.max(cols[col] ?? 0, it.w);
      rows[row] = Math.max(rows[row] ?? 0, it.h);
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let c = 0, x = ins.left; c < cols.length; c++) {
      xs[c] = x;
      x += (cols[c] ?? 0) + layout.hgap;
    }
    for (let r = 0, y = ins.top; r < rows.length; r++) {
      ys[r] = y;
      y += (rows[r] ?? 0) + layout.vgap;
    }
    for (const it of items) {
      const { row, col } = it.cell ?? { row: 0, col: 0 };
      out.set(it.name, { x: xs[col], y: ys[row], w: it.growW ? cols[col] : it.w, h: it.growH ? rows[row] : it.h });
    }
    return out;
  }
  // Border layouts: north and south across, their preferred heights; west and east between, their widths; the
  // centre takes the rest. The last one added to a region is the one shown. In its region, what can't grow keeps
  // its size: at the top left (the right side's at the top right), the centre's in the middle.
  const { hgap, vgap } = layout;
  const at = new Map<Region, Item>();
  for (const it of items) at.set(it.region ?? "CENTER", it);
  let top = ins.top;
  let bottom = ins.top + H;
  let left = ins.left;
  let right = ins.left + W;
  const place = (it: Item, area: Box, where: "start" | "end" | "middle") => {
    const grows = (g: boolean | undefined) => g !== false;
    const w = grows(it.growW) ? area.w : Math.min(it.w, area.w);
    const h = grows(it.growH) ? area.h : Math.min(it.h, area.h);
    const x = where === "middle" ? area.x + (area.w - w) / 2 : where === "end" ? area.x + area.w - w : area.x;
    const y = where === "middle" ? area.y + (area.h - h) / 2 : area.y;
    out.set(it.name, { x: Math.round(x), y: Math.round(y), w, h });
  };
  const n = at.get("NORTH");
  if (n) {
    place(n, { x: left, y: top, w: right - left, h: n.h }, "start");
    top += n.h + vgap;
  }
  const s = at.get("SOUTH");
  if (s) {
    place(s, { x: left, y: bottom - s.h, w: right - left, h: s.h }, "start");
    bottom -= s.h + vgap;
  }
  const e = at.get("EAST");
  if (e) {
    place(e, { x: right - e.w, y: top, w: e.w, h: Math.max(0, bottom - top) }, "end");
    right -= e.w + hgap;
  }
  const w = at.get("WEST");
  if (w) {
    place(w, { x: left, y: top, w: w.w, h: Math.max(0, bottom - top) }, "start");
    left += w.w + hgap;
  }
  const c = at.get("CENTER");
  if (c) place(c, { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) }, "middle");
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

/**
 * Flow and grid: where in the order a point falls, among the boxes in their order (index to insert before). A
 * column (VBox) goes by the height only, a row (HBox) by the width.
 */
export function indexAt(boxes: Box[], x: number, y: number, along?: "down" | "across"): number {
  if (along) {
    const i = boxes.findIndex((b) => (along === "down" ? y < b.y + b.h / 2 : x < b.x + b.w / 2));
    return i < 0 ? boxes.length : i;
  }
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
    default:
      // JavaFX's panes have no Swing code.
      return "null";
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
