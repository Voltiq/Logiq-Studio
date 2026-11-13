/*
 * Python: runs a script with the project's interpreter (its virtual
 * environment when there is one) with output as it is printed and input
 * from the panel; an exception becomes a problem at its line. Creates
 * virtual environments, installs requirements and packages in the terminal,
 * runs pytest or unittest, and uses a Python language server (Pyright,
 * basedpyright, pylsp or jedi) when one is installed.
 */
import { invoke } from "@tauri-apps/api/core";
import { appendOutput, get, openDialog, toast } from "../../lib/store";
import { errorText } from "../../lib/api";
import { basename, dirname, isInside, join, relative } from "../../lib/paths";
import { t } from "../../lib/i18n";
import { beginRun, missingTool, programArgs, startProgram } from "../run";
import { currentTool, findTools, toolFor, toolLabel, toolMenu } from "../toolchain";
import { parseTraceback } from "./traceback";
import type { LanguagePlugin } from "../plugin";

const how = () => t("Install Python from python.org (tick “Add python.exe to PATH”) or run `winget install Python.Python.3.13`, then choose it in the status bar.");

async function python() {
  const py = await toolFor("python");
  if (!py) missingTool(t("Python wasn't found"), how());
  return py;
}

/** The virtual environment folder a Python interpreter belongs to, if any. */
function venvOf(pythonPath: string): string | null {
  const scripts = dirname(pythonPath);
  return /[\\/](Scripts|bin)$/.test(scripts) ? dirname(scripts) : null;
}

function runEnv(pythonPath: string): Record<string, string> {
  const env: Record<string, string> = { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
  const venv = venvOf(pythonPath);
  if (venv) env.VIRTUAL_ENV = venv;
  return env;
}

async function run(path: string) {
  if (!(await beginRun(basename(path)))) return;
  const py = await python();
  if (!py) return;
  const root = get().root;
  const cwd = root && isInside(path, root) ? root : dirname(path);
  const { setFileProblems } = await import("../../lib/actions");
  setFileProblems([path], []);
  await startProgram(py.path, ["-u", path, ...programArgs()], {
    cwd,
    env: runEnv(py.path),
    label: basename(path),
    echo: `python ${root ? relative(root, path) : basename(path)}${programArgs().length ? " " + programArgs().join(" ") : ""}`,
    onEnd: (code, stderr) => {
      if (code === 0 || code === null) return;
      const d = parseTraceback(stderr, (p) => !!root && isInside(p, root) && !/[\\/](\.venv|venv|site-packages)[\\/]/i.test(p));
      if (!d) return;
      setFileProblems([d.path], [d]);
      void import("../../lib/actions").then((m) => m.openFile(d.path, { line: d.line, col: d.column || 1 }));
    },
  });
}

/** Checks the syntax of every Python file it is given (Ctrl+F9) by compiling them. */
async function build(path: string): Promise<boolean> {
  if (!(await beginRun(basename(path)))) return false;
  const py = await python();
  if (!py) return false;
  appendOutput("system", t("Checking {0}…", basename(path)) + "\n");
  try {
    const r = await invoke<{ code: number; stdout: string; stderr: string }>("tool_exec", { program: py.path, args: ["-X", "utf8", "-m", "py_compile", path], cwd: dirname(path), input: null, env: runEnv(py.path), timeoutMs: 30000 });
    const { setFileProblems, openFile } = await import("../../lib/actions");
    const { endRun } = await import("../run");
    endRun();
    if (r.code === 0) {
      setFileProblems([path], []);
      appendOutput("success", t("No syntax errors.") + "\n");
      return true;
    }
    appendOutput("stderr", r.stderr);
    const d = parseTraceback(r.stderr.replace(/^.*?(?=  File )/s, ""), () => true) ?? parseTraceback(r.stderr, () => true);
    if (d) {
      setFileProblems([d.path], [d]);
      void openFile(d.path, { line: d.line, col: d.column || 1 });
    }
    return false;
  } catch (e) {
    appendOutput("error", errorText(e) + "\n");
    (await import("../run")).endRun();
    return false;
  }
}

/** Runs a Python command in the terminal, in the project folder. */
async function inTerminal(args: string[]) {
  const py = await python();
  if (!py) return;
  const { runProgramInTerminal } = await import("../../lib/terminals");
  await runProgramInTerminal(py.path, args, { cwd: get().root ?? undefined });
}

export async function createVenv() {
  const root = get().root;
  if (!root) return toast("info", t("Open a folder first"), t("A virtual environment belongs to a project folder."));
  const tools = (await findTools("python")).filter((x) => !venvOf(x.path));
  const base = tools[0] ?? (await python());
  if (!base) return;
  toast("info", t("Creating a virtual environment…"), t("{0} in .venv", toolLabel("python", base)));
  try {
    const r = await invoke<{ code: number; stdout: string; stderr: string }>("tool_exec", { program: base.path, args: ["-m", "venv", ".venv"], cwd: root, input: null, env: null, timeoutMs: 180000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout);
  } catch (e) {
    toast("error", t("The virtual environment wasn't created"), errorText(e));
    return;
  }
  const list = await findTools("python", true);
  const venv = list.find((x) => venvOf(x.path) && isInside(x.path, root));
  if (venv) (await import("../toolchain")).chooseTool("python", venv.path);
  toast("success", t("Virtual environment created"), t("Programs, tests and new terminals use .venv now."));
  const hasReq = await invoke<boolean>("fs_exists", { path: join(root, "requirements.txt") }).catch(() => false);
  if (hasReq) {
    openDialog({
      kind: "confirm",
      title: t("Install the requirements?"),
      body: t("requirements.txt lists the packages this project needs. Install them into .venv now?"),
      confirmLabel: t("Install"),
      onConfirm: () => installRequirements(),
    });
  }
}

export async function installRequirements() {
  const root = get().root;
  if (!root) return;
  if (!(await invoke<boolean>("fs_exists", { path: join(root, "requirements.txt") }).catch(() => false))) {
    return toast("info", t("There's no requirements.txt"), t("List one package per line in requirements.txt in the project folder."));
  }
  await inTerminal(["-m", "pip", "install", "-r", "requirements.txt"]);
}

export function installPackage() {
  openDialog({
    kind: "prompt",
    title: t("Install a package"),
    label: t("Package (as for pip, e.g. requests or numpy==2.1)"),
    value: "",
    confirmLabel: t("Install"),
    validate: (v) => (/^[A-Za-z0-9_.\-\[\],<>=!~ ]+$/.test(v.trim()) ? null : t("Enter a package name.")),
    onSubmit: (v) => inTerminal(["-m", "pip", "install", ...v.trim().split(/\s+/)]),
  });
}

/** pytest when the environment has it, else unittest's discovery. */
async function test(): Promise<boolean> {
  const root = get().root;
  if (!root) return false;
  const py = await toolFor("python");
  if (!py) return false;
  const hasPytest = await invoke<{ code: number }>("tool_exec", { program: py.path, args: ["-c", "import pytest"], cwd: root, input: null, env: null, timeoutMs: 20000 })
    .then((r) => r.code === 0)
    .catch(() => false);
  await inTerminal(hasPytest ? ["-m", "pytest", "-q"] : ["-m", "unittest", "discover", "-v"]);
  return true;
}

export const pythonPlugin: LanguagePlugin = {
  languages: ["python"],
  run,
  build,
  test,
  status() {
    const py = currentTool("python");
    if (py === undefined) {
      void findTools("python");
      return { label: "Python", onClick: (a) => void toolMenu("python", a) };
    }
    const extra = [
      { type: "separator" as const },
      { label: t("Create virtual environment"), onSelect: () => void createVenv() },
      { label: t("Install requirements.txt"), onSelect: () => void installRequirements() },
      { label: t("Install a package…"), onSelect: installPackage },
    ];
    if (!py) return { label: t("No Python"), warn: true, tooltip: how(), onClick: (a) => void toolMenu("python", a, extra) };
    return { label: toolLabel("python", py), tooltip: py.path, onClick: (a) => void toolMenu("python", a, extra) };
  },
  commands: [
    { id: "python.venv", label: "Python: Create virtual environment", run: createVenv },
    { id: "python.requirements", label: "Python: Install requirements.txt", run: installRequirements },
    { id: "python.install", label: "Python: Install a package…", run: installPackage },
  ],
  async terminalEnv() {
    const py = await toolFor("python");
    const venv = py && venvOf(py.path);
    if (!py || !venv) return null;
    return { env: { VIRTUAL_ENV: venv, VIRTUAL_ENV_PROMPT: basename(venv) }, pathPrepend: [dirname(py.path)] };
  },
  server: {
    id: "python",
    name: () => {
      const s = currentTool("python-lsp");
      return s ? basename(s.path).replace(/\.(exe|cmd|bat)$/i, "").replace(/-langserver$/, "") : "Python";
    },
    async find() {
      const s = await toolFor("python-lsp");
      if (!s) return null;
      const name = basename(s.path).replace(/\.(exe|cmd|bat)$/i, "");
      return { program: s.path, args: /pyright/.test(name) ? ["--stdio"] : [], name };
    },
    configuration(section) {
      const py = currentTool("python");
      if (section === "python") return { pythonPath: py?.path, venvPath: py && venvOf(py.path) ? dirname(venvOf(py.path)!) : undefined };
      if (section === "python.analysis" || section === "basedpyright.analysis") return { typeCheckingMode: "basic", autoSearchPaths: true, useLibraryCodeForTypes: true };
      if (section === "pylsp") return { plugins: { pycodestyle: { enabled: false } } };
      return null;
    },
  },
};
