/*
 * The class diagram for people who don't see it: each class in words (for
 * a screen reader), and which class is next in a direction (for the arrow
 * keys).
 */
import type { Positions, UmlEdge, UmlNode } from "./diagram";
import { t } from "../lib/i18n";

/** "Abstract class Shape, implements Drawable. 3 attributes: # x: double, … 2 methods: … Used by Drawing." */
export function describeNode(node: UmlNode, edges: UmlEdge[], byId: Map<string, UmlNode>): string {
  const x = node.type;
  const name = (id: string) => byId.get(id)?.type.name ?? id;
  if (node.library) return t("Library class {0}", x.name);
  const kind =
    x.kind === "interface" ? t("Interface") : x.kind === "enum" ? t("Enum") : x.kind === "record" ? t("Record") : x.kind === "annotation" ? t("Annotation") : x.isAbstract ? t("Abstract class") : t("Class");
  const parts: string[] = [`${kind} ${x.name}`];
  const out = edges.filter((e) => e.from === node.id);
  const into = edges.filter((e) => e.to === node.id);
  const list = (kindOf: UmlEdge["kind"], from: UmlEdge[], end: "from" | "to") => from.filter((e) => e.kind === kindOf).map((e) => name(e[end]));
  const ext = list("extends", out, "to");
  const impl = list("implements", out, "to");
  const has = list("association", out, "to");
  const uses = list("dependency", out, "to");
  const subs = [...list("extends", into, "from"), ...list("implements", into, "from")];
  const usedBy = [...new Set([...list("association", into, "from"), ...list("dependency", into, "from")])];
  if (ext.length) parts.push(t("extends {0}", ext.join(", ")));
  if (impl.length) parts.push(t("implements {0}", impl.join(", ")));
  const sentences = [parts.join(", ") + "."];
  if (node.constants.length) sentences.push(t("Constants: {0}.", node.constants.join(", ")));
  if (node.attributes.length) sentences.push(t("Attributes: {0}.", node.attributes.map((a) => a.text).join("; ")));
  if (node.operations.length) sentences.push(t("Methods: {0}.", node.operations.map((o) => o.text).join("; ")));
  if (has.length) sentences.push(t("Has {0}.", has.join(", ")));
  if (uses.length) sentences.push(t("Uses {0}.", uses.join(", ")));
  if (subs.length) sentences.push(t("Extended or implemented by {0}.", subs.join(", ")));
  if (usedBy.length) sentences.push(t("Used by {0}.", usedBy.join(", ")));
  // Spoken, the visibility signs are words.
  return sentences
    .join(" ")
    .replace(/(^|[;:] )\+ /g, `$1${t("public")} `)
    .replace(/(^|[;:] )[-−] /g, `$1${t("private")} `)
    .replace(/(^|[;:] )# /g, `$1${t("protected")} `)
    .replace(/(^|[;:] )~ /g, `$1${t("package")} `);
}

export type Direction = "left" | "right" | "up" | "down";

/**
 * The class to go to from `from` in a direction: the nearest one whose centre lies in
 * that quarter (more along the direction than across it), else the nearest one that is
 * still roughly that way.
 */
export function neighbour(nodes: UmlNode[], positions: Positions, from: string, dir: Direction): string | null {
  const centre = (n: UmlNode) => {
    const p = positions[n.id];
    return p ? { x: p.x + n.w / 2, y: p.y + n.h / 2 } : null;
  };
  const start = nodes.find((n) => n.id === from);
  const c = start && centre(start);
  if (!c) return nodes[0]?.id ?? null;
  let best: { id: string; score: number } | null = null;
  let loose: { id: string; score: number } | null = null;
  for (const n of nodes) {
    if (n.id === from) continue;
    const p = centre(n);
    if (!p) continue;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    const across = Math.abs(dir === "left" || dir === "right" ? dy : dx);
    if (along <= 0) continue;
    // Straight ahead counts more than close by but off to the side.
    const score = along + across * 2;
    if (across <= along && (!best || score < best.score)) best = { id: n.id, score };
    // Not straight ahead, but still more that way than not (within about 70° of the direction).
    if (across <= along * 3 && (!loose || score < loose.score)) loose = { id: n.id, score };
  }
  return (best ?? loose)?.id ?? null;
}

/** How far to pan so that a box is inside the stage (with a margin); zero when it already is. */
export function panIntoView(box: { x: number; y: number; w: number; h: number }, view: { x: number; y: number; k: number }, stage: { w: number; h: number }, margin = 24): { dx: number; dy: number } {
  const left = box.x * view.k + view.x;
  const top = box.y * view.k + view.y;
  const right = left + box.w * view.k;
  const bottom = top + box.h * view.k;
  const fix = (lo: number, hi: number, size: number) => (hi - lo > size - margin * 2 ? margin - lo : lo < margin ? margin - lo : hi > size - margin ? size - margin - hi : 0);
  return { dx: fix(left, right, stage.w), dy: fix(top, bottom, stage.h) };
}
