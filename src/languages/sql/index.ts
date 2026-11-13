/*
 * SQL with SQLite, which is compiled in: F5 runs the file (or the
 * selection), Ctrl+Enter the statement at the cursor. The database is named
 * in the file itself, in a comment at the top (`-- database: shop.db`,
 * relative to the file), so the file says where it belongs; without one a
 * fresh database in memory is used for each run. Results show in Atomiq
 * Studio's grid in the Results panel; an error becomes a problem at its
 * statement. The database's tables and columns complete as you type.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { open as pickPath, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { get, openMenu, set, toast } from "../../lib/store";
import { errorText } from "../../lib/api";
import { basename, dirname, isInside, join, relative } from "../../lib/paths";
import { getDoc, groupShowing, viewOf } from "../../editor/docs";
import { sqlSchemas } from "../../editor/languages";
import type { Diagnostic } from "../../lib/types";
import { t } from "../../lib/i18n";
import type { LanguagePlugin } from "../plugin";

export type SqlValue = null | number | string | { blob: number; hex: string };

export interface SqlColumn {
  name: string;
  declType: string;
}

export interface SqlResult {
  /** Where the statement is in the file (UTF-16 offsets). */
  from: number;
  to: number;
  sql: string;
  columns: SqlColumn[];
  rows: SqlValue[][];
  truncated: boolean;
  changes: number;
  durationMs: number;
  error: string | null;
}

interface SqlState {
  path: string | null;
  /** The database file, or null for one in memory. */
  db: string | null;
  results: SqlResult[];
  selected: number;
  running: boolean;
  ranAt: number;
  sqliteVersion: string;
}

export const useSql = create<SqlState>(() => ({ path: null, db: null, results: [], selected: 0, running: false, ranAt: 0, sqliteVersion: "" }));

const DIRECTIVE = /^[ \t]*--[ \t]*(?:database|db)[ \t]*:[ \t]*(.*?)[ \t]*$/im;

/** The database a SQL file names in its first lines, resolved against the file's folder; null: in memory. */
export function databaseOf(text: string, path: string): string | null {
  const head = text.split("\n").slice(0, 12).join("\n");
  const m = DIRECTIVE.exec(head);
  const value = m?.[1].replace(/^["']|["']$/g, "").trim();
  if (!value || value === ":memory:") return null;
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(value)) return value;
  return join(dirname(path), ...value.split(/[\\/]/));
}

/** Writes (or replaces, or removes) the database comment at the top of the file. */
export function setDatabase(path: string, db: string | null) {
  const doc = getDoc(path);
  if (!doc) return;
  const text = doc.state.doc.toString();
  const value = db ? (isInside(db, dirname(path)) ? relative(dirname(path), db) : db) : ":memory:";
  const line = `-- database: ${value}`;
  const head = text.split("\n").slice(0, 12).join("\n");
  const m = DIRECTIVE.exec(head);
  const changes = m ? { from: m.index, to: m.index + m[0].length, insert: line } : { from: 0, to: 0, insert: line + "\n" };
  void import("../../lib/actions").then(({ changeDoc }) => {
    changeDoc(path, [changes]);
    void loadSchema(path);
  });
}

function utf16Line(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

/** Runs the file, the selection, or (`statement`) only the statement at the cursor. */
export async function runSql(path: string, mode: "all" | "statement" = "all") {
  const doc = getDoc(path);
  if (!doc || useSql.getState().running) return;
  const g = groupShowing(path);
  const state = (g !== null && viewOf(g)?.state) || doc.state;
  const text = state.doc.toString();
  const sel = state.selection.main;
  let script = text;
  let base = 0;
  let at: number | null = null;
  if (!sel.empty) {
    script = state.sliceDoc(sel.from, sel.to);
    base = sel.from;
  } else if (mode === "statement") at = sel.head;
  const db = databaseOf(text, path);
  useSql.setState({ running: true, path, db });
  set({ panelOpen: true, panelTab: "results" });
  const { setFileProblems } = await import("../../lib/actions");
  try {
    const r = await invoke<{ results: SqlResult[]; sqliteVersion: string }>("sql_run", { db, script, maxRows: get().settings.sqlMaxRows || 10000, at });
    const results = r.results.map((x) => ({ ...x, from: x.from + base, to: x.to + base }));
    const failed = results.find((x) => x.error);
    const problems: Diagnostic[] = failed ? [{ path, ...utf16Line(text, failed.from), severity: "error", message: failed.error! }] : [];
    setFileProblems([path], problems);
    // Show the last statement with rows (or the error).
    const shown = failed ? results.indexOf(failed) : Math.max(0, results.map((x) => x.columns.length > 0).lastIndexOf(true));
    useSql.setState({ results, selected: shown < 0 ? results.length - 1 : shown, running: false, ranAt: Date.now(), sqliteVersion: r.sqliteVersion });
    if (!results.length) toast("info", t("Nothing to run"), t("Write a statement such as SELECT 1; and run it with F5."));
    if (db) void loadSchema(path);
  } catch (e) {
    useSql.setState({ running: false, results: [], ranAt: Date.now() });
    toast("error", t("The SQL didn't run"), errorText(e));
  }
}

/** Reads the database's tables for completion; the editor's grammar is rebuilt with them. */
export async function loadSchema(path: string) {
  const doc = getDoc(path);
  const db = doc ? databaseOf(doc.state.doc.toString(), path) : null;
  const key = path.toLowerCase();
  if (!db) {
    if (sqlSchemas.delete(key)) void import("../../lib/actions").then((m) => m.refreshLanguages(["sql"]));
    return;
  }
  const tables = await invoke<{ name: string; kind: string; columns: SqlColumn[] }[]>("sql_schema", { db }).catch(() => []);
  const schema = Object.fromEntries(tables.map((x) => [x.name, x.columns.map((c) => ({ label: c.name, type: "property", detail: c.declType.toLowerCase() || undefined }))]));
  const before = JSON.stringify(sqlSchemas.get(key) ?? null);
  sqlSchemas.set(key, schema);
  if (JSON.stringify(schema) !== before) void import("../../lib/actions").then((m) => m.refreshLanguages(["sql"]));
}

async function chooseDatabase(path: string) {
  const picked = await pickPath({ multiple: false, directory: false, defaultPath: dirname(path), filters: [{ name: t("SQLite database"), extensions: ["db", "sqlite", "sqlite3", "db3"] }] });
  if (typeof picked === "string") setDatabase(path, picked);
}

async function newDatabase(path: string) {
  const picked = await pickSavePath({ defaultPath: join(dirname(path), basename(path).replace(/\.sql$/i, "") + ".db"), filters: [{ name: t("SQLite database"), extensions: ["db"] }] });
  if (picked) setDatabase(path, picked);
}

export function databaseMenu(path: string, anchor: HTMLElement) {
  const doc = getDoc(path);
  const db = doc ? databaseOf(doc.state.doc.toString(), path) : null;
  openMenu({
    anchor,
    align: "end",
    items: [
      { type: "heading", label: db ? basename(db) : t("Database in memory") },
      { label: t("Choose a database file…"), onSelect: () => void chooseDatabase(path) },
      { label: t("New database file…"), onSelect: () => void newDatabase(path) },
      { label: t("Use a fresh database in memory"), checked: !db, onSelect: () => setDatabase(path, null) },
      { type: "separator" },
      { label: t("Run the file"), shortcut: "F5", onSelect: () => void runSql(path) },
      { label: t("Run the statement at the cursor"), shortcut: "Ctrl+Enter", onSelect: () => void runSql(path, "statement") },
    ],
  });
}

export const sqlPlugin: LanguagePlugin = {
  languages: ["sql"],
  run: (path) => runSql(path),
  status(path) {
    const doc = getDoc(path);
    const db = doc ? databaseOf(doc.state.doc.toString(), path) : null;
    return { label: db ? `SQLite · ${basename(db)}` : t("SQLite · in memory"), tooltip: db ?? t("Each run starts with an empty database. Choose a file to keep the data."), onClick: (a) => databaseMenu(path, a) };
  },
  editor: (path) =>
    Prec.high(
      keymap.of([
        { key: "Mod-Enter", run: () => (void runSql(path(), "statement"), true) },
        { key: "Shift-Mod-Enter", run: () => (void runSql(path()), true) },
      ]),
    ),
};
