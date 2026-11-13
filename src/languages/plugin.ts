/*
 * What a language plug-in can add to the editor's grammar
 * (src/editor/languages.ts): running a file, compiling it, a language
 * server, checks after saving, an outside formatter, a status bar item,
 * commands, the terminal's environment and editor keys. The structure for
 * the outline and the class diagram is a parser in src/uml/javaIndex.ts.
 */
import type { Extension } from "@codemirror/state";
import type { LanguageId } from "../editor/languages";

export interface ServerSpec {
  /** The id of the server process and its client ("clangd", "python"…). */
  id: string;
  /** Shown in the status bar. */
  name(): string;
  /** The program and arguments that start it, or null when it isn't installed. */
  find(): Promise<{ program: string; args: string[]; name: string } | null>;
  initializationOptions?(): unknown;
  /** The answer to `workspace/configuration` for a section ("python"…). */
  configuration?(section: string): unknown;
}

export interface StatusItem {
  label: string;
  tooltip?: string;
  /** Drawn as a warning (the tool isn't installed). */
  warn?: boolean;
  onClick(anchor: HTMLElement): void;
}

export interface PluginCommand {
  id: string;
  label: string;
  run(): void | Promise<void>;
}

export interface LanguagePlugin {
  languages: LanguageId[];
  /** F5: runs the file (compiling it first where needed). */
  run?(path: string): Promise<void>;
  /** Ctrl+F9: compiles or checks without running; false when it failed. */
  build?(path: string): Promise<boolean>;
  /** Runs the project's tests (in the terminal); false when this plug-in has none for the folder. */
  test?(): Promise<boolean>;
  server?: ServerSpec;
  /** After a file of the language is saved (PHP's syntax check). */
  afterSave?(path: string, text: string): void;
  /** Formats with an outside formatter (clang-format); null when there is none. */
  format?(path: string, text: string): Promise<string | null>;
  canFormat?(path: string): boolean;
  /** The status bar item for a file of the language; read again when the toolchain changes. */
  status?(path: string): StatusItem | null;
  commands?: PluginCommand[];
  /** Variables and folders for new terminals (a Python virtual environment). */
  terminalEnv?(): Promise<{ env: Record<string, string>; pathPrepend: string[] } | null>;
  /** Extra editor extensions for a file (SQL's Ctrl+Enter). */
  editor?(path: () => string): Extension;
  /** Whether F5 previews the file instead of running it (PHP pages). */
  previews?(path: string, text: string): boolean;
}
