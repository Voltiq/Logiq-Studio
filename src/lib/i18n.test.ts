import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { de } from "./de";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
  });
}

describe("German", () => {
  it("translates every interface string", () => {
    const keys = new Set<string>();
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
      if (f.endsWith("commands.ts")) for (const m of src.matchAll(/label: "([^"]+)", category: "(\w+)"/g)) keys.add(m[1]).add(m[2]);
      if (f.endsWith("templates.ts")) for (const m of src.matchAll(/(?:title|description): "([^"]+)"/g)) keys.add(m[1]);
    }
    // Ids built with t() in the shared components are not text.
    const missing = [...keys].filter((k) => !(k in de) && !/^\{0\}-|^button:not/.test(k));
    expect(missing).toEqual([]);
  });

  it("keeps placeholders", () => {
    for (const [en, tr] of Object.entries(de)) {
      const want = (en.match(/\{\d\}/g) ?? []).sort().join();
      expect((tr.match(/\{\d\}/g) ?? []).sort().join(), en).toBe(want);
    }
  });
});
