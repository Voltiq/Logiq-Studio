/*
 * Navigation in Java code: go to definition, find usages and rename. It
 * works from the project's parsed structure (javaIndex) plus the text around
 * the cursor, so it knows the project's classes, their members (inherited
 * ones too) and local variables, without a full compiler.
 */
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { javaLanguage } from "@codemirror/lang-java";
import type { Tree } from "@lezer/common";
import { javaIndex } from "../uml/javaIndex";
import { baseName } from "../uml/javaParser";
import type { JMethod, JType } from "../uml/model";
import { declaredType } from "./javaComplete";
import { api, errorText } from "../lib/api";
import { get, openDialog, toast } from "../lib/store";
import { changeDoc, movePath, openFile, searchFor } from "../lib/actions";
import { getDoc } from "./docs";
import { dirname, join, samePath, stem } from "../lib/paths";
import { t } from "../lib/i18n";

const ID_CHAR = /[\p{L}\p{N}_$]/u;

export interface Target {
  path: string;
  line: number;
  /** The declaration is a local variable or parameter of this method. */
  local?: { method: JMethod };
  type?: JType;
}

export function wordAt(state: EditorState, pos: number): { from: number; to: number; text: string } | null {
  const line = state.doc.lineAt(pos);
  let a = pos - line.from;
  let b = a;
  while (a > 0 && ID_CHAR.test(line.text[a - 1])) a--;
  while (b < line.length && ID_CHAR.test(line.text[b])) b++;
  if (a === b || /\d/.test(line.text[a])) return null;
  return { from: line.from + a, to: line.from + b, text: line.text.slice(a, b) };
}

/** The types (outermost first) and the method that contain a line. */
export function scopeAt(path: string, line: number): { types: JType[]; method: JMethod | null } {
  const file = javaIndex.file(path);
  if (!file) return { types: [], method: null };
  const types = file.types.filter((x) => x.line <= line && x.endLine >= line).sort((a, b) => a.line - b.line);
  const inner = types[types.length - 1];
  const method = inner?.methods.find((m) => m.line <= line && m.endLine >= line) ?? null;
  return { types, method };
}

function typeNamed(name: string, from?: JType): JType | null {
  const all = javaIndex.types();
  const base = baseName(name);
  const candidates = all.filter((x) => x.name === base);
  if (!candidates.length) return null;
  return candidates.find((c) => from && c.outer === from.qualifiedName) ?? candidates.find((c) => from && c.package === from.package) ?? candidates[0];
}

/** A member called `name` in `type` or its supertypes. */
function memberIn(type: JType, name: string, seen = new Set<string>()): Target | null {
  if (seen.has(type.qualifiedName)) return null;
  seen.add(type.qualifiedName);
  const f = type.fields.find((x) => x.name === name);
  if (f) return { path: type.path, line: f.line, type };
  const m = type.methods.find((x) => x.name === name && !x.isConstructor);
  if (m) return { path: type.path, line: m.line, type };
  if (type.constants.includes(name)) return { path: type.path, line: type.line, type };
  const nested = javaIndex.types().find((x) => x.outer === type.qualifiedName && x.name === name);
  if (nested) return { path: nested.path, line: nested.line, type: nested };
  for (const sup of [...type.extends, ...type.implements]) {
    const parent = typeNamed(sup, type);
    const hit = parent && memberIn(parent, name, seen);
    if (hit) return hit;
  }
  return null;
}

/** Where the identifier at `pos` is declared, or null when it isn't the project's own. */
export function definitionAt(state: EditorState, pos: number, path: string): Target | null {
  const w = wordAt(state, pos);
  if (!w) return null;
  const node = syntaxTree(state).resolveInner(pos, 1);
  if (/Comment|String/.test(node.name)) return null;
  const lineNo = state.doc.lineAt(pos).number;
  const before = state.sliceDoc(0, w.from);
  const { types, method } = scopeAt(path, lineNo);
  const here = types[types.length - 1];

  // `receiver.name`
  const dot = /([\p{L}_$][\p{L}\p{N}_$]*)(\(\))?\s*\.\s*$/u.exec(before.slice(-200));
  if (dot) {
    const receiver = dot[1];
    let type: JType | null = null;
    if (receiver === "this" && here) type = here;
    else if (receiver === "super" && here) type = typeNamed(here.extends[0] ?? "", here);
    else if (/^\p{Lu}/u.test(receiver)) type = typeNamed(receiver, here);
    if (!type) {
      const declared = declaredType(before, receiver);
      if (declared) type = typeNamed(declared, here);
    }
    return type ? memberIn(type, w.text) : null;
  }

  // A local variable or parameter of the method the cursor is in.
  if (method) {
    if (method.params.some((p) => p.name === w.text)) return { path, line: method.line, local: { method } };
    const from = state.doc.line(method.line).from;
    const body = state.sliceDoc(from, w.from);
    const decl = new RegExp(`(?:[\\p{L}_$][\\p{L}\\p{N}_$.]*(?:<[^;(){}=]*>)?(?:\\[\\])*|var)\\s+${w.text.replace(/\$/g, "\\$")}\\s*[=;,:)]`, "gu");
    let last: RegExpExecArray | null = null;
    for (let m = decl.exec(body); m; m = decl.exec(body)) last = m;
    if (last) return { path, line: state.doc.lineAt(from + last.index).number, local: { method } };
  }

  // A class of the project.
  const type = typeNamed(w.text, here);
  if (type) return { path: type.path, line: type.line, type };

  // A member of this class or one it inherits from.
  for (let i = types.length - 1; i >= 0; i--) {
    const hit = memberIn(types[i], w.text);
    if (hit) return hit;
  }
  return null;
}

export function goToDefinition(view: EditorView, path: string, pos = view.state.selection.main.head): boolean {
  const target = definitionAt(view.state, pos, path);
  const w = wordAt(view.state, pos);
  if (!target || !w) {
    if (w) toast("info", t("No definition found for “{0}”", w.text), t("Only the project's own classes, members and variables can be followed."));
    return !!w;
  }
  void openFile(target.path, { line: target.line, col: columnOf(target, w.text), length: w.text.length });
  return true;
}

function columnOf(target: Target, name: string): number {
  const doc = getDoc(target.path);
  if (!doc) return 1;
  const text = doc.state.doc.line(Math.min(target.line, doc.state.doc.lines)).text;
  const i = findWord(text, name)[0];
  return i === undefined ? 1 : i + 1;
}

/** Whole-word occurrences of `name` in `text` (Java identifier boundaries). */
export function findWord(text: string, name: string): number[] {
  const out: number[] = [];
  let i = text.indexOf(name);
  while (i >= 0) {
    const before = i > 0 ? text[i - 1] : "";
    const after = text[i + name.length] ?? "";
    if (!ID_CHAR.test(before) && !ID_CHAR.test(after)) out.push(i);
    i = text.indexOf(name, i + name.length);
  }
  return out;
}

export function findUsages(view: EditorView) {
  const w = wordAt(view.state, view.state.selection.main.head);
  if (w) searchFor(w.text, { matchCase: true, wholeWord: true, extensions: ["java"] });
}

/** Offsets of `name` in code (not in comments or strings), optionally limited to a range of lines. */
function codeOccurrences(text: string, tree: Tree, name: string, lines?: [number, number]): number[] {
  let positions = findWord(text, name);
  if (lines) {
    const starts = [0];
    for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    const lo = starts[lines[0] - 1] ?? 0;
    const hi = starts[lines[1]] ?? text.length;
    positions = positions.filter((p) => p >= lo && p < hi);
  }
  return positions.filter((p) => !/Comment|String|TextBlock/.test(tree.resolveInner(p, 1).name));
}

const JAVA_NAME = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const RESERVED = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record".split(" "));

export function renameSymbol(view: EditorView, path: string) {
  const pos = view.state.selection.main.head;
  const w = wordAt(view.state, pos);
  if (!w) return;
  const target = definitionAt(view.state, pos, path);
  const isLocal = !!target?.local && samePath(target.path, path);
  openDialog({
    kind: "prompt",
    title: t("Rename “{0}”", w.text),
    label: isLocal ? t("New name (in this method)") : t("New name (in every Java file)"),
    value: w.text,
    confirmLabel: t("Rename"),
    validate: (v) => (!JAVA_NAME.test(v) ? t("That isn't a valid Java name.") : RESERVED.has(v) ? t("“{0}” is a Java keyword.", v) : null),
    onSubmit: async (newName) => {
      if (newName === w.text) return;
      await applyRename(w.text, newName, isLocal ? { path, lines: [target!.local!.method.line, target!.local!.method.endLine] } : null, target);
    },
  });
}

/** Renames a member or class (declared at `path`:`line`) in every Java file, as the diagram's dialogs do. */
export async function renameEverywhere(name: string, newName: string, path: string, line: number) {
  const type = javaIndex.types().find((x) => x.name === name && samePath(x.path, path) && x.line === line);
  await applyRename(name, newName, null, type ? { path, line, type } : null);
}

async function applyRename(name: string, newName: string, local: { path: string; lines: [number, number] } | null, target: Target | null) {
  const root = get().root;
  const paths = local ? [local.path] : [...new Set(javaIndex.types().map((x) => x.path))];
  let count = 0;
  let files = 0;
  try {
    for (const p of paths) {
      const doc = getDoc(p);
      const text = doc ? doc.state.doc.toString() : (await api.readText(p)).text;
      const tree = doc ? syntaxTree(doc.state) : javaLanguage.parser.parse(text);
      const at = codeOccurrences(text, tree, name, local?.lines);
      if (!at.length) continue;
      count += at.length;
      files++;
      const changes = at.map((from) => ({ from, to: from + name.length, insert: newName }));
      if (doc) changeDoc(p, changes);
      else {
        let out = text;
        for (const c of [...changes].reverse()) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
        await api.writeText(p, out);
        javaIndex.set(p, out);
      }
    }
    // A public class lives in a file of its own name.
    const type = target?.type;
    if (!local && type && !type.outer && stem(type.path) === name && root) {
      await movePath(type.path, join(dirname(type.path), `${newName}.java`));
    }
  } catch (e) {
    toast("error", t("Renaming stopped"), errorText(e));
    return;
  }
  toast("success", t("Renamed “{0}” to “{1}”", name, newName), t("{0} places in {1} files. Open files are changed but not saved yet.", count, files));
}
