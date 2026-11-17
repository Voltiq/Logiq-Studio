/*
 * How long the heavy parts take on a large project: 400 classes in the
 * diagram, a 20,000-line Java file, 50,000 file names in quick open. The
 * limits are generous (several times what a normal computer needs); they
 * catch a change that makes something slow by an order of magnitude.
 */
import { describe, expect, it } from "vitest";
import { parseJava } from "./javaParser";
import { autoLayout, buildDiagram, DEFAULT_UML_OPTIONS, roughMeasure, route, type Rect } from "./diagram";
import { parsePython } from "../languages/python/structure";
import { fuzzy } from "../lib/fuzzy";
import { parseConflicts } from "../lib/gitParse";
import { visibleNodes } from "./visible";
import { Text } from "@codemirror/state";
import { changeMarks } from "../editor/gitGutter";
import { rowWindow } from "../lib/rowWindow";

function project(classes: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < classes; i++) {
    const parent = i > 0 && i % 5 !== 0 ? ` extends C${i - 1 - ((i - 1) % 5)}` : "";
    const other = (i * 7 + 3) % classes;
    const third = (i * 13 + 11) % classes;
    out.push(
      `package app.p${i % 10};\npublic class C${i}${parent} implements Runnable {\n` +
        `  private int count${i};\n  protected String name;\n  private C${other} partner;\n  private java.util.List<C${third}> items = new java.util.ArrayList<>();\n` +
        `  public C${i}(String name) { this.name = name; }\n  public void run() { new C${other}("x").run(); }\n` +
        `  public int getCount() { return count${i}; }\n  public void setName(String name) { this.name = name; }\n  public String describe(int depth, boolean deep) { return name + depth; }\n}\n`,
    );
  }
  return out;
}

const time = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const r = f();
  return [r, performance.now() - t0];
};

describe("a large project", () => {
  const sources = project(400);

  it("parses, builds, lays out and routes a 400-class diagram quickly", () => {
    const [types, parse] = time(() => sources.flatMap((s, i) => parseJava(s, `C${i}.java`).types));
    const [diagram, build] = time(() => buildDiagram(types, DEFAULT_UML_OPTIONS, roughMeasure));
    const [positions, layout] = time(() => autoLayout(diagram));
    const rects = new Map<string, Rect>(diagram.nodes.map((n) => [n.id, { x: positions[n.id].x, y: positions[n.id].y, w: n.w, h: n.h }]));
    const obstacles = [...rects.values()];
    const [, routing] = time(() => {
      for (const e of diagram.edges) route(e, rects.get(e.from)!, rects.get(e.to)!, 0, { orthogonal: true, obstacles });
    });
    console.log(`400 classes, ${diagram.edges.length} lines: parse ${parse.toFixed(0)} ms, build ${build.toFixed(0)} ms, layout ${layout.toFixed(0)} ms, routing ${routing.toFixed(0)} ms`);
    expect(diagram.nodes.length).toBe(400);
    expect(parse).toBeLessThan(1500);
    expect(build).toBeLessThan(1500);
    expect(layout).toBeLessThan(3000);
    expect(routing).toBeLessThan(1500);

    // Only what is on screen is drawn.
    const [shown, culling] = time(() => visibleNodes(diagram.nodes, positions, { x: 0, y: 0, k: 1 }, { w: 1600, h: 900 }));
    expect(shown.size).toBeLessThan(120);
    expect(shown.size).toBeGreaterThan(0);
    expect(culling).toBeLessThan(50);
  });

  it("parses a 20,000-line Java file and a long Python file while you type", () => {
    const big = "package big;\npublic class Big {\n" + Array.from({ length: 3000 }, (_, i) => `  private int f${i};\n  /** Doc */\n  public int m${i}(int a, String b) {\n    if (a > ${i}) { return a + f${i}; }\n    String s = "x{" + b;\n    return s.length();\n  }\n`).join("") + "}\n";
    expect(big.split("\n").length).toBeGreaterThan(20000);
    const [file, java] = time(() => parseJava(big, "Big.java"));
    expect(file.types[0].methods.length).toBe(3000);
    const py = Array.from({ length: 800 }, (_, i) => `class K${i}(Base):\n    def __init__(self, a: int):\n        self.a = a\n        self.items = []\n\n    def go(self, x):\n        return K${i}(x)\n\n`).join("");
    const [pfile, python] = time(() => parsePython(py, "big.py"));
    expect(pfile.types.length).toBe(800);
    const [, conflicts] = time(() => parseConflicts(big));
    // The change bar: the file against its committed text, after an edit in the middle and one near the end.
    const edited = big.replace("public int m1500(", "public long m1500(").replace("private int f2900;", "private int f2900;\n  private int extra;");
    const [marks, gutter] = time(() => changeMarks(Text.of(big.split("\n")), Text.of(edited.split("\n"))));
    expect(marks.size).toBe(2);
    expect(gutter).toBeLessThan(400);
    console.log(`20,000 lines: Java ${java.toFixed(0)} ms, Python (7,000 lines) ${python.toFixed(0)} ms, conflict scan ${conflicts.toFixed(0)} ms, change bar ${gutter.toFixed(0)} ms`);
    expect(java).toBeLessThan(1500);
    expect(python).toBeLessThan(1500);
    expect(conflicts).toBeLessThan(300);
  });

  it("draws only the rows in view of a long list", () => {
    expect(rowWindow(120, 0, 600, 28)).toEqual({ first: 0, last: 120, row: 28, windowed: false });
    const w = rowWindow(20000, 28000, 600, 28);
    expect(w.windowed).toBe(true);
    expect(w.first).toBe(988);
    expect(w.last).toBe(1034);
    expect(rowWindow(20000, 9_999_999, 600, 28).last).toBe(20000);
  });

  it("finds a file among 50,000 names", () => {
    const names = Array.from({ length: 50000 }, (_, i) => `src/main/java/app/module${i % 200}/feature${i % 37}/Thing${i}Service.java`);
    const [hits, ms] = time(() => names.map((n) => fuzzy("thng4217serv", n)).filter((s) => s !== null).length);
    console.log(`50,000 names: ${ms.toFixed(0)} ms, ${hits} matches`);
    expect(hits).toBeGreaterThan(0);
    expect(ms).toBeLessThan(600);
  });
});
