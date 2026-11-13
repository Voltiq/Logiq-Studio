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
  /** Grey boxes for library classes the project uses (Scanner, Random…). */
  showLibrary: boolean;
  /** Lines with right angles that go around boxes, instead of straight lines. */
  orthogonal: boolean;
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
  showLibrary: false,
  orthogonal: true,
};

export interface Member {
  text: string;
  line: number;
  isStatic: boolean;
  isAbstract: boolean;
}

export interface UmlNode {
  /** A class from a library: drawn grey, name only. */
  library?: boolean;
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

/** Types that are too common to draw as library classes. */
const NOT_LIBRARY = new Set([
  "String",
  "Object",
  "Integer",
  "Long",
  "Double",
  "Float",
  "Short",
  "Byte",
  "Boolean",
  "Character",
  "Number",
  "Optional",
  "Void",
  "Math",
  "System",
  "StringBuilder",
  "Exception",
  "RuntimeException",
  ...MANY,
]);

function libraryType(name: string): JType {
  return {
    name,
    qualifiedName: `lib:${name}`,
    kind: "class",
    visibility: "public",
    isAbstract: false,
    isStatic: false,
    isFinal: false,
    typeParams: "",
    extends: [],
    implements: [],
    fields: [],
    methods: [],
    constants: [],
    creates: [],
    outer: null,
    path: "",
    package: "",
    line: 0,
    endLine: 0,
    hasMain: false,
  };
}

export function buildDiagram(types: JType[], opts: UmlOptions, measure: Measure = canvasMeasure): Diagram {
  const index = new TypeIndex(types);
  const visible = new Set(types.map((t) => t.qualifiedName));
  const nodes = types.map((t) => buildNode(t, opts, measure));
  const library = new Map<string, JType>();
  /** A grey box for a library class, made the first time it is used. */
  const lib = (name: string): JType | null => {
    if (!opts.showLibrary || !/^\p{Lu}/u.test(name) || NOT_LIBRARY.has(name) || name.includes(".")) return null;
    let t = library.get(name);
    if (!t) {
      t = libraryType(name);
      library.set(name, t);
      visible.add(t.qualifiedName);
      const w = Math.max(96, Math.ceil(measure(name, "title") + BOX.padX * 2 + 2));
      nodes.push({ id: t.qualifiedName, library: true, type: t, stereotype: null, title: name, italic: false, constants: [], attributes: [], operations: [], showAttributes: false, showOperations: false, w, h: BOX.headPadY * 2 + BOX.titleH });
    }
    return t;
  };
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
          const target = index.resolve(n, t) ?? lib(n);
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
        const target = index.resolve(n, t) ?? lib(n);
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

export interface RouteOptions {
  /** Right-angled lines that go around `obstacles`. */
  orthogonal?: boolean;
  /** Every box of the diagram (the two ends included). */
  obstacles?: Rect[];
  /** Bend points the user placed; the line passes through them. */
  bends?: Point[];
}

/** Where a line from `toward` meets `r`: at a right angle when `toward` is straight above, below or beside it. */
export function attach(r: Rect, toward: Point): Point {
  if (toward.x >= r.x && toward.x <= r.x + r.w) {
    if (toward.y < r.y) return { x: toward.x, y: r.y };
    if (toward.y > r.y + r.h) return { x: toward.x, y: r.y + r.h };
  }
  if (toward.y >= r.y && toward.y <= r.y + r.h) {
    if (toward.x < r.x) return { x: r.x, y: toward.y };
    if (toward.x > r.x + r.w) return { x: r.x + r.w, y: toward.y };
  }
  return borderPoint(r, toward);
}

/**
 * The points a relation's line passes through, from the source box to the
 * target box. Lines with bend points the user placed pass through them.
 * Generalisations run as orthogonal trees when the subtype is below its
 * supertype, so siblings share one arrowhead. Other lines are right-angled
 * and go around boxes, or straight; both are offset when two boxes point at
 * each other.
 */
export function route(e: UmlEdge, a: Rect, b: Rect, offset = 0, o: RouteOptions = {}): Point[] {
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
  if (o.bends?.length) {
    const first = o.bends[0];
    const last = o.bends[o.bends.length - 1];
    return [attach(a, first), ...o.bends, attach(b, last)];
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
  if (o.orthogonal) {
    // The two lines between boxes that point at each other leave on different sides of the middle.
    const shift = offset ? (e.from < e.to ? offset : -offset) : 0;
    const path = routeOrthogonal(a, b, o.obstacles ?? [a, b], shift);
    if (path) return path;
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

// ----- Right-angled lines ---------------------------------------------------------------

/** How far lines keep from boxes, and what a bend costs in pixels of length. */
const CLEAR = 16;
const BEND = 28;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

interface Port {
  /** Where the line meets the box. */
  p: Point;
  /** One step out of the box, where routing starts. */
  out: Point;
  /** 0 right, 1 down, 2 left, 3 up: the way out of the box. */
  dir: number;
}

function portsOf(r: Rect, shift: number): Port[] {
  const sx = Math.max(-r.w / 2 + 8, Math.min(r.w / 2 - 8, shift));
  const sy = Math.max(-r.h / 2 + 8, Math.min(r.h / 2 - 8, shift));
  const cx = r.x + r.w / 2 + sx;
  const cy = r.y + r.h / 2 + sy;
  return [
    { p: { x: r.x + r.w, y: cy }, dir: 0 },
    { p: { x: cx, y: r.y + r.h }, dir: 1 },
    { p: { x: r.x, y: cy }, dir: 2 },
    { p: { x: cx, y: r.y }, dir: 3 },
  ].map((q) => ({ ...q, out: { x: q.p.x + DX[q.dir] * CLEAR, y: q.p.y + DY[q.dir] * CLEAR } }));
}

/** A tiny binary heap of [priority, value]. */
class Heap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(p: number, v: number) {
    const a = this.a;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j][0] <= a[i][0]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A right-angled line from box `a` to box `b` that keeps clear of every box
 * in `obstacles`, with as few bends as it can: A* over a sparse grid made of
 * the lines just outside each box. Null when there is no way through.
 */
export function routeOrthogonal(a: Rect, b: Rect, obstacles: Rect[], shift = 0): Point[] | null {
  const starts = portsOf(a, shift);
  const goals = portsOf(b, shift);
  const pad = CLEAR - 1;
  const blocked = obstacles.map((r) => ({ x0: r.x - pad, y0: r.y - pad, x1: r.x + r.w + pad, y1: r.y + r.h + pad }));
  const inside = (x: number, y: number) => blocked.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
  const xsSet = new Set<number>();
  const ysSet = new Set<number>();
  for (const r of obstacles) {
    xsSet.add(r.x - CLEAR).add(r.x + r.w + CLEAR);
    ysSet.add(r.y - CLEAR).add(r.y + r.h + CLEAR);
  }
  for (const q of [...starts, ...goals]) {
    xsSet.add(q.out.x);
    ysSet.add(q.out.y);
  }
  // The middle of the gap between the two boxes, where a line looks tidiest.
  if (a.x + a.w < b.x || b.x + b.w < a.x) xsSet.add(Math.round((Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2));
  if (a.y + a.h < b.y || b.y + b.h < a.y) ysSet.add(Math.round((Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2));
  const xs = [...xsSet].sort((p, q) => p - q);
  const ys = [...ysSet].sort((p, q) => p - q);
  const nx = xs.length;
  if (nx * ys.length > 60000) return null;
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  const node = (x: number, y: number) => yi.get(y)! * nx + xi.get(x)!;
  const goalAt = new Map<number, Port[]>();
  for (const g of goals) {
    if (inside(g.out.x, g.out.y)) continue;
    const k = node(g.out.x, g.out.y);
    goalAt.set(k, [...(goalAt.get(k) ?? []), g]);
  }
  if (!goalAt.size) return null;
  const h = (x: number, y: number) => Math.min(...goals.map((g) => Math.abs(g.out.x - x) + Math.abs(g.out.y - y))) + CLEAR;

  // A state is a grid point and the direction the line arrived in.
  const cost = new Map<number, number>();
  const from = new Map<number, number>();
  const startOf = new Map<number, Port>();
  const heap = new Heap();
  const GOAL = -1;
  let best: { cost: number; state: number; port: Port } | null = null;
  for (const s of starts) {
    if (inside(s.out.x, s.out.y)) continue;
    const st = node(s.out.x, s.out.y) * 4 + s.dir;
    if ((cost.get(st) ?? Infinity) <= CLEAR) continue;
    cost.set(st, CLEAR);
    startOf.set(st, s);
    heap.push(CLEAR + h(s.out.x, s.out.y), st);
  }
  const segFree = new Map<number, boolean>();
  while (heap.size) {
    const [f, st] = heap.pop();
    if (st === GOAL) break;
    if (best && f >= best.cost) break;
    const g = cost.get(st)!;
    const id = st >> 2;
    const dir = st & 3;
    const ix = id % nx;
    const iy = (id - ix) / nx;
    const x = xs[ix];
    const y = ys[iy];
    for (const port of goalAt.get(id) ?? []) {
      // The last step goes into the box, against the port's way out.
      const total = g + CLEAR + (dir === ((port.dir + 2) & 3) ? 0 : BEND);
      if (!best || total < best.cost) {
        best = { cost: total, state: st, port };
        heap.push(total, GOAL);
      }
    }
    for (let d = 0; d < 4; d++) {
      if (d === ((dir + 2) & 3)) continue;
      const jx = ix + DX[d];
      const jy = iy + DY[d];
      if (jx < 0 || jx >= nx || jy < 0 || jy >= ys.length) continue;
      const x2 = xs[jx];
      const y2 = ys[jy];
      const seg = id * 4 + d;
      let free = segFree.get(seg);
      if (free === undefined) {
        // Box edges lie on grid lines, so a segment is clear when its middle and its end are.
        free = !inside((x + x2) / 2, (y + y2) / 2) && !inside(x2, y2);
        segFree.set(seg, free);
      }
      if (!free) continue;
      const nextCost = g + Math.abs(x2 - x) + Math.abs(y2 - y) + (d === dir ? 0 : BEND);
      const next = (jy * nx + jx) * 4 + d;
      if (nextCost < (cost.get(next) ?? Infinity)) {
        cost.set(next, nextCost);
        from.set(next, st);
        heap.push(nextCost + h(x2, y2), next);
      }
    }
  }
  if (!best) return null;
  const grid: Point[] = [];
  let st: number | undefined = best.state;
  let first = st;
  while (st !== undefined) {
    const id = st >> 2;
    grid.unshift({ x: xs[id % nx], y: ys[Math.floor(id / nx)] });
    first = st;
    st = from.get(st);
  }
  const start = startOf.get(first)!;
  const pts = [start.p, ...grid, best.port.p];
  // Drop the points in the middle of straight runs.
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = out[out.length - 1];
    const q = pts[i];
    const r = pts[i + 1];
    if ((p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y)) continue;
    out.push(q);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
