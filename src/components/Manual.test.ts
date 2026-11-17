import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chapters } from "./Manual";

const read = (f: string) => chapters(readFileSync(`docs/${f}.md`, "utf8"));

describe("the manual", () => {
  const english = read("GUIDE");

  it("splits into chapters", () => {
    expect(english.title).toBe("Logiq Studio manual");
    expect(english.chapters.length).toBeGreaterThan(8);
    expect(english.chapters[0].title).toBe("The window");
    expect(english.chapters[2].html).toContain("<table>");
    expect(english.intro).toContain("<p>");
  });

  it.each(["ANLEITUNG", "GUIA", "MANUEL"])("%s has the same chapters, lists, tables and keys", (name) => {
    const other = read(name);
    expect(other.chapters.length).toBe(english.chapters.length);
    other.chapters.forEach((c, i) => {
      const count = (html: string, tag: string) => html.split(`<${tag}>`).length - 1;
      for (const tag of ["li", "tr", "p"]) expect(count(c.html, tag), `${name} chapter ${i + 1}, <${tag}>`).toBe(count(english.chapters[i].html, tag));
      // The same shortcuts, whatever the keys are called (Ctrl, Strg, Maj…): the same number of them.
      expect(count(c.html, "code"), `${name} chapter ${i + 1}, keys`).toBe(count(english.chapters[i].html, "code"));
    });
  });
});
