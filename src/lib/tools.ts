/*
 * JShell, JUnit, runnable JARs, Javadoc and the project's libraries.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as pickPath, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { api, errorText } from "./api";
import { appendOutput, get, openDialog, set, toast } from "./store";
import { compileJava, loadDir, mainClassFor, openFile, reloadJavaIndex } from "./actions";
import { basename, dirname, join } from "./paths";
import type { JType } from "../uml/model";
import { t } from "./i18n";

const jdk = () => get().settings.jdkHome || get().jdks[0]?.home || null;

// ----- JShell ------------------------------------------------------------------------------

interface ShellState {
  running: boolean;
  text: string;
  history: string[];
}

export const useShell = create<ShellState>(() => ({ running: false, text: "", history: [] }));

let shellListening = false;

export async function startShell() {
  const root = get().root;
  if (!root) return;
  if (!shellListening) {
    shellListening = true;
    await listen<string>("jshell-output", (e) => useShell.setState((s) => ({ text: (s.text + e.payload).slice(-200_000) })));
    await listen("jshell-exit", () => useShell.setState({ running: false }));
  }
  // The project's classes are usable in JShell once compiled.
  await compileJava(true);
  useShell.setState({ text: "", running: true });
  try {
    await invoke("jshell_start", { root, jdkHome: jdk() });
  } catch (e) {
    useShell.setState({ running: false, text: errorText(e) + "\n" });
  }
}

export async function shellSend(line: string) {
  if (!useShell.getState().running) return;
  useShell.setState((s) => ({ history: [line, ...s.history.filter((h) => h !== line)].slice(0, 100), text: s.text + line + "\n" }));
  await invoke("jshell_send", { text: line + "\n" }).catch(() => {});
}

export async function stopShell() {
  await invoke("jshell_stop").catch(() => {});
  useShell.setState({ running: false });
}

// ----- JUnit -------------------------------------------------------------------------------

export interface TestCase {
  cls: string;
  name: string;
  time: number;
  status: "passed" | "failed" | "error" | "skipped";
  message?: string;
  detail?: string;
}

interface TestState {
  status: "idle" | "running";
  cases: TestCase[];
  output: string;
  ranAt: number | null;
}

export const useTests = create<TestState>(() => ({ status: "idle", cases: [], output: "", ranAt: null }));

/** Reads the legacy JUnit XML report the console launcher writes. */
export function parseReport(xml: string): TestCase[] {
  if (!xml.trim()) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.querySelectorAll("testcase")].map((tc) => {
    const failure = tc.querySelector("failure");
    const error = tc.querySelector("error");
    const skipped = tc.querySelector("skipped");
    const problem = failure ?? error;
    return {
      cls: tc.getAttribute("classname") ?? "",
      name: (tc.getAttribute("name") ?? "").replace(/\(\)$/, ""),
      time: Number(tc.getAttribute("time") ?? 0),
      status: failure ? "failed" : error ? "error" : skipped ? "skipped" : "passed",
      message: problem?.getAttribute("message") ?? skipped?.getAttribute("message") ?? undefined,
      detail: problem?.textContent?.trim() || undefined,
    };
  });
}

async function launcher(): Promise<string | null> {
  const root = get().root!;
  const found = await invoke<string | null>("junit_find", { root });
  if (found) return found;
  return new Promise((resolve) => {
    openDialog({
      kind: "confirm",
      title: t("Add JUnit 5 to the project?"),
      body: t("Tests run with the JUnit console launcher (about 2.7 MB). It is downloaded from Maven Central into the project's lib folder, where the compiler finds it too."),
      confirmLabel: t("Download JUnit"),
      onConfirm: async () => {
        try {
          const path = await invoke<string>("junit_download", { root });
          toast("success", t("JUnit added"), basename(path));
          await loadDir(join(root, "lib")).catch(() => {});
          await loadDir(root);
          resolve(path);
        } catch (e) {
          toast("error", t("JUnit wasn't downloaded"), errorText(e));
          resolve(null);
        }
      },
      onCancel: () => resolve(null),
    });
  });
}

/** Runs all tests, a class, or one method (`Class#method`). */
export async function runTests(select?: string) {
  const root = get().root;
  if (!root || useTests.getState().status === "running") return;
  const { useBuild, runBuildTask } = await import("./build");
  const build = useBuild.getState().info;
  if (build) {
    // The build tool brings its own JUnit; its test task runs them (one class or method with a filter).
    const filter = select ? (build.tool === "maven" ? [`-Dtest=${select.replace(/^.*\./, "")}`] : ["--tests", select.replace("#", ".")]) : [];
    await runBuildTask(["test", ...filter]);
    return;
  }
  const jar = await launcher();
  if (!jar) return;
  if (!(await compileJava(true))) return;
  useTests.setState({ status: "running" });
  set({ panelOpen: true, panelTab: "tests" });
  try {
    const r = await invoke<{ ok: boolean; output: string; report: string }>("junit_run", { root, jdkHome: jdk(), launcher: jar, select: select ?? null });
    const cases = parseReport(r.report);
    useTests.setState({ status: "idle", cases, output: r.output, ranAt: Date.now() });
    const failed = cases.filter((c) => c.status === "failed" || c.status === "error").length;
    if (!cases.length) toast("info", t("No tests found"), t("Write methods with @Test in a class, for example CircleTest."));
    else if (failed) toast("error", t("{0} of {1} tests failed", failed, cases.length));
    else toast("success", t("All {0} tests passed", cases.length));
  } catch (e) {
    useTests.setState({ status: "idle" });
    toast("error", t("The tests didn't run"), errorText(e));
  }
}

/** A JUnit 5 test class for a class: one test per public method, to fill in. */
export function testSkeleton(cls: string, pkg: string, methods: string[]): string {
  const head = pkg ? `package ${pkg};\n\n` : "";
  const tests = methods.length ? methods : ["example"];
  const body = tests
    .map((m) => `    @Test\n    void ${m}() {\n        // ${cls} sample = new ${cls}(...);\n        // assertEquals(expected, sample.${m}(...));\n        fail("Not written yet");\n    }`)
    .join("\n\n");
  return `${head}import org.junit.jupiter.api.Test;\n\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass ${cls}Test {\n\n${body}\n}\n`;
}

/** Creates (or opens) a JUnit test class beside a class. */
export async function createTestFor(type: JType) {
  const path = join(dirname(type.path), `${type.name}Test.java`);
  if (!(await api.exists(path))) {
    const methods = [...new Set(type.methods.filter((m) => !m.isConstructor && !m.isStatic && m.visibility !== "private").map((m) => m.name))];
    try {
      await api.createFile(path, testSkeleton(type.name, type.package, methods));
      await loadDir(dirname(path));
    } catch (e) {
      toast("error", t("The test wasn't created"), errorText(e));
      return;
    }
  }
  await openFile(path);
}

// ----- JAR and Javadoc -----------------------------------------------------------------------

export async function exportJar() {
  const root = get().root;
  if (!root) return;
  if (!(await compileJava())) return;
  const active = get().tabs.find((x) => x.id === get().active[get().focusGroup]);
  const main = mainClassFor(active?.path ?? null);
  if (!main) {
    toast("warning", t("No class has a main method"), t("A runnable JAR starts a main method."));
    return;
  }
  const dest = await pickSavePath({ title: t("Export runnable JAR"), defaultPath: join(root, `${basename(root)}.jar`), filters: [{ name: "JAR", extensions: ["jar"] }] }).catch(() => null);
  if (!dest) return;
  try {
    const r = await invoke<{ ok: boolean; output: string; path: string }>("jar_export", { root, jdkHome: jdk(), mainClass: main.name, dest });
    if (!r.ok) throw new Error(r.output);
    appendOutput("success", t("Runnable JAR written: {0} (starts {1}). Run it with java -jar.", r.path, main.name) + "\n");
    toast("success", t("JAR exported"), r.path);
  } catch (e) {
    toast("error", t("The JAR wasn't exported"), errorText(e));
  }
}

export async function generateJavadoc() {
  const root = get().root;
  if (!root) return;
  appendOutput("system", t("Writing Javadoc…") + "\n");
  try {
    const r = await invoke<{ ok: boolean; output: string; path: string }>("javadoc_generate", { root, jdkHome: jdk() });
    if (r.output.trim()) appendOutput(r.ok ? "stdout" : "stderr", r.output.trimEnd() + "\n");
    if (!r.ok) throw new Error(t("Javadoc reported errors; see the output."));
    toast("success", t("Javadoc written"), t("Opening it in the browser."));
    await openPath(r.path).catch(() => {});
    await loadDir(root);
  } catch (e) {
    toast("error", t("Javadoc wasn't written"), errorText(e));
  }
}

// ----- Libraries ---------------------------------------------------------------------------------

export async function listLibraries(): Promise<string[]> {
  const root = get().root;
  if (!root) return [];
  const entries = await api.listDir(join(root, "lib")).catch(() => []);
  return entries.filter((e) => !e.isDir && e.name.toLowerCase().endsWith(".jar")).map((e) => e.path);
}

export async function addLibraries(): Promise<void> {
  const root = get().root;
  if (!root) return;
  const picked = await pickPath({ multiple: true, title: t("Add libraries"), filters: [{ name: "JAR", extensions: ["jar"] }] }).catch(() => null);
  const list = typeof picked === "string" ? [picked] : picked ?? [];
  for (const p of list) {
    try {
      await api.copy(p, join(root, "lib", basename(p)));
    } catch (e) {
      toast("error", t("{0} wasn't added", basename(p)), errorText(e));
    }
  }
  await loadDir(root);
  await reloadJavaIndex();
}

export async function removeLibrary(path: string) {
  try {
    await api.delete(path);
  } catch (e) {
    toast("error", t("{0} wasn't removed", basename(path)), errorText(e));
  }
}

export function setPanelTab(tab: string) {
  set({ panelOpen: true, panelTab: tab as "output" });
}
