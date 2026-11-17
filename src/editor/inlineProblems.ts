/*
 * What is wrong, where it is: the message of a line's problem is shown after the line's code (the most serious
 * one when a line has several), so it can be read without pointing at the underline. The full message, with
 * its details, is still in the tooltip and in Problems.
 */
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { forEachDiagnostic, setDiagnosticsEffect, type Diagnostic } from "@codemirror/lint";

const RANK: Record<Diagnostic["severity"], number> = { error: 3, warning: 2, info: 1, hint: 0 };
const MAX = 140;

class Message extends WidgetType {
  constructor(
    readonly text: string,
    readonly severity: Diagnostic["severity"],
    readonly more: number,
  ) {
    super();
  }

  eq(other: Message) {
    return other.text === this.text && other.severity === this.severity && other.more === this.more;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-inline-problem is-${this.severity}`;
    el.textContent = this.text;
    if (this.more) {
      const more = document.createElement("span");
      more.className = "cm-inline-problem-more";
      more.textContent = `+${this.more}`;
      el.append(more);
    }
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

/** The first line of a message, short enough to sit after the code. */
export function shortMessage(message: string): string {
  const lines = message.split("\n").map((l) => l.trim());
  let text = lines[0];
  // javac names what it couldn't find on a line of its own ("symbol: method area()"): it belongs in the summary.
  const symbol = lines.slice(1).find((l) => /^symbol:/.test(l));
  if (symbol) text += ": " + symbol.replace(/^symbol:\s*/, "");
  return text.length > MAX ? text.slice(0, MAX - 1) + "…" : text;
}

function build(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const perLine = new Map<number, { d: Diagnostic; count: number }>();
  forEachDiagnostic(view.state, (d, from) => {
    const line = doc.lineAt(Math.min(from, doc.length)).number;
    const seen = perLine.get(line);
    if (!seen) perLine.set(line, { d, count: 1 });
    else {
      seen.count++;
      if (RANK[d.severity] > RANK[seen.d.severity]) seen.d = d;
    }
  });
  const builder = new RangeSetBuilder<Decoration>();
  for (const line of [...perLine.keys()].sort((a, b) => a - b)) {
    const { d, count } = perLine.get(line)!;
    const text = shortMessage(d.message);
    if (!text) continue;
    builder.add(doc.line(line).to, doc.line(line).to, Decoration.widget({ widget: new Message(text, d.severity, count - 1), side: 1 }));
  }
  return builder.finish();
}

export const inlineProblems = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)))) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
