/*
 * The open documents. Each file keeps its own editor state (text, selection,
 * undo history) while one editor view shows whichever is active.
 */
import type { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rebase } from "../lib/paths";

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
  return moved;
}

export function isDirty(doc: Doc): boolean {
  return !doc.state.doc.eq(doc.saved);
}

let view: EditorView | null = null;
/** The path shown in the editor view. */
let shown: string | null = null;

export function setView(v: EditorView | null) {
  view = v;
}

export function activeView(): EditorView | null {
  return view;
}

export function setShownPath(p: string | null) {
  shown = p;
}

export function shownPath(): string | null {
  return shown;
}
