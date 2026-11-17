import { create } from "zustand";
import type { MenuRequest } from "../components/ui/Menu";
import { loadSettings, saveSettings, type Settings } from "./settings";
import type { Diagnostic, Entry, Jdk, NodeInfo } from "./types";
import type { TemplateId } from "./templates";

export type SidebarView = "explorer" | "search" | "outline" | "debug" | "git";
export type PanelTab = "output" | "problems" | "tests" | "jshell" | "terminal" | "results";

export type Group = 0 | 1;

export interface Tab {
  /** The file's path; for the class diagram, its .uml file (null for the project's diagram). */
  id: string;
  kind: "file" | "uml" | "image" | "sequence" | "diff" | "gui";
  path: string | null;
  title: string;
  dirty: boolean;
  /** The editor group: 0 on the left, 1 to the side. */
  group: Group;
  pinned?: boolean;
}

export interface SearchRequest {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Only files with these extensions. */
  extensions?: string[];
  nonce: number;
}

export type OutputKind = "stdout" | "stderr" | "system" | "input" | "success" | "error";

export interface OutputChunk {
  id: number;
  kind: OutputKind;
  text: string;
}

export type RunState =
  | { status: "idle" }
  | { status: "compiling"; label: string }
  | { status: "running"; runId: number; label: string; startedAt: number };

export interface ToastData {
  id: number;
  appearance: "success" | "error" | "warning" | "info";
  title: string;
  description?: string;
  /** A button in the toast: what to do about it. */
  action?: { label: string; run: () => void };
}

export type Dialog =
  | { kind: "newProject"; template?: TemplateId }
  | { kind: "settings" }
  | { kind: "about" }
  | { kind: "shortcuts" }
  | { kind: "newJavaFile"; dir: string }
  | {
      kind: "prompt";
      title: string;
      label: string;
      value: string;
      confirmLabel: string;
      /** Select the name without its extension. */
      selectStem?: boolean;
      /** Several lines of text (a note). */
      multiline?: boolean;
      validate?: (value: string) => string | null;
      onSubmit: (value: string) => Promise<void> | void;
    }
  | {
      kind: "confirm";
      title: string;
      body: string;
      confirmLabel: string;
      danger?: boolean;
      secondaryLabel?: string;
      onConfirm: () => Promise<void> | void;
      onSecondary?: () => Promise<void> | void;
      onCancel?: () => void;
    }
  | { kind: "palette"; mode: "commands" | "files" | "line" }
  | { kind: "classWizard"; dir: string }
  | {
      kind: "pickClasses";
      title: string;
      options: { value: string; label: string; detail?: string }[];
      selected: string[];
      confirmLabel: string;
      onSubmit: (values: string[]) => void;
    }
  | { kind: "editClass"; owner: string }
  /** Add (no `line`) or edit (the member's line) an attribute, method or constructor. */
  | { kind: "member"; owner: string; member: "field" | "method" | "ctor"; line?: number }
  | { kind: "association"; from: string; to: string }
  | { kind: "benchNew"; cls: string; ctorLine: number | null }
  | { kind: "benchCall"; owner: string; methodLine: number; target: string | null }
  | { kind: "runConfig" }
  | { kind: "libraries" }
  /** What each language needs, whether it is installed, and installing it; `focus` puts one first. */
  | { kind: "languages"; focus?: import("../languages/setup").SetupId }
  | { kind: "clone" }
  | { kind: "update"; update: import("./updates").Update }
  | { kind: "manual" };

export interface State {
  settings: Settings;
  root: string | null;
  tree: Record<string, Entry[] | undefined>;
  expanded: Record<string, boolean>;
  selected: string | null;
  /** Explorer multi-selection (always includes `selected`). */
  selection: string[];
  /** Files cut or copied in the explorer. */
  clipboard: { mode: "copy" | "cut"; paths: string[] } | null;
  tabs: Tab[];
  /** The active tab of each editor group. */
  active: [string | null, string | null];
  /** The group last used. */
  focusGroup: Group;
  searchRequest: SearchRequest | null;
  sidebar: SidebarView | null;
  panelOpen: boolean;
  panelTab: PanelTab;
  previewOpen: boolean;
  previewPath: string | null;
  previewNonce: number;
  /** PHP's web server for the preview of PHP pages. */
  phpServer: { port: number; root: string } | null;
  run: RunState;
  output: OutputChunk[];
  problems: Diagnostic[];
  jdks: Jdk[];
  node: NodeInfo | null;
  cursor: { line: number; col: number; selected: number };
  menu: MenuRequest | null;
  dialog: Dialog | null;
  toasts: ToastData[];
  /** Bumped when the editors must re-read their diagnostics. */
  problemsVersion: number;
  /** Bumped when the UML diagram should lay itself out again. */
  umlLayoutNonce: number;
  /** The tour of the window is showing. */
  tour: boolean;
}

export const useStore = create<State>(() => ({
  settings: loadSettings(),
  root: null,
  tree: {},
  expanded: {},
  selected: null,
  selection: [],
  clipboard: null,
  tabs: [],
  active: [null, null],
  focusGroup: 0,
  searchRequest: null,
  sidebar: "explorer",
  panelOpen: false,
  panelTab: "output",
  previewOpen: false,
  previewPath: null,
  previewNonce: 0,
  phpServer: null,
  run: { status: "idle" },
  output: [],
  problems: [],
  jdks: [],
  node: null,
  cursor: { line: 1, col: 1, selected: 0 },
  menu: null,
  dialog: null,
  toasts: [],
  problemsVersion: 0,
  umlLayoutNonce: 0,
  tour: false,
}));

export const get = useStore.getState;

/** The active tab of the focused group. */
export function activeTab(s: State = get()): Tab | undefined {
  const id = s.active[s.focusGroup] ?? s.active[0];
  return s.tabs.find((t) => t.id === id);
}

export function activeIdOf(s: State = get()): string | null {
  return s.active[s.focusGroup] ?? s.active[0];
}
export const set = useStore.setState;

export function setSettings(patch: Partial<Settings>) {
  const settings = { ...get().settings, ...patch };
  saveSettings(settings);
  set({ settings });
}

let toastId = 0;
export function toast(appearance: ToastData["appearance"], title: string, description?: string, action?: ToastData["action"]) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, appearance, title, description, action }] }));
  window.setTimeout(() => dismissToast(id), action ? 12000 : appearance === "error" ? 8000 : 4500);
}

export function dismissToast(id: number) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function openMenu(menu: MenuRequest) {
  set({ menu });
}

export function openDialog(dialog: Dialog) {
  set({ dialog, menu: null });
}

export function closeDialog() {
  set({ dialog: null });
}

let chunkId = 0;
const MAX_OUTPUT = 4000;

export function appendOutput(kind: OutputKind, text: string) {
  if (!text) return;
  set((s) => {
    const last = s.output[s.output.length - 1];
    // Consecutive output of one kind joins one chunk, so the list stays short.
    if (last && last.kind === kind && (kind === "stdout" || kind === "stderr") && last.text.length < 4000) {
      const output = s.output.slice(0, -1);
      output.push({ ...last, text: last.text + text });
      return { output };
    }
    const output = [...s.output, { id: ++chunkId, kind, text }];
    return { output: output.length > MAX_OUTPUT ? output.slice(-MAX_OUTPUT) : output };
  });
}

export function clearOutput() {
  set({ output: [] });
}
