/*
 * Components inside panels. A component's `parent` is the panel it is added to; its x and y are relative to that
 * panel, as `setBounds` is in Swing. The designer works in window coordinates and converts at the edges.
 */
import type { Box } from "./geometry";
import type { GuiComponent, GuiForm } from "./model";

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
  return ancestors(form, c).reduce((o, p) => ({ x: o.x + p.x, y: o.y + p.y }), { x: 0, y: 0 });
}

/** A component's box in window coordinates. */
export function absBox(form: GuiForm, c: GuiComponent): Box {
  const o = originOf(form, c);
  return { x: c.x + o.x, y: c.y + o.y, w: c.w, h: c.h };
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
      moveInto(form, c, containerAt(form, at.x + 1, at.y + 1, [c.name, ...sources]), at);
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
