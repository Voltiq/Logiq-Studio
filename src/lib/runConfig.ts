/*
 * How the project runs: which main class, with which program arguments and
 * JVM options. Kept per folder in the browser storage of the app.
 */
import { create } from "zustand";

export interface RunConfig {
  /** Qualified name; null runs the active file's main class (or the only one). */
  mainClass: string | null;
  args: string;
  vmOptions: string;
}

const EMPTY: RunConfig = { mainClass: null, args: "", vmOptions: "" };
const key = (root: string) => `logiq.run.${root.toLowerCase()}`;

export const useRunConfig = create<{ root: string | null; config: RunConfig }>(() => ({ root: null, config: EMPTY }));

export function loadRunConfig(root: string | null) {
  let config = EMPTY;
  if (root) {
    try {
      config = { ...EMPTY, ...JSON.parse(localStorage.getItem(key(root)) ?? "{}") };
    } catch {
      config = EMPTY;
    }
  }
  useRunConfig.setState({ root, config });
}

export function saveRunConfig(patch: Partial<RunConfig>) {
  const { root, config } = useRunConfig.getState();
  const next = { ...config, ...patch };
  useRunConfig.setState({ config: next });
  if (root) {
    try {
      localStorage.setItem(key(root), JSON.stringify(next));
    } catch {
      // Not kept; the run still uses it this session.
    }
  }
}

/** Splits a command line like the shell does: spaces separate, quotes group. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}
