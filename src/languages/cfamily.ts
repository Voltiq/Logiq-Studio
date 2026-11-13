/*
 * C and C++: compiles the sources in the file's folder with clang or gcc
 * (whichever is found or chosen), lists the compiler's errors as problems,
 * and runs the program with input from the panel. clangd gives completion,
 * errors as you type and go to definition when it is installed (it comes
 * with LLVM); clang-format formats.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "../lib/store";
import { api } from "../lib/api";
import { basename, dirname, extname, join, stem } from "../lib/paths";
import { getDoc } from "../editor/docs";
import type { LanguageId } from "../editor/languages";
import { t } from "../lib/i18n";
import { beginRun, compileNative, endRun, missingTool, programArgs, startProgram } from "./run";
import { currentTool, findTools, toolFor, toolLabel, toolMenu, buildDir } from "./toolchain";
import type { LanguagePlugin } from "./plugin";

const WINDOWS = navigator.userAgent.includes("Windows");
const how = () => t("Install LLVM (clang) with `winget install LLVM.LLVM`, or gcc with MSYS2 (msys2.org), then choose it in the status bar.");

const SOURCES: Record<"c" | "cpp", string[]> = { c: ["c"], cpp: ["cpp", "cc", "cxx"] };

async function textOf(path: string): Promise<string> {
  const doc = getDoc(path);
  if (doc) return doc.state.doc.toString();
  return (await api.readText(path).catch(() => ({ text: "" }))).text;
}

const HAS_MAIN = /\b(?:int|void)\s+(?:w?main|WinMain)\s*\(/;

/** The sources that make one program: the file's folder, leaving out the other files with a `main`. */
export async function programSources(path: string, lang: "c" | "cpp"): Promise<string[]> {
  const exts = SOURCES[lang];
  const dir = dirname(path);
  const entries = await api.listDir(dir).catch(() => []);
  const files = entries.filter((e) => !e.isDir && exts.includes(extname(e.name))).map((e) => e.path);
  if (!files.some((f) => f.toLowerCase() === path.toLowerCase())) files.unshift(path);
  const withMain = await Promise.all(files.map(async (f) => ({ f, main: HAS_MAIN.test(await textOf(f)) })));
  return withMain.filter((x) => !x.main || x.f.toLowerCase() === path.toLowerCase()).map((x) => x.f);
}

export function compilerFlags(lang: "c" | "cpp", compiler: string): string[] {
  const flags = [lang === "c" ? "-std=c17" : "-std=c++20", "-Wall", "-Wextra", "-g"];
  // With the Windows SDK's headers, clang warns that scanf and friends are "unsafe"; that is not for beginners.
  if (WINDOWS && /clang/i.test(basename(compiler))) flags.push("-D_CRT_SECURE_NO_WARNINGS");
  const extra = get().settings.cFlags.trim();
  return extra ? [...flags, ...extra.split(/\s+/)] : flags;
}

function family(path: string): "c" | "cpp" {
  return ["cpp", "cc", "cxx", "hpp", "hh", "hxx"].includes(extname(path)) ? "cpp" : "c";
}

async function compile(path: string): Promise<string | null> {
  const lang = family(path);
  if (extname(path) === "h" || extname(path) === "hpp") {
    missingTool(t("A header file doesn't run"), t("Open the .c or .cpp file with main() and run that."));
    return null;
  }
  const compiler = await toolFor(lang === "c" ? "cc" : "cxx");
  if (!compiler) {
    missingTool(lang === "c" ? t("No C compiler was found") : t("No C++ compiler was found"), how());
    return null;
  }
  const files = await programSources(path, lang);
  const out = buildDir(path);
  await api.createDir(out).catch(() => {});
  const exe = join(out, stem(path) + (WINDOWS ? ".exe" : ""));
  const ok = await compileNative(compiler.path, [...files, "-o", exe, ...compilerFlags(lang, compiler.path)], dirname(path), files.length, toolLabel(lang === "c" ? "cc" : "cxx", compiler));
  return ok ? exe : null;
}

function plugin(lang: "c" | "cpp"): LanguagePlugin {
  const kind = lang === "c" ? "cc" : "cxx";
  return {
    languages: [lang as LanguageId],
    async run(path) {
      if (!(await beginRun(basename(path)))) return;
      const exe = await compile(path);
      if (!exe) return endRun();
      await startProgram(exe, programArgs(), { cwd: dirname(path), label: stem(path), echo: t("Running {0}", basename(exe)) });
    },
    async build(path) {
      if (!(await beginRun(basename(path)))) return false;
      const ok = !!(await compile(path));
      endRun();
      return ok;
    },
    canFormat: () => true,
    async format(path, text) {
      const tool = await toolFor("clang-format");
      if (!tool) return null;
      const root = get().root;
      const own = root && ((await api.exists(join(root, ".clang-format")).catch(() => false)) || (await api.exists(join(root, "_clang-format")).catch(() => false)));
      const s = get().settings;
      const style = own ? "file" : `{BasedOnStyle: LLVM, IndentWidth: ${s.tabSize}, TabWidth: ${s.tabSize}, UseTab: ${s.insertSpaces ? "Never" : "Always"}, ColumnLimit: 100, AllowShortFunctionsOnASingleLine: Empty}`;
      const r = await invoke<{ code: number; stdout: string; stderr: string }>("tool_exec", { program: tool.path, args: [`--assume-filename=${path}`, `--style=${style}`], cwd: dirname(path), input: text, env: null, timeoutMs: 20000 });
      if (r.code !== 0) throw new Error(r.stderr || "clang-format failed");
      return r.stdout;
    },
    status() {
      const c = currentTool(kind);
      if (c === undefined) {
        void findTools(kind);
        return { label: lang === "c" ? "C" : "C++", onClick: (a) => void toolMenu(kind, a) };
      }
      if (!c) return { label: lang === "c" ? t("No C compiler") : t("No C++ compiler"), warn: true, tooltip: how(), onClick: (a) => void toolMenu(kind, a) };
      return { label: toolLabel(kind, c), tooltip: c.path, onClick: (a) => void toolMenu(kind, a) };
    },
    server: {
      id: "clangd",
      name: () => "clangd",
      async find() {
        const s = await toolFor("clangd");
        return s ? { program: s.path, args: ["--header-insertion=never", "--background-index=false", "--log=error"], name: "clangd" } : null;
      },
      initializationOptions: () => ({ fallbackFlags: ["-Wall", "-Wextra", ...(WINDOWS ? ["-D_CRT_SECURE_NO_WARNINGS"] : [])] }),
    },
  };
}

export const cPlugin = plugin("c");
export const cppPlugin = plugin("cpp");
