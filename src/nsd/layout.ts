/*
 * Where the blocks of a Nassi–Shneiderman diagram go: boxes, the diagonals of decisions, the bars of loops,
 * wrapped text. Drawn on screen and exported as SVG from the same layout.
 */
import type { Block, ListPath, Nsd, Place } from "./model";

export type Item =
  | { t: "rect"; x: number; y: number; w: number; h: number; cls: string; place?: Place }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; cls?: string }
  | { t: "text"; x: number; y: number; s: string; anchor: "start" | "middle" | "end"; cls: string }
  | { t: "slot"; x: number; y: number; w: number; h: number; list: ListPath };

export interface Layout {
  width: number;
  height: number;
  items: Item[];
}

export interface Labels {
  yes: string;
  no: string;
}

const PX = 10;
const PY = 7;
const LH = 17;
const INDENT = 26;
const MAX_TEXT = 340;
const MIN_W = 320;
const MAX_W = 1400;
const CALL_BAR = 7;
const EXIT_NOTCH = 12;

/** Breaks text into lines no wider than `width`; a word longer than a line is broken too. */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of (text || " ").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = "";
      if (measure(word) <= width) {
        line = word;
        continue;
      }
      for (const ch of word) {
        if (line && measure(line + ch) > width) {
          out.push(line);
          line = "";
        }
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

export function layoutNsd(d: Nsd, measure: (s: string) => number, labels: Labels): Layout {
  const items: Item[] = [];
  // A few pixels to spare, so a text that just fits its column after halving and rounding isn't wrapped.
  const textW = (s: string) => Math.min(MAX_TEXT, measure(s || " ") + 4);

  const prefList = (list: Block[]): number => (list.length ? Math.max(...list.map(pref)) : 70);
  const pref = (b: Block): number => {
    switch (b.kind) {
      case "action":
        return textW(b.text) + 2 * PX;
      case "call":
        return textW(b.text) + 2 * PX + 2 * CALL_BAR;
      case "exit":
        return textW(b.text) + 2 * PX + EXIT_NOTCH;
      case "if":
        return Math.max(2 * Math.max(prefList(b.yes), prefList(b.no)), textW(b.cond) + 2 * PX + 80);
      case "switch": {
        const n = Math.max(1, b.cases.length);
        const col = Math.max(...b.cases.map((c) => Math.max(prefList(c.body), measure(c.label) + 2 * PX)), 70);
        return Math.max(n * col, textW(b.expr) + 2 * PX + 80);
      }
      case "while":
      case "repeat":
      case "group":
        return Math.max(INDENT + prefList(b.body), textW(b.kind === "group" ? b.title : b.cond) + 2 * PX);
    }
  };

  const texts = (lines: string[], x: number, y: number, anchor: "start" | "middle" | "end", cls: string) => {
    lines.forEach((s, i) => items.push({ t: "text", x, y: y + PY + 12 + i * LH, s, anchor, cls }));
  };

  const layoutList = (list: Block[], path: ListPath, x: number, y: number, w: number): number => {
    if (!list.length) {
      const h = LH + 2 * PY;
      items.push({ t: "slot", x, y, w, h, list: path });
      return h;
    }
    let h = 0;
    list.forEach((b, i) => (h += layoutBlock(b, { list: path, index: i }, x, y + h, w)));
    return h;
  };

  const layoutBlock = (b: Block, place: Place, x: number, y: number, w: number): number => {
    const sub = (part: string): ListPath => [...place.list, place.index, part];
    switch (b.kind) {
      case "action":
      case "call":
      case "exit": {
        const inset = b.kind === "call" ? CALL_BAR : b.kind === "exit" ? EXIT_NOTCH : 0;
        const lines = wrap(b.text, w - 2 * PX - 2 * inset, measure);
        const h = lines.length * LH + 2 * PY;
        items.push({ t: "rect", x, y, w, h, cls: b.kind, place });
        if (b.kind === "call") {
          items.push({ t: "line", x1: x + CALL_BAR, y1: y, x2: x + CALL_BAR, y2: y + h });
          items.push({ t: "line", x1: x + w - CALL_BAR, y1: y, x2: x + w - CALL_BAR, y2: y + h });
        }
        if (b.kind === "exit") {
          // An exit: a notch on the left, pointing out of the structure.
          items.push({ t: "line", x1: x + EXIT_NOTCH, y1: y, x2: x, y2: y + h / 2 });
          items.push({ t: "line", x1: x, y1: y + h / 2, x2: x + EXIT_NOTCH, y2: y + h });
        }
        texts(lines, x + PX + inset, y, "start", "code");
        return h;
      }
      case "if": {
        const lines = wrap(b.cond, Math.max(60, w - 2 * PX - 70), measure);
        const head = lines.length * LH + PY + LH + 6;
        const half = Math.round(w / 2);
        items.push({ t: "rect", x, y, w, h: head, cls: "if", place });
        items.push({ t: "line", x1: x, y1: y, x2: x + half, y2: y + head });
        items.push({ t: "line", x1: x + w, y1: y, x2: x + half, y2: y + head });
        texts(lines, x + w / 2, y, "middle", "code");
        items.push({ t: "text", x: x + 6, y: y + head - 6, s: labels.yes, anchor: "start", cls: "label" });
        items.push({ t: "text", x: x + w - 6, y: y + head - 6, s: labels.no, anchor: "end", cls: "label" });
        const start = items.length;
        const hy = layoutList(b.yes, sub("yes"), x, y + head, half);
        const hn = layoutList(b.no, sub("no"), x + half, y + head, w - half);
        const body = Math.max(hy, hn);
        // The shorter branch's space below it stays empty, inside its column.
        items.splice(start, 0, { t: "rect", x, y: y + head, w: half, h: body, cls: "column" }, { t: "rect", x: x + half, y: y + head, w: w - half, h: body, cls: "column" });
        return head + body;
      }
      case "switch": {
        const n = Math.max(1, b.cases.length);
        const col = w / n;
        const lines = wrap(b.expr, Math.max(60, w - 2 * PX - 70), measure);
        const head = lines.length * LH + PY + LH + 6;
        const knee = x + col * (n - 1);
        items.push({ t: "rect", x, y, w, h: head, cls: "switch", place });
        items.push({ t: "line", x1: x, y1: y, x2: knee, y2: y + head });
        items.push({ t: "line", x1: x + w, y1: y, x2: knee, y2: y + head });
        texts(lines, x + Math.max(w / 2, (knee - x) / 2 + 20), y, "middle", "code");
        // Each case's value at the bottom of the head, the columns divided below the diagonal.
        b.cases.forEach((c, i) => {
          const cx = x + col * i;
          items.push({ t: "text", x: cx + col / 2, y: y + head - 6, s: c.label, anchor: "middle", cls: "label" });
          if (i > 0) {
            const ty = i === n - 1 ? y + head : y + (head * (cx - x)) / Math.max(1, knee - x);
            items.push({ t: "line", x1: cx, y1: ty, x2: cx, y2: y + head });
          }
        });
        const start = items.length;
        const heights = b.cases.map((c, i) => layoutList(c.body, sub(`case:${i}`), x + col * i, y + head, col));
        const body = Math.max(LH + 2 * PY, ...heights);
        items.splice(start, 0, ...b.cases.map((_, i): Item => ({ t: "rect", x: x + col * i, y: y + head, w: col, h: body, cls: "column" })));
        return head + body;
      }
      case "while":
      case "group": {
        const title = b.kind === "group" ? b.title : b.cond;
        const lines = wrap(title, w - 2 * PX, measure);
        const head = lines.length * LH + 2 * PY;
        const at = items.length;
        texts(lines, x + PX, y, "start", b.kind === "group" ? "code is-group" : "code");
        const body = layoutList(b.body, sub("body"), x + INDENT, y + head, w - INDENT);
        items.splice(at, 0, { t: "rect", x, y, w, h: head + body, cls: b.kind, place });
        return head + body;
      }
      case "repeat": {
        const lines = wrap(b.cond, w - 2 * PX, measure);
        const foot = lines.length * LH + 2 * PY;
        const at = items.length;
        const body = layoutList(b.body, sub("body"), x + INDENT, y, w - INDENT);
        items.splice(at, 0, { t: "rect", x, y, w, h: body + foot, cls: "repeat", place });
        texts(lines, x + PX, y + body, "start", "code");
        return body + foot;
      }
    }
  };

  const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, prefList(d.body), measure(d.title) + 2 * PX)));
  // The title on top, then the blocks.
  const titleLines = wrap(d.title, width - 2 * PX, measure);
  const titleH = titleLines.length * LH + 2 * PY;
  items.push({ t: "rect", x: 0, y: 0, w: width, h: titleH, cls: "title" });
  texts(titleLines, PX, 0, "start", "title");
  const body = layoutList(d.body, [], 0, titleH, width);
  return { width, height: titleH + body, items };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The diagram as a standalone SVG in print colours (black lines on white). */
export function toSvg(l: Layout): string {
  const m = 1;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width + 2 * m}" height="${l.height + 2 * m}" viewBox="${-m} ${-m} ${l.width + 2 * m} ${l.height + 2 * m}">`,
    `<rect x="${-m}" y="${-m}" width="${l.width + 2 * m}" height="${l.height + 2 * m}" fill="#ffffff"/>`,
    `<g fill="none" stroke="#1b1e24" stroke-width="1">`,
  ];
  for (const it of l.items) {
    if (it.t === "rect") out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"${it.cls === "title" ? ' fill="#eef0f4"' : ""}/>`);
    else if (it.t === "slot") out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"/>`);
    else if (it.t === "line") out.push(`<line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}"/>`);
  }
  out.push(`</g><g fill="#1b1e24" stroke="none">`);
  for (const it of l.items) {
    if (it.t !== "text") continue;
    const font = it.cls === "label" ? `font-family="Segoe UI, Arial, sans-serif" font-size="11" fill="#5f6573"` : it.cls === "title" ? `font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600"` : `font-family="Consolas, 'Courier New', monospace" font-size="12.5"${it.cls.includes("is-group") ? ' font-style="italic"' : ""}`;
    out.push(`<text x="${it.x}" y="${it.y}" text-anchor="${it.anchor}" ${font}>${esc(it.s)}</text>`);
  }
  out.push("</g></svg>");
  return out.join("\n");
}
