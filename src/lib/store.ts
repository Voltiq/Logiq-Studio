import { create } from "zustand";
import type { MenuRequest } from "../components/ui/Menu";
import { loadSettings, saveSettings, type Settings } from "./settings";
import type { Diagnostic, Entry, Jdk, NodeInfo } from "./types";
import type { TemplateId } from "./templates";

export type SidebarView = "explorer" | "search" | "outline";
export type PanelTab = "output" | "problems";

export interface Tab {
  /** The file's path, or "uml" for the class diagram. */
  id: string;
  kind: "file" | "uml" | "image";
  path: string | null;
  title: string;
  dirty: boolean;
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
  | { kind: "palette"; mode: "commands" | "files" | "line" };

export interface State {
  settings: Settings;
  root: string | null;
  tree: Record<string, Entry[] | undefined>;
  expanded: Record<string, boolean>;
  selected: string | null;
  tabs: Tab[];
  activeId: string | null;
  sidebar: SidebarView | null;
  panelOpen: boolean;
  panelTab: PanelTab;
  previewOpen: boolean;
  previewPath: string | null;
  previewNonce: number;
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
}

export const useStore = create<State>(() => ({
  settings: loadSettings(),
  root: null,
  tree: {},
  expanded: {},
  selected: null,
  tabs: [],
  activeId: null,
  sidebar: "explorer",
  panelOpen: false,
  panelTab: "output",
  previewOpen: false,
  previewPath: null,
  previewNonce: 0,
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
}));

export const get = useStore.getState;
export const set = useStore.setState;

export function setSettings(patch: Partial<Settings>) {
  const settings = { ...get().settings, ...patch };
  saveSettings(settings);
  set({ settings });
}

let toastId = 0;
export function toast(appearance: ToastData["appearance"], title: string, description?: string) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, appearance, title, description }] }));
  window.setTimeout(() => dismissToast(id), appearance === "error" ? 8000 : 4500);
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
