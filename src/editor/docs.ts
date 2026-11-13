/*
 * The open documents. Each file keeps its own editor state (text, selection,
 * undo history); each editor group's view shows whichever of its files is
 * active. A file is open in one group at a time.
 */
import type { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rebase } from "../lib/paths";

export type Group = 0 | 1;

export interface Doc {
  path: string;
  state: EditorState;
  /** The text as last saved or loaded, to tell whether the file is dirty. */
  saved: Text;
  eol: "lf" | "crlf";
}

const docs = new Map<string, Doc>();

export const keyOf = (p: string) => p.replace(/\//g, "\\").toLowerCase();

export function getDoc(path: string): Doc | undefined {
  return docs.get(keyOf(path));
}

export function putDoc(doc: Doc) {
  docs.set(keyOf(doc.path), doc);
}

export function dropDoc(path: string) {
  docs.delete(keyOf(path));
}

export function allDocs(): Doc[] {
  return [...docs.values()];
}

/** Moves every document at or under `from` to `to`; returns the moves. */
export function moveDocs(from: string, to: string): { from: string; to: string }[] {
  const moved: { from: string; to: string }[] = [];
  const f = keyOf(from);
  for (const [k, doc] of [...docs]) {
    if (k === f || k.startsWith(f + "\\")) {
      docs.delete(k);
      const path = rebase(doc.path, from, to);
      moved.push({ from: doc.path, to: path });
      doc.path = path;
      docs.set(keyOf(path), doc);
    }
  }
  for (const g of [0, 1] as Group[]) {
    const p = shown[g];
    if (p && (keyOf(p) === f || keyOf(p).startsWith(f + "\\"))) shown[g] = rebase(p, from, to);
  }
  return moved;
}

export function isDirty(doc: Doc): boolean {
  return !doc.state.doc.eq(doc.saved);
}

const views: [EditorView | null, EditorView | null] = [null, null];
/** The path each group's view shows. */
const shown: [string | null, string | null] = [null, null];
let focused: Group = 0;

export function setView(group: Group, v: EditorView | null) {
  views[group] = v;
}

export function viewOf(group: Group): EditorView | null {
  return views[group];
}

export function groupOfView(v: EditorView): Group | null {
  return views[0] === v ? 0 : views[1] === v ? 1 : null;
}

/** The view of the group last used, for commands such as Find or Format. */
export function activeView(): EditorView | null {
  return shown[focused] ? views[focused] : null;
}

export function setFocusedGroup(g: Group) {
  focused = g;
}

export function focusedGroup(): Group {
  return focused;
}

export function setShownPath(group: Group, p: string | null) {
  shown[group] = p;
}

/** The path shown in a group (the focused group by default). */
export function shownPath(group: Group = focused): string | null {
  return shown[group];
}

/** The group whose view shows `path`, if any. */
export function groupShowing(path: string): Group | null {
  const k = keyOf(path);
  if (shown[0] && keyOf(shown[0]) === k) return 0;
  if (shown[1] && keyOf(shown[1]) === k) return 1;
  return null;
}
