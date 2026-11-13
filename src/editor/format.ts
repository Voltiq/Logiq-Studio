/*
 * Formatting with Prettier: Java through prettier-plugin-java, HTML, CSS,
 * JavaScript, TypeScript, JSON and Markdown through Prettier's own parsers.
 * The formatters are loaded the first time they are needed.
 */
import type { EditorView } from "@codemirror/view";
import { indentRange } from "@codemirror/language";
import { languageFor, type LanguageId } from "./languages";
import type { Settings } from "../lib/settings";
import { pluginById } from "../languages";

const PARSER: Partial<Record<LanguageId, string>> = {
  java: "java",
  html: "html",
  css: "css",
  javascript: "babel",
  typescript: "typescript",
  json: "json",
  markdown: "markdown",
};

async function plugins(lang: LanguageId) {
  const estree = import("prettier/plugins/estree");
  switch (lang) {
    case "java":
      return [(await import("prettier-plugin-java")).default];
    case "html":
      return Promise.all([import("prettier/plugins/html"), import("prettier/plugins/postcss"), import("prettier/plugins/babel"), estree]);
    case "css":
      return [await import("prettier/plugins/postcss")];
    case "typescript":
      return Promise.all([import("prettier/plugins/typescript"), estree]);
    case "markdown":
      return [await import("prettier/plugins/markdown")];
    default:
      return Promise.all([import("prettier/plugins/babel"), estree]);
  }
}

export function canFormat(path: string): boolean {
  return !!PARSER[languageFor(path).id] || !!pluginById(languageFor(path).id)?.canFormat?.(path);
}

export class FormatError extends Error {
  line?: number;
  column?: number;
}

/** Formats text; returns the new text and where the cursor ends up. */
export async function formatText(path: string, text: string, cursor: number, s: Settings): Promise<{ text: string; cursor: number }> {
  const lang = languageFor(path).id;
  const parser = PARSER[lang];
  const plugin = pluginById(lang);
  if (!parser && plugin?.format) {
    // An outside formatter (clang-format); the cursor stays on its line.
    const out = await plugin.format(path, text);
    if (out === null) throw new FormatError("No formatter for this kind of file was found.");
    const line = text.slice(0, cursor).split("\n").length;
    const lines = out.split("\n");
    return { text: out, cursor: Math.min(out.length, lines.slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0)) };
  }
  if (!parser) throw new FormatError("This kind of file can't be formatted.");
  const prettier = await import("prettier/standalone");
  try {
    const r = await prettier.formatWithCursor(text, {
      parser,
      plugins: (await plugins(lang)) as never,
      cursorOffset: Math.min(cursor, text.length),
      tabWidth: s.tabSize,
      useTabs: !s.insertSpaces,
      printWidth: lang === "java" ? 110 : 100,
      singleQuote: false,
      htmlWhitespaceSensitivity: "css",
    });
    return { text: r.formatted, cursor: Math.max(0, r.cursorOffset) };
  } catch (e) {
    const err = new FormatError(String((e as Error).message ?? e).split("\n")[0]);
    const loc = (e as { loc?: { start?: { line: number; column: number } } }).loc?.start;
    if (loc) {
      err.line = loc.line;
      err.column = loc.column;
    }
    throw err;
  }
}

/**
 * Formats the editor's document in one undoable change. Files Prettier
 * doesn't know are re-indented instead.
 */
export async function formatView(view: EditorView, path: string, s: Settings): Promise<boolean> {
  if (!canFormat(path)) {
    const changes = indentRange(view.state, 0, view.state.doc.length);
    if (!changes.empty) view.dispatch({ changes, userEvent: "format" });
    return true;
  }
  const before = view.state.doc.toString();
  const r = await formatText(path, before, view.state.selection.main.head, s);
  // The document may have changed while the formatter ran.
  if (view.state.doc.toString() !== before || r.text === before) return r.text === before;
  view.dispatch({
    changes: minimalChange(before, r.text),
    selection: { anchor: Math.min(r.cursor, r.text.length) },
    userEvent: "format",
    scrollIntoView: true,
  });
  return true;
}

/** Only the part that differs, so markers and folds outside it stay where they are. */
export function minimalChange(a: string, b: string) {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}
