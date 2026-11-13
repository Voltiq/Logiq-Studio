/*
 * Kotlin: compiles the project's .kt files with kotlinc into one jar and
 * runs the file's `main` on the JDK the IDE uses, with input from the
 * panel; a .kts script runs with `kotlinc -script`. kotlinc's messages are
 * problems. kotlin-language-server gives completion when it is installed.
 */
import { api } from "../lib/api";
import { get } from "../lib/store";
import { basename, dirname, extname, join, stem } from "../lib/paths";
import { getDoc } from "../editor/docs";
import { t } from "../lib/i18n";
import { beginRun, compileNative, endRun, missingTool, programArgs, startProgram } from "./run";
import { buildDir, currentTool, findTools, javaExe, jdkHome, toolFor, toolLabel, toolMenu } from "./toolchain";
import type { LanguagePlugin } from "./plugin";

const how = () => t("Download the Kotlin compiler from github.com/JetBrains/kotlin/releases (kotlin-compiler-*.zip), unpack it to C:\\kotlinc, or put its bin folder on the PATH; then choose it in the status bar.");

/** The class Kotlin makes for a file's top-level functions: `main.kt` in package `app` → `app.MainKt`. */
export function facadeClass(path: string, text: string): string {
  const pkg = /^\s*package\s+([\w.]+)/m.exec(text)?.[1];
  const s = stem(path);
  const name = s.charAt(0).toUpperCase() + s.slice(1).replace(/[^\w]/g, "_") + "Kt";
  return pkg ? `${pkg}.${name}` : name;
}

const HAS_MAIN = /^\s*fun\s+main\s*\(/m;

function env(): Record<string, string> {
  const home = jdkHome();
  return home ? { JAVA_HOME: home } : {};
}

async function textOf(path: string) {
  return getDoc(path)?.state.doc.toString() ?? (await api.readText(path).catch(() => ({ text: "" }))).text;
}

async function compile(path: string): Promise<string | null> {
  const kotlinc = await toolFor("kotlinc");
  if (!kotlinc) {
    missingTool(t("The Kotlin compiler wasn't found"), how());
    return null;
  }
  const root = get().root;
  const files = root
    ? (await api.listFiles(root).catch(() => [] as string[])).filter((f) => extname(f) === "kt").map((f) => join(root, ...f.split("/")))
    : [path];
  if (!files.length) files.push(path);
  const out = join(buildDir(path), "kotlin");
  await api.createDir(out).catch(() => {});
  const jar = join(out, (root ? basename(root) : stem(path)).replace(/[^\w.-]/g, "_") + ".jar");
  // kotlinc takes a while to start; the first build of a session is the slowest.
  const ok = await compileNative(kotlinc.path, [...files, "-include-runtime", "-d", jar], root ?? dirname(path), files.length, toolLabel("kotlinc", kotlinc), env());
  return ok ? jar : null;
}

export const kotlinPlugin: LanguagePlugin = {
  languages: ["kotlin"],
  async run(path) {
    if (!(await beginRun(basename(path)))) return;
    if (extname(path) === "kts") {
      const kotlinc = await toolFor("kotlinc");
      if (!kotlinc) return missingTool(t("The Kotlin compiler wasn't found"), how());
      await startProgram(kotlinc.path, ["-script", path, ...programArgs()], { cwd: dirname(path), env: env(), label: basename(path), echo: `kotlinc -script ${basename(path)}` });
      return;
    }
    let main = path;
    if (!HAS_MAIN.test(await textOf(path))) {
      const root = get().root;
      const others = root ? (await api.listFiles(root).catch(() => [] as string[])).filter((f) => extname(f) === "kt").map((f) => join(root, ...f.split("/"))) : [];
      const found = [];
      for (const f of others) if (HAS_MAIN.test(await textOf(f))) found.push(f);
      if (!found.length) return missingTool(t("No main function"), t("Add `fun main() { … }` to a Kotlin file to run it."));
      main = found[0];
    }
    const jar = await compile(path);
    if (!jar) return endRun();
    const cls = facadeClass(main, await textOf(main));
    await startProgram(javaExe(), ["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-cp", jar, cls, ...programArgs()], { cwd: get().root ?? dirname(path), label: cls, echo: t("Running {0}", cls) });
  },
  async build(path) {
    if (!(await beginRun(basename(path)))) return false;
    const ok = !!(await compile(path));
    endRun();
    return ok;
  },
  status() {
    const k = currentTool("kotlinc");
    if (k === undefined) {
      void findTools("kotlinc");
      return { label: "Kotlin", onClick: (a) => void toolMenu("kotlinc", a) };
    }
    if (!k) return { label: t("No Kotlin compiler"), warn: true, tooltip: how(), onClick: (a) => void toolMenu("kotlinc", a) };
    return { label: toolLabel("kotlinc", k), tooltip: k.path, onClick: (a) => void toolMenu("kotlinc", a) };
  },
  server: {
    id: "kotlin",
    name: () => "Kotlin LS",
    async find() {
      const s = await toolFor("kotlin-lsp");
      return s ? { program: s.path, args: [], name: "kotlin-language-server" } : null;
    },
  },
};
