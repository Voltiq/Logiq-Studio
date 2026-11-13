/*
 * Blame in the editor: a gutter that shows, at the first line of each run
 * of lines from one commit, its short id, author and age; the tooltip has
 * the commit's message, a click opens what the commit changed in the file.
 * It follows edits: a moment after typing stops it is read again for the
 * text as it is, and changed lines show "not committed yet".
 */
import { Compartment, Facet, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { BlameCommit } from "../lib/gitParse";
import { relativeTime } from "../lib/gitParse";
import { get } from "../lib/store";
import { t } from "../lib/i18n";
import { toast } from "../lib/store";
import { errorText } from "../lib/api";

interface BlameData {
  lines: (BlameCommit | null)[];
  /** The text no longer matches; it is read again soon. */
  stale: boolean;
}

export const setBlame = StateEffect.define<BlameData | null>();

type Load = (text: string) => Promise<(BlameCommit | null)[] | null>;

/** How a file's editor reads its blame and opens a commit. */
const handlers = Facet.define<{ load: Load; open: (c: BlameCommit) => void }, { load: Load; open: (c: BlameCommit) => void } | null>({ combine: (v) => v[0] ?? null });

/** The gutter is there only while the blame is shown. */
const shown = new Compartment();

export const blameField = StateField.define<BlameData | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setBlame)) return e.value;
    return v && tr.docChanged ? { ...v, stale: true } : v;
  },
});

class BlameMarker extends GutterMarker {
  constructor(
    readonly c: BlameCommit | null,
    readonly onOpen: (c: BlameCommit) => void,
  ) {
    super();
  }

  eq(other: BlameMarker) {
    return other.c?.hash === this.c?.hash;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-blame-entry";
    const c = this.c;
    if (!c) {
      el.textContent = "";
      return el;
    }
    const lang = get().settings.language;
    if (c.uncommitted) {
      el.textContent = t("Not committed yet");
      el.classList.add("is-uncommitted");
      return el;
    }
    const when = relativeTime(new Date(c.time * 1000).toISOString(), Date.now(), lang === "system" ? undefined : lang);
    const hash = document.createElement("span");
    hash.className = "cm-blame-hash";
    hash.textContent = c.hash.slice(0, 7);
    const who = document.createElement("span");
    who.className = "cm-blame-who";
    who.textContent = `${c.author} · ${when}`;
    el.append(hash, who);
    el.title = `${c.hash.slice(0, 7)} · ${c.author} · ${new Date(c.time * 1000).toLocaleString(lang === "system" ? undefined : lang)}\n${c.summary}`;
    el.onclick = () => this.onOpen(c);
    return el;
  }
}

const theGutter = gutter({
  class: "cm-blame-gutter",
  lineMarker(view, block) {
    const b = view.state.field(blameField, false);
    if (!b) return null;
    const n = view.state.doc.lineAt(block.from).number;
    const c = b.lines[n - 1] ?? null;
    const prev = n > 1 ? (b.lines[n - 2] ?? null) : undefined;
    if (prev !== undefined && prev?.hash === c?.hash) return null;
    return new BlameMarker(c, (x) => view.state.facet(handlers)?.open(x));
  },
  lineMarkerChange: (u) => u.state.field(blameField, false) !== u.startState.field(blameField, false),
  initialSpacer: () => new BlameMarker({ hash: "0000000", author: "Somebody Longname", time: 0, summary: "", uncommitted: false }, () => {}),
});

/** The blame's state and its refresh after edits; `load` reads the blame for a text, `open` shows a commit. */
export function blameGutter(load: Load, open: (c: BlameCommit) => void) {
  const refresher = ViewPlugin.fromClass(
    class {
      timer = 0;
      constructor(readonly view: EditorView) {}
      update(u: ViewUpdate) {
        const b = u.state.field(blameField, false);
        if (!b?.stale || !u.docChanged) return;
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          const text = this.view.state.doc.toString();
          void load(text).then((lines) => {
            if (this.view.state.field(blameField, false) && this.view.state.doc.toString() === text)
              this.view.dispatch({ effects: [setBlame.of(lines ? { lines, stale: false } : null), ...(lines ? [] : [shown.reconfigure([])])] });
          });
        }, 700);
      }
      destroy() {
        window.clearTimeout(this.timer);
      }
    },
  );
  // Leftmost, before the breakpoints and line numbers.
  return [blameField, refresher, handlers.of({ load, open }), Prec.highest(shown.of([]))];
}

/** Shows or hides the blame of the file in a view. */
export async function toggleBlame(view: EditorView, load: Load) {
  if (view.state.field(blameField, false)) {
    view.dispatch({ effects: [setBlame.of(null), shown.reconfigure([])] });
    return;
  }
  try {
    const lines = await load(view.state.doc.toString());
    if (!lines) {
      toast("info", t("No history for this file"), t("Blame needs a file in a Git repository with at least one commit."));
      return;
    }
    view.dispatch({ effects: [setBlame.of({ lines, stale: false }), shown.reconfigure(theGutter)] });
  } catch (e) {
    toast("error", t("Blame isn't available"), errorText(e));
  }
}
