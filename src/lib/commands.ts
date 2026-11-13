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
  Wand2,
  X,
  Bug,
  ListVideo,
  StepForward,
  ArrowRightToLine,
  ArrowDownToDot,
  ArrowUpFromDot,
  CircleDot,
  FlaskConical,
  TerminalSquare,
  SlidersHorizontal,
  Package,
  BookOpen,
  FileArchive,
  Coffee,
  Lightbulb,
} from "lucide-react";
import { expandAbbreviation } from "@emmetio/codemirror6-plugin";
import { findUsages, goToDefinition, renameSymbol } from "../editor/javaNav";
import { openSearchPanel } from "@codemirror/search";
import { toggleComment } from "@codemirror/commands";
import { activeView, shownPath } from "../editor/docs";
import { toggleBreakpointAt } from "../editor/breakpoints";
import * as D from "./debug";
import * as T from "./tools";
import { hasServer, organizeImports, quickFix, useLsp } from "../lsp/clients";
import * as A from "./actions";
import { activeIdOf, activeTab, get, openDialog, set } from "./store";

export interface Command {
  id: string;
  label: string;
  category: "File" | "Edit" | "View" | "Run" | "Help" | "UML";
  shortcut?: string;
  icon?: LucideIcon;
  run: () => void | Promise<void>;
  /** Hidden from the palette when false. */
  enabled?: () => boolean;
  /** The shortcut belongs to the editor's own key map; it is shown, not handled here. */
  editorKey?: boolean;
}

const hasFolder = () => !!get().root;
const hasEditor = () => !!activeView() && activeTab()?.kind === "file";
const paused = () => D.useDebug.getState().status === "paused";
const hasJava = () => hasEditor() && /\.java$/i.test(shownPath() ?? "");
const hasWeb = () => hasEditor() && /\.(html?|css)$/i.test(shownPath() ?? "");

function focusOther() {
  const g = get().focusGroup === 0 ? 1 : 0;
  const id = get().active[g];
  if (id) A.activate(id);
  requestAnimationFrame(() => activeView()?.focus());
}
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
  { id: "file.newClass", label: "New Java class…", category: "File", icon: Code, enabled: hasFolder, run: () => openDialog({ kind: "classWizard", dir: currentDir() }) },
  { id: "file.openFolder", label: "Open folder…", category: "File", icon: FolderOpen, shortcut: "Ctrl+O", run: () => A.chooseFolder() },
  { id: "file.openFile", label: "Open file…", category: "File", run: () => A.chooseFile() },
  { id: "file.quickOpen", label: "Go to file…", category: "File", shortcut: "Ctrl+P", enabled: hasFolder, run: () => openDialog({ kind: "palette", mode: "files" }) },
  { id: "file.save", label: "Save", category: "File", icon: Save, shortcut: "Ctrl+S", enabled: hasEditor, run: () => A.saveActive() },
  { id: "file.saveAs", label: "Save as…", category: "File", shortcut: "Ctrl+Shift+S", enabled: hasEditor, run: () => A.saveActiveAs() },
  { id: "file.saveAll", label: "Save all", category: "File", shortcut: "Ctrl+Alt+S", run: () => void A.saveAll() },
  { id: "file.close", label: "Close tab", category: "File", icon: X, shortcut: "Ctrl+W", enabled: () => !!activeIdOf(), run: () => void A.closeTab(activeIdOf()!) },
  { id: "file.closeAll", label: "Close all tabs", category: "File", enabled: () => get().tabs.length > 0, run: () => void A.closeAllTabs() },
  { id: "file.closeFolder", label: "Close folder", category: "File", enabled: hasFolder, run: () => A.closeFolder() },
  { id: "file.settings", label: "Settings", category: "File", icon: Settings, shortcut: "Ctrl+,", run: () => openDialog({ kind: "settings" }) },

  { id: "edit.undo", label: "Undo", category: "Edit", shortcut: "Ctrl+Z", enabled: hasEditor, run: editor((v) => import("@codemirror/commands").then((m) => m.undo(v))) },
  { id: "edit.redo", label: "Redo", category: "Edit", shortcut: "Ctrl+Y", enabled: hasEditor, run: editor((v) => import("@codemirror/commands").then((m) => m.redo(v))) },
  { id: "edit.find", label: "Find and replace", category: "Edit", icon: Search, shortcut: "Ctrl+F", enabled: hasEditor, run: editor((v) => openSearchPanel(v)) },
  { id: "edit.findInFiles", label: "Find in files", category: "Edit", shortcut: "Ctrl+Shift+F", enabled: hasFolder, run: () => set({ sidebar: "search" }) },
  { id: "edit.gotoLine", label: "Go to line…", category: "Edit", shortcut: "Ctrl+G", enabled: hasEditor, run: () => openDialog({ kind: "palette", mode: "line" }) },
  { id: "edit.comment", label: "Toggle comment", category: "Edit", shortcut: "Ctrl+/", enabled: hasEditor, run: editor((v) => toggleComment(v)) },
  { id: "edit.format", label: "Format document", category: "Edit", icon: Wand2, shortcut: "Shift+Alt+F", enabled: hasEditor, run: () => A.formatActive() },
  { id: "edit.definition", label: "Go to definition", category: "Edit", shortcut: "F12", editorKey: true, enabled: hasJava, run: editor((v) => void goToDefinition(v, shownPath()!)) },
  { id: "edit.usages", label: "Find usages", category: "Edit", shortcut: "Shift+F12", editorKey: true, enabled: hasJava, run: editor((v) => findUsages(v)) },
  { id: "edit.rename", label: "Rename symbol…", category: "Edit", shortcut: "F2", editorKey: true, enabled: hasJava, run: editor((v) => renameSymbol(v, shownPath()!)) },
  { id: "edit.quickfix", label: "Quick fix…", category: "Edit", icon: Lightbulb, shortcut: "Ctrl+.", editorKey: true, enabled: hasEditor, run: editor((v) => void quickFix(v, shownPath()!)) },
  { id: "edit.organizeImports", label: "Organize imports", category: "Edit", shortcut: "Shift+Alt+O", editorKey: true, enabled: () => hasJava() && hasServer(shownPath()!), run: editor((v) => void organizeImports(v, shownPath()!)) },
  { id: "help.javaServer", label: "Install the Java language server…", category: "Help", enabled: () => useLsp.getState().java === "missing", run: () => openDialog({ kind: "settings" }) },
  { id: "edit.emmet", label: "Expand Emmet abbreviation", category: "Edit", shortcut: "Ctrl+E", editorKey: true, enabled: hasWeb, run: editor((v) => void expandAbbreviation(v)) },

  { id: "view.explorer", label: "Show explorer", category: "View", icon: PanelLeft, shortcut: "Ctrl+Shift+E", run: () => set({ sidebar: "explorer" }) },
  { id: "view.outline", label: "Show outline", category: "View", run: () => set({ sidebar: "outline" }) },
  { id: "view.sidebar", label: "Toggle side bar", category: "View", shortcut: "Ctrl+B", run: () => A.toggleSidebar() },
  { id: "view.panel", label: "Toggle output panel", category: "View", icon: PanelBottom, shortcut: "Ctrl+J", run: () => A.togglePanel() },
  { id: "view.problems", label: "Show problems", category: "View", shortcut: "Ctrl+Shift+M", run: () => set({ panelOpen: true, panelTab: "problems" }) },
  { id: "view.split", label: "Split editor (move tab to the side)", category: "View", icon: Columns2, shortcut: "Ctrl+\\", enabled: () => !!activeTab(), run: () => A.splitEditor() },
  { id: "view.focusOther", label: "Focus the other editor group", category: "View", enabled: () => get().tabs.some((t) => t.group === 1), run: () => focusOther() },
  { id: "view.preview", label: "Toggle web preview", category: "View", icon: Columns2, shortcut: "Ctrl+Shift+V", enabled: hasFolder, run: () => A.togglePreview() },
  { id: "view.palette", label: "Command palette…", category: "View", shortcut: "Ctrl+Shift+P", run: () => openDialog({ kind: "palette", mode: "commands" }) },
  { id: "view.zoomIn", label: "Larger editor text", category: "View", shortcut: "Ctrl+=", run: () => zoom(1) },
  { id: "view.zoomOut", label: "Smaller editor text", category: "View", shortcut: "Ctrl+-", run: () => zoom(-1) },
  { id: "view.zoomReset", label: "Reset editor text size", category: "View", shortcut: "Ctrl+0", run: () => zoom(0) },

  { id: "uml.open", label: "Show UML class diagram", category: "UML", icon: Network, shortcut: "Ctrl+Shift+U", enabled: hasFolder, run: () => A.openUml() },
  { id: "uml.side", label: "Show UML class diagram to the side", category: "UML", enabled: hasFolder, run: () => A.openUml(1) },
  { id: "uml.layout", label: "Arrange UML diagram automatically", category: "UML", enabled: hasFolder, run: () => (A.openUml(), set((s) => ({ umlLayoutNonce: s.umlLayoutNonce + 1 }))) },

  { id: "run.run", label: "Run", category: "Run", icon: Play, shortcut: "F5", enabled: hasFolder, run: () => (D.useDebug.getState().status === "paused" ? void D.resume() : A.runActive()) },
  { id: "run.debug", label: "Start debugging", category: "Run", icon: Bug, shortcut: "F6", enabled: () => hasFolder() && !D.isDebugging() && get().run.status === "idle", run: () => D.startDebug() },
  { id: "run.trace", label: "Record a sequence diagram", category: "Run", icon: ListVideo, enabled: () => hasFolder() && !D.isDebugging() && get().run.status === "idle", run: () => D.startDebug(true) },
  { id: "debug.continue", label: "Continue", category: "Run", icon: StepForward, shortcut: "F8", enabled: paused, run: () => void D.resume() },
  { id: "debug.over", label: "Step over", category: "Run", icon: ArrowRightToLine, shortcut: "F10", enabled: paused, run: () => void D.stepOver() },
  { id: "debug.into", label: "Step into", category: "Run", icon: ArrowDownToDot, shortcut: "F11", enabled: paused, run: () => void D.stepInto() },
  { id: "debug.out", label: "Step out", category: "Run", icon: ArrowUpFromDot, shortcut: "Shift+F11", enabled: paused, run: () => void D.stepOut() },
  { id: "debug.breakpoint", label: "Toggle breakpoint", category: "Run", icon: CircleDot, shortcut: "F9", editorKey: true, enabled: hasJava, run: editor((v) => toggleBreakpointAt(v, v.state.selection.main.head)) },
  { id: "run.tests", label: "Run all tests", category: "Run", icon: FlaskConical, shortcut: "Ctrl+Shift+T", enabled: hasFolder, run: () => T.runTests() },
  { id: "run.jshell", label: "Open JShell", category: "Run", icon: TerminalSquare, enabled: hasFolder, run: () => (T.setPanelTab("jshell"), T.useShell.getState().running ? undefined : void T.startShell()) },
  { id: "run.config", label: "Run configuration…", category: "Run", icon: SlidersHorizontal, enabled: hasFolder, run: () => openDialog({ kind: "runConfig" }) },
  { id: "build.jar", label: "Export runnable JAR…", category: "Run", icon: Package, enabled: hasFolder, run: () => T.exportJar() },
  { id: "build.javadoc", label: "Generate Javadoc", category: "Run", icon: BookOpen, enabled: hasFolder, run: () => T.generateJavadoc() },
  { id: "project.libraries", label: "Libraries…", category: "Run", icon: FileArchive, enabled: hasFolder, run: () => openDialog({ kind: "libraries" }) },
  { id: "run.compile", label: "Compile Java", category: "Run", icon: Hammer, shortcut: "Ctrl+F9", enabled: hasFolder, run: () => void A.compileJava() },
  { id: "run.stop", label: "Stop", category: "Run", icon: CircleStop, shortcut: "Shift+F5", enabled: () => get().run.status === "running", run: () => A.stopRun() },
  { id: "run.output", label: "Show output", category: "Run", icon: SquareTerminal, run: () => set({ panelOpen: true, panelTab: "output" }) },

  { id: "help.shortcuts", label: "Keyboard shortcuts", category: "Help", icon: Keyboard, shortcut: "Ctrl+K", run: () => openDialog({ kind: "shortcuts" }) },
  { id: "help.jdk", label: "Install a JDK…", category: "Help", icon: Coffee, run: () => openDialog({ kind: "installJdk" }) },
  { id: "view.debug", label: "Show debugger", category: "View", icon: Bug, shortcut: "Ctrl+Shift+D", run: () => set({ sidebar: "debug" }) },
  { id: "uml.sequence", label: "Show sequence diagram", category: "UML", icon: ListVideo, enabled: hasFolder, run: () => A.openSequence() },
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
  if (e.code === "Backslash" || e.code === "IntlBackslash") key = "\\";
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  parts.push(key);
  return parts.join("+");
}

/** Shortcuts the editor itself must not swallow. */
const GLOBAL = new Set(COMMANDS.filter((c) => c.shortcut && !c.editorKey).map((c) => c.shortcut!));
// Left to CodeMirror while an editor has focus.
const EDITOR_OWNED = new Set(["Ctrl+Z", "Ctrl+Y", "Ctrl+F", "Ctrl+/"]);

export function handleShortcut(e: KeyboardEvent, inEditor: boolean): boolean {
  const sc = shortcutOf(e);
  if (!GLOBAL.has(sc)) return false;
  if (inEditor && EDITOR_OWNED.has(sc)) return false;
  const c = COMMANDS.find((x) => x.shortcut === sc && !x.editorKey);
  if (!c) return false;
  if (c.enabled && !c.enabled()) return true;
  e.preventDefault();
  // Handled here: the editor must not act on the same key too.
  e.stopPropagation();
  void c.run();
  return true;
}
