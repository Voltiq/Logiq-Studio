/*
 * Undo and redo in the class diagram. What the diagram changes in code (members, inheritance, associations,
 * new classes) and in the project's relations (aggregation, composition) is reported here; the diagram in
 * view keeps it with its own layout changes as steps to take back with Ctrl+Z and do again with Ctrl+Y.
 */
import { api, errorText } from "../lib/api";
import { getDoc } from "../editor/docs";
import { minimalChange } from "../editor/format";
import { dirname } from "../lib/paths";
import { get, toast } from "../lib/store";
import { t } from "../lib/i18n";
import { javaIndex, unindex } from "./javaIndex";
import type { Whole } from "./relations";

/** A file's text before and after a change; null where it didn't exist. */
export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}

export interface UmlChange {
  files?: FileChange[];
  wholes?: { before: Record<string, Whole>; after: Record<string, Whole> };
}

let recorder: ((c: UmlChange) => void) | null = null;

/** The diagram in view takes what is changed from now on (until the returned function is called). */
export function setRecorder(r: (c: UmlChange) => void): () => void {
  recorder = r;
  return () => {
    if (recorder === r) recorder = null;
  };
}

export function record(c: UmlChange) {
  recorder?.(c);
}

interface UndoTarget {
  undo: () => void;
  redo: () => void;
}

let target: UndoTarget | null = null;

/** The diagram whose steps Edit → Undo and Redo take, while it is in view. */
export function setUndoTarget(u: UndoTarget): () => void {
  target = u;
  return () => {
    if (target === u) target = null;
  };
}

export const undoTarget = () => target;

const norm = (s: string | null) => (s === null ? null : s.replace(/\r\n/g, "\n"));

async function current(path: string): Promise<string | null> {
  const doc = getDoc(path);
  if (doc) return doc.state.doc.toString();
  return api
    .readText(path)
    .then((f) => f.text)
    .catch(() => null);
}

/**
 * Takes file changes back (`undo`) or does them again. Nothing is touched when a file was changed since by
 * something else: that is said, and false returned.
 */
export async function applyFiles(files: FileChange[], undo: boolean): Promise<boolean> {
  const steps = undo ? [...files].reverse() : files;
  for (const f of steps) {
    const from = undo ? f.after : f.before;
    if (norm(await current(f.path)) !== norm(from)) {
      toast("warning", t("The code was changed since"), t("{0} isn't as the diagram left it. Undo the change in its editor instead.", f.path.split(/[\\/]/).pop()!));
      return false;
    }
  }
  const actions = await import("../lib/actions");
  try {
    for (const f of steps) {
      const from = undo ? f.after : f.before;
      const to = undo ? f.before : f.after;
      if (to === null) {
        // A class the diagram created: its file goes to the recycle bin again.
        const tabs = get().tabs.filter((x) => x.path && x.path.toLowerCase() === f.path.toLowerCase()).map((x) => x.id);
        if (tabs.length && !(await actions.closeTabs(tabs))) return false;
        await api.delete(f.path);
        unindex(f.path);
        await actions.loadDir(dirname(f.path)).catch(() => {});
      } else if (from === null) {
        await api.createFile(f.path, to);
        javaIndex.set(f.path, to);
        await actions.loadDir(dirname(f.path)).catch(() => {});
      } else if (getDoc(f.path)) {
        actions.changeDoc(f.path, [minimalChange(from, to)]);
      } else {
        await api.writeText(f.path, to);
        javaIndex.set(f.path, to);
      }
    }
    return true;
  } catch (e) {
    toast("error", t("The code wasn't changed"), errorText(e));
    return false;
  }
}
