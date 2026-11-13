export type ThemePreference = "system" | "light" | "dark";

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export interface TextFile {
  text: string;
  eol: "lf" | "crlf";
  modified: number;
}

export interface Source {
  path: string;
  text: string;
}

export interface SearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  length: number;
  preview: string;
  previewStart: number;
}

export interface SearchResult {
  hits: SearchHit[];
  filesSearched: number;
  truncated: boolean;
}

export interface Jdk {
  home: string;
  version: string;
  major: number;
  vendor: string;
}

export interface NodeInfo {
  path: string;
  version: string;
}

export interface Diagnostic {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
}

export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  output: string;
  files: number;
  durationMs: number;
}

export interface RunOutput {
  runId: number;
  stream: "stdout" | "stderr";
  text: string;
}

export interface RunExit {
  runId: number;
  code: number | null;
  durationMs: number;
}
