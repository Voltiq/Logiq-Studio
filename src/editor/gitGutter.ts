/*
 * The change bar left of the line numbers: lines added, changed or deleted
 * since the last commit, like VS Code's. A click on a mark opens the diff.
 */
import { Chunk } from "@codemirror/merge";
import { RangeSet, StateEffect, StateField, Text, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from "@codemirror/view";
import { useGit, headText } from "../lib/git";

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: "added" | "modified" | "deleted") {
    super();
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  elementClass = "";
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-mark is-${this.kind}`;
    return el;
  }
}

const MARKS = { added: new ChangeMarker("added"), modified: new ChangeMarker("modified"), deleted: new ChangeMarker("deleted") };

const setBase = StateEffect.define<string | null>();
const setMarks = StateEffect.define<RangeSet<GutterMarker>>();

/** The committed text, and the marks against it. */
const gitField = StateField.define<{ base: Text | null; marks: RangeSet<GutterMarker> }>({
  create: () => ({ base: null, marks: RangeSet.empty }),
  update(value, tr) {
    let { base, marks } = value;
    for (const e of tr.effects) {
      if (e.is(setBase)) base = e.value === null ? null : Text.of(e.value.split("\n"));
      if (e.is(setMarks)) marks = e.value;
    }
    if (tr.docChanged && marks.size) marks = marks.map(tr.changes);
    return base === value.base && marks === value.marks ? value : { base, marks };
  },
});

/** The marks for `doc` against `base`. */
export function changeMarks(base: Text, doc: Text): RangeSet<GutterMarker> {
  const ranges = [];
  for (const c of Chunk.build(base, doc)) {
    if (c.fromB === c.toB) {
      // Lines removed: a mark on the line where they were.
      const line = doc.lineAt(Math.min(c.fromB, doc.length));
      ranges.push(MARKS.deleted.range(line.from));
      continue;
    }
    const kind = c.fromA === c.toA ? "added" : "modified";
    const first = doc.lineAt(c.fromB).number;
    // A chunk ends after the last line's break, which belongs to the next line.
    const last = doc.lineAt(Math.max(c.fromB, Math.min(doc.length, c.toB - (c.toB > c.fromB ? 1 : 0)))).number;
    for (let n = first; n <= last; n++) ranges.push(MARKS[kind].range(doc.line(n).from));
  }
  return RangeSet.of(ranges, true);
}

/** The change bar for the file at `path()` (its current path after renames). */
export function gitGutter(path: () => string, onClick: (path: string) => void): Extension {
  const loader = ViewPlugin.fromClass(
    class {
      timer = 0;
      version = -1;
      unsubscribe: () => void;
      constructor(readonly view: EditorView) {
        this.load();
        this.unsubscribe = useGit.subscribe((s) => {
          if (s.version !== this.version) this.load();
        });
      }
      load() {
        this.version = useGit.getState().version;
        void headText(path()).then((base) => {
          if (!this.view.dom.isConnected && !this.view.dom.ownerDocument) return;
          const was = this.view.state.field(gitField).base;
          if ((was === null && base === null) || (was && base !== null && was.toString() === base)) return;
          this.view.dispatch({ effects: setBase.of(base) });
          this.compute();
        });
      }
      update(u: ViewUpdate) {
        if (u.docChanged) {
          window.clearTimeout(this.timer);
          this.timer = window.setTimeout(() => this.compute(), 200);
        }
      }
      compute() {
        const { base } = this.view.state.field(gitField);
        const marks = base ? changeMarks(base, this.view.state.doc) : RangeSet.empty;
        this.view.dispatch({ effects: setMarks.of(marks) });
      }
      destroy() {
        window.clearTimeout(this.timer);
        this.unsubscribe();
      }
    },
  );
  return [
    gitField,
    loader,
    gutter({
      class: "cm-git-gutter",
      markers: (v) => v.state.field(gitField).marks,
      domEventHandlers: {
        mousedown: (v, line) => {
          let has = false;
          v.state.field(gitField).marks.between(line.from, line.from, () => {
            has = true;
          });
          if (has) onClick(path());
          return has;
        },
      },
    }),
  ];
}
