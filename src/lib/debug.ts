/*
 * The debugger as the page sees it: breakpoints per file, the session's
 * state (running or paused, the call stack, variables, watches), and the
 * trace of a run for the sequence diagram.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { errorText } from "./api";
import { appendOutput, clearOutput, get as getApp, set as setApp, toast } from "./store";
import { compileJava, mainClassFor, openFile, saveAll, setDebugHooks } from "./actions";
import { useRunConfig, splitArgs } from "./runConfig";
import { t } from "./i18n";
import { javaIndex } from "../uml/javaIndex";
import { getDoc, groupShowing, viewOf, allDocs } from "../editor/docs";
import { breakpointLines, debugLineEffect, setBreakpointsEffect } from "../editor/breakpoints";

export interface DebugVar {
  name: string;
  type: string;
  value: string;
  id?: number;
  error?: boolean;
}

export interface DebugFrame {
  cls: string;
  method: string;
  line: number;
  source: string;
}

export interface TraceCall {
  kind: "call" | "return";
  from: string;
  to: string;
  method: string;
  args?: string;
  value?: string;
  depth: number;
}

export interface Trace {
  participants: string[];
  calls: TraceCall[];
  truncated: boolean;
}

interface DebugState {
  status: "off" | "starting" | "running" | "paused";
  tracing: boolean;
  reason: string | null;
  exception: string | null;
  frames: DebugFrame[];
  frame: number;
  variables: DebugVar[];
  children: Record<number, DebugVar[]>;
  expanded: Record<number, boolean>;
  watches: string[];
  watchValues: Record<string, DebugVar>;
  /** Breakpoint lines by file path (lowercase keys). */
  breakpoints: Record<string, { path: string; lines: number[] }>;
  trace: Trace | null;
}

export const useDebug = create<DebugState>(() => ({
  status: "off",
  tracing: false,
  reason: null,
  exception: null,
  frames: [],
  frame: 0,
  variables: [],
  children: {},
  expanded: {},
  watches: loadWatches(),
  watchValues: {},
  breakpoints: {},
  trace: null,
}));
const set = useDebug.setState;
const get = useDebug.getState;

function loadWatches(): string[] {
  try {
    return JSON.parse(localStorage.getItem("logiq.watches") ?? "[]");
  } catch {
    return [];
  }
}

// ----- Breakpoints ---------------------------------------------------------------------

const bpKey = (root: string) => `logiq.breakpoints.${root.toLowerCase()}`;

export function loadBreakpoints(root: string | null) {
  let breakpoints: DebugState["breakpoints"] = {};
  if (root) {
    try {
      breakpoints = JSON.parse(localStorage.getItem(bpKey(root)) ?? "{}");
    } catch {
      breakpoints = {};
    }
  }
  set({ breakpoints });
}

function saveBreakpoints() {
  const root = getApp().root;
  if (!root) return;
  try {
    localStorage.setItem(bpKey(root), JSON.stringify(get().breakpoints));
  } catch {
    // Not kept.
  }
}

/** The lines saved for a file, for a newly opened editor. */
export function savedBreakpoints(path: string): number[] {
  return get().breakpoints[path.toLowerCase()]?.lines ?? [];
}

/** The class a line of a Java file belongs to, as the JVM names it for breakpoints. */
function classForLine(path: string, line: number): string | null {
  const file = javaIndex.file(path);
  if (!file) return null;
  const top = file.types.filter((x) => !x.outer);
  const hit = top.find((x) => x.line <= line && x.endLine >= line) ?? top[0];
  return hit ? hit.qualifiedName : null;
}

/** Called when an editor's breakpoints change (toggled, or moved by edits). */
export function syncBreakpoints(path: string, lines: number[]) {
  const before = get().breakpoints[path.toLowerCase()]?.lines ?? [];
  const same = before.length === lines.length && before.every((l, i) => l === lines[i]);
  if (same) return;
  const breakpoints = { ...get().breakpoints };
  if (lines.length) breakpoints[path.toLowerCase()] = { path, lines };
  else delete breakpoints[path.toLowerCase()];
  set({ breakpoints });
  saveBreakpoints();
  // A running session learns about the change at once.
  if (get().status === "running" || get().status === "paused") {
    for (const l of lines.filter((x) => !before.includes(x))) send(["break", classForLine(path, l) ?? "", String(l), "1"]);
    for (const l of before.filter((x) => !lines.includes(x))) send(["break", classForLine(path, l) ?? "", String(l), "0"]);
  }
}

export function removeBreakpoint(path: string, line: number) {
  const doc = getDoc(path);
  const lines = savedBreakpoints(path).filter((l) => l !== line);
  if (doc) {
    const g = groupShowing(path);
    const effect = setBreakpointsEffect(lines);
    if (g !== null && viewOf(g)) viewOf(g)!.dispatch({ effects: effect });
    else doc.state = doc.state.update({ effects: effect }).state;
  }
  syncBreakpoints(path, lines);
}

export function clearBreakpoints() {
  for (const { path, lines } of Object.values(get().breakpoints)) {
    if (get().status === "running" || get().status === "paused") for (const l of lines) send(["break", classForLine(path, l) ?? "", String(l), "0"]);
  }
  for (const doc of allDocs()) {
    const g = groupShowing(doc.path);
    const effect = setBreakpointsEffect([]);
    if (g !== null && viewOf(g)) viewOf(g)!.dispatch({ effects: effect });
    else doc.state = doc.state.update({ effects: effect }).state;
  }
  set({ breakpoints: {} });
  saveBreakpoints();
}

/** Lines of all files as "Class:line" for the debugger. */
function breakpointSpecs(): string[] {
  const out: string[] = [];
  for (const { path, lines } of Object.values(get().breakpoints)) {
    const doc = getDoc(path);
    const current = doc ? breakpointLines(doc.state) : lines;
    for (const l of current) {
      const cls = classForLine(path, l);
      if (cls) out.push(`${cls}:${l}`);
    }
  }
  return out;
}

// ----- Session --------------------------------------------------------------------------

function send(fields: string[]) {
  void invoke("debug_send", { fields }).catch(() => {});
}

/** Starts the program under the debugger; with `trace`, records calls for a sequence diagram. */
export async function startDebug(trace = false) {
  const root = getApp().root;
  if (!root || get().status !== "off" || getApp().run.status !== "idle") return;
  if (getApp().settings.saveBeforeRun) await saveAll(true);
  if (!(await compileJava())) return;
  const active = getApp().tabs.find((x) => x.id === getApp().active[getApp().focusGroup]);
  const main = mainClassFor(active?.path ?? null);
  if (!main) {
    appendOutput("error", t("No class has a main method. Add `public static void main(String[] args)` to run the program.") + "\n");
    return;
  }
  const cfg = useRunConfig.getState().config;
  clearOutput();
  appendOutput("system", (trace ? t("Recording the calls of {0}…", main.name) : t("Debugging {0}", main.name)) + "\n");
  set({ status: "starting", tracing: trace, frames: [], variables: [], children: {}, expanded: {}, reason: null, exception: null, watchValues: {} });
  setApp({ run: { status: "running", runId: -1, label: main.name.split(".").pop()!, startedAt: Date.now() }, panelOpen: true, panelTab: "output" });
  if (!trace) setApp({ sidebar: "debug" });
  try {
    await invoke("debug_start", {
      root,
      jdkHome: getApp().settings.jdkHome || getApp().jdks[0]?.home || null,
      mainClass: main.name,
      args: splitArgs(cfg.args),
      vmOptions: cfg.vmOptions,
      breakpoints: trace ? [] : breakpointSpecs(),
      trace,
      projectClasses: javaIndex
        .types()
        .filter((x) => !x.outer)
        .map((x) => x.qualifiedName),
    });
  } catch (e) {
    appendOutput("error", errorText(e) + "\n");
    end();
  }
}

function end() {
  clearDebugLine();
  set({ status: "off", frames: [], variables: [], children: {}, reason: null });
  setApp({ run: { status: "idle" } });
}

let debugLinePath: string | null = null;
function clearDebugLine() {
  if (!debugLinePath) return;
  const doc = getDoc(debugLinePath);
  if (doc) {
    const g = groupShowing(debugLinePath);
    if (g !== null && viewOf(g)) viewOf(g)!.dispatch({ effects: debugLineEffect(null) });
    else doc.state = doc.state.update({ effects: debugLineEffect(null) }).state;
  }
  debugLinePath = null;
}

/** The project file a frame's class is in. */
export function pathOfClass(cls: string): string | null {
  const q = cls.replace(/\$.*$/, "");
  return javaIndex.types().find((x) => x.qualifiedName === q)?.path ?? null;
}

async function showFrame(i: number) {
  const f = get().frames[i];
  clearDebugLine();
  if (!f) return;
  const path = pathOfClass(f.cls);
  if (!path) return;
  await openFile(path, { line: f.line });
  const doc = getDoc(path);
  if (!doc) return;
  const g = groupShowing(path);
  if (g !== null && viewOf(g)) viewOf(g)!.dispatch({ effects: debugLineEffect(f.line) });
  debugLinePath = path;
}

export function selectFrame(i: number) {
  if (get().status !== "paused") return;
  set({ frame: i, children: {}, expanded: {} });
  send(["frame", String(i)]);
}

export const resume = () => get().status === "paused" && send(["resume"]);
export const stepOver = () => get().status === "paused" && send(["over"]);
export const stepInto = () => get().status === "paused" && send(["into"]);
export const stepOut = () => get().status === "paused" && send(["out"]);
export const pause = () => get().status === "running" && send(["pause"]);

export async function stopDebug() {
  if (get().status === "off") return;
  await invoke("debug_stop").catch(() => {});
  appendOutput("system", "\n" + t("Debugging stopped.") + "\n");
  end();
}

export function toggleExpand(v: DebugVar) {
  if (v.id === undefined) return;
  const open = !get().expanded[v.id];
  set({ expanded: { ...get().expanded, [v.id]: open } });
  if (open && !get().children[v.id]) send(["expand", String(v.id)]);
}

export function addWatch(expr: string) {
  const e = expr.trim();
  if (!e || get().watches.includes(e)) return;
  const watches = [...get().watches, e];
  set({ watches });
  localStorage.setItem("logiq.watches", JSON.stringify(watches));
  if (get().status === "paused") send(["eval", String(get().frame), e]);
}

export function removeWatch(expr: string) {
  const watches = get().watches.filter((w) => w !== expr);
  set({ watches });
  localStorage.setItem("logiq.watches", JSON.stringify(watches));
}

function refreshWatches() {
  for (const w of get().watches) send(["eval", String(get().frame), w]);
}

let started = false;

export async function initDebug() {
  if (started) return;
  started = true;
  setDebugHooks({
    active: () => get().status !== "off",
    input: (text) => send(["input", text]),
    stop: () => void stopDebug(),
    lines: (path, state) => syncBreakpoints(path, breakpointLines(state)),
    initial: (path) => setBreakpointsEffect(savedBreakpoints(path)),
    folder: (root) => {
      loadBreakpoints(root);
      set({ trace: null });
    },
  });
  await listen<string>("debug-event", (e) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(e.payload);
    } catch {
      return;
    }
    switch (ev.event) {
      case "started":
        set({ status: "running" });
        break;
      case "output":
        appendOutput(ev.stream === "stderr" ? "stderr" : "stdout", String(ev.text));
        break;
      case "stopped": {
        const frames = ev.frames as DebugFrame[];
        const frame = Number(ev.frame ?? 0);
        set({
          status: "paused",
          reason: String(ev.reason),
          exception: (ev.exception as string) ?? null,
          frames,
          frame,
          variables: ev.variables as DebugVar[],
          children: {},
          expanded: {},
        });
        if (ev.reason !== "frame") refreshWatches();
        void showFrame(frame);
        if (ev.exception) appendOutput("error", `${ev.exception}\n`);
        break;
      }
      case "resumed":
        clearDebugLine();
        set({ status: "running", frames: [], variables: [], children: {}, expanded: {} });
        break;
      case "children":
        set({ children: { ...get().children, [Number(ev.id)]: ev.children as DebugVar[] } });
        break;
      case "watch": {
        const v = ev.value as DebugVar;
        set({ watchValues: { ...get().watchValues, [v.name]: v } });
        break;
      }
      case "trace":
        set({ trace: { participants: ev.participants as string[], calls: ev.calls as TraceCall[], truncated: !!ev.truncated } });
        void import("./actions").then((m) => m.openSequence());
        break;
      case "exited": {
        const code = Number(ev.code);
        appendOutput(code === 0 ? "success" : "error", "\n" + (code === 0 ? t("Program finished.") : t("Program ended with exit code {0}.", code)) + "\n");
        end();
        break;
      }
      case "error":
        toast("error", t("Debugger"), String(ev.message));
        break;
      case "closed":
        if (get().status !== "off") end();
        break;
    }
  });
}

export function isDebugging(): boolean {
  return get().status !== "off";
}

export function breakpointCount(): number {
  return Object.values(get().breakpoints).reduce((n, b) => n + b.lines.length, 0);
}

