/*
 * The tools the language plug-ins use: Python interpreters (a project's
 * virtual environment first), C and C++ compilers, PHP, Kotlin and their
 * language servers. Found once per folder and kept here; the one in use is
 * the one chosen in the status bar (per project for Python), else the first
 * found.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { get as getApp, openMenu, toast } from "../lib/store";
import { basename, dirname, join } from "../lib/paths";
import { t } from "../lib/i18n";
import type { MenuItem } from "../components/ui/Menu";

export type ToolKind = "python" | "cc" | "cxx" | "php" | "kotlinc" | "clangd" | "clang-format" | "python-lsp" | "php-lsp" | "kotlin-lsp";

export interface Tool {
  path: string;
  version: string;
  /** Where it was found: "PATH", "LLVM", ".venv"… */
  source: string;
}

interface ToolchainState {
  root: string | null;
  found: Partial<Record<ToolKind, Tool[]>>;
  /** Chosen paths: per project for Python, for every project otherwise. */
  chosen: Partial<Record<ToolKind, string>>;
  version: number;
}

export const useToolchain = create<ToolchainState>(() => ({ root: null, found: {}, chosen: loadChosen(null), version: 0 }));

const pending = new Map<ToolKind, Promise<Tool[]>>();

function chosenKey(root: string | null) {
  return root ? `logiq.tools.${root.toLowerCase()}` : "logiq.tools";
}

function loadChosen(root: string | null): Partial<Record<ToolKind, string>> {
  try {
    const global = JSON.parse(localStorage.getItem("logiq.tools") ?? "{}");
    const own = root ? JSON.parse(localStorage.getItem(chosenKey(root)) ?? "{}") : {};
    return { ...global, ...own };
  } catch {
    return {};
  }
}

/** Forgets what was found when another folder opens (its virtual environment differs). */
export function toolchainFolder(root: string | null) {
  pending.clear();
  useToolchain.setState((s) => ({ root, found: {}, chosen: loadChosen(root), version: s.version + 1 }));
}

/** The tools of a kind found on this computer (cached until `refresh`). */
export function findTools(kind: ToolKind, refresh = false): Promise<Tool[]> {
  const known = useToolchain.getState().found[kind];
  if (known && !refresh) return Promise.resolve(known);
  if (!refresh && pending.has(kind)) return pending.get(kind)!;
  const root = getApp().root;
  const p = invoke<Tool[]>("tools_find", { kind, root })
    .catch(() => [] as Tool[])
    .then((list) => {
      pending.delete(kind);
      useToolchain.setState((s) => ({ found: { ...s.found, [kind]: list }, version: s.version + 1 }));
      return list;
    });
  pending.set(kind, p);
  return p;
}

/** The tool in use: the chosen one if it is still there, else the first found. */
export async function toolFor(kind: ToolKind): Promise<Tool | null> {
  const list = await findTools(kind);
  const chosen = useToolchain.getState().chosen[kind];
  return list.find((x) => x.path === chosen) ?? list[0] ?? null;
}

/** The tool in use right now, without looking (for the status bar). */
export function currentTool(kind: ToolKind): Tool | null | undefined {
  const s = useToolchain.getState();
  const list = s.found[kind];
  if (!list) return undefined;
  return list.find((x) => x.path === s.chosen[kind]) ?? list[0] ?? null;
}

export function chooseTool(kind: ToolKind, path: string) {
  const root = getApp().root;
  const perProject = kind === "python" && root;
  const key = perProject ? chosenKey(root) : "logiq.tools";
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    saved[kind] = path;
    localStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Kept for this session.
  }
  useToolchain.setState((s) => ({ chosen: { ...s.chosen, [kind]: path }, version: s.version + 1 }));
}

/** A short name for a tool in menus and the status bar: "Python 3.14 (.venv)", "clang 23.1". */
export function toolLabel(kind: ToolKind, tool: Tool): string {
  const exe = basename(tool.path).replace(/\.(exe|cmd|bat)$/i, "");
  const v = tool.version.split(".").slice(0, 2).join(".");
  const name = kind === "python" ? "Python" : kind === "php" ? "PHP" : kind === "kotlinc" ? "Kotlin" : exe;
  const where = tool.source === "PATH" || tool.source === "Python" || tool.source === "PHP" || tool.source === "Kotlin" ? "" : ` (${tool.source})`;
  return `${name}${v ? " " + v : ""}${where}`;
}

/** A menu to pick the tool of a kind, with a way to look again. */
export async function toolMenu(kind: ToolKind, anchor: HTMLElement, extra: MenuItem[] = []) {
  const list = await findTools(kind);
  const current = await toolFor(kind);
  const items: MenuItem[] = list.map((x) => ({
    label: toolLabel(kind, x),
    detail: x.path,
    checked: current?.path === x.path,
    onSelect: () => chooseTool(kind, x.path),
  }));
  if (!items.length) items.push({ label: t("None found"), disabled: true, onSelect: () => {} });
  items.push(
    { type: "separator" },
    {
      label: t("Look again"),
      onSelect: () =>
        void findTools(kind, true).then((l) => toast("info", t("Found: {0}", l.length), l.map((x) => toolLabel(kind, x)).join(" · ") || undefined)),
    },
    ...extra,
  );
  openMenu({ anchor, align: "end", items });
}

/** Where a project's build output goes: `<root>/build` (or next to the file outside a folder). */
export function buildDir(file: string): string {
  const root = getApp().root;
  return join(root ?? dirname(file), "build");
}

/** The JDK's `java` (Kotlin runs on it). */
export function javaExe(): string {
  const home = getApp().settings.jdkHome || getApp().jdks[0]?.home;
  return home ? join(home, "bin", navigator.userAgent.includes("Windows") ? "java.exe" : "java") : "java";
}

export function jdkHome(): string | null {
  return getApp().settings.jdkHome || getApp().jdks[0]?.home || null;
}
