/*
 * One editor state per open file, all built from the same extensions. The
 * settings live in compartments, so they change without rebuilding a state
 * (and its undo history).
 */
import { Compartment, EditorState, Prec, StateEffect, type Extension } from "@codemirror/state";
import { abbreviationTracker, expandAbbreviation } from "@emmetio/codemirror6-plugin";
import { findUsages, goToDefinition, renameSymbol } from "./javaNav";
import { colorSwatches } from "./colors";
import { breakpointGutter, debugLineField, toggleBreakpointAt } from "./breakpoints";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, ensureSyntaxTree, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxTree } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { lintGutter, linter, lintKeymap, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { graphiqHighlight, graphiqTheme } from "./theme";
import { languageFor } from "./languages";
import { javaCompletions } from "./javaComplete";
import { gitGutter } from "./gitGutter";
import { conflictMarkers } from "./conflicts";
import { blameGutter, toggleBlame } from "./blame";
import type { BlameCommit } from "../lib/gitParse";
import { stylelintDiagnostics } from "./stylelint";
import { eslintDiagnostics } from "./eslint";
import { jumpToDefinition } from "@codemirror/lsp-client";
import { hasServer, lspExtension, organizeImports, quickFix, refactor, serverDiagnosticsFor } from "../lsp/clients";
import { pluginById } from "../languages";
import type { Settings } from "../lib/settings";
import { get } from "../lib/store";
import { samePath } from "../lib/paths";
import { t } from "../lib/i18n";

/** Files longer than this (in characters) skip the checks that read the whole text while typing: ESLint, Stylelint, the conflict scan. */
export const LARGE_FILE = 1_500_000;

/** Dispatched when problems change outside the editor (compiler, language server). */
export const relint = StateEffect.define<null>();

export const compartments = {
  language: new Compartment(),
  indent: new Compartment(),
  wrap: new Compartment(),
  lineNumbers: new Compartment(),
  brackets: new Compartment(),
};

function languageExtension(path: string): Extension {
  const lang = languageFor(path);
  const ext: Extension[] = [lang.support(path), lspExtension(path)];
  const server = hasServer(path);
  const here = () => currentPath(path);
  ext.push(Prec.high(keymap.of([{ key: "Mod-.", run: (v) => (void quickFix(v, here()), true) }])));
  ext.push(pluginById(lang.id)?.editor?.(here) ?? []);
  // Rename and find usages through a plug-in's language server (Java has its own keys below).
  if (server && lang.id !== "java") ext.push(Prec.high(keymap.of([{ key: "Mod-Shift-r", run: (v: EditorView) => (void refactor(v, here()), true) }])));
  if (lang.id === "java") {
    ext.push(
      // With the Java language server its completion, F12, F2 and Shift+F12 take over.
      server ? [] : EditorState.languageData.of(() => [{ autocomplete: javaCompletions(here) }]),
      Prec.high(
        keymap.of([
          ...(server
            ? [
                { key: "Shift-Alt-o", run: (v: EditorView) => (void organizeImports(v, here()), true) },
                { key: "Mod-Shift-r", run: (v: EditorView) => (void refactor(v, here()), true) },
              ]
            : [
                { key: "F12", run: (v: EditorView) => goToDefinition(v, here()) },
                { key: "Shift-F12", run: (v: EditorView) => (findUsages(v), true) },
                { key: "F2", run: (v: EditorView) => (renameSymbol(v, here()), true) },
              ]),
          { key: "F9", run: (v) => (toggleBreakpointAt(v, v.state.selection.main.head), true) },
        ]),
      ),
      // Breakpoints sit left of the line numbers, as in other IDEs.
      Prec.highest(breakpointGutter),
      // Ctrl+click follows a name to its definition (Alt+click adds a cursor).
      EditorView.domEventHandlers({
        mousedown: (e, v) => {
          if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null) return false;
          e.preventDefault();
          if (server) {
            v.dispatch({ selection: { anchor: pos } });
            jumpToDefinition(v);
          } else goToDefinition(v, here(), pos);
          return true;
        },
      }),
    );
  }
  if (lang.id === "html" || lang.id === "css") {
    ext.push(Prec.high(abbreviationTracker({ syntax: lang.id === "css" ? "css" : "html" } as never)), Prec.high(keymap.of([{ key: "Mod-e", run: expandAbbreviation }])));
  }
  if (lang.id === "css" || lang.id === "html") ext.push(colorSwatches);
  return ext;
}

// The path can change on rename; completion asks for it lazily.
const renamed = new Map<string, string>();
function currentPath(original: string) {
  return renamed.get(original) ?? original;
}
export function notePathChange(original: string, now: string) {
  renamed.set(original, now);
}

export function settingsEffects(s: Settings) {
  return [
    compartments.indent.reconfigure(indentFor(s)),
    compartments.wrap.reconfigure(s.wordWrap ? EditorView.lineWrapping : []),
    compartments.lineNumbers.reconfigure(s.lineNumbers ? [lineNumbers(), foldGutter()] : [foldGutter()]),
    compartments.brackets.reconfigure(s.autoCloseBrackets ? closeBrackets() : []),
  ];
}

function indentFor(s: Settings): Extension {
  return [EditorState.tabSize.of(s.tabSize), indentUnit.of(s.insertSpaces ? " ".repeat(s.tabSize) : "\t")];
}

/** Syntax errors from the parser, plus the compiler's findings for this file. */
function lintSource(path: () => string) {
  return (view: EditorView): CmDiagnostic[] => {
    const out: CmDiagnostic[] = [];
    const doc = view.state.doc;
    const lang = languageFor(path());
    for (const d of serverDiagnosticsFor(path())) {
      const at = (p: { line: number; character: number }) => {
        const l = doc.line(Math.max(1, Math.min(doc.lines, p.line + 1)));
        return Math.min(l.to, l.from + p.character);
      };
      const from = at(d.range.start);
      const to = Math.max(from, at(d.range.end));
      out.push({ from, to: to === from ? Math.min(doc.length, from + 1) : to, severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info", source: d.source ?? "server", message: d.message });
    }
    const huge = doc.length > LARGE_FILE;
    const conflicted = !huge && /^<{7} /m.test(doc.sliceString(0, doc.length));
    if (!conflicted && !hasServer(path()) && lang.id !== "text" && lang.id !== "markdown" && lang.id !== "html" && lang.id !== "xml") {
      // A very large file is checked as far as it has been parsed for drawing, not to its end.
      const tree = huge ? syntaxTree(view.state) : ensureSyntaxTree(view.state, doc.length, 300);
      let count = 0;
      tree?.iterate({
        enter(n) {
          if (!n.type.isError || count > 50) return;
          count++;
          const from = n.from;
          const to = Math.min(doc.length, Math.max(n.to, from + 1));
          const before = doc.sliceString(Math.max(0, from - 1), from);
          out.push({
            from: n.from === n.to && before && from > 0 ? from - 1 : from,
            to: n.from === n.to && before && from > 0 ? from : to,
            severity: "error",
            source: "syntax",
            message: n.from === n.to ? t("Syntax error: something is missing here.") : t("Syntax error"),
          });
        },
      });
    }
    const source = lang.id === "java" ? "javac" : lang.name;
    for (const d of get().problems) {
      if (!samePath(d.path, path())) continue;
      if (d.line < 1 || d.line > doc.lines) continue;
      const line = doc.line(d.line);
      if (!d.column) {
        // No column (Python, PHP, SQL): the line's code.
        const start = line.from + (line.text.length - line.text.trimStart().length);
        out.push({ from: start, to: Math.max(start + 1, line.to), severity: d.severity, source, message: d.message });
        continue;
      }
      let from = line.from + Math.max(0, Math.min(line.length, d.column - 1));
      const word = /[\w$]+/y;
      word.lastIndex = from - line.from;
      const m = word.exec(line.text);
      let to = m ? from + m[0].length : Math.min(line.to, from + 1);
      if (to <= from) {
        from = line.from + (line.text.length - line.text.trimStart().length);
        to = line.to;
      }
      out.push({ from, to, severity: d.severity, source, message: d.message });
    }
    return out;
  };
}

export function createState(path: string, text: string, s: Settings, onUpdate: Extension): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      compartments.lineNumbers.of(s.lineNumbers ? [lineNumbers(), foldGutter()] : [foldGutter()]),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.clickAddsSelectionRange.of((e) => e.altKey),
      indentOnInput(),
      bracketMatching(),
      compartments.brackets.of(s.autoCloseBrackets ? closeBrackets() : []),
      autocompletion({ icons: true, activateOnTypingDelay: 60 }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      lintGutter(),
      gitGutter(
        () => currentPath(path),
        (p) => void import("../lib/diffTabs").then((m) => m.openWorkingDiff(p)),
      ),
      debugLineField,
      conflictMarkers(() => void import("../lib/diffTabs").then((m) => m.openConflictDiff(currentPath(path)))),
      blameGutter(
        (text) => loadBlame(currentPath(path), text),
        (c) => openBlameCommit(currentPath(path), c),
      ),
      linter(lintSource(() => currentPath(path)), {
        delay: 450,
        // New problems from the compiler or a language server re-run the check.
        needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(relint))),
      }),
      // Stylelint for style sheets, when the project has it.
      /\.(css|scss|less)$/i.test(path) ? linter((view) => (view.state.doc.length > LARGE_FILE ? [] : stylelintDiagnostics(currentPath(path), view.state.doc)), { delay: 800 }) : [],
      // ESLint for JavaScript, next to the language server's own checks.
      /\.(m|c)?jsx?$/i.test(path)
        ? linter((view) => (view.state.doc.length > LARGE_FILE ? [] : eslintDiagnostics(view.state.doc.toString(), view.state.doc, /\.mjs$/i.test(currentPath(path)) || /^\s*(import|export)\s/m.test(view.state.doc.toString())).catch(() => [])), { delay: 700 })
        : [],
      compartments.indent.of(indentFor(s)),
      compartments.wrap.of(s.wordWrap ? EditorView.lineWrapping : []),
      compartments.language.of(languageExtension(path)),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
      graphiqTheme,
      graphiqHighlight,
      onUpdate,
    ],
  });
}

async function loadBlame(path: string, text: string): Promise<(BlameCommit | null)[] | null> {
  const { blame } = await import("../lib/gitMore");
  return (await blame(path, text))?.lines ?? null;
}

async function openBlameCommit(path: string, c: BlameCommit) {
  const { relPath } = await import("../lib/git");
  const { openCommitDiff } = await import("../lib/diffTabs");
  const rel = relPath(path);
  if (!rel) return;
  openCommitDiff({ hash: c.hash, short: c.hash.slice(0, 7), author: c.author, email: "", date: new Date(c.time * 1000).toISOString(), subject: c.summary, refs: [], parents: [`${c.hash}^`] }, { path: rel, status: "M" } as never);
}

/** Shows or hides who last changed each line (Ctrl+Alt+B). */
export function toggleBlameIn(view: EditorView, path: string) {
  return toggleBlame(view, (text) => loadBlame(path, text));
}

export function languageEffect(path: string) {
  return compartments.language.reconfigure(languageExtension(path));
}
