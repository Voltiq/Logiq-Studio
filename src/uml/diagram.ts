/*
 * From parsed Java types to a UML class diagram: one box per type with its
 * compartments, the relations between them (generalisation, realisation,
 * association with role and multiplicity, dependency, nesting), an
 * automatic layered layout and the routes the lines take.
 */

import { baseName, simpleType, typeNames } from "./javaParser";
import { VISIBILITY_SYMBOL, type JType, type Visibility } from "./model";

export interface UmlOptions {
  showAttributes: boolean;
  showMethods: boolean;
  showConstructors: boolean;
  showParams: boolean;
  showTypes: boolean;
  /** + - # ~ instead of nothing. */
  visibilitySymbols: boolean;
  showPrivate: boolean;
  showAssociations: boolean;
  showDependencies: boolean;
  showNesting: boolean;
}

export const DEFAULT_UML_OPTIONS: UmlOptions = {
  showAttributes: true,
  showMethods: true,
  showConstructors: true,
  showParams: true,
  showTypes: true,
  visibilitySymbols: true,
  showPrivate: true,
  showAssociations: true,
  showDependencies: false,
  showNesting: true,
};

export interface Member {
  text: string;
  line: number;
  isStatic: boolean;
  isAbstract: boolean;
}

export interface UmlNode {
  id: string;
  type: JType;
  stereotype: string | null;
  title: string;
  italic: boolean;
  /** Enum constants, shown before the attributes. */
  constants: string[];
  attributes: Member[];
  operations: Member[];
  /** Whether each compartment is drawn. */
  showAttributes: boolean;
  showOperations: boolean;
  w: number;
  h: number;
}

export type EdgeKind = "extends" | "implements" | "association" | "dependency" | "nesting";

export interface RoleLabel {
  role: string;
  multiplicity: string;
}

export interface UmlEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  labels: RoleLabel[];
}

export interface Diagram {
  nodes: UmlNode[];
  edges: UmlEdge[];
}

export interface Point {
  x: number;
  y: number;
}

export type Positions = Record<string, Point>;

// ----- Geometry of a box --------------------------------------------------------

export const BOX = {
  padX: 12,
  lineH: 18,
  titleH: 20,
  stereoH: 15,
  headPadY: 9,
  sectionPadY: 6,
  emptySection: 10,
  minW: 128,
};

export type Measure = (text: string, kind: "title" | "member" | "stereotype") => number;

/** A rough measure for tests and for when no canvas is available. */
export const roughMeasure: Measure = (text, kind) => text.length * (kind === "title" ? 7.6 : kind === "member" ? 7.25 : 6.4);

let canvasCtx: CanvasRenderingContext2D | null | undefined;

export const FONT_TITLE = '600 13px "Geist Variable", "Geist", "Segoe UI", sans-serif';
export const FONT_MEMBER = '400 12px "Geist Mono Variable", "Geist Mono", Consolas, monospace';
export const FONT_STEREO = '400 11px "Geist Variable", "Geist", "Segoe UI", sans-serif';

/** Measures with the fonts the diagram is drawn in. */
export const canvasMeasure: Measure = (text, kind) => {
  if (canvasCtx === undefined) {
    canvasCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!canvasCtx) return roughMeasure(text, kind);
  canvasCtx.font = kind === "title" ? FONT_TITLE : kind === "member" ? FONT_MEMBER : FONT_STEREO;
  return canvasCtx.measureText(text).width;
};

// ----- Building the diagram -----------------------------------------------------------

const MANY = new Set([
  "List",
  "ArrayList",
  "LinkedList",
  "Set",
  "HashSet",
  "LinkedHashSet",
  "TreeSet",
  "SortedSet",
  "Collection",
  "Iterable",
  "Queue",
  "Deque",
  "ArrayDeque",
  "PriorityQueue",
  "Stack",
  "Vector",
  "Map",
  "HashMap",
  "LinkedHashMap",
  "TreeMap",
  "SortedMap",
  "Stream",
  "Iterator",
]);

function vis(v: Visibility, opts: UmlOptions): string {
  return opts.visibilitySymbols ? VISIBILITY_SYMBOL[v] + " " : "";
}

function shown(v: Visibility, opts: UmlOptions) {
  return opts.showPrivate || v !== "private";
}

export class TypeIndex {
  private byQualified = new Map<string, JType>();
  private bySimple = new Map<string, JType[]>();

  constructor(types: JType[]) {
    for (const t of types) {
      this.byQualified.set(t.qualifiedName, t);
      const list = this.bySimple.get(t.name) ?? [];
      list.push(t);
      this.bySimple.set(t.name, list);
    }
  }

  /** Finds the project type a name in `from` refers to, as Java would. */
  resolve(name: string, from: JType): JType | null {
    const raw = name.replace(/<.*$/, "").replace(/(\[\]|\.\.\.)+$/, "");
    if (!raw) return null;
    if (raw.includes(".")) {
      const exact = this.byQualified.get(raw);
      if (exact) return exact;
    }
    const simple = baseName(raw);
    // Nested in this type or in an enclosing one, then the same package.
    for (let scope: string | null = from.qualifiedName; scope; scope = this.byQualified.get(scope)?.outer ?? null) {
      const nested = this.byQualified.get(`${scope}.${raw}`);
      if (nested) return nested;
    }
    const samePkg = this.byQualified.get(from.package ? `${from.package}.${raw}` : raw);
    if (samePkg) return samePkg;
    const candidates = this.bySimple.get(simple) ?? [];
    if (candidates.length === 1) return candidates[0];
    return candidates.find((c) => c.package === from.package) ?? candidates[0] ?? null;
  }
}

function memberParams(params: { name: string; type: string }[], opts: UmlOptions) {
  if (!opts.showParams) return params.length ? "…" : "";
  return params.map((p) => (opts.showTypes ? `${p.name}: ${simpleType(p.type)}` : p.name)).join(", ");
}

export function buildNode(t: JType, opts: UmlOptions, measure: Measure): UmlNode {
  const stereotype =
    t.kind === "interface"
      ? "«interface»"
      : t.kind === "enum"
        ? "«enumeration»"
        : t.kind === "record"
          ? "«record»"
          : t.kind === "annotation"
            ? "«annotation»"
            : t.isAbstract
              ? "«abstract»"
              : null;
  const title = t.name + (t.typeParams ? simpleType(t.typeParams) : "");
  const attributes: Member[] = opts.showAttributes
    ? t.fields
        .filter((f) => shown(f.visibility, opts))
        .map((f) => ({
          text: `${vis(f.visibility, opts)}${f.name}${opts.showTypes ? `: ${simpleType(f.type)}` : ""}`,
          line: f.line,
          isStatic: f.isStatic,
          isAbstract: false,
        }))
    : [];
  const operations: Member[] = opts.showMethods
    ? t.methods
        .filter((m) => shown(m.visibility, opts) && (opts.showConstructors || !m.isConstructor))
        .map((m) => {
          const ret = !m.isConstructor && opts.showTypes && m.returnType && m.returnType !== "void" ? `: ${simpleType(m.returnType)}` : "";
          return {
            text: `${vis(m.visibility, opts)}${m.name}(${memberParams(m.params, opts)})${ret}`,
            line: m.line,
            isStatic: m.isStatic,
            isAbstract: m.isAbstract && t.kind !== "interface",
          };
        })
    : [];
  const constants = opts.showAttributes ? t.constants : [];
  const showAttributes = opts.showAttributes && (t.kind !== "interface" || attributes.length > 0);
  const showOperations = opts.showMethods;

  const lines = [...constants, ...attributes.map((a) => a.text), ...operations.map((o) => o.text)];
  let w = Math.max(measure(title, "title"), stereotype ? measure(stereotype, "stereotype") : 0);
  for (const l of lines) w = Math.max(w, measure(l, "member"));
  w = Math.max(BOX.minW, Math.ceil(w + BOX.padX * 2 + 2));

  let h = BOX.headPadY * 2 + BOX.titleH + (stereotype ? BOX.stereoH : 0);
  const section = (n: number) => (n ? n * BOX.lineH + BOX.sectionPadY * 2 : BOX.emptySection);
  if (showAttributes) h += section(constants.length + attributes.length);
  if (showOperations) h += section(operations.length);

  return {
    id: t.qualifiedName,
    type: t,
    stereotype,
    title,
    italic: t.isAbstract && t.kind !== "interface",
    constants,
    attributes,
    operations,
    showAttributes,
    showOperations,
    w,
    h: Math.ceil(h),
  };
}

/** How many of `target` a field of type `type` holds: `Shape` 1, `Shape[]` or `List<Shape>` 0..*, `Optional<Shape>` 0..1. */
export function multiplicity(type: string, target: string): string {
  if (/(\[\]|\.\.\.)$/.test(type)) return "0..*";
  const outer = baseName(type);
  if (MANY.has(outer)) return "0..*";
  if (outer === "Optional" && target !== outer) return "0..1";
  return "1";
}

export function buildDiagram(types: JType[], opts: UmlOptions, measure: Measure = canvasMeasure): Diagram {
  const index = new TypeIndex(types);
  const visible = new Set(types.map((t) => t.qualifiedName));
  const nodes = types.map((t) => buildNode(t, opts, measure));
  const edges = new Map<string, UmlEdge>();
  const related = new Set<string>();

  const add = (kind: EdgeKind, from: JType, to: JType, label?: RoleLabel) => {
    if (!visible.has(to.qualifiedName)) return;
    const key = `${kind}:${from.qualifiedName}->${to.qualifiedName}`;
    let e = edges.get(key);
    if (!e) {
      e = { id: key, kind, from: from.qualifiedName, to: to.qualifiedName, labels: [] };
      edges.set(key, e);
    }
    if (label && !e.labels.some((l) => l.role === label.role)) e.labels.push(label);
    related.add(`${from.qualifiedName}->${to.qualifiedName}`);
  };

  for (const t of types) {
    const own = new Set((t.typeParams.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? []).filter((n) => n !== "extends" && n !== "super"));
    for (const name of t.extends) {
      const target = index.resolve(name, t);
      if (target) add("extends", t, target);
    }
    for (const name of t.implements) {
      const target = index.resolve(name, t);
      if (target) add(target.kind === "interface" || t.kind === "interface" ? "implements" : "extends", t, target);
    }
    if (opts.showAssociations) {
      for (const f of t.fields) {
        if (!shown(f.visibility, opts) && !opts.showAttributes) continue;
        for (const n of typeNames(f.type)) {
          if (own.has(n)) continue;
          const target = index.resolve(n, t);
          if (!target) continue;
          add("association", t, target, {
            role: `${opts.visibilitySymbols ? VISIBILITY_SYMBOL[f.visibility] : ""}${f.name}`,
            multiplicity: multiplicity(f.type, n),
          });
        }
      }
    }
    if (opts.showNesting && t.outer) {
      const outer = types.find((o) => o.qualifiedName === t.outer);
      if (outer) add("nesting", t, outer);
    }
  }
  if (opts.showDependencies) {
    for (const t of types) {
      const own = new Set((t.typeParams.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? []));
      const names = new Set<string>(t.creates);
      for (const m of t.methods) {
        if (m.returnType) typeNames(m.returnType).forEach((n) => names.add(n));
        for (const p of m.params) typeNames(p.type).forEach((n) => names.add(n));
      }
      for (const n of names) {
        if (own.has(n)) continue;
        const target = index.resolve(n, t);
        if (!target || target === t) continue;
        if (related.has(`${t.qualifiedName}->${target.qualifiedName}`)) continue;
        add("dependency", t, target);
      }
    }
  }
  return { nodes, edges: [...edges.values()] };
}

// ----- Layout ------------------------------------------------------------------------

const GAP_X = 56;
const GAP_Y = 84;
const MAX_ROW = 1500;

/**
 * Layers by inheritance (supertypes above their subtypes), orders each layer
 * to keep children under their parents, and centres the rows.
 */
export function autoLayout(d: Diagram): Positions {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const neighbours = new Map<string, string[]>();
  for (const n of d.nodes) {
    parents.set(n.id, []);
    children.set(n.id, []);
    neighbours.set(n.id, []);
  }
  for (const e of d.edges) {
    if (e.from === e.to) continue;
    if (e.kind === "extends" || e.kind === "implements") {
      parents.get(e.from)!.push(e.to);
      children.get(e.to)!.push(e.from);
    } else {
      neighbours.get(e.from)!.push(e.to);
      neighbours.get(e.to)!.push(e.from);
    }
  }

  // Rank: longest path from a root of the inheritance forest.
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = parents.get(id)!;
    const r = ps.length ? 1 + Math.max(...ps.map(rankOf)) : 0;
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  d.nodes.forEach((n) => rankOf(n.id));
  // Types outside any hierarchy sit one row below a type that uses or holds them.
  const inHierarchy = (id: string) => parents.get(id)!.length > 0 || children.get(id)!.length > 0;
  for (const n of d.nodes) {
    if (inHierarchy(n.id)) continue;
    const users = d.edges.filter((e) => e.to === n.id && e.from !== n.id && e.kind !== "nesting").map((e) => e.from);
    const holder = users.find((u) => inHierarchy(u) || rank.get(u)! === 0);
    if (holder && !d.edges.some((e) => e.from === n.id && e.to === holder)) rank.set(n.id, rank.get(holder)! + 1);
  }

  let layers: string[][] = [];
  for (const n of d.nodes) {
    const r = rank.get(n.id)!;
    (layers[r] ??= []).push(n.id);
  }
  layers = layers.filter((l) => l && l.length);

  // Order: barycentre of related nodes in the layer above, then below.
  const order = new Map<string, number>();
  layers.forEach((l) => l.forEach((id, i) => order.set(id, i)));
  const linked = (id: string) => [...parents.get(id)!, ...children.get(id)!, ...neighbours.get(id)!];
  for (let pass = 0; pass < 6; pass++) {
    const seq = pass % 2 === 0 ? layers : [...layers].reverse();
    for (const layer of seq) {
      const score = new Map<string, number>();
      for (const id of layer) {
        const others = linked(id).filter((o) => rank.get(o) !== rank.get(id));
        score.set(id, others.length ? others.reduce((s, o) => s + order.get(o)!, 0) / others.length : order.get(id)!);
      }
      layer.sort((a, b) => score.get(a)! - score.get(b)! || a.localeCompare(b));
      layer.forEach((id, i) => order.set(id, i));
    }
  }

  // Long rows wrap.
  const rows: string[][] = [];
  for (const layer of layers) {
    let row: string[] = [];
    let width = 0;
    for (const id of layer) {
      const w = byId.get(id)!.w;
      if (row.length && width + w > MAX_ROW) {
        rows.push(row);
        row = [];
        width = 0;
      }
      row.push(id);
      width += w + GAP_X;
    }
    if (row.length) rows.push(row);
  }

  const pos: Positions = {};
  const rowWidth = (row: string[]) => row.reduce((s, id) => s + byId.get(id)!.w, 0) + GAP_X * (row.length - 1);
  const widest = Math.max(...rows.map(rowWidth), 0);
  let y = 0;
  for (const row of rows) {
    // Place each box under the centre of its parents, without overlaps.
    const want = row.map((id) => {
      const ps = parents.get(id)!.filter((p) => pos[p]);
      if (!ps.length) return null;
      return ps.reduce((s, p) => s + pos[p].x + byId.get(p)!.w / 2, 0) / ps.length - byId.get(id)!.w / 2;
    });
    const w = (id: string) => byId.get(id)!.w;
    // Boxes without parents take centred slots; the others start under their parents.
    const xs: number[] = [];
    let cursor = (widest - rowWidth(row)) / 2;
    row.forEach((id, i) => {
      xs.push(want[i] ?? cursor);
      cursor = xs[i] + w(id) + GAP_X;
    });
    // No overlaps: push right where boxes collide...
    for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + w(row[i - 1]) + GAP_X);
    // ...then move the row back by the average push, so siblings centre under their parent.
    const pushed = row.map((_, i) => (want[i] === null ? null : xs[i] - want[i]!)).filter((d): d is number => d !== null);
    const shift = pushed.length ? pushed.reduce((a, b) => a + b, 0) / pushed.length : 0;
    const h = Math.max(...row.map((id) => byId.get(id)!.h));
    row.forEach((id, i) => (pos[id] = { x: xs[i] - shift, y: Math.round(y) }));
    y += h + GAP_Y;
  }
  // Start at x = 0.
  const minX = Math.min(...Object.values(pos).map((p) => p.x), 0);
  for (const id of Object.keys(pos)) pos[id] = { x: Math.round(pos[id].x - minX), y: pos[id].y };
  return pos;
}

/** Gives boxes without a saved place one to the right of the others. */
export function placeNew(d: Diagram, saved: Positions, known: Set<string> = new Set(d.nodes.map((n) => n.id))): Positions {
  const result: Positions = {};
  const missing = d.nodes.filter((n) => !saved[n.id]);
  if (missing.length === d.nodes.length) return autoLayout(d);
  // One class gone and one new: a rename, so the box stays where it was.
  const stale = Object.keys(saved).filter((id) => !known.has(id));
  if (missing.length === 1 && stale.length === 1) {
    return { ...Object.fromEntries(d.nodes.filter((n) => saved[n.id]).map((n) => [n.id, saved[n.id]])), [missing[0].id]: saved[stale[0]] };
  }
  let right = 0;
  for (const n of d.nodes) if (saved[n.id]) right = Math.max(right, saved[n.id].x + n.w);
  let y = 0;
  for (const n of d.nodes) {
    if (saved[n.id]) result[n.id] = saved[n.id];
  }
  for (const n of missing) {
    result[n.id] = { x: right + GAP_X, y };
    y += n.h + 32;
  }
  return result;
}

// ----- Routing --------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the line from the centre of `r` towards `toward` leaves `r`. */
export function borderPoint(r: Rect, toward: Point): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * The points a relation's line passes through, from the source box to the
 * target box. Generalisations run as orthogonal trees when the subtype is
 * below its supertype, so siblings share one arrowhead; everything else is a
 * straight line, offset when two boxes point at each other.
 */
export function route(e: UmlEdge, a: Rect, b: Rect, offset = 0): Point[] {
  if (e.from === e.to) {
    const x = a.x + a.w;
    return [
      { x: x - 24, y: a.y },
      { x: x - 24, y: a.y - 26 },
      { x: x + 26, y: a.y - 26 },
      { x: x + 26, y: a.y + 24 },
      { x, y: a.y + 24 },
    ];
  }
  if ((e.kind === "extends" || e.kind === "implements") && a.y > b.y + b.h + 24) {
    const cx = a.x + a.w / 2;
    const px = b.x + b.w / 2;
    const bottom = b.y + b.h;
    // Within the parent's width the line can drop straight down.
    const midY = bottom + Math.min(32, (a.y - bottom) / 2);
    if (Math.abs(cx - px) < 1) return [{ x: px, y: a.y }, { x: px, y: bottom }];
    return [
      { x: cx, y: a.y },
      { x: cx, y: midY },
      { x: px, y: midY },
      { x: px, y: bottom },
    ];
  }
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const start = borderPoint(a, cb);
  const end = borderPoint(b, ca);
  if (!offset) return [start, end];
  // Two boxes that point at each other get two parallel lines.
  const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
  const nx = (-(cb.y - ca.y) / len) * offset;
  const ny = ((cb.x - ca.x) / len) * offset;
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
  ];
}
