import type { Extension } from "@codemirror/state";
import { java } from "@codemirror/lang-java";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { extname } from "../lib/paths";

export type LanguageId = "java" | "html" | "css" | "javascript" | "typescript" | "json" | "markdown" | "xml" | "text";

export interface Language {
  id: LanguageId;
  name: string;
  /** Token for the file icon colour. */
  color: string;
  /** Short badge drawn on the file icon. */
  badge: string;
  support: () => Extension;
  /** Line comment, for status and commands. */
  comment?: string;
}

const LANGS: Record<LanguageId, Language> = {
  java: { id: "java", name: "Java", color: "var(--accent-orange)", badge: "J", support: () => java(), comment: "//" },
  html: { id: "html", name: "HTML", color: "var(--accent-red)", badge: "<>", support: () => html({ autoCloseTags: true, selfClosingTags: true }) },
  css: { id: "css", name: "CSS", color: "var(--accent-blue)", badge: "#", support: () => css() },
  javascript: { id: "javascript", name: "JavaScript", color: "var(--accent-yellow)", badge: "JS", support: () => javascript({ jsx: true }), comment: "//" },
  typescript: { id: "typescript", name: "TypeScript", color: "var(--accent-blue)", badge: "TS", support: () => javascript({ typescript: true, jsx: true }), comment: "//" },
  json: { id: "json", name: "JSON", color: "var(--accent-lime)", badge: "{}", support: () => json() },
  markdown: { id: "markdown", name: "Markdown", color: "var(--accent-teal)", badge: "M", support: () => markdown() },
  xml: { id: "xml", name: "XML", color: "var(--accent-magenta)", badge: "<>", support: () => html() },
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
};

export function languageFor(path: string): Language {
  return LANGS[BY_EXT[extname(path)] ?? "text"];
}

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
