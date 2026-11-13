/*
 * The structure of Python code for the outline and the class diagram, in
 * the same model as Java's: classes with their attributes (class attributes,
 * annotated fields and every `self.x = …` in a method), methods, base
 * classes and the classes they create. Names starting with `__` are private,
 * with `_` protected; `@staticmethod` and `@classmethod` are static,
 * `@abstractmethod` abstract. Types come from annotations, or from the value
 * when there is none: `self.items = []` is a list, `self.owner = Person(…)` a
 * Person, `self.name = name` the parameter's annotation.
 */
import type { JField, JFile, JMethod, JParam, JType, TypeKind, Visibility } from "../../uml/model";

export interface LogicalLine {
  indent: number;
  /** The line with strings blanked to `""` (or `""""""` for docstrings) and comments removed. */
  text: string;
  line: number;
  endLine: number;
}

/** Joins physical lines into Python's logical lines: open brackets, backslashes and long strings continue a line. */
export function logicalLines(src: string): LogicalLine[] {
  const out: LogicalLine[] = [];
  let buf = "";
  let depth = 0;
  let line = 1;
  let start = 1;
  let indent = -1;
  let i = 0;
  const n = src.length;
  const flush = () => {
    const text = buf.trim();
    if (text) out.push({ indent: Math.max(0, indent), text, line: start, endLine: line });
    buf = "";
    indent = -1;
    depth = 0;
  };
  while (i < n) {
    const c = src[i];
    if (indent < 0) {
      // The start of a logical line: measure its indentation (a tab to the next multiple of 8).
      let w = 0;
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t" || src[j] === "\f")) {
        w = src[j] === "\t" ? (Math.floor(w / 8) + 1) * 8 : w + 1;
        j++;
      }
      if (j >= n) break;
      if (src[j] === "\n" || src[j] === "\r" || src[j] === "#") {
        // Blank or comment-only line.
        while (j < n && src[j] !== "\n") j++;
        i = j + 1;
        line++;
        continue;
      }
      indent = w;
      start = line;
      i = j;
      continue;
    }
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      i += src[i + 1] === "\r" ? 3 : 2;
      line++;
      buf += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      const raw = /[rR][bBfF]?$|[bBfF][rR]$/.test(buf.slice(-2));
      i += quote.length;
      const from = i;
      let to = i;
      while (i < n) {
        if (src[i] === "\\" && !raw) {
          if (src[i + 1] === "\n") line++;
          i += 2;
          continue;
        }
        if (src.startsWith(quote, i)) {
          to = i;
          i += quote.length;
          break;
        }
        if (src[i] === "\n") {
          line++;
          if (!triple) break;
        }
        i++;
      }
      // Short name-like strings stay readable: forward references (`-> "Shape"`) and `"__main__"`.
      const content = src.slice(from, to);
      buf += triple ? '""""""' : /^[\w.\[\], |]{1,80}$/.test(content) ? `"${content}"` : '""';
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      if (depth > 0) {
        buf += " ";
        line++;
        i++;
        continue;
      }
      flush();
      line++;
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Splits at commas that aren't inside brackets. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The index just after the bracket that closes the one at `open`. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if ("([{".includes(s[i])) depth++;
    else if (")]}".includes(s[i]) && --depth === 0) return i + 1;
  }
  return s.length;
}

function visibilityOf(name: string): Visibility {
  if (name.startsWith("__") && !name.endsWith("__")) return "private";
  if (name.startsWith("_") && !name.startsWith("__")) return "protected";
  return "public";
}

const LITERAL: [RegExp, string][] = [
  [/^-?\d[\d_]*$/, "int"],
  [/^-?(\d[\d_]*)?\.\d+([eE][-+]?\d+)?$|^-?\d+[eE][-+]?\d+$/, "float"],
  [/^[bB][rR]?"/, "bytes"],
  [/^[rRuUfF]*"/, "str"],
  [/^(True|False)$/, "bool"],
  [/^\[/, "list"],
  [/^\{\s*\}$|^\{[^:]*:/, "dict"],
  [/^\{/, "set"],
  [/^\(/, "tuple"],
];

/** A value's type, as far as it shows: literals, `Name(…)` calls, a parameter with an annotation. */
function inferType(value: string, params: Map<string, string>): string {
  const v = value.trim();
  if (!v || v === "None") return "";
  for (const [re, type] of LITERAL) if (re.test(v)) return type;
  const call = /^([A-Za-z_][\w.]*)\s*\(/.exec(v);
  if (call && closing(v, call[0].length - 1) === v.length) {
    const name = call[1].split(".").pop()!;
    if (/^[A-Z]/.test(name)) return name;
    if (["str", "int", "float", "list", "dict", "set", "tuple", "bool", "bytes", "frozenset"].includes(name)) return name;
    return "";
  }
  if (/^[A-Za-z_]\w*$/.test(v)) return params.get(v) ?? "";
  return "";
}

/** Annotations in diagram form: `Optional[X]` and `X | None` stay as written; quotes around forward references go. */
function cleanType(t: string): string {
  return t.replace(/"([^"]*)"/g, "$1").replace(/\s+/g, " ").trim();
}

function parseParams(text: string, isMethod: boolean): JParam[] {
  const parts = splitTop(text);
  const out: JParam[] = [];
  parts.forEach((p, i) => {
    if (p === "/" || p === "*") return;
    const m = /^(\*{0,2}[A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.*))?$/.exec(p);
    if (!m) return;
    if (i === 0 && isMethod && (m[1] === "self" || m[1] === "cls")) return;
    out.push({ name: m[1], type: m[2] ? cleanType(m[2]) : m[3] ? inferType(m[3], new Map()) : "" });
  });
  return out;
}

const ENUM_BASES = new Set(["Enum", "IntEnum", "StrEnum", "Flag", "IntFlag"]);
const SKIP_BASES = new Set(["object", "ABC", "Protocol", "Generic", ...ENUM_BASES]);

interface Scope {
  kind: "class" | "def";
  indent: number;
  /** The indentation of the body, once its first line is seen. */
  body: number;
  type?: JType;
  method?: JMethod;
  /** The class a method belongs to. */
  owner?: JType;
  params?: Map<string, string>;
}

function moduleName(path: string): string {
  const parts = path.split(/[\\/]/);
  const file = parts.pop() ?? "";
  const stem = file.replace(/\.pyi?$|\.pyw$/i, "");
  return stem === "__init__" ? (parts.pop() ?? stem) : stem;
}

export function parsePython(src: string, path: string): JFile {
  const lines = logicalLines(src);
  const pkg = moduleName(path);
  const types: JType[] = [];
  const functions: JMethod[] = [];
  const stack: Scope[] = [];
  let decorators: string[] = [];
  let isMain = false;

  const close = (until: number, endLine: number) => {
    while (stack.length && stack[stack.length - 1].indent >= until) {
      const s = stack.pop()!;
      if (s.type) s.type.endLine = endLine;
      if (s.method) s.method.endLine = endLine;
    }
  };

  let lastEnd = 1;
  for (const l of lines) {
    close(l.indent, lastEnd);
    const top = stack[stack.length - 1];
    if (top && top.body < 0) top.body = l.indent;
    lastEnd = l.endLine;
    const text = l.text;

    if (text.startsWith("@")) {
      decorators.push(text.slice(1).replace(/\(.*$/, "").trim());
      continue;
    }

    const cls = /^class\s+([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(\()?/.exec(text);
    if (cls) {
      let bases: string[] = [];
      let rest = text.slice(cls[0].length);
      if (cls[3]) {
        const open = cls[0].length - 1;
        const end = closing(text, open);
        bases = splitTop(text.slice(open + 1, end - 1));
        rest = text.slice(end);
      }
      const keywords = bases.filter((b) => /^\w+\s*=/.test(b));
      const plain = bases.filter((b) => !/^\w+\s*=/.test(b)).map((b) => b.trim());
      const names = plain.map((b) => b.replace(/\[.*$/, "").split(".").pop()!);
      const generic = plain.find((b) => /^(typing\.)?Generic\[/.test(b));
      const kind: TypeKind = names.some((b) => ENUM_BASES.has(b)) ? "enum" : names.includes("Protocol") ? "interface" : "class";
      const outer = stack.slice().reverse().find((s) => s.kind === "class")?.type ?? null;
      const insideDef = stack.some((s) => s.kind === "def");
      const t: JType = {
        name: cls[1],
        qualifiedName: `${outer ? outer.qualifiedName : pkg}.${cls[1]}`,
        kind,
        visibility: visibilityOf(cls[1]),
        isAbstract: names.includes("ABC") || keywords.some((k) => /metaclass\s*=\s*(abc\.)?ABCMeta/.test(k)),
        isStatic: false,
        isFinal: decorators.some((d) => /(^|\.)final$/.test(d)),
        typeParams: cls[2] ?? (generic ? generic.replace(/^(typing\.)?Generic/, "") : ""),
        extends: plain.filter((_, i) => !SKIP_BASES.has(names[i])).map((b) => b.replace(/\[.*$/, "")),
        implements: [],
        fields: [],
        methods: [],
        constants: [],
        creates: [],
        outer: outer?.qualifiedName ?? null,
        path,
        package: pkg,
        line: l.line,
        endLine: l.endLine,
        hasMain: false,
        language: "python",
      };
      decorators = [];
      if (!insideDef) types.push(t);
      stack.push({ kind: "class", indent: l.indent, body: -1, type: t });
      if (rest.replace(/^\s*:/, "").trim() && !/^\s*:\s*(pass|\.\.\.)\s*$/.test(rest)) {
        // A one-line body: `class A: x = 1`.
        lastEnd = l.endLine;
      }
      continue;
    }

    const def = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(/.exec(text);
    if (def) {
      const open = def[0].length - 1;
      const end = closing(text, open);
      const after = text.slice(end);
      const ret = /^\s*->\s*(.+?)\s*:/.exec(after);
      const body = after.replace(/^\s*(->\s*.+?)?\s*:/, "").trim();
      const owner = top?.kind === "class" && top.indent < l.indent ? top.type : undefined;
      const isStatic = decorators.some((d) => d === "staticmethod" || d === "classmethod");
      const params = parseParams(text.slice(open + 1, end - 1), !!owner && !decorators.includes("staticmethod"));
      const name = def[1];
      const isCtor = !!owner && name === "__init__";
      const m: JMethod = {
        name: isCtor ? owner!.name : name,
        returnType: isCtor ? null : ret ? (ret[1] === "None" ? "void" : cleanType(ret[1])) : "",
        params,
        visibility: visibilityOf(name),
        isStatic,
        isAbstract: decorators.some((d) => /(^|\.)abstractmethod$/.test(d)),
        isConstructor: isCtor,
        typeParams: "",
        line: l.line,
        endLine: l.endLine,
      };
      if (owner) {
        if (decorators.some((d) => d === "property" || /\.setter$|\.deleter$/.test(d))) {
          // A property reads like an attribute; its setter adds nothing new.
          if (decorators.includes("property") && !owner.fields.some((f) => f.name === name)) {
            owner.fields.push({ name, type: m.returnType && m.returnType !== "void" ? m.returnType : "", visibility: visibilityOf(name), isStatic: false, isFinal: false, line: l.line });
          }
        } else owner.methods.push(m);
        if (m.isAbstract && owner.kind === "class") owner.isAbstract = true;
      } else if (!stack.length) functions.push(m);
      decorators = [];
      const paramTypes = new Map(params.filter((p) => p.type).map((p) => [p.name, p.type]));
      const enclosingClass = owner ?? stack.slice().reverse().find((s) => s.owner)?.owner;
      stack.push({ kind: "def", indent: l.indent, body: -1, method: m, owner: enclosingClass, params: paramTypes });
      if (body) noteBody(body, stack[stack.length - 1]);
      continue;
    }
    decorators = [];

    if (!stack.length && /^if\s+__name__\s*==\s*"__main__"\s*:/.test(text)) isMain = true;

    if (top?.kind === "class" && top.type && l.indent === top.body) {
      classLine(text, top.type, l.line);
      continue;
    }
    const inDef = stack.slice().reverse().find((s) => s.kind === "def");
    if (inDef) noteBody(text, inDef, l.line);
  }
  close(-1, lastEnd);
  return { path, package: pkg, imports: [], types, functions, isMain };

  function noteBody(text: string, scope: Scope, line = scope.method?.line ?? 0) {
    const owner = scope.owner;
    if (!owner) return;
    for (const m of text.matchAll(/(?:^|[^\w.])([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
      if (!owner.creates.includes(m[1])) owner.creates.push(m[1]);
    }
    const single = /^self\.([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*=(?!=)\s*(.*)$/.exec(text);
    const add = (name: string, type: string) => {
      if (owner.fields.some((f) => f.name === name)) {
        const f = owner.fields.find((x) => x.name === name)!;
        if (!f.type && type) f.type = type;
        return;
      }
      owner.fields.push({ name, type, visibility: visibilityOf(name), isStatic: false, isFinal: false, line });
    };
    if (single) {
      add(single[1], single[2] ? cleanType(single[2]) : inferType(single[3], scope.params ?? new Map()));
      return;
    }
    const tuple = /^((?:self\.\w+\s*,\s*)+self\.\w+)\s*=(?!=)\s*(.*)$/.exec(text);
    if (tuple) {
      const names = tuple[1].split(",").map((s) => s.trim().slice(5));
      const values = splitTop(tuple[2]);
      names.forEach((n, i) => add(n, values.length === names.length ? inferType(values[i], scope.params ?? new Map()) : ""));
    }
  }

  function classLine(text: string, t: JType, line: number) {
    if (/^(pass|\.\.\.|""""""|"")$/.test(text)) return;
    const annotated = /^([A-Za-z_]\w*)\s*:\s*([^=]+?)\s*(?:=(?!=)\s*(.*))?$/.exec(text);
    const assigned = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/.exec(text);
    if (t.kind === "enum" && (assigned || annotated)) {
      const name = (assigned ?? annotated)![1];
      if (!name.startsWith("_") && !t.constants.includes(name)) t.constants.push(name);
      return;
    }
    if (annotated) {
      const classVar = /^(typing\.)?ClassVar\b/.test(annotated[2]);
      const type = cleanType(annotated[2].replace(/^(typing\.)?ClassVar\[(.*)\]$/, "$2"));
      if (!t.fields.some((f) => f.name === annotated[1])) t.fields.push(field(annotated[1], type, classVar, line));
      return;
    }
    if (assigned) {
      const name = assigned[1];
      if (name === "__slots__" || name === "__match_args__") return;
      if (!t.fields.some((f) => f.name === name)) t.fields.push(field(name, inferType(assigned[2], new Map()), true, line, /^[A-Z][A-Z0-9_]*$/.test(name)));
    }
  }
}

function field(name: string, type: string, isStatic: boolean, line: number, isFinal = false): JField {
  return { name, type, visibility: visibilityOf(name), isStatic, isFinal, line };
}
