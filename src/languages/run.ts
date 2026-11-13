/*
 * What running a program of any language has in common: saving first,
 * the output panel, compiling with problems listed and the first error
 * shown, and starting the program with its input from the panel.
 */
import { invoke } from "@tauri-apps/api/core";
import { appendOutput, clearOutput, get, set, toast } from "../lib/store";
import { errorText } from "../lib/api";
import type { CompileResult } from "../lib/types";
import { basename } from "../lib/paths";
import { splitArgs, useRunConfig } from "../lib/runConfig";
import { t } from "../lib/i18n";

const actions = () => import("../lib/actions");

/** Saves (when the setting says so), clears and shows the output; false when something is already running. */
export async function beginRun(label: string): Promise<boolean> {
  if (get().run.status !== "idle") return false;
  if (get().settings.saveBeforeRun && !(await (await actions()).saveAll(true))) return false;
  clearOutput();
  set({ panelOpen: true, panelTab: "output", run: { status: "compiling", label } });
  return true;
}

export function endRun() {
  if (get().run.status === "compiling") set({ run: { status: "idle" } });
}

/** The program arguments of the run configuration. */
export function programArgs(): string[] {
  return splitArgs(useRunConfig.getState().config.args);
}

/** Compiles with a native compiler; lists its problems and opens the first error when it fails. */
export async function compileNative(program: string, args: string[], cwd: string, files: number, what: string, env?: Record<string, string>): Promise<boolean> {
  appendOutput("system", t("Compiling with {0}…", what) + "\n");
  try {
    const r = await invoke<CompileResult>("native_compile", { program, args, cwd, files, env: env ?? null });
    const { setProblems, openFile } = await actions();
    setProblems(r.diagnostics);
    const errors = r.diagnostics.filter((d) => d.severity === "error").length;
    const warnings = r.diagnostics.length - errors;
    if (!r.ok) {
      appendOutput("stderr", r.output.trimEnd() + "\n");
      appendOutput("error", t("Compiling failed (errors: {0}, warnings: {1}).", errors, warnings) + "\n");
      const first = get().problems.find((p) => p.severity === "error");
      if (first) void openFile(first.path, { line: first.line, col: first.column || 1 });
      return false;
    }
    if (r.output.trim()) appendOutput("stderr", r.output.trimEnd() + "\n");
    appendOutput("success", t("Compiled in {0} ms (files: {1}).", r.durationMs, r.files) + (warnings ? " " + t("Warnings: {0}.", warnings) : "") + "\n");
    return true;
  } catch (e) {
    appendOutput("error", errorText(e) + "\n");
    return false;
  }
}

/** Starts a program in the output panel; `onEnd` hears its exit code and error output. */
export async function startProgram(
  program: string,
  args: string[],
  opts: { cwd?: string | null; env?: Record<string, string>; label?: string; echo?: string; onEnd?: (code: number | null, stderr: string) => void } = {},
): Promise<boolean> {
  appendOutput("system", (opts.echo ?? `${basename(program).replace(/\.(exe|cmd|bat)$/i, "")} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`) + "\n");
  try {
    const runId = await invoke<number>("run_program", { program, args, cwd: opts.cwd ?? null, env: opts.env ?? null });
    set({ run: { status: "running", runId, label: opts.label ?? basename(program), startedAt: Date.now() } });
    if (opts.onEnd) (await actions()).onRunEnd(runId, opts.onEnd);
    return true;
  } catch (e) {
    appendOutput("error", errorText(e) + "\n");
    set({ run: { status: "idle" } });
    return false;
  }
}

/** Says a tool is missing, with how to get it. */
export function missingTool(title: string, how: string) {
  endRun();
  appendOutput("error", `${title}\n${how}\n`);
  toast("error", title, how);
}
