/*
 * Components inside panels. A component's `parent` is the panel it is added to; its x and y are relative to that
 * panel, as `setBounds` is in Swing. The designer works in window coordinates and converts at the edges.
 */
import type { Box } from "./geometry";
import { FX_GROW, type GuiComponent, type GuiForm } from "./model";
import { NO_INSETS, TITLED_INSETS, indexAt, layoutItems, regionAt, type Insets, type Item, type Layout, type Region } from "./layout";

export const isContainer = (c: GuiComponent | undefined) => c?.type === "JPanel";

/** The chain of panels a component is in, nearest first (a loop in hand-written code is cut). */
export function ancestors(form: GuiForm, c: GuiComponent): GuiComponent[] {
  const out: GuiComponent[] = [];
  const seen = new Set([c.name]);
  let p = c.parent ? form.components.find((x) => x.name === c.parent) : undefined;
  while (p && isContainer(p) && !seen.has(p.name)) {
    out.push(p);
    seen.add(p.name);
    p = p.parent ? form.components.find((x) => x.name === p!.parent) : undefined;
  }
  return out;
}

/** Where a component's panel starts in the window. */
export function originOf(form: GuiForm, c: GuiComponent): { x: number; y: number } {
  // Along the chain of panels (cut at a loop), each placed in the next.
  return ancestors(form, c).reduce((o, p) => {
    const r = relBox(form, p);
    return { x: o.x + r.x, y: o.y + r.y };
  }, { x: 0, y: 0 });
}

/** A component's box in window coordinates: where its bounds say, or where its panel's layout puts it. */
export function absBox(form: GuiForm, c: GuiComponent): Box {
  const o = originOf(form, c);
  const r = relBox(form, c);
  return { x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h };
}

/** The layout of a panel, or of the window (null); undefined: none, each where its bounds say. */
export function layoutOf(form: GuiForm, container: string | null): Layout | undefined {
  if (container === null) return form.layout;
  const c = form.components.find((x) => x.name === container);
  return isContainer(c) ? c!.layout : undefined;
}

/** The room a container's border takes. */
export function insetsOf(form: GuiForm, container: string | null): Insets {
  const c = container === null ? undefined : form.components.find((x) => x.name === container);
  if (form.toolkit === "fx") return (container === null ? form.padding : c?.padding) ?? NO_INSETS;
  return c?.border ? TITLED_INSETS : NO_INSETS;
}

/** A component as its container's layout sees it (in Swing everything can be stretched). */
function itemOf(form: GuiForm, k: GuiComponent): Item {
  const grow = form.toolkit === "fx" ? FX_GROW[k.type] : { w: true, h: true };
  return { name: k.name, w: k.w, h: k.h, region: k.region, cell: k.cell, growW: grow.w, growH: grow.h };
}

/**
 * Where a laid-out container's components go, relative to it (null when it has no layout). `size` is the
 * container's, its own by default (the designer passes the size it is being dragged to). A component another one
 * in the same BorderLayout region hides gets no size.
 */
export function childBoxes(form: GuiForm, container: string | null, size?: { w: number; h: number }, depth = 0): Map<string, Box> | null {
  const layout = layoutOf(form, container);
  if (!layout) return null;
  // A panel is as big as its own panel's layout makes it (a loop in hand-written code stops somewhere).
  const own = container === null ? { w: form.width, h: form.height } : depth > 40 ? form.components.find((x) => x.name === container)! : relBox(form, form.components.find((x) => x.name === container)!, depth + 1);
  const kids = childrenOf(form, container);
  const boxes = layoutItems(layout, size ?? { w: own.w, h: own.h }, kids.map((k) => itemOf(form, k)), insetsOf(form, container));
  for (const k of kids) if (!boxes.has(k.name)) boxes.set(k.name, { x: 0, y: 0, w: 0, h: 0 });
  return boxes;
}

/** A component's box relative to its panel (or the window). */
export function relBox(form: GuiForm, c: GuiComponent, depth = 0): Box {
  const laid = depth > 40 ? undefined : childBoxes(form, parentOf(form, c) ?? null, undefined, depth + 1)?.get(c.name);
  return laid ?? { x: c.x, y: c.y, w: c.w, h: c.h };
}

/**
 * Puts a component at a place in its container's order (what flow and grid layouts go by): before the sibling
 * now at `index`, or after the last.
 */
export function placeInOrder(form: GuiForm, c: GuiComponent, index: number) {
  const list = form.components;
  list.splice(list.indexOf(c), 1);
  const siblings = childrenOf(form, parentOf(form, c) ?? null).filter((x) => x !== c);
  if (!siblings.length) list.push(c);
  else if (index < siblings.length) list.splice(list.indexOf(siblings[Math.max(0, index)]), 0, c);
  else list.splice(list.indexOf(siblings[siblings.length - 1]) + 1, 0, c);
}

/** The first BorderLayout region of a container nobody is in (but those left out), centre first. */
function freeRegion(form: GuiForm, container: string | null, except: GuiComponent[], also: Region[] = []): Region | undefined {
  const taken = new Set([...childrenOf(form, container).filter((k) => !except.includes(k)).map((k) => k.region ?? "CENTER"), ...also]);
  return (["CENTER", "NORTH", "SOUTH", "WEST", "EAST"] as Region[]).find((r) => !taken.has(r));
}

/**
 * Puts components into a container where they were dropped (`at`, in window coordinates; each one's `abs` is
 * where it was let go). Without a layout each stays where it was let go; in a flow or grid it goes into the order
 * where the pointer is; in a border layout the first goes to the region under the pointer. Whoever was in that
 * region moves to the region the component came from (in the same container), or to a free one.
 */
export function dropInto(form: GuiForm, moves: { name: string; abs: { x: number; y: number } }[], into: string | null, at: { x: number; y: number }) {
  const layout = layoutOf(form, into);
  const moving = moves.map((m) => form.components.find((c) => c.name === m.name)).filter((c): c is GuiComponent => !!c);
  const siblings = childrenOf(form, into).filter((c) => !moving.includes(c));
  const index = layout && layout.kind !== "border" && layout.kind !== "gridpane" ? indexAt(siblings.map((s) => absBox(form, s)), at.x, at.y, alongOf(layout)) : 0;
  const cb = into === null ? { x: 0, y: 0, w: form.width, h: form.height } : absBox(form, form.components.find((c) => c.name === into)!);
  const pointed = layout?.kind === "border" ? regionAt(cb, at.x - cb.x, at.y - cb.y) : undefined;
  const cell = layout?.kind === "gridpane" ? cellAt(form, into, at, moving) : undefined;
  moving.forEach((c, i) => {
    const from = parentOf(form, c) ?? null;
    const was = c.region ?? "CENTER";
    moveInto(form, c, into, moves[i].abs);
    if (layout?.kind !== "gridpane") delete c.cell;
    if (!layout) delete c.region;
    else if (layout.kind === "gridpane") {
      // The cell under the pointer; more than one: the next ones below it.
      delete c.region;
      c.cell = { row: cell!.row + i, col: cell!.col };
    } else if (layout.kind === "border") {
      const want = i === 0 ? pointed! : (freeRegion(form, into, [c]) ?? "CENTER");
      const holder = childrenOf(form, into).find((s) => s !== c && (s.region ?? "CENTER") === want);
      if (holder) {
        const instead = from === into && was !== want ? was : freeRegion(form, into, [holder, c], [want]);
        if (instead) holder.region = instead;
      }
      c.region = want;
    } else {
      delete c.region;
      placeInOrder(form, c, index + i);
    }
  });
}

/**
 * Gives a container a layout (or none), so nothing jumps: going to none, each one keeps where the layout had it;
 * to a flow or grid, they are ordered as they read (top to bottom, left to right); to a border layout, each goes
 * to the region it is nearest.
 */
export function setLayout(form: GuiForm, container: string | null, layout: Layout | undefined) {
  const kids = childrenOf(form, container);
  const before = new Map(kids.map((k) => [k.name, relBox(form, k)]));
  const own = container === null ? null : form.components.find((x) => x.name === container);
  if (container === null) form.layout = layout;
  else if (own) {
    if (layout) own.layout = layout;
    else delete own.layout;
  }
  const size = own ? { w: own.w, h: own.h } : { w: form.width, h: form.height };
  if (layout?.kind !== "gridpane") for (const k of kids) delete k.cell;
  if (!layout) {
    for (const k of kids) {
      const b = before.get(k.name)!;
      if (b.w && b.h) Object.assign(k, b);
      delete k.region;
    }
    return;
  }
  if (layout.kind === "gridpane") {
    // Rows from the top, a new one where the next starts below the last one's middle; columns left to right.
    for (const k of kids) delete k.region;
    const byY = [...kids].sort((a, b) => before.get(a.name)!.y - before.get(b.name)!.y);
    const rows: GuiComponent[][] = [];
    let bottom = -Infinity;
    for (const k of byY) {
      const b = before.get(k.name)!;
      if (!rows.length || b.y >= bottom) {
        rows.push([]);
        bottom = b.y + b.h / 2;
      }
      rows[rows.length - 1].push(k);
    }
    rows.forEach((r, row) => r.sort((a, b) => before.get(a.name)!.x - before.get(b.name)!.x).forEach((k, col) => (k.cell = { row, col })));
    return;
  }
  if (layout.kind === "vbox" || layout.kind === "hbox") {
    for (const k of kids) delete k.region;
    const key = (k: GuiComponent) => (layout.kind === "vbox" ? before.get(k.name)!.y : before.get(k.name)!.x);
    [...kids].sort((a, b) => key(a) - key(b)).forEach((k, i) => placeInOrder(form, k, i));
    return;
  }
  if (layout.kind === "stack") {
    for (const k of kids) delete k.region;
    return;
  }
  if (layout.kind === "border") {
    // Each to the region it is nearest; when that is taken, to a free one (a sixth one would be hidden).
    const used = new Set<Region>();
    const later: GuiComponent[] = [];
    for (const k of kids) {
      const b = before.get(k.name)!;
      const r = regionAt(size, b.x + b.w / 2, b.y + b.h / 2);
      if (used.has(r)) later.push(k);
      else {
        k.region = r;
        used.add(r);
      }
    }
    for (const k of later) {
      const free = (["CENTER", "NORTH", "SOUTH", "WEST", "EAST"] as Region[]).find((r) => !used.has(r));
      k.region = free ?? "CENTER";
      if (free) used.add(free);
    }
  } else {
    for (const k of kids) delete k.region;
    const reading = [...kids].sort((a, b) => {
      const p = before.get(a.name)!;
      const q = before.get(b.name)!;
      return Math.abs(p.y - q.y) > Math.min(p.h, q.h) / 2 ? p.y - q.y : p.x - q.x;
    });
    reading.forEach((k, i) => placeInOrder(form, k, i));
  }
}

/** A column or a row goes by one direction when something is dropped into it. */
function alongOf(layout: Layout): "down" | "across" | undefined {
  return layout.kind === "vbox" ? "down" : layout.kind === "hbox" ? "across" : undefined;
}

/**
 * GridPane: the cell under a point (in window coordinates), past the last column or row a new one. Widths and
 * heights come from what is in the grid now (but the components being moved).
 */
export function cellAt(form: GuiForm, container: string | null, at: { x: number; y: number }, moving: GuiComponent[] = []): { row: number; col: number } {
  const layout = layoutOf(form, container);
  const kids = childrenOf(form, container).filter((k) => !moving.includes(k));
  const cb = container === null ? { x: 0, y: 0 } : absBox(form, form.components.find((c) => c.name === container)!);
  const ins = insetsOf(form, container);
  const gap = layout?.kind === "gridpane" ? layout : { hgap: 0, vgap: 0 };
  const cols: number[] = [];
  const rows: number[] = [];
  for (const k of kids) {
    const { row, col } = k.cell ?? { row: 0, col: 0 };
    cols[col] = Math.max(cols[col] ?? 0, k.w);
    rows[row] = Math.max(rows[row] ?? 0, k.h);
  }
  const find = (sizes: number[], g: number, from: number, p: number) => {
    let edge = from;
    for (let i = 0; i < sizes.length; i++) {
      edge += (sizes[i] ?? 0) + g;
      if (p < edge - g / 2) return i;
    }
    return sizes.length;
  };
  return { row: find(rows, gap.vgap, cb.y + ins.top, at.y), col: find(cols, gap.hgap, cb.x + ins.left, at.x) };
}

/** The components directly in a panel (or in the window, for null), in the code's order. */
export function childrenOf(form: GuiForm, parent: string | null): GuiComponent[] {
  return form.components.filter((c) => (parentOf(form, c) ?? null) === parent);
}

/** The panel a component is really in: its parent when that is a panel of the form and no loop, else the window. */
export function parentOf(form: GuiForm, c: GuiComponent): string | undefined {
  return ancestors(form, c)[0]?.name;
}

/** Everything inside a panel, at any depth. */
export function descendants(form: GuiForm, name: string): GuiComponent[] {
  const out: GuiComponent[] = [];
  const walk = (n: string) => {
    for (const c of childrenOf(form, n)) {
      if (out.includes(c)) continue;
      out.push(c);
      walk(c.name);
    }
  };
  walk(name);
  return out;
}

/** Of the names, those whose panel isn't among them too (moving a panel moves what is inside it). */
export function topmost(form: GuiForm, names: string[]): string[] {
  return names.filter((n) => {
    const c = form.components.find((x) => x.name === n);
    return c && !ancestors(form, c).some((a) => names.includes(a.name));
  });
}

/**
 * The innermost panel under a point of the window that isn't one of `exclude` (or inside one), or null for the
 * window itself. Of panels that overlap, the one Swing paints on top (added first) wins.
 */
export function containerAt(form: GuiForm, x: number, y: number, exclude: string[] = []): string | null {
  const out = new Set(exclude.flatMap((n) => [n, ...descendants(form, n).map((d) => d.name)]));
  let inside: string | null = null;
  for (;;) {
    const hit: GuiComponent | undefined = childrenOf(form, inside).find((c) => {
      if (!isContainer(c) || out.has(c.name)) return false;
      const b = absBox(form, c);
      return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    });
    if (!hit) return inside;
    inside = hit.name;
  }
}

/** Puts a component into a panel (or the window, for null), keeping where it is in the window. */
export function moveInto(form: GuiForm, c: GuiComponent, parent: string | null, abs: { x: number; y: number }) {
  if (parent) c.parent = parent;
  else delete c.parent;
  const o = originOf(form, c);
  c.x = Math.round(abs.x - o.x);
  c.y = Math.round(abs.y - o.y);
}

/** Copies of components with whatever is inside them: the outer ones in window coordinates, the rest relative. */
export function copyComponents(form: GuiForm, names: string[]): GuiComponent[] {
  return topmost(form, names).flatMap((n) => {
    const c = form.components.find((x) => x.name === n)!;
    const b = absBox(form, c);
    const top: GuiComponent = { ...structuredClone(c), x: b.x, y: b.y };
    delete top.parent;
    return [top, ...descendants(form, n).map((d) => structuredClone(d))];
  });
}

/**
 * Adds copies made by copyComponents, `offset` further right and down, with new names (from `name`), events left
 * out. An outer copy goes into the panel where its corner lands, but never into what it was copied from: a
 * duplicated panel lands beside the original, a duplicated button in its panel. Returns the outer copies' names.
 */
export function pasteComponents(
  form: GuiForm,
  list: GuiComponent[],
  offset: number,
  name: (form: GuiForm, c: GuiComponent) => string,
  add: (list: GuiComponent[], c: GuiComponent) => void = (l, c) => l.push(c),
): string[] {
  const outer: string[] = [];
  const renamed = new Map<string, string>();
  const sources = list.map((s) => s.name);
  for (const src of list) {
    const c: GuiComponent = { ...structuredClone(src), events: [] };
    c.name = name(form, c);
    renamed.set(src.name, c.name);
    add(form.components, c);
    const inside = src.parent && renamed.get(src.parent);
    if (inside) c.parent = inside;
    else {
      outer.push(c.name);
      delete c.parent;
      const at = { x: src.x + offset, y: src.y + offset };
      // The panel the original is in, or the one under the copy's corner that isn't the original (or in it).
      const into = containerAt(form, at.x + 1, at.y + 1, [c.name, ...sources]);
      moveInto(form, c, into, at);
      // In a layout: at the end of the order, or in a free region (else the centre).
      const layout = layoutOf(form, into);
      if (layout?.kind === "border") c.region = freeRegion(form, into, [c]) ?? "CENTER";
      else delete c.region;
      if (layout && layout.kind !== "border") placeInOrder(form, c, Number.MAX_SAFE_INTEGER);
      // In a GridPane: a new row below the others.
      if (layout?.kind === "gridpane") c.cell = { row: Math.max(-1, ...childrenOf(form, into).filter((k) => k !== c).map((k) => k.cell?.row ?? 0)) + 1, col: 0 };
      else delete c.cell;
    }
  }
  return outer;
}

/**
 * The form's components in the order the code writes them: each one followed by what is in it (so a panel's
 * children are added to it after it is set up), siblings in their order.
 */
export function codeOrder(form: GuiForm): GuiComponent[] {
  const out: GuiComponent[] = [];
  const walk = (parent: string | null) => {
    for (const c of childrenOf(form, parent)) {
      if (out.includes(c)) continue;
      out.push(c);
      if (isContainer(c)) walk(c.name);
    }
  };
  walk(null);
  return out;
}
