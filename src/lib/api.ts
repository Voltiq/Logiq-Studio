/*
 * The native side, one typed function per command. In a plain browser during
 * development `installMock` (lib/mock.ts) answers instead.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CompileResult,
  Entry,
  Jdk,
  NodeInfo,
  RunExit,
  RunOutput,
  SearchOptions,
  SearchResult,
  Source,
  TextFile,
} from "./types";

export const api = {
  launchPaths: () => invoke<string[]>("launch_paths"),
  listDir: (path: string) => invoke<Entry[]>("fs_list_dir", { path }),
  readText: (path: string) => invoke<TextFile>("fs_read_text", { path }),
  writeText: (path: string, text: string, eol?: string) => invoke<number>("fs_write_text", { path, text, eol }),
  writeBytes: (path: string, bytes: Uint8Array) => invoke<void>("fs_write_bytes", { path, bytes: Array.from(bytes) }),
  createFile: (path: string, text?: string) => invoke<void>("fs_create_file", { path, text }),
  createDir: (path: string) => invoke<void>("fs_create_dir", { path }),
  rename: (from: string, to: string) => invoke<void>("fs_rename", { from, to }),
  copy: (from: string, to: string) => invoke<void>("fs_copy", { from, to }),
  delete: (path: string) => invoke<void>("fs_delete", { path }),
  exists: (path: string) => invoke<boolean>("fs_exists", { path }),
  listFiles: (root: string) => invoke<string[]>("fs_list_files", { root }),
  readSources: (root: string, extension: string) => invoke<Source[]>("fs_read_sources", { root, extension }),
  search: (root: string, options: SearchOptions) => invoke<SearchResult>("search_workspace", { root, options }),
  watch: (path: string | null) => invoke<void>("watch_folder", { path }),
  setPreviewRoot: (path: string | null) => invoke<void>("set_preview_root", { path }),
  detectJdks: () => invoke<Jdk[]>("detect_jdks"),
  detectNode: () => invoke<NodeInfo | null>("detect_node"),
  javaCompile: (root: string, jdkHome: string | null) => invoke<CompileResult>("java_compile", { root, jdkHome }),
  runJava: (root: string, mainClass: string, jdkHome: string | null, args: string[]) =>
    invoke<number>("run_java", { root, mainClass, jdkHome, args }),
  runNode: (file: string, node: string | null) => invoke<number>("run_node", { file, node }),
  runStdin: (runId: number, text: string) => invoke<void>("run_stdin", { runId, text }),
  runStop: () => invoke<void>("run_stop"),
};

export const events = {
  onRunOutput: (f: (e: RunOutput) => void): Promise<UnlistenFn> => listen<RunOutput>("run-output", (e) => f(e.payload)),
  onRunExit: (f: (e: RunExit) => void): Promise<UnlistenFn> => listen<RunExit>("run-exit", (e) => f(e.payload)),
  onFsChanged: (f: (paths: string[]) => void): Promise<UnlistenFn> => listen<string[]>("fs-changed", (e) => f(e.payload)),
  onOpenPaths: (f: (paths: string[]) => void): Promise<UnlistenFn> => listen<string[]>("open-paths", (e) => f(e.payload)),
};

/** The address the preview loads a file of the open folder from. */
export function previewUrl(relativePath: string): string {
  const path = relativePath
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const windows = navigator.userAgent.includes("Windows");
  return windows ? `http://logiq-preview.localhost/${path}` : `logiq-preview://localhost/${path}`;
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
