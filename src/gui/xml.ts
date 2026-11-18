/*
 * A small XML reader and writer for FXML: elements with attributes in their order, text, comments and processing
 * instructions (`<?import …?>`). Enough to read what Scene Builder or a person writes and to write it back.
 */

export interface XmlElement {
  kind: "element";
  name: string;
  attrs: [string, string][];
  children: XmlNode[];
}
export type XmlNode = XmlElement | { kind: "text"; text: string } | { kind: "comment"; text: string } | { kind: "pi"; target: string; data: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );
}

export function escapeXml(s: string, attr = true): string {
  const out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return attr ? out.replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;") : out;
}

/** Reads a document: its top-level nodes. Throws with the position when it isn't well formed. */
export function parseXml(text: string): XmlNode[] {
  let i = 0;
  const fail = (msg: string): never => {
    const line = text.slice(0, i).split("\n").length;
    throw new Error(`${msg} (line ${line})`);
  };
  const nodes = (until: string | null): XmlNode[] => {
    const out: XmlNode[] = [];
    while (i < text.length) {
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        if (end < 0) fail("A comment isn't closed");
        out.push({ kind: "comment", text: text.slice(i + 4, end) });
        i = end + 3;
      } else if (text.startsWith("<?", i)) {
        const end = text.indexOf("?>", i + 2);
        if (end < 0) fail("A processing instruction isn't closed");
        const body = text.slice(i + 2, end);
        const m = /^([\w:.-]+)\s*([\s\S]*)$/.exec(body);
        out.push({ kind: "pi", target: m?.[1] ?? "", data: (m?.[2] ?? "").trim() });
        i = end + 2;
      } else if (text.startsWith("<![CDATA[", i)) {
        const end = text.indexOf("]]>", i);
        if (end < 0) fail("A CDATA section isn't closed");
        out.push({ kind: "text", text: text.slice(i + 9, end) });
        i = end + 3;
      } else if (text.startsWith("<!", i)) {
        // A DOCTYPE: skipped.
        const end = text.indexOf(">", i);
        i = end < 0 ? text.length : end + 1;
      } else if (text.startsWith("</", i)) {
        const m = /^<\/([\w:.-]+)\s*>/.exec(text.slice(i));
        if (!m) fail("A closing tag is broken");
        if (m![1] !== until) fail(`</${m![1]}> where </${until ?? "nothing"}> was expected`);
        i += m![0].length;
        return out;
      } else if (text[i] === "<") {
        out.push(element());
      } else {
        const next = text.indexOf("<", i);
        const raw = text.slice(i, next < 0 ? text.length : next);
        out.push({ kind: "text", text: unescapeXml(raw) });
        i = next < 0 ? text.length : next;
      }
    }
    if (until) fail(`<${until}> isn't closed`);
    return out;
  };
  const element = (): XmlElement => {
    const m = /^<([\w:.-]+)/.exec(text.slice(i));
    if (!m) fail("A tag is broken");
    const name = m![1];
    i += m![0].length;
    const attrs: [string, string][] = [];
    for (;;) {
      const ws = /^\s*/.exec(text.slice(i))![0];
      i += ws.length;
      if (text.startsWith("/>", i)) {
        i += 2;
        return { kind: "element", name, attrs, children: [] };
      }
      if (text[i] === ">") {
        i++;
        return { kind: "element", name, attrs, children: nodes(name) };
      }
      const a = /^([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(text.slice(i));
      if (!a) fail(`An attribute of <${name}> is broken`);
      attrs.push([a![1], unescapeXml(a![3] ?? a![4] ?? "")]);
      i += a![0].length;
    }
  };
  return nodes(null);
}

/** The element children of an element. */
export const elements = (e: XmlElement) => e.children.filter((c): c is XmlElement => c.kind === "element");

export const attr = (e: XmlElement, name: string) => e.attrs.find(([k]) => k === name)?.[1];

/** Writes nodes back, indented by four spaces a level; elements with only text stay on one line. */
export function writeXml(nodes: XmlNode[], depth = 0): string {
  const pad = "    ".repeat(depth);
  let out = "";
  for (const n of nodes) {
    if (n.kind === "pi") out += `${pad}<?${n.target}${n.data ? " " + n.data : ""}?>\n`;
    else if (n.kind === "comment") out += `${pad}<!--${n.text}-->\n`;
    else if (n.kind === "text") {
      if (n.text.trim()) out += `${pad}${escapeXml(n.text.trim(), false)}\n`;
    } else {
      const attrs = n.attrs.map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join("");
      const kids = n.children.filter((c) => c.kind !== "text" || c.text.trim());
      if (!kids.length) out += `${pad}<${n.name}${attrs} />\n`;
      else if (kids.every((c) => c.kind === "text")) out += `${pad}<${n.name}${attrs}>${escapeXml(kids.map((c) => (c as { text: string }).text).join("").trim(), false)}</${n.name}>\n`;
      else out += `${pad}<${n.name}${attrs}>\n${writeXml(kids, depth + 1)}${pad}</${n.name}>\n`;
    }
  }
  return out;
}
