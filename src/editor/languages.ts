/*
 * The languages the editor knows: their names, file extensions, icon badge
 * and colour, and the CodeMirror grammar that colours and folds them. What a
 * language can do beyond editing (run, outline, diagram, language server) is
 * its plug-in in src/languages.
 */
import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { java } from "@codemirror/lang-java";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { sql, SQLite, type SQLNamespace } from "@codemirror/lang-sql";
import { kotlin } from "@codemirror/legacy-modes/mode/clike";
import { extname } from "../lib/paths";

export type LanguageId =
  | "java"
  | "html"
  | "css"
  | "javascript"
  | "typescript"
  | "json"
  | "markdown"
  | "xml"
  | "python"
  | "c"
  | "cpp"
  | "php"
  | "kotlin"
  | "sql"
  | "text";

export interface Language {
  id: LanguageId;
  name: string;
  /** Token for the file icon colour. */
  color: string;
  /** Short badge drawn on the file icon. */
  badge: string;
  /** The grammar; the path lets SQL complete the tables of the file's database. */
  support: (path?: string) => Extension;
  /** Line comment, for status and commands. */
  comment?: string;
}

/** The tables of each SQL file's database, for completion (filled by the SQL plug-in). */
export const sqlSchemas = new Map<string, SQLNamespace>();

const kotlinLanguage = StreamLanguage.define(kotlin);

const LANGS: Record<LanguageId, Language> = {
  java: { id: "java", name: "Java", color: "var(--accent-orange)", badge: "J", support: () => java(), comment: "//" },
  html: { id: "html", name: "HTML", color: "var(--accent-red)", badge: "<>", support: () => html({ autoCloseTags: true, selfClosingTags: true }) },
  css: { id: "css", name: "CSS", color: "var(--accent-blue)", badge: "#", support: () => css() },
  javascript: { id: "javascript", name: "JavaScript", color: "var(--accent-yellow)", badge: "JS", support: () => javascript({ jsx: true }), comment: "//" },
  typescript: { id: "typescript", name: "TypeScript", color: "var(--accent-blue)", badge: "TS", support: () => javascript({ typescript: true, jsx: true }), comment: "//" },
  json: { id: "json", name: "JSON", color: "var(--accent-lime)", badge: "{}", support: () => json() },
  markdown: { id: "markdown", name: "Markdown", color: "var(--accent-teal)", badge: "M", support: () => markdown() },
  xml: { id: "xml", name: "XML", color: "var(--accent-magenta)", badge: "<>", support: () => html() },
  python: { id: "python", name: "Python", color: "var(--accent-blue)", badge: "Py", support: () => python(), comment: "#" },
  c: { id: "c", name: "C", color: "var(--accent-gray)", badge: "C", support: () => cpp(), comment: "//" },
  cpp: { id: "cpp", name: "C++", color: "var(--accent-purple)", badge: "C+", support: () => cpp(), comment: "//" },
  php: { id: "php", name: "PHP", color: "var(--accent-purple)", badge: "P", support: () => php({ plain: false }), comment: "//" },
  kotlin: { id: "kotlin", name: "Kotlin", color: "var(--accent-magenta)", badge: "K", support: () => kotlinLanguage, comment: "//" },
  sql: {
    id: "sql",
    name: "SQL",
    color: "var(--accent-teal)",
    badge: "SQ",
    support: (path) => sql({ dialect: SQLite, upperCaseKeywords: true, schema: (path && sqlSchemas.get(path.toLowerCase())) || undefined }),
    comment: "--",
  },
  text: { id: "text", name: "Plain text", color: "var(--accent-gray)", badge: "", support: () => [] },
};

const BY_EXT: Record<string, LanguageId> = {
  java: "java",
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  xml: "xml",
  svg: "xml",
  py: "python",
  pyw: "python",
  pyi: "python",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  php: "php",
  phtml: "php",
  kt: "kotlin",
  kts: "kotlin",
  sql: "sql",
};

export function languageFor(path: string): Language {
  return LANGS[BY_EXT[extname(path)] ?? "text"];
}

export function languageById(id: LanguageId): Language {
  return LANGS[id];
}

/** The file extensions of a language. */
export function extensionsOf(id: LanguageId): string[] {
  return Object.entries(BY_EXT)
    .filter(([, l]) => l === id)
    .map(([e]) => e);
}

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
