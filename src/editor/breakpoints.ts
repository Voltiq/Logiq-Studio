/*
 * Breakpoints in the editor: a gutter of red dots that follow their lines as
 * the code is edited, and the highlighted line where the debugger stopped.
 */
import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";

const toggle = StateEffect.define<{ pos: number; on: boolean }>({ map: (v, m) => ({ pos: m.mapPos(v.pos), on: v.on }) });
const setAll = StateEffect.define<number[]>();

class Dot extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-breakpoint";
    return el;
  }
}
const dot = new Dot();

export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(toggle)) {
        set = e.value.on ? set.update({ add: [dot.range(e.value.pos)] }) : set.update({ filter: (from) => from !== e.value.pos });
      } else if (e.is(setAll)) {
        const lines = [...new Set(e.value)].filter((l) => l >= 1 && l <= tr.state.doc.lines).sort((a, b) => a - b);
        set = RangeSet.of(lines.map((l) => dot.range(tr.state.doc.line(l).from)));
      }
    }
    return set;
  },
});

/** The 1-based lines that have a breakpoint. */
export function breakpointLines(state: EditorState): number[] {
  const out: number[] = [];
  const set = state.field(breakpointField, false);
  if (!set) return out;
  set.between(0, state.doc.length, (from) => {
    out.push(state.doc.lineAt(from).number);
  });
  return [...new Set(out)];
}

export function toggleBreakpointAt(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  let has = false;
  view.state.field(breakpointField).between(line.from, line.from, () => {
    has = true;
  });
  view.dispatch({ effects: toggle.of({ pos: line.from, on: !has }) });
}

export function setBreakpointsEffect(lines: number[]) {
  return setAll.of(lines);
}

export const breakpointGutter: Extension = [
  breakpointField,
  gutter({
    class: "cm-breakpoint-gutter",
    markers: (v) => v.state.field(breakpointField),
    initialSpacer: () => dot,
    domEventHandlers: {
      mousedown(view, line) {
        toggleBreakpointAt(view, line.from);
        return true;
      },
    },
  }),
];

// ----- The line the debugger stopped at ----------------------------------------------

const setDebugLine = StateEffect.define<number | null>();
const debugLineDeco = Decoration.line({ class: "cm-debug-line" });

export const debugLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDebugLine)) {
        deco = e.value === null || e.value < 1 || e.value > tr.state.doc.lines ? Decoration.none : Decoration.set([debugLineDeco.range(tr.state.doc.line(e.value).from)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function debugLineEffect(line: number | null) {
  return setDebugLine.of(line);
}
