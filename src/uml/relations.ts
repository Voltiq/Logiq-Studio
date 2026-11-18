/*
 * Which associations are aggregations (a part that can exist on its own, hollow diamond) or compositions
 * (a part owned by its whole, filled diamond). Java code doesn't say, so the choice is kept for the project in
 * .logiq/relations.json, and every diagram of the project shows it the same way.
 */
import { create } from "zustand";
import { api } from "../lib/api";
import { join } from "../lib/paths";
import { record } from "./history";

export type Whole = "aggregation" | "composition";

interface RelationsState {
  root: string | null;
  /** By "From->To" (qualified class names). */
  wholes: Record<string, Whole>;
}

export const useRelations = create<RelationsState>(() => ({ root: null, wholes: {} }));

export const relationKey = (from: string, to: string) => `${from}->${to}`;

const fileOf = (root: string) => join(root, ".logiq", "relations.json");

/** Reads the project's choices (once per folder). */
export async function loadRelations(root: string) {
  if (useRelations.getState().root === root) return;
  useRelations.setState({ root, wholes: {} });
  try {
    const data = JSON.parse((await api.readText(fileOf(root))).text) as { wholes?: Record<string, string> };
    const wholes: Record<string, Whole> = {};
    for (const [k, v] of Object.entries(data.wholes ?? {})) if (v === "aggregation" || v === "composition") wholes[k] = v;
    if (useRelations.getState().root === root) useRelations.setState({ wholes });
  } catch {
    // None chosen yet.
  }
}

/** Makes an association an aggregation or a composition, or a plain association again (null). */
export function setWhole(from: string, to: string, whole: Whole | null) {
  const { root, wholes } = useRelations.getState();
  if (!root || (wholes[relationKey(from, to)] ?? null) === whole) return;
  const next = { ...wholes };
  if (whole) next[relationKey(from, to)] = whole;
  else delete next[relationKey(from, to)];
  record({ wholes: { before: wholes, after: next } });
  setWholes(next);
}

/** Puts back every choice at once (undo and redo). */
export function setWholes(next: Record<string, Whole>) {
  const { root } = useRelations.getState();
  if (!root) return;
  useRelations.setState({ wholes: next });
  void api.writeText(fileOf(root), JSON.stringify({ version: 1, wholes: next }, null, 2) + "\n").catch(() => {});
}
