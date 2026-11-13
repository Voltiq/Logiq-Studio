/*
 * Merge conflicts in the editor: the blocks git leaves (<<<<<<< current,
 * ======= , >>>>>>> incoming) are coloured, and a bar above each offers to
 * keep the current side, the incoming side or both, or to compare them.
 */
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { parseConflicts, resolveConflict, type ConflictBlock } from "../lib/gitParse";
import { t } from "../lib/i18n";

/** Replaces a conflict block with the side (or sides) chosen. */
export function resolveBlock(view: EditorView, block: ConflictBlock, take: "current" | "incoming" | "both") {
  const doc = view.state.doc;
  if (block.end > doc.lines) return;
  const lines: string[] = [];
  for (let n = 1; n <= block.end; n++) lines.push(doc.line(n).text);
  const kept = resolveConflict(lines, block, take);
  const from = doc.line(block.start).from;
  let to = doc.line(block.end).to;
  // Nothing kept: the line break after the block goes too.
  if (!kept.length && to < doc.length) to += 1;
  view.dispatch({ changes: { from, to, insert: kept.join("\n") }, selection: { anchor: from }, scrollIntoView: true, userEvent: "input.resolve" });
  view.focus();
}

class ActionsWidget extends WidgetType {
  constructor(
    readonly block: ConflictBlock,
    readonly compare: () => void,
  ) {
    super();
  }

  eq(other: ActionsWidget) {
    return other.block.start === this.block.start && other.block.end === this.block.end && other.block.current === this.block.current && other.block.incoming === this.block.incoming;
  }

  toDOM(view: EditorView) {
    const bar = document.createElement("div");
    bar.className = "cm-conflict-actions";
    const add = (label: string, title: string, f: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = (e) => {
        e.preventDefault();
        f();
      };
      bar.appendChild(b);
    };
    const find = () => parseConflicts(view.state.doc.toString()).find((x) => x.start === this.block.start) ?? this.block;
    add(t("Accept current"), this.block.current || "HEAD", () => resolveBlock(view, find(), "current"));
    add(t("Accept incoming"), this.block.incoming, () => resolveBlock(view, find(), "incoming"));
    add(t("Accept both"), t("Current, then incoming"), () => resolveBlock(view, find(), "both"));
    add(t("Compare"), t("Both sides side by side"), this.compare);
    return bar;
  }

  ignoreEvent() {
    return false;
  }
}

const lineDeco = {
  marker: Decoration.line({ class: "cm-conflict-marker" }),
  current: Decoration.line({ class: "cm-conflict-current" }),
  base: Decoration.line({ class: "cm-conflict-base" }),
  incoming: Decoration.line({ class: "cm-conflict-incoming" }),
};

function build(state: EditorState, compare: () => void): DecorationSet {
  const doc = state.doc;
  if (doc.length > 4_000_000) return Decoration.none;
  const text = doc.toString();
  if (!text.includes("<<<<<<<")) return Decoration.none;
  const out: Range<Decoration>[] = [];
  for (const b of parseConflicts(text)) {
    if (b.end > doc.lines) continue;
    out.push(Decoration.widget({ widget: new ActionsWidget(b, compare), block: true, side: -1 }).range(doc.line(b.start).from));
    for (let n = b.start; n <= b.end; n++) {
      const kind = n === b.start || n === b.middle || n === b.end || n === b.base ? "marker" : n < (b.base ?? b.middle) ? "current" : n < b.middle ? "base" : "incoming";
      out.push(lineDeco[kind].range(doc.line(n).from));
    }
  }
  return Decoration.set(out, true);
}

/** The conflict colours and bars for a file; `compare` opens its two sides as a diff. */
export function conflictMarkers(compare: () => void) {
  return StateField.define<DecorationSet>({
    create: (s) => build(s, compare),
    update: (deco, tr) => (tr.docChanged ? build(tr.state, compare) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}
