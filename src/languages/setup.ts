/*
 * What each language needs on this computer, whether it is there, and how to get it: a winget package that
 * installs it in a terminal (where its questions are answered), or the page to download it from.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../lib/api";
import { set as setApp, toast } from "../lib/store";
import { t } from "../lib/i18n";
import { findTools, toolLabel } from "./toolchain";

export type SetupId = "java" | "node" | "python" | "cpp" | "php" | "kotlin" | "git";

export interface Found {
  label: string;
  path: string;
}

export interface LanguageSetup {
  id: SetupId;
  /** The languages it is for. */
  name: string;
  /** What gets installed. */
  tool: string;
  /** What it is needed for. */
  why: () => string;
  winget?: string;
  page: string;
  /** Needed first (Kotlin runs on the JDK). */
  needs?: SetupId;
  find: () => Promise<Found | null>;
}

const tool = async (kind: Parameters<typeof findTools>[0]) => {
  const list = await findTools(kind, true);
  return list[0] ? { label: toolLabel(kind, list[0]), path: list[0].path } : null;
};

export const LANGUAGES: LanguageSetup[] = [
  {
    id: "java",
    name: "Java",
    tool: "Eclipse Temurin JDK 25",
    why: () => t("Compiling, running and debugging Java, the class diagram's objects and JShell."),
    winget: "EclipseAdoptium.Temurin.25.JDK",
    page: "https://adoptium.net/temurin/releases/",
    find: async () => {
      const jdks = await api.detectJdks().catch(() => []);
      setApp({ jdks });
      return jdks[0] ? { label: `Java ${jdks[0].version}`, path: jdks[0].home } : null;
    },
  },
  {
    id: "node",
    name: "JavaScript, TypeScript",
    tool: "Node.js LTS",
    why: () => t("Running JavaScript files and the language servers for JavaScript, TypeScript, HTML and CSS."),
    winget: "OpenJS.NodeJS.LTS",
    page: "https://nodejs.org/en/download",
    find: async () => {
      const node = await api.detectNode().catch(() => null);
      setApp({ node });
      return node ? { label: `Node.js ${node.version.replace(/^v/, "")}`, path: node.path } : null;
    },
  },
  {
    id: "python",
    name: "Python",
    tool: "Python 3.14",
    why: () => t("Running Python files and their tests."),
    winget: "Python.Python.3.14",
    page: "https://www.python.org/downloads/windows/",
    find: () => tool("python"),
  },
  {
    id: "cpp",
    name: "C, C++",
    tool: "WinLibs (GCC, Clang, clangd)",
    why: () => t("Compiling and running C and C++, with completion and formatting."),
    winget: "BrechtSanders.WinLibs.POSIX.UCRT.LLVM",
    page: "https://winlibs.com/",
    find: () => tool("cxx"),
  },
  {
    id: "php",
    name: "PHP",
    tool: "PHP 8.5",
    why: () => t("Running PHP files and the PHP preview."),
    winget: "PHP.PHP.8.5",
    page: "https://windows.php.net/download/",
    find: () => tool("php"),
  },
  {
    id: "kotlin",
    name: "Kotlin",
    tool: "Kotlin compiler",
    why: () => t("Compiling and running Kotlin. Unpack it, for example to C:\\kotlinc; it needs a JDK."),
    page: "https://github.com/JetBrains/kotlin/releases/latest",
    needs: "java",
    find: () => tool("kotlinc"),
  },
  {
    id: "git",
    name: "Git",
    tool: "Git for Windows",
    why: () => t("Source control: changes, commits, branches and history."),
    winget: "Git.Git",
    page: "https://git-scm.com/download/win",
    find: async () => {
      const info = await invoke<{ version: string } | null>("git_info").catch(() => null);
      return info ? { label: `Git ${info.version}`, path: "git" } : null;
    },
  },
];

/** The command that installs a language with winget; its questions (licence, permission) are asked in the terminal. */
export function installCommand(l: LanguageSetup): string | null {
  return l.winget ? `winget install --id ${l.winget} --exact --source winget` : null;
}

/** Reads the PATH again: something installed since Logiq Studio started is found, and runs in new terminals. */
export function refreshPath(): Promise<void> {
  return invoke<void>("env_refresh_path").catch(() => {});
}

// ----- Checking and installing -------------------------------------------------------------------

interface SetupState {
  /** What was found for each language: undefined while looking, null when it isn't there. */
  found: Partial<Record<SetupId, Found | null>>;
  /** Being installed in a terminal; watched until it shows up. */
  installing: SetupId[];
}

export const useSetup = create<SetupState>(() => ({ found: {}, installing: [] }));

/** Looks for every language again (reading the PATH first). */
export async function checkAll(): Promise<void> {
  useSetup.setState({ found: {} });
  await refreshPath();
  await Promise.all(
    LANGUAGES.map(async (l) => {
      const f = await l.find().catch(() => null);
      useSetup.setState((s) => ({ found: { ...s.found, [l.id]: f } }));
    }),
  );
}

const WATCH_FOR = 30 * 60_000;

/** Runs winget in a new terminal and watches for the language until it can be used. */
export async function install(l: LanguageSetup): Promise<void> {
  const command = installCommand(l);
  if (!command) return;
  const { runInTerminal } = await import("../lib/terminals");
  const id = await runInTerminal(command, { fresh: true });
  if (id < 0) return;
  toast("info", t("Installing {0}…", l.tool), t("Answer winget's questions in the terminal. Logiq Studio notices when it is ready."));
  if (useSetup.getState().installing.includes(l.id)) return;
  useSetup.setState((s) => ({ installing: [...s.installing, l.id] }));
  const started = Date.now();
  const done = () => useSetup.setState((s) => ({ installing: s.installing.filter((x) => x !== l.id) }));
  const tick = async () => {
    await refreshPath();
    const f = await l.find().catch(() => null);
    if (f) {
      done();
      useSetup.setState((s) => ({ found: { ...s.found, [l.id]: f } }));
      toast("success", t("{0} is ready", f.label), f.path);
      return;
    }
    if (Date.now() - started > WATCH_FOR) return done();
    window.setTimeout(() => void tick(), 5000);
  };
  window.setTimeout(() => void tick(), 8000);
}

/** The language a tool belongs to, for "Set up" next to a tool that wasn't found. */
export function setupFor(kind: string): SetupId | null {
  if (kind === "python" || kind === "python-lsp") return "python";
  if (kind === "cc" || kind === "cxx" || kind === "clangd" || kind === "clang-format") return "cpp";
  if (kind === "php" || kind === "php-lsp") return "php";
  if (kind === "kotlinc" || kind === "kotlin-lsp") return "kotlin";
  return null;
}
