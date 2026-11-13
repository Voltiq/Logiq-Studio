/*
 * One editor state per open file, all built from the same extensions. The
 * settings live in compartments, so they change without rebuilding a state
 * (and its undo history).
 */
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { abbreviationTracker, expandAbbreviation } from "@emmetio/codemirror6-plugin";
import { findUsages, goToDefinition, renameSymbol } from "./javaNav";
import { colorSwatches } from "./colors";
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
import { bracketMatching, ensureSyntaxTree, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { lintGutter, linter, lintKeymap, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { graphiqHighlight, graphiqTheme } from "./theme";
import { languageFor } from "./languages";
import { javaCompletions } from "./javaComplete";
import type { Settings } from "../lib/settings";
import { get } from "../lib/store";
import { samePath } from "../lib/paths";
import { t } from "../lib/i18n";

export const compartments = {
  language: new Compartment(),
  indent: new Compartment(),
  wrap: new Compartment(),
  lineNumbers: new Compartment(),
  brackets: new Compartment(),
};

function languageExtension(path: string): Extension {
  const lang = languageFor(path);
  const ext: Extension[] = [lang.support()];
  if (lang.id === "java") {
    const here = () => currentPath(path);
    ext.push(
      EditorState.languageData.of(() => [{ autocomplete: javaCompletions(here) }]),
      Prec.high(
        keymap.of([
          { key: "F12", run: (v) => goToDefinition(v, here()) },
          { key: "Shift-F12", run: (v) => (findUsages(v), true) },
          { key: "F2", run: (v) => (renameSymbol(v, here()), true) },
        ]),
      ),
      // Ctrl+click follows a name to its definition (Alt+click adds a cursor).
      EditorView.domEventHandlers({
        mousedown: (e, v) => {
          if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null) return false;
          e.preventDefault();
          goToDefinition(v, here(), pos);
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
    if (lang.id !== "text" && lang.id !== "markdown" && lang.id !== "html" && lang.id !== "xml") {
      const tree = ensureSyntaxTree(view.state, doc.length, 300);
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
    for (const d of get().problems) {
      if (!samePath(d.path, path())) continue;
      if (d.line < 1 || d.line > doc.lines) continue;
      const line = doc.line(d.line);
      let from = line.from + Math.max(0, Math.min(line.length, d.column - 1));
      const word = /[\w$]+/y;
      word.lastIndex = from - line.from;
      const m = word.exec(line.text);
      let to = m ? from + m[0].length : Math.min(line.to, from + 1);
      if (to <= from) {
        from = line.from + (line.text.length - line.text.trimStart().length);
        to = line.to;
      }
      out.push({ from, to, severity: d.severity, source: "javac", message: d.message });
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
      linter(lintSource(() => currentPath(path)), { delay: 450 }),
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

export function languageEffect(path: string) {
  return compartments.language.reconfigure(languageExtension(path));
}
