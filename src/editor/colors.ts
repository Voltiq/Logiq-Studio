/*
 * Colour swatches next to CSS colours (#hex, rgb(), rgba(), hsl()). Clicking
 * a swatch opens the system colour picker; the chosen colour replaces the
 * text, keeping its alpha when it had one.
 */
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const COLOR = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})\b|\b(?:rgba?|hsla?)\([^()\n]{3,60}\)/gi;

class Swatch extends WidgetType {
  constructor(
    readonly color: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: Swatch) {
    return other.color === this.color && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-swatch";
    el.style.setProperty("--swatch", this.color);
    el.title = "Pick a colour";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const input = document.createElement("input");
      input.type = "color";
      input.value = toHex6(this.color) ?? "#000000";
      input.style.cssText = "position:fixed;opacity:0;pointer-events:none;left:0;top:0";
      document.body.appendChild(input);
      input.addEventListener("input", () => {
        const text = view.state.sliceDoc(this.from, this.to);
        const alpha = alphaOf(text);
        const value = alpha === null ? input.value : input.value + Math.round(alpha * 255).toString(16).padStart(2, "0");
        view.dispatch({ changes: { from: this.from, to: this.to, insert: value } });
      });
      input.addEventListener("change", () => input.remove());
      input.addEventListener("blur", () => input.remove());
      input.click();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

/** #rgb, #rrggbb or rgb()/hsl() → #rrggbb, via the browser's own colour parser. */
export function toHex6(color: string): string | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  const v = String(ctx.fillStyle);
  if (v.startsWith("#")) return v.slice(0, 7);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  return m ? "#" + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("") : null;
}

function alphaOf(text: string): number | null {
  if (/^#[\da-f]{8}$/i.test(text)) return parseInt(text.slice(7), 16) / 255;
  if (/^#[\da-f]{4}$/i.test(text)) return parseInt(text[4] + text[4], 16) / 255;
  const m = /(?:rgba|hsla)\([^)]*[,/]\s*([\d.]+)(%?)\s*\)/i.exec(text) ?? /\/\s*([\d.]+)(%?)\s*\)/.exec(text);
  if (!m) return null;
  return m[2] ? +m[1] / 100 : +m[1];
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    COLOR.lastIndex = 0;
    for (let m = COLOR.exec(text); m; m = COLOR.exec(text)) {
      if (!CSS.supports("color", m[0])) continue;
      const start = from + m.index;
      b.add(start, start, Decoration.widget({ widget: new Swatch(m[0], start, start + m[0].length), side: -1 }));
    }
  }
  return b.finish();
}

export const colorSwatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
