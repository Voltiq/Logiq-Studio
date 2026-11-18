import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { de } from "./de";
import { es } from "./es";
import { fr } from "./fr";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
  });
}

/** Every text the interface shows: what is passed to t(), and the labels translated where they are drawn. */
function interfaceStrings(): Set<string> {
  const keys = new Set<string>();
  for (const f of files("src")) {
    if (/[\\/]lib[\\/](de|es|fr)\.ts$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
    if (f.endsWith("commands.ts")) for (const m of src.matchAll(/label: "([^"]+)", category: "(\w+)"/g)) keys.add(m[1]).add(m[2]);
    if (f.endsWith("templates.ts")) for (const m of src.matchAll(/(?:title|description): "([^"]+)"/g)) keys.add(m[1]);
    if (/python[\\/]index\.ts$/.test(f) || f.endsWith("LanguageSettings.tsx") || /gui[\\/]model\.ts$/.test(f)) for (const m of src.matchAll(/label: "([^"]+)"/g)) keys.add(m[1]);
    if (/editor[\\/]snippets\.ts$/.test(f)) for (const m of src.matchAll(/\bs\(\s*"[^"]*",\s*"([^"]+)"/g)) keys.add(m[1]);
    if (/gui[\\/]GuiDesigner\.tsx$/.test(f)) for (const m of src.matchAll(/^\s+J\w+: "([^"]+)",$/gm)) keys.add(m[1]);
  }
  // Ids built with t() in the shared components and names of languages are not text.
  return new Set([...keys].filter((k) => !/^\{0\}-|^button:not/.test(k) && k !== "PHP" && k !== "Python"));
}

const TABLES = { German: de, Spanish: es, French: fr };

describe.each(Object.entries(TABLES))("%s", (_name, table) => {
  it("translates every interface string", () => {
    const missing = [...interfaceStrings()].filter((k) => !(k in table));
    expect(missing).toEqual([]);
  });

  it("keeps placeholders, and the ellipsis of commands that ask for more", () => {
    for (const [en, tr] of Object.entries(table)) {
      const want = (en.match(/\{\d\}/g) ?? []).sort().join();
      expect((tr.match(/\{\d\}/g) ?? []).sort().join(), en).toBe(want);
      expect(tr.endsWith("…"), en).toBe(en.endsWith("…"));
      expect(tr.trim().length, en).toBeGreaterThan(0);
    }
  });
});
