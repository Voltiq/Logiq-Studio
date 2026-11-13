/*
 * Every Java file of the open folder, parsed. Files on disk are read when
 * the folder opens and when they change; open editors replace their file's
 * entry as you type, so the diagram, the outline and completion always show
 * the code as it is in the editor.
 */
import { useSyncExternalStore } from "react";
import { parseJava } from "./javaParser";
import type { JFile, JType } from "./model";

const key = (p: string) => p.replace(/\//g, "\\").toLowerCase();

class JavaIndex {
  private files = new Map<string, JFile>();
  private texts = new Map<string, string>();
  private listeners = new Set<() => void>();
  private queued = false;
  version = 0;

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
    this.files.set(k, parseJava(text, path));
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
      this.files.set(key(s.path), parseJava(s.text, s.path));
    }
    this.bump();
  }

  file(path: string): JFile | undefined {
    return this.files.get(key(path));
  }

  types(): JType[] {
    return [...this.files.values()].flatMap((f) => f.types);
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const javaIndex = new JavaIndex();

/** Re-renders when any Java file's structure may have changed. */
export function useJavaIndexVersion(): number {
  return useSyncExternalStore(javaIndex.subscribe, () => javaIndex.version);
}
