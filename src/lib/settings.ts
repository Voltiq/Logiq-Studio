import type { ThemePreference } from "./types";
import { DEFAULT_UML_OPTIONS, type UmlOptions } from "../uml/diagram";

export interface Settings {
  theme: ThemePreference;
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoCloseBrackets: boolean;
  /** Save a file a moment after typing stops. */
  autoSave: boolean;
  /** Reload the preview when an HTML, CSS or JS file is saved. */
  livePreview: boolean;
  formatOnSave: boolean;
  /** Keep unsaved changes and open files across restarts instead of asking on close. */
  hotExit: boolean;
  /** Use Eclipse JDT LS for Java when it is installed. */
  javaServer: boolean;
  language: "system" | "en" | "de" | "es" | "fr";
  /** Ask GitHub for a newer version when the app starts. */
  checkUpdates: boolean;
  /** Save all files before compiling. */
  saveBeforeRun: boolean;
  /** Empty: the newest JDK found. */
  jdkHome: string;
  nodePath: string;
  /** The shell new terminals start; empty: the first one found. */
  terminalShell: string;
  /** The terminal's text cursor: a box, a vertical line or an underline. */
  terminalCursor: "block" | "bar" | "underline";
  terminalCursorBlink: boolean;
  /** Start installed language servers for Python, C, C++, PHP and Kotlin (clangd, Pyright…). */
  languageServers: boolean;
  /** More compiler flags for C and C++ (after -std=c17 / -std=c++20 -Wall -Wextra -g). */
  cFlags: string;
  /** Rows a SQL result shows at most. */
  sqlMaxRows: number;
  uml: UmlOptions;
  recent: string[];
  sidebarWidth: number;
  panelHeight: number;
  previewWidth: number;
  sideWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontSize: 13,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  autoCloseBrackets: true,
  autoSave: false,
  livePreview: true,
  formatOnSave: false,
  hotExit: true,
  javaServer: true,
  language: "system",
  checkUpdates: true,
  saveBeforeRun: true,
  jdkHome: "",
  nodePath: "",
  terminalShell: "",
  terminalCursor: "block",
  terminalCursorBlink: true,
  languageServers: true,
  cFlags: "",
  sqlMaxRows: 10000,
  uml: DEFAULT_UML_OPTIONS,
  recent: [],
  sidebarWidth: 272,
  panelHeight: 240,
  previewWidth: 520,
  sideWidth: 640,
};

const KEY = "logiq.settings";

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw, uml: { ...DEFAULT_UML_OPTIONS, ...(raw.uml ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: settings last for this session only.
  }
}
