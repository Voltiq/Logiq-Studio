/*
 * Terminals in the bottom panel. Each tab is a shell in a pseudo console on
 * the native side, drawn by xterm.js. The xterm instances live here, outside
 * React, so a terminal keeps its screen while the panel shows something else.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { get as getApp, set as setApp, toast, useStore } from "./store";
import { errorText } from "./api";
import { t } from "./i18n";
import { shellLine } from "./shellLine";

export interface Shell {
  id: string;
  name: string;
  path: string;
  args: string[];
}

export interface TermTab {
  id: number;
  title: string;
  shell: string;
  exited: boolean;
}

interface TermState {
  tabs: TermTab[];
  active: number | null;
  shells: Shell[];
}

export const useTerminals = create<TermState>(() => ({ tabs: [], active: null, shells: [] }));
const setT = useTerminals.setState;
const getT = useTerminals.getState;

interface Instance {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  shell: Shell;
  cwd: string;
  started: boolean;
  /** Text to type once the shell is up (Run in terminal before it started). */
  queued: string[];
}

const instances = new Map<number, Instance>();
let nextId = 1;
let listening: Promise<void> | null = null;

function listenOnce() {
  listening ??= (async () => {
    await listen<{ id: number; data: string }>("term-data", (e) => instances.get(e.payload.id)?.term.write(e.payload.data));
    await listen<{ id: number; code: number | null }>("term-exit", (e) => {
      const inst = instances.get(e.payload.id);
      inst?.term.write(`\r\n\x1b[2m${t("The shell ended (exit code {0}). Press Enter to start it again.", String(e.payload.code ?? "?"))}\x1b[0m\r\n`);
      setT((s) => ({ tabs: s.tabs.map((x) => (x.id === e.payload.id ? { ...x, exited: true } : x)) }));
    });
  })();
  return listening;
}

export async function loadShells(): Promise<Shell[]> {
  if (getT().shells.length) return getT().shells;
  const shells = await invoke<Shell[]>("term_shells").catch(() => []);
  setT({ shells });
  return shells;
}

/** ANSI colours that sit well on the Graphiq panels, light and dark. */
const DARK = ["#1b1e24", "#f0616d", "#4cc38a", "#e5b54a", "#6f8cff", "#b07cf7", "#46c2d9", "#c9ccd3", "#5c6370", "#ff7b86", "#6ee0a6", "#f3cd6b", "#93a8ff", "#c79bff", "#72d9ea", "#f5f6f8"];
const LIGHT = ["#2b3038", "#c9283a", "#1f8a57", "#9a6a00", "#3552d4", "#7c3fd1", "#16839a", "#6b7280", "#4a505e", "#e0364a", "#23a067", "#b88200", "#4a66e8", "#9256e6", "#1b9ab3", "#111318"];
const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

function themeFor(host: Element | null): ITheme {
  const dark = document.documentElement.dataset.theme !== "light";
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = host ? getComputedStyle(host).backgroundColor : "";
  const ansi = dark ? DARK : LIGHT;
  const theme: ITheme = {
    background: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : v("--bg-2", dark ? "#101216" : "#f6f7f9"),
    foreground: v("--text", dark ? "#e8eaee" : "#111318"),
    cursor: v("--accent", "#6457f0"),
    cursorAccent: v("--bg-2", "#101216"),
    selectionBackground: dark ? "rgba(100, 87, 240, 0.42)" : "rgba(100, 87, 240, 0.25)",
  };
  NAMES.forEach((n, i) => {
    (theme as Record<string, string>)[n] = ansi[i];
    (theme as Record<string, string>)[`bright${n[0].toUpperCase()}${n.slice(1)}`] = ansi[i + 8];
  });
  return theme;
}

/** Follows the app's light and dark switch. */
new MutationObserver(() => {
  for (const inst of instances.values()) inst.term.options.theme = themeFor(inst.el.parentElement);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

function fontSize() {
  return Math.max(11, Math.min(20, (getApp().settings.fontSize ?? 14) - 1));
}

async function spawn(id: number) {
  const inst = instances.get(id);
  if (!inst) return;
  inst.started = true;
  setT((s) => ({ tabs: s.tabs.map((x) => (x.id === id ? { ...x, exited: false } : x)) }));
  try {
    // A project's Python environment is active in its terminals.
    const { terminalEnvironment } = await import("../languages");
    const extra = await terminalEnvironment().catch(() => ({ env: {}, pathPrepend: [] as string[] }));
    await invoke("term_open", { id, shell: inst.shell.path, args: inst.shell.args, cwd: inst.cwd, cols: inst.term.cols, rows: inst.term.rows, jdkHome: getApp().settings.jdkHome || null, env: extra.env, pathPrepend: extra.pathPrepend });
    for (const text of inst.queued.splice(0)) void invoke("term_write", { id, data: text }).catch(() => {});
  } catch (e) {
    inst.term.write(`\x1b[31m${errorText(e)}\x1b[0m\r\n`);
    setT((s) => ({ tabs: s.tabs.map((x) => (x.id === id ? { ...x, exited: true } : x)) }));
  }
}

/** Opens a new terminal tab in the project folder and shows it. */
export async function newTerminal(shellId?: string, cwd?: string): Promise<number> {
  await listenOnce();
  const shells = await loadShells();
  const preferred = shellId ?? getApp().settings.terminalShell;
  const shell = shells.find((s) => s.id === preferred) ?? shells[0];
  if (!shell) {
    toast("error", t("No shell found"), t("Logiq Studio looks for PowerShell, the Command Prompt and Git Bash."));
    return -1;
  }
  const id = nextId++;
  const term = new Terminal({
    fontFamily: '"Geist Mono Variable", "Geist Mono", Consolas, monospace',
    fontSize: fontSize(),
    lineHeight: 1.15,
    cursorStyle: getApp().settings.terminalCursor,
    cursorInactiveStyle: "outline",
    cursorBlink: getApp().settings.terminalCursorBlink,
    scrollback: 5000,
    allowProposedApi: true,
    theme: themeFor(null),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri).catch(() => {})));
  const el = document.createElement("div");
  el.className = "terminal-screen";
  const inst: Instance = { term, fit, el, shell, cwd: cwd ?? getApp().root ?? "", started: false, queued: [] };
  instances.set(id, inst);
  term.onData((data) => {
    const tab = getT().tabs.find((x) => x.id === id);
    if (tab?.exited) {
      if (data === "\r") {
        term.reset();
        void spawn(id);
      }
      return;
    }
    void invoke("term_write", { id, data }).catch(() => {});
  });
  term.onResize(({ cols, rows }) => void invoke("term_resize", { id, cols, rows }).catch(() => {}));
  term.onTitleChange((title) => setT((s) => ({ tabs: s.tabs.map((x) => (x.id === id ? { ...x, title: title.replace(/^.*[\\/]/, "") || shell.name } : x)) })));
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const ctrl = e.ctrlKey || e.metaKey;
    // Copy with Ctrl+C when text is selected (otherwise Ctrl+C stops the program), paste with Ctrl+V.
    if (ctrl && (e.key === "c" || e.key === "C") && (e.shiftKey || term.hasSelection())) {
      void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
      return false;
    }
    if (ctrl && (e.key === "v" || e.key === "V")) return false;
    return true;
  });
  setT((s) => ({ tabs: [...s.tabs, { id, title: shell.name, shell: shell.id, exited: false }], active: id }));
  setApp({ panelOpen: true, panelTab: "terminal" });
  return id;
}

/** The cursor of every terminal, after the setting changes. */
export function applyCursor() {
  const { terminalCursor, terminalCursorBlink } = getApp().settings;
  for (const inst of instances.values()) {
    inst.term.options.cursorStyle = terminalCursor;
    inst.term.options.cursorBlink = terminalCursorBlink;
  }
}

// The cursor follows the setting, also when settings are imported.
useStore.subscribe((s, p) => {
  if (s.settings.terminalCursor !== p.settings.terminalCursor || s.settings.terminalCursorBlink !== p.settings.terminalCursorBlink) applyCursor();
});

/** Puts terminal `id` into `host` and starts its shell once it knows its size. */
export function attach(id: number, host: HTMLElement) {
  const inst = instances.get(id);
  if (!inst) return;
  if (inst.el.parentElement !== host) host.appendChild(inst.el);
  if (!inst.term.element) inst.term.open(inst.el);
  inst.term.options.theme = themeFor(host);
  inst.term.options.fontSize = fontSize();
  fitNow(id);
  if (!inst.started) void spawn(id);
  inst.term.focus();
}

export function fitNow(id: number | null) {
  const inst = id === null ? undefined : instances.get(id);
  if (!inst || !inst.el.isConnected || !inst.el.clientWidth) return;
  try {
    inst.fit.fit();
  } catch {
    // Not laid out yet.
  }
}

export function detach(id: number) {
  instances.get(id)?.el.remove();
}

export function closeTerminal(id: number) {
  const inst = instances.get(id);
  void invoke("term_close", { id }).catch(() => {});
  inst?.term.dispose();
  inst?.el.remove();
  instances.delete(id);
  setT((s) => {
    const tabs = s.tabs.filter((x) => x.id !== id);
    const i = s.tabs.findIndex((x) => x.id === id);
    const active = s.active === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active;
    return { tabs, active };
  });
}

export function showTerminal(id: number) {
  setT({ active: id });
  setApp({ panelOpen: true, panelTab: "terminal" });
}

/** Shows the terminal panel, opening a terminal when there is none. */
export async function toggleTerminal() {
  const app = getApp();
  if (app.panelOpen && app.panelTab === "terminal") {
    setApp({ panelOpen: false });
    return;
  }
  if (!getT().tabs.length) await newTerminal();
  else setApp({ panelOpen: true, panelTab: "terminal" });
}

/**
 * Types a command into a terminal and runs it: the active one, or a new one
 * when there is none or `fresh` is asked for. Returns the terminal's id.
 */
export async function runInTerminal(command: string, opts: { fresh?: boolean; cwd?: string } = {}): Promise<number> {
  let id = opts.fresh ? null : getT().active;
  if (id === null || getT().tabs.find((x) => x.id === id)?.exited) id = await newTerminal(undefined, opts.cwd);
  if (id < 0) return id;
  showTerminal(id);
  const inst = instances.get(id)!;
  const text = command + "\r";
  if (inst.started) void invoke("term_write", { id, data: text }).catch(() => {});
  else inst.queued.push(text);
  return id;
}

/** Runs a program in a terminal, quoted for the shell that terminal runs. */
export async function runProgramInTerminal(program: string, args: string[], opts: { cwd?: string } = {}): Promise<number> {
  const active = getT().tabs.find((x) => x.id === getT().active && !x.exited);
  const shells = await loadShells();
  const shell = active?.shell ?? (shells.find((s) => s.id === getApp().settings.terminalShell) ?? shells[0])?.id ?? "powershell";
  return runInTerminal(shellLine(shell, program, args), opts);
}

/** The active terminal's selected text, for Copy in the panel's menu. */
export function terminalSelection(): string {
  const id = getT().active;
  return id === null ? "" : (instances.get(id)?.term.getSelection() ?? "");
}

export function clearTerminal() {
  const id = getT().active;
  if (id !== null) instances.get(id)?.term.clear();
}
