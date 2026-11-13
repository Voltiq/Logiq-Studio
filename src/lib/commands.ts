/*
 * Every command the app offers, in one list: the menus, the command palette
 * and the keyboard shortcuts all read it, so a command looks and behaves the
 * same wherever it is started from.
 */
import type { LucideIcon } from "lucide-react";
import {
  CircleStop,
  Code,
  Columns2,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Hammer,
  Keyboard,
  Network,
  PanelBottom,
  PanelLeft,
  Play,
  Save,
  Search,
  Settings,
  SquareTerminal,
  X,
} from "lucide-react";
import { indentRange } from "@codemirror/language";
import { openSearchPanel, gotoLine } from "@codemirror/search";
import { toggleComment } from "@codemirror/commands";
import { activeView } from "../editor/docs";
import * as A from "./actions";
import { get, openDialog, set } from "./store";

export interface Command {
  id: string;
  label: string;
  category: "File" | "Edit" | "View" | "Run" | "Help" | "UML";
  shortcut?: string;
  icon?: LucideIcon;
  run: () => void | Promise<void>;
  /** Hidden from the palette when false. */
  enabled?: () => boolean;
}

const hasFolder = () => !!get().root;
const hasEditor = () => !!activeView() && get().tabs.find((t) => t.id === get().activeId)?.kind === "file";
const editor = (f: (v: NonNullable<ReturnType<typeof activeView>>) => void) => () => {
  const v = activeView();
  if (v && hasEditor()) {
    f(v);
    v.focus();
  }
};

export const COMMANDS: Command[] = [
  { id: "file.newProject", label: "New project…", category: "File", icon: FolderPlus, shortcut: "Ctrl+Shift+N", run: () => openDialog({ kind: "newProject" }) },
  { id: "file.newFile", label: "New file…", category: "File", icon: FilePlus, shortcut: "Ctrl+N", enabled: hasFolder, run: () => A.newFile(currentDir()) },
  { id: "file.newClass", label: "New Java class…", category: "File", icon: Code, enabled: hasFolder, run: () => openDialog({ kind: "newJavaFile", dir: currentDir() }) },
  { id: "file.openFolder", label: "Open folder…", category: "File", icon: FolderOpen, shortcut: "Ctrl+O", run: () => A.chooseFolder() },
  { id: "file.openFile", label: "Open file…", category: "File", run: () => A.chooseFile() },
  { id: "file.quickOpen", label: "Go to file…", category: "File", shortcut: "Ctrl+P", enabled: hasFolder, run: () => openDialog({ kind: "palette", mode: "files" }) },
  { id: "file.save", label: "Save", category: "File", icon: Save, shortcut: "Ctrl+S", enabled: hasEditor, run: () => A.saveActive() },
  { id: "file.saveAs", label: "Save as…", category: "File", shortcut: "Ctrl+Shift+S", enabled: hasEditor, run: () => A.saveActiveAs() },
  { id: "file.saveAll", label: "Save all", category: "File", shortcut: "Ctrl+Alt+S", run: () => void A.saveAll() },
  { id: "file.close", label: "Close tab", category: "File", icon: X, shortcut: "Ctrl+W", enabled: () => !!get().activeId, run: () => void A.closeTab(get().activeId!) },
  { id: "file.closeAll", label: "Close all tabs", category: "File", enabled: () => get().tabs.length > 0, run: () => void A.closeAllTabs() },
  { id: "file.closeFolder", label: "Close folder", category: "File", enabled: hasFolder, run: () => A.closeFolder() },
  { id: "file.settings", label: "Settings", category: "File", icon: Settings, shortcut: "Ctrl+,", run: () => openDialog({ kind: "settings" }) },

  { id: "edit.undo", label: "Undo", category: "Edit", shortcut: "Ctrl+Z", enabled: hasEditor, run: editor((v) => import("@codemirror/commands").then((m) => m.undo(v))) },
  { id: "edit.redo", label: "Redo", category: "Edit", shortcut: "Ctrl+Y", enabled: hasEditor, run: editor((v) => import("@codemirror/commands").then((m) => m.redo(v))) },
  { id: "edit.find", label: "Find and replace", category: "Edit", icon: Search, shortcut: "Ctrl+F", enabled: hasEditor, run: editor((v) => openSearchPanel(v)) },
  { id: "edit.findInFiles", label: "Find in files", category: "Edit", shortcut: "Ctrl+Shift+F", enabled: hasFolder, run: () => set({ sidebar: "search" }) },
  { id: "edit.gotoLine", label: "Go to line…", category: "Edit", shortcut: "Ctrl+G", enabled: hasEditor, run: editor((v) => gotoLine(v)) },
  { id: "edit.comment", label: "Toggle comment", category: "Edit", shortcut: "Ctrl+/", enabled: hasEditor, run: editor((v) => toggleComment(v)) },
  {
    id: "edit.format",
    label: "Format document",
    category: "Edit",
    shortcut: "Shift+Alt+F",
    enabled: hasEditor,
    run: editor((v) => {
      const changes = indentRange(v.state, 0, v.state.doc.length);
      if (!changes.empty) v.dispatch({ changes, userEvent: "format" });
    }),
  },

  { id: "view.explorer", label: "Show explorer", category: "View", icon: PanelLeft, shortcut: "Ctrl+Shift+E", run: () => set({ sidebar: "explorer" }) },
  { id: "view.outline", label: "Show outline", category: "View", run: () => set({ sidebar: "outline" }) },
  { id: "view.sidebar", label: "Toggle side bar", category: "View", shortcut: "Ctrl+B", run: () => A.toggleSidebar() },
  { id: "view.panel", label: "Toggle output panel", category: "View", icon: PanelBottom, shortcut: "Ctrl+J", run: () => A.togglePanel() },
  { id: "view.problems", label: "Show problems", category: "View", shortcut: "Ctrl+Shift+M", run: () => set({ panelOpen: true, panelTab: "problems" }) },
  { id: "view.preview", label: "Toggle web preview", category: "View", icon: Columns2, shortcut: "Ctrl+Shift+V", enabled: hasFolder, run: () => A.togglePreview() },
  { id: "view.palette", label: "Command palette…", category: "View", shortcut: "Ctrl+Shift+P", run: () => openDialog({ kind: "palette", mode: "commands" }) },
  { id: "view.zoomIn", label: "Larger editor text", category: "View", shortcut: "Ctrl+=", run: () => zoom(1) },
  { id: "view.zoomOut", label: "Smaller editor text", category: "View", shortcut: "Ctrl+-", run: () => zoom(-1) },
  { id: "view.zoomReset", label: "Reset editor text size", category: "View", shortcut: "Ctrl+0", run: () => zoom(0) },

  { id: "uml.open", label: "Show UML class diagram", category: "UML", icon: Network, shortcut: "Ctrl+Shift+U", enabled: hasFolder, run: () => A.openUml() },
  { id: "uml.layout", label: "Arrange UML diagram automatically", category: "UML", enabled: hasFolder, run: () => (A.openUml(), set((s) => ({ umlLayoutNonce: s.umlLayoutNonce + 1 }))) },

  { id: "run.run", label: "Run", category: "Run", icon: Play, shortcut: "F5", enabled: hasFolder, run: () => A.runActive() },
  { id: "run.compile", label: "Compile Java", category: "Run", icon: Hammer, shortcut: "Ctrl+F9", enabled: hasFolder, run: () => void A.compileJava() },
  { id: "run.stop", label: "Stop", category: "Run", icon: CircleStop, shortcut: "Shift+F5", enabled: () => get().run.status === "running", run: () => A.stopRun() },
  { id: "run.output", label: "Show output", category: "Run", icon: SquareTerminal, run: () => set({ panelOpen: true, panelTab: "output" }) },

  { id: "help.shortcuts", label: "Keyboard shortcuts", category: "Help", icon: Keyboard, shortcut: "Ctrl+K", run: () => openDialog({ kind: "shortcuts" }) },
  { id: "help.about", label: "About Logiq Studio", category: "Help", run: () => openDialog({ kind: "about" }) },
];

export function command(id: string): Command {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown command ${id}`);
  return c;
}

export function runCommand(id: string) {
  const c = command(id);
  if (c.enabled && !c.enabled()) return;
  void c.run();
}

function currentDir(): string {
  const s = get();
  const root = s.root!;
  const sel = s.selected;
  if (!sel) return root;
  const entry = Object.values(s.tree)
    .flat()
    .find((e) => e && e.path === sel);
  if (entry?.isDir) return entry.path;
  const parent = sel.replace(/[\\/][^\\/]*$/, "");
  return parent.toLowerCase().startsWith(root.toLowerCase()) ? parent : root;
}

function zoom(step: number) {
  const s = get().settings;
  const fontSize = step === 0 ? 13 : Math.max(9, Math.min(28, s.fontSize + step));
  import("./store").then((m) => m.setSettings({ fontSize }));
}

/** Normalises a keyboard event into the shortcut notation used above. */
export function shortcutOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let key = e.key;
  if (key === "+") key = "=";
  if (key.length === 1) key = key.toUpperCase();
  if (e.code === "Equal") key = "=";
  if (e.code === "Minus") key = "-";
  if (e.code === "Comma") key = ",";
  if (e.code === "Slash" || e.code === "NumpadDivide") key = "/";
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  parts.push(key);
  return parts.join("+");
}

/** Shortcuts the editor itself must not swallow. */
const GLOBAL = new Set(COMMANDS.filter((c) => c.shortcut).map((c) => c.shortcut!));
// Left to CodeMirror while an editor has focus.
const EDITOR_OWNED = new Set(["Ctrl+Z", "Ctrl+Y", "Ctrl+F", "Ctrl+G", "Ctrl+/"]);

export function handleShortcut(e: KeyboardEvent, inEditor: boolean): boolean {
  const sc = shortcutOf(e);
  if (!GLOBAL.has(sc)) return false;
  if (inEditor && EDITOR_OWNED.has(sc)) return false;
  const c = COMMANDS.find((x) => x.shortcut === sc);
  if (!c) return false;
  if (c.enabled && !c.enabled()) return true;
  e.preventDefault();
  void c.run();
  return true;
}
