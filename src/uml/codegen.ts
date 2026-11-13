/*
 * Writing Java from the diagram: new classes, fields, constructors, methods,
 * getters and setters, supertypes and removals, as edits of a file's text.
 * Every function takes the source and the parsed type and returns new
 * source, so it can be tested on its own and applied as one undoable change.
 */
import type { JField, JMethod, JParam, JType, TypeKind, Visibility } from "./model";
import { baseName, parseJava } from "./javaParser";

export interface FieldSpec {
  name: string;
  type: string;
  visibility: Visibility;
  isStatic?: boolean;
  isFinal?: boolean;
  init?: string;
}

export interface MethodSpec {
  name: string;
  /** null for a constructor. */
  returnType: string | null;
  params: JParam[];
  visibility: Visibility;
  isStatic?: boolean;
  isAbstract?: boolean;
  /** Body lines without indentation; a default return is generated when missing. */
  body?: string[];
}

export interface ClassSpec {
  name: string;
  kind: "class" | "abstract" | "interface" | "enum" | "record";
  pkg: string;
  extends: string;
  implements: string[];
  fields: FieldSpec[];
  constants?: string[];
  constructor: boolean;
  getters: boolean;
  setters: boolean;
  toString: boolean;
  main: boolean;
}

const VIS_WORD: Record<Visibility, string> = { public: "public ", protected: "protected ", package: "", private: "private " };

const COLLECTION_IMPORTS: Record<string, string> = {
  List: "java.util.List",
  ArrayList: "java.util.ArrayList",
  LinkedList: "java.util.LinkedList",
  Map: "java.util.Map",
  HashMap: "java.util.HashMap",
  TreeMap: "java.util.TreeMap",
  Set: "java.util.Set",
  HashSet: "java.util.HashSet",
  TreeSet: "java.util.TreeSet",
  Scanner: "java.util.Scanner",
  Random: "java.util.Random",
  Optional: "java.util.Optional",
  LocalDate: "java.time.LocalDate",
  LocalDateTime: "java.time.LocalDateTime",
};

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The value a method returns when it has no body yet. */
export function defaultValue(type: string): string | null {
  switch (type) {
    case "void":
      return null;
    case "boolean":
      return "false";
    case "char":
      return "' '";
    case "int":
    case "long":
    case "short":
    case "byte":
      return "0";
    case "double":
    case "float":
      return "0.0";
    default:
      return "null";
  }
}

export function fieldDecl(f: FieldSpec): string {
  return `${VIS_WORD[f.visibility]}${f.isStatic ? "static " : ""}${f.isFinal ? "final " : ""}${f.type} ${f.name}${f.init ? ` = ${f.init}` : ""};`;
}

export function signature(m: MethodSpec, typeName: string): string {
  const params = m.params.map((p) => `${p.type} ${p.name}`).join(", ");
  if (m.returnType === null) return `${VIS_WORD[m.visibility]}${typeName}(${params})`;
  return `${VIS_WORD[m.visibility]}${m.isStatic ? "static " : ""}${m.isAbstract ? "abstract " : ""}${m.returnType} ${m.name}(${params})`;
}

/** The lines of a method (or constructor), indented one level from `indent`. */
export function methodLines(m: MethodSpec, typeName: string, indent: string, unit: string, bodyless = false): string[] {
  const head = indent + signature(m, typeName);
  if (bodyless || m.isAbstract) return [head + ";"];
  let body = m.body;
  if (!body) {
    const v = m.returnType ? defaultValue(m.returnType) : null;
    body = v === null ? [] : [`return ${v};`];
  }
  return [head + " {", ...body.map((l) => (l ? indent + unit + l : "")), indent + "}"];
}

export function getter(f: FieldSpec): MethodSpec {
  const prefix = f.type === "boolean" ? "is" : "get";
  return { name: prefix + capitalize(f.name), returnType: f.type, params: [], visibility: "public", isStatic: f.isStatic, body: [`return ${f.name};`] };
}

export function setter(f: FieldSpec, typeName: string): MethodSpec {
  const target = f.isStatic ? typeName : "this";
  return {
    name: "set" + capitalize(f.name),
    returnType: "void",
    params: [{ name: f.name, type: f.type }],
    visibility: "public",
    isStatic: f.isStatic,
    body: [`${target}.${f.name} = ${f.name};`],
  };
}

function toStringMethod(name: string, fields: FieldSpec[]): MethodSpec {
  const parts = fields.filter((f) => !f.isStatic).map((f, i) => `${i ? '", ' : '"'}${f.name}=" + ${f.name}`);
  const body = parts.length ? `return "${name}{" + ${parts.join(" + ")} + "}";` : `return "${name}{}";`;
  return { name: "toString", returnType: "String", params: [], visibility: "public", body: [body] };
}

/** Imports a class needs for the library types it uses. */
export function importsFor(types: string[]): string[] {
  const out = new Set<string>();
  for (const t of types) for (const name of t.match(/[A-Z][\w$]*/g) ?? []) if (COLLECTION_IMPORTS[name]) out.add(COLLECTION_IMPORTS[name]);
  return [...out].sort();
}

/** A complete source file for a new class. */
export function renderClass(spec: ClassSpec, unit = "    "): string {
  const lines: string[] = [];
  if (spec.pkg) lines.push(`package ${spec.pkg};`, "");
  const used = [...spec.fields.flatMap((f) => [f.type, f.init ?? ""]), spec.extends, ...spec.implements];
  const imports = importsFor(used);
  if (imports.length) lines.push(...imports.map((i) => `import ${i};`), "");
  const kind = spec.kind === "abstract" ? "abstract class" : spec.kind;
  const instanceFields = spec.fields.filter((f) => !f.isStatic);
  let head = `public ${kind} ${spec.name}`;
  if (spec.kind === "record") head += `(${instanceFields.map((f) => `${f.type} ${f.name}`).join(", ")})`;
  if (spec.extends && spec.kind !== "enum" && spec.kind !== "record") head += ` extends ${spec.extends}`;
  if (spec.implements.length) head += `${spec.kind === "interface" ? " extends " : " implements "}${spec.implements.join(", ")}`;
  lines.push(head + " {", "");
  const blocks: string[][] = [];
  if (spec.kind === "enum" && spec.constants?.length) blocks.push([unit + spec.constants.join(", ") + (spec.fields.length ? ";" : "")]);
  const fields = spec.kind === "record" ? spec.fields.filter((f) => f.isStatic) : spec.fields;
  if (fields.length) blocks.push(fields.map((f) => unit + fieldDecl(spec.kind === "interface" ? { ...f, visibility: "package", isStatic: false, isFinal: false } : f)));
  const isClass = spec.kind === "class" || spec.kind === "abstract";
  if (spec.constructor && (isClass || spec.kind === "enum")) {
    const ctor: MethodSpec = {
      name: spec.name,
      returnType: null,
      params: instanceFields.map((f) => ({ name: f.name, type: f.type })),
      visibility: spec.kind === "enum" ? "private" : "public",
      body: instanceFields.map((f) => `this.${f.name} = ${f.name};`),
    };
    blocks.push(methodLines(ctor, spec.name, unit, unit));
  }
  if (isClass || spec.kind === "enum") {
    for (const f of instanceFields.concat(spec.fields.filter((f) => f.isStatic))) {
      if (spec.getters) blocks.push(methodLines(getter(f), spec.name, unit, unit));
      if (spec.setters && !f.isFinal) blocks.push(methodLines(setter(f, spec.name), spec.name, unit, unit));
    }
    if (spec.toString) blocks.push(["@Override", ...methodLines(toStringMethod(spec.name, spec.fields), spec.name, "", unit)].map((l) => (l ? unit + l : l)));
  }
  if (spec.main && spec.kind !== "interface") {
    blocks.push(methodLines({ name: "main", returnType: "void", params: [{ name: "args", type: "String[]" }], visibility: "public", isStatic: true, body: [""] }, spec.name, unit, unit));
  }
  blocks.forEach((b, i) => lines.push(...b, ...(i < blocks.length - 1 ? [""] : [])));
  lines.push("}", "");
  return lines.join("\n");
}

// ----- Editing existing classes ------------------------------------------------------

/** Index (0-based) of the line holding the `{` that opens the type's body. */
function bodyOpen(lines: string[], t: JType): number {
  for (let i = t.line - 1; i < lines.length; i++) if (stripCode(lines[i]).includes("{")) return i;
  return t.line - 1;
}

/** A line without string literals and comments, so braces in them don't count. */
function stripCode(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/\/\/.*$/, "")
    .replace(/\/\*.*?\*\//g, "");
}

/** The last line (0-based) of the statement starting on `start`, ending at a `;` outside brackets. */
function statementEnd(lines: string[], start: number): number {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const c of stripCode(lines[i])) {
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      else if (c === ";" && depth <= 0) return i;
    }
  }
  return start;
}

export function indentOf(line: string): string {
  return /^\s*/.exec(line)![0];
}

function memberIndent(lines: string[], t: JType, unit: string): string {
  const any = [...t.fields.map((f) => f.line), ...t.methods.map((m) => m.line)][0];
  return any ? indentOf(lines[any - 1]) : indentOf(lines[t.line - 1]) + unit;
}

/** The line (0-based) before which a new method goes: the type's closing brace. */
function closingLine(lines: string[], t: JType): number {
  return Math.min(lines.length - 1, t.endLine - 1);
}

function insertBlock(lines: string[], at: number, block: string[], blankBefore: boolean, blankAfter = false) {
  const before = blankBefore && at > 0 && lines[at - 1].trim() !== "" && !lines[at - 1].trim().endsWith("{") ? [""] : [];
  const after = blankAfter && lines[at] !== undefined && lines[at].trim() !== "" && !lines[at].trim().startsWith("}") ? [""] : [];
  lines.splice(at, 0, ...before, ...block, ...after);
}

/** Adds `import x.y.Z;` when the file doesn't import it (or its package) yet. */
export function ensureImports(text: string, imports: string[]): string {
  const lines = text.split("\n");
  for (const imp of imports) {
    const pkg = imp.slice(0, imp.lastIndexOf("."));
    if (lines.some((l) => new RegExp(`^\\s*import\\s+(${imp.replace(/\./g, "\\.")}|${pkg.replace(/\./g, "\\.")}\\.\\*)\\s*;`).test(l))) continue;
    let at = -1;
    lines.forEach((l, i) => {
      if (/^\s*(import|package)\s/.test(l)) at = i;
    });
    const pkgOnly = at >= 0 && /^\s*package\s/.test(lines[at]);
    lines.splice(at + 1, 0, ...(pkgOnly ? ["", `import ${imp};`] : [`import ${imp};`]));
    if (at < 0 && lines[1] !== undefined && lines[1].trim() !== "") lines.splice(1, 0, "");
  }
  return lines.join("\n");
}

export function addField(text: string, t: JType, f: FieldSpec, opts: { getter?: boolean; setter?: boolean } = {}, unit = "    "): string {
  const lines = text.split("\n");
  const indent = memberIndent(lines, t, unit);
  let at: number;
  if (t.fields.length) {
    const last = Math.max(...t.fields.map((x) => x.line));
    at = statementEnd(lines, last - 1) + 1;
    lines.splice(at, 0, indent + fieldDecl(f));
  } else {
    at = bodyOpen(lines, t) + 1;
    // Enum fields come after the constants, which then need a `;`.
    if (t.kind === "enum" && t.constants.length) {
      const close = closingLine(lines, t);
      const semi = lines.findIndex((l, i) => i >= at && i < close && /;\s*$/.test(stripCode(l)));
      if (semi >= 0) at = semi + 1;
      else {
        let last = close - 1;
        while (last > at && lines[last].trim() === "") last--;
        lines[last] = lines[last].replace(/\s*,?\s*$/, ";");
        at = last + 1;
      }
    }
    insertBlock(lines, at, [indent + fieldDecl(f)], true, true);
  }
  let out = lines.join("\n");
  const methods: MethodSpec[] = [];
  if (opts.getter) methods.push(getter(f));
  if (opts.setter && !f.isFinal) methods.push(setter(f, t.name));
  for (const m of methods) out = addMethod(out, reparse(out, t)(), m, unit);
  return ensureImports(out, importsFor([f.type, f.init ?? ""]));
}

/** Re-locates a type in changed text by its qualified name (line numbers move). */
function reparse(text: string, t: JType): () => JType {
  return () => parseJava(text).types.find((x) => x.qualifiedName === t.qualifiedName) ?? t;
}

export function addMethod(text: string, t: JType, m: MethodSpec, unit = "    "): string {
  const lines = text.split("\n");
  const indent = memberIndent(lines, t, unit);
  const bodyless = t.kind === "interface" && !m.isStatic && !m.body;
  const block = methodLines(m, t.name, indent, unit, bodyless);
  if (m.returnType === null && t.methods.some((x) => !x.isConstructor)) {
    // Constructors go before the first method.
    const first = Math.min(...t.methods.filter((x) => !x.isConstructor).map((x) => x.line));
    const at = leadingStart(lines, first - 1);
    insertBlock(lines, at, [...block, ""], false);
  } else {
    const at = closingLine(lines, t);
    // No blank line between the last member and the closing brace before it.
    let end = at;
    while (end > 0 && lines[end - 1].trim() === "") end--;
    lines.splice(end, at - end);
    insertBlock(lines, end, block, true);
  }
  return ensureImports(lines.join("\n"), importsFor([m.returnType ?? "", ...m.params.map((p) => p.type)]));
}

/** First line of a member including its Javadoc and annotations. */
function leadingStart(lines: string[], i: number): number {
  let start = i;
  while (start > 0) {
    const prev = lines[start - 1].trim();
    if (prev.startsWith("@") || prev.startsWith("*") || prev.startsWith("/**") || prev.startsWith("/*") || prev.endsWith("*/")) start--;
    else break;
  }
  return start;
}

/** Removes a field or method (with its Javadoc, annotations and one blank line). */
export function removeMember(text: string, member: JField | JMethod): string {
  const lines = text.split("\n");
  const first = leadingStart(lines, member.line - 1);
  const last = "endLine" in member ? Math.max(member.endLine - 1, statementEnd(lines, member.line - 1)) : statementEnd(lines, member.line - 1);
  // A field that shares its declaration with others only loses its own name.
  if (!("endLine" in member)) {
    const stmt = lines.slice(member.line - 1, last + 1).join("\n");
    const names = /,/.test(stripCode(stmt).replace(/<[^<>]*>/g, "").replace(/\([^()]*\)/g, ""));
    if (names) {
      const re = new RegExp(`(,\\s*\\b${member.name}\\b(\\s*=[^,;]*)?)|(\\b${member.name}\\b(\\s*=[^,;]*)?\\s*,\\s*)`);
      const changed = stmt.replace(re, "");
      lines.splice(member.line - 1, last - member.line + 2, ...changed.split("\n"));
      return lines.join("\n");
    }
  }
  let remove = last - first + 1;
  if (lines[first + remove]?.trim() === "" && (first === 0 || lines[first - 1].trim() === "" || lines[first - 1].trim().endsWith("{"))) remove++;
  else if (first > 0 && lines[first - 1].trim() === "" && lines[first + remove]?.trim().startsWith("}")) {
    lines.splice(first - 1, remove + 1);
    return lines.join("\n");
  }
  lines.splice(first, remove);
  return lines.join("\n");
}

/** Rewrites a field's declaration (type, visibility, modifiers), keeping its initializer. */
export function changeField(text: string, field: JField, f: FieldSpec): string {
  const lines = text.split("\n");
  const start = field.line - 1;
  const end = statementEnd(lines, start);
  const stmt = lines.slice(start, end + 1).join("\n");
  const init = /=\s*([\s\S]*);\s*(\/\/.*)?$/.exec(stmt);
  const keep = f.init !== undefined ? f.init : init ? init[1].trim() : undefined;
  const decl = indentOf(lines[start]) + fieldDecl({ ...f, init: keep });
  lines.splice(start, end - start + 1, decl);
  return ensureImports(lines.join("\n"), importsFor([f.type]));
}

/** Rewrites a method's or constructor's signature, keeping its body. */
export function changeSignature(text: string, t: JType, method: JMethod, m: MethodSpec): string {
  const lines = text.split("\n");
  const start = method.line - 1;
  // The signature runs to the `{` of the body or the `;`.
  let end = start;
  while (end < lines.length - 1 && !/[{;]/.test(stripCode(lines[end]))) end++;
  const joined = lines.slice(start, end + 1).join("\n");
  const cut = joined.search(/[{;]/);
  const rest = joined.slice(cut);
  const bodyless = rest.startsWith(";");
  const head = indentOf(lines[start]) + signature({ ...m, isAbstract: m.isAbstract && bodyless }, t.name) + (bodyless ? "" : " ");
  const replaced = (head + rest).split("\n");
  lines.splice(start, end - start + 1, ...replaced);
  let out = lines.join("\n");
  // A method that was abstract and no longer is needs a body (and the other way round).
  if (bodyless && !m.isAbstract && t.kind !== "interface") {
    out = out.split("\n").map((l, i) => (i === start ? l.replace(/;\s*$/, " {") : l)).join("\n");
    const body = methodLines({ ...m, isAbstract: false }, t.name, indentOf(lines[start]), "    ").slice(1);
    const ls = out.split("\n");
    ls.splice(start + 1, 0, ...body);
    out = ls.join("\n");
  }
  return ensureImports(out, importsFor([m.returnType ?? "", ...m.params.map((p) => p.type)]));
}

/** Rewrites the `extends` and `implements` clauses of a type's header. */
export function setSupertypes(text: string, t: JType, ext: string[], impl: string[]): string {
  const lines = text.split("\n");
  const start = t.line - 1;
  const open = bodyOpen(lines, t);
  const header = lines.slice(start, open + 1).join("\n");
  const brace = header.lastIndexOf("{");
  const head = header.slice(0, brace);
  // Keep everything up to the end of the name, its type parameters and record components.
  const nameAt = new RegExp(`\\b(class|interface|enum|record)\\s+${t.name}\\b`).exec(head);
  if (!nameAt) return text;
  let i = nameAt.index + nameAt[0].length;
  const skip = (o: string, c: string) => {
    while (/\s/.test(head[i] ?? "")) i++;
    if (head[i] !== o) return;
    let depth = 0;
    for (; i < head.length; i++) {
      if (head[i] === o) depth++;
      else if (head[i] === c && --depth === 0) {
        i++;
        return;
      }
    }
  };
  skip("<", ">");
  skip("(", ")");
  const prefix = head.slice(0, i).trimEnd();
  const permits = /\bpermits\b[\s\S]*$/.exec(head.slice(i))?.[0].trim();
  const isInterface = t.kind === "interface";
  let clauses = "";
  if (isInterface) {
    if (ext.length) clauses += ` extends ${ext.join(", ")}`;
  } else {
    if (ext.length && t.kind === "class") clauses += ` extends ${ext[0]}`;
    if (impl.length) clauses += ` implements ${impl.join(", ")}`;
  }
  if (permits) clauses += ` ${permits}`;
  const newHeader = `${prefix}${clauses} ${header.slice(brace)}`;
  lines.splice(start, open - start + 1, ...newHeader.split("\n"));
  return lines.join("\n");
}

/** The kind word a spec's kind maps to in the model. */
export function modelKind(k: ClassSpec["kind"]): TypeKind {
  return k === "abstract" ? "class" : k;
}

/** Splits a parameter list typed by hand: "int x, List<String> names". */
export function parseParams(s: string): JParam[] | null {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "<") depth++;
    if (c === ">") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  const out: JParam[] = [];
  for (const p of parts) {
    const m = /^\s*(?:final\s+)?(.+?)\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*$/u.exec(p);
    if (!m) return null;
    out.push({ type: m[1].replace(/\s+/g, " ").replace(/\s*,\s*/g, ", "), name: m[2] });
  }
  return out;
}

export const TYPE_RE = /^[\p{L}_$][\p{L}\p{N}_$.]*(\s*<[\p{L}\p{N}_$.,?\s<>[\]]*>)?(\[\])*(\.\.\.)?$/u;

/** A field type for an association to `target` with this multiplicity. */
export function associationType(target: string, many: boolean): { type: string; init?: string } {
  return many ? { type: `List<${baseName(target)}>`, init: "new ArrayList<>()" } : { type: baseName(target) };
}
