/*
 * Every Java file of the open folder, parsed; and beside it the files of
 * the other languages whose plug-in reads structure (Python). Files on disk
 * are read when the folder opens and when they change; open editors replace
 * their file's entry as you type, so the diagram, the outline and completion
 * always show the code as it is in the editor.
 */
import { useSyncExternalStore } from "react";
import { parseJava } from "./javaParser";
import { parsePython } from "../languages/python/structure";
import type { JFile, JType } from "./model";
import { extname } from "../lib/paths";

const key = (p: string) => p.replace(/\//g, "\\").toLowerCase();

class StructureIndex {
  private files = new Map<string, JFile>();
  private texts = new Map<string, string>();
  private listeners = new Set<() => void>();
  private queued = false;
  version = 0;

  constructor(private parse: (text: string, path: string) => JFile) {}

  private bump() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.version++;
      this.listeners.forEach((l) => l());
    });
  }

  set(path: string, text: string) {
    const k = key(path);
    if (this.texts.get(k) === text) return;
    this.texts.set(k, text);
    this.files.set(k, this.parse(text, path));
    this.bump();
  }

  remove(path: string) {
    const k = key(path);
    let changed = false;
    for (const f of [...this.files.keys()]) {
      if (f === k || f.startsWith(k + "\\")) {
        this.files.delete(f);
        this.texts.delete(f);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  replaceAll(sources: { path: string; text: string }[]) {
    this.files.clear();
    this.texts.clear();
    for (const s of sources) {
      this.texts.set(key(s.path), s.text);
      this.files.set(key(s.path), this.parse(s.text, s.path));
    }
    this.bump();
  }

  file(path: string): JFile | undefined {
    return this.files.get(key(path));
  }

  /** The text a file was indexed from. */
  text(path: string): string | undefined {
    return this.texts.get(key(path));
  }

  types(): JType[] {
    return [...this.files.values()].flatMap((f) => f.types);
  }

  /** How many files are indexed. */
  get size(): number {
    return this.files.size;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const javaIndex = new StructureIndex(parseJava);

/** Parsers of the other languages, by file extension. */
const OTHER_PARSERS: Record<string, (text: string, path: string) => JFile> = {
  py: parsePython,
  pyw: parsePython,
  pyi: parsePython,
};

/** The extensions whose files have a structure besides Java's. */
export const STRUCTURE_EXTENSIONS = Object.keys(OTHER_PARSERS);

/** Python and the other languages whose classes show in the outline and the diagram (shown, not edited). */
export const otherIndex = new StructureIndex((text, path) => OTHER_PARSERS[extname(path)](text, path));

/** The index a file belongs in, if any. */
export function indexFor(path: string): StructureIndex | null {
  const ext = extname(path);
  if (ext === "java") return javaIndex;
  if (OTHER_PARSERS[ext]) return otherIndex;
  return null;
}

/** Keeps a file's structure up to date with its text. */
export function indexText(path: string, text: string) {
  indexFor(path)?.set(path, text);
}

/** Forgets a removed file (or folder) in every index. */
export function unindex(path: string) {
  javaIndex.remove(path);
  otherIndex.remove(path);
}

/** A file's structure, whatever its language. */
export function structureOf(path: string): JFile | undefined {
  return indexFor(path)?.file(path);
}

/** The classes of every language, for the diagram; repeated names get a suffix so ids stay unique. */
export function allTypes(): JType[] {
  const out = javaIndex.types();
  const seen = new Set(out.map((x) => x.qualifiedName));
  for (const x of otherIndex.types()) {
    let q = x.qualifiedName;
    for (let i = 2; seen.has(q); i++) q = `${x.qualifiedName}~${i}`;
    seen.add(q);
    out.push(q === x.qualifiedName ? x : { ...x, qualifiedName: q });
  }
  return out;
}

/** Re-renders when any Java file's structure may have changed. */
export function useJavaIndexVersion(): number {
  return useSyncExternalStore(javaIndex.subscribe, () => javaIndex.version);
}

/** Re-renders when any file's structure may have changed, whatever its language. */
export function useStructureVersion(): number {
  const a = useSyncExternalStore(javaIndex.subscribe, () => javaIndex.version);
  const b = useSyncExternalStore(otherIndex.subscribe, () => otherIndex.version);
  return a * 100003 + b;
}
