/*
 * Nassi–Shneiderman diagrams (structograms): a sequence of blocks, each an action, a call, an exit, a
 * decision (if), a multiple choice (switch), a loop testing first (while, for) or last (do … while), or a
 * group (try, catch, finally). A diagram is made from a Java method, or drawn by hand and kept in a .nsd file.
 */

export type Block =
  | { kind: "action"; text: string }
  | { kind: "call"; text: string }
  | { kind: "exit"; text: string }
  | { kind: "if"; cond: string; yes: Block[]; no: Block[] }
  | { kind: "switch"; expr: string; cases: { label: string; body: Block[] }[] }
  | { kind: "while"; cond: string; body: Block[] }
  | { kind: "repeat"; cond: string; body: Block[] }
  | { kind: "group"; title: string; body: Block[] };

export type BlockKind = Block["kind"];

export interface Nsd {
  title: string;
  body: Block[];
}

/** The text a block shows (its statement, condition or title). */
export function textOf(b: Block): string {
  switch (b.kind) {
    case "action":
    case "call":
    case "exit":
      return b.text;
    case "if":
    case "while":
    case "repeat":
      return b.cond;
    case "switch":
      return b.expr;
    case "group":
      return b.title;
  }
}

export function withText(b: Block, text: string): Block {
  switch (b.kind) {
    case "action":
    case "call":
    case "exit":
      return { ...b, text };
    case "if":
    case "while":
    case "repeat":
      return { ...b, cond: text };
    case "switch":
      return { ...b, expr: text };
    case "group":
      return { ...b, title: text };
  }
}

/** A new block of a kind, with text to replace. */
export function newBlock(kind: BlockKind): Block {
  switch (kind) {
    case "action":
      return { kind, text: "statement" };
    case "call":
      return { kind, text: "procedure()" };
    case "exit":
      return { kind, text: "return" };
    case "if":
      return { kind, cond: "condition", yes: [], no: [] };
    case "switch":
      return { kind, expr: "value", cases: [{ label: "1", body: [] }, { label: "2", body: [] }, { label: "default", body: [] }] };
    case "while":
      return { kind, cond: "while condition", body: [] };
    case "repeat":
      return { kind, cond: "while condition", body: [] };
    case "group":
      return { kind, title: "block", body: [] };
  }
}

// ----- Places in a diagram ---------------------------------------------------------------------

/**
 * A list of blocks in the diagram: the body, a branch, a case or a loop's body. Written as steps from the
 * diagram's body: [index, part, index, part…], a part being "yes", "no", "body" or "case:<n>".
 */
export type ListPath = (number | string)[];

/** A block: the list it is in, and where in it. */
export interface Place {
  list: ListPath;
  index: number;
}

export const samePlace = (a: Place | null, b: Place | null) => !!a && !!b && a.index === b.index && a.list.join("/") === b.list.join("/");

function child(b: Block, part: string): Block[] | null {
  if (b.kind === "if" && (part === "yes" || part === "no")) return b[part];
  if ((b.kind === "while" || b.kind === "repeat" || b.kind === "group") && part === "body") return b.body;
  if (b.kind === "switch" && part.startsWith("case:")) return b.cases[+part.slice(5)]?.body ?? null;
  return null;
}

export function listAt(d: Nsd, path: ListPath): Block[] | null {
  let list: Block[] = d.body;
  for (let i = 0; i < path.length; i += 2) {
    const b = list[path[i] as number];
    if (!b) return null;
    const next = child(b, path[i + 1] as string);
    if (!next) return null;
    list = next;
  }
  return list;
}

export function blockAt(d: Nsd, p: Place): Block | null {
  return listAt(d, p.list)?.[p.index] ?? null;
}

/** A copy of the diagram with one list changed (the rest shared). */
export function updateList(d: Nsd, path: ListPath, f: (list: Block[]) => Block[]): Nsd {
  const go = (list: Block[], depth: number): Block[] => {
    if (depth >= path.length) return f(list);
    const i = path[depth] as number;
    const part = path[depth + 1] as string;
    return list.map((b, j) => {
      if (j !== i) return b;
      if (b.kind === "if" && (part === "yes" || part === "no")) return { ...b, [part]: go(b[part], depth + 2) };
      if ((b.kind === "while" || b.kind === "repeat" || b.kind === "group") && part === "body") return { ...b, body: go(b.body, depth + 2) };
      if (b.kind === "switch" && part.startsWith("case:")) {
        const n = +part.slice(5);
        return { ...b, cases: b.cases.map((c, k) => (k === n ? { ...c, body: go(c.body, depth + 2) } : c)) };
      }
      return b;
    });
  };
  return { ...d, body: go(d.body, 0) };
}

export function replaceBlock(d: Nsd, p: Place, b: Block): Nsd {
  return updateList(d, p.list, (list) => list.map((x, i) => (i === p.index ? b : x)));
}

/** Puts a block after `p` (or into an empty list at `p`), and says where it went. */
export function insertAfter(d: Nsd, p: Place | null, b: Block): { nsd: Nsd; at: Place } {
  if (!p) return { nsd: { ...d, body: [...d.body, b] }, at: { list: [], index: d.body.length } };
  const list = listAt(d, p.list) ?? [];
  const index = list.length === 0 ? 0 : p.index + 1;
  return { nsd: updateList(d, p.list, (l) => [...l.slice(0, index), b, ...l.slice(index)]), at: { list: p.list, index } };
}

export function removeBlock(d: Nsd, p: Place): Nsd {
  return updateList(d, p.list, (list) => list.filter((_, i) => i !== p.index));
}

/** Moves a block one place up (-1) or down (1) in its list. */
export function moveBlock(d: Nsd, p: Place, by: -1 | 1): { nsd: Nsd; at: Place } {
  const list = listAt(d, p.list) ?? [];
  const to = p.index + by;
  if (to < 0 || to >= list.length) return { nsd: d, at: p };
  return {
    nsd: updateList(d, p.list, (l) => {
      const next = [...l];
      [next[p.index], next[to]] = [next[to], next[p.index]];
      return next;
    }),
    at: { list: p.list, index: to },
  };
}

// ----- The .nsd file -----------------------------------------------------------------------------

const MARK = "logiq-nsd";

export function toFile(d: Nsd): string {
  return JSON.stringify({ format: MARK, version: 1, title: d.title, body: d.body }, null, 2) + "\n";
}

function valid(b: unknown): b is Block {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  const list = (v: unknown) => Array.isArray(v) && v.every(valid);
  switch (x.kind) {
    case "action":
    case "call":
    case "exit":
      return typeof x.text === "string";
    case "if":
      return typeof x.cond === "string" && list(x.yes) && list(x.no);
    case "while":
    case "repeat":
      return typeof x.cond === "string" && list(x.body);
    case "group":
      return typeof x.title === "string" && list(x.body);
    case "switch":
      return typeof x.expr === "string" && Array.isArray(x.cases) && x.cases.every((c: { label?: unknown; body?: unknown }) => typeof c?.label === "string" && list(c.body));
    default:
      return false;
  }
}

/** Reads a .nsd file; an empty one is a new diagram. */
export function fromFile(text: string, fallbackTitle: string): Nsd {
  if (!text.trim()) return { title: fallbackTitle, body: [] };
  const data = JSON.parse(text) as { format?: string; title?: unknown; body?: unknown };
  if (data.format !== MARK || !Array.isArray(data.body) || !data.body.every(valid)) throw new Error("This isn't a Nassi–Shneiderman diagram file.");
  return { title: typeof data.title === "string" ? data.title : fallbackTitle, body: data.body };
}
