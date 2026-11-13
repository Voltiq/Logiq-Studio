import { describe, expect, it } from "vitest";
import { parseJava } from "./javaParser";
import { autoLayout, buildDiagram, DEFAULT_UML_OPTIONS, multiplicity, placeNew, roughMeasure, route, routeOrthogonal, type Point, type Rect } from "./diagram";

const SHAPES = `
interface Drawable { void draw(); }
abstract class Shape implements Drawable {
  protected Point origin;
  public abstract double area();
}
class Circle extends Shape { private double r; public double area() { return 0; } public void draw() {} }
class Square extends Shape { private double side; public double area() { return 0; } public void draw() {} }
class Point { int x, y; }
class Canvas {
  private java.util.List<Shape> shapes = new java.util.ArrayList<>();
  private Point[] marks;
  private Canvas parent;
  void add(Shape s) {}
  Report report() { return new Report(); }
}
class Report {}
`;

describe("buildDiagram", () => {
  const types = parseJava(SHAPES).types;

  it("finds generalisations, realisations and associations", () => {
    const d = buildDiagram(types, DEFAULT_UML_OPTIONS, roughMeasure);
    const edges = d.edges.map((e) => `${e.kind} ${e.from}->${e.to}${e.labels.length ? " " + e.labels.map((l) => `${l.role}[${l.multiplicity}]`).join(",") : ""}`);
    expect(edges.sort()).toEqual(
      [
        "implements Shape->Drawable",
        "extends Circle->Shape",
        "extends Square->Shape",
        "association Shape->Point #origin[1]",
        "association Canvas->Shape -shapes[0..*]",
        "association Canvas->Point -marks[0..*]",
        "association Canvas->Canvas -parent[1]",
      ].sort(),
    );
  });

  it("adds dependencies only where nothing else connects", () => {
    const d = buildDiagram(types, { ...DEFAULT_UML_OPTIONS, showDependencies: true }, roughMeasure);
    const deps = d.edges.filter((e) => e.kind === "dependency").map((e) => `${e.from}->${e.to}`);
    expect(deps).toEqual(["Canvas->Report"]);
  });

  it("formats compartments in UML notation", () => {
    const d = buildDiagram(types, DEFAULT_UML_OPTIONS, roughMeasure);
    const shape = d.nodes.find((n) => n.id === "Shape")!;
    expect(shape.stereotype).toBe("«abstract»");
    expect(shape.italic).toBe(true);
    expect(shape.attributes.map((a) => a.text)).toEqual(["# origin: Point"]);
    expect(shape.operations[0]).toMatchObject({ text: "+ area(): double", isAbstract: true });
    const canvas = d.nodes.find((n) => n.id === "Canvas")!;
    expect(canvas.operations.map((o) => o.text)).toEqual(["~ add(s: Shape)", "~ report(): Report"]);
    expect(canvas.attributes[0].text).toBe("- shapes: List<Shape>");
    const drawable = d.nodes.find((n) => n.id === "Drawable")!;
    expect(drawable.showAttributes).toBe(false);
    expect(drawable.operations[0].isAbstract).toBe(false);
  });

  it("puts supertypes above subtypes without overlaps", () => {
    const d = buildDiagram(types, DEFAULT_UML_OPTIONS, roughMeasure);
    const pos = autoLayout(d);
    expect(pos.Drawable.y).toBeLessThan(pos.Shape.y);
    expect(pos.Shape.y).toBeLessThan(pos.Circle.y);
    expect(pos.Circle.y).toBe(pos.Square.y);
    const boxes = d.nodes.map((n) => ({ ...pos[n.id], w: n.w, h: n.h, id: n.id }));
    for (const a of boxes)
      for (const b of boxes)
        if (a !== b) {
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
        }
  });

  it("routes generalisations as trees and other lines straight", () => {
    const parent = { x: 100, y: 0, w: 100, h: 60 };
    const child = { x: 0, y: 200, w: 80, h: 40 };
    const pts = route({ id: "e", kind: "extends", from: "C", to: "P", labels: [] }, child, parent);
    expect(pts).toEqual([
      { x: 40, y: 200 },
      { x: 40, y: 92 },
      { x: 150, y: 92 },
      { x: 150, y: 60 },
    ]);
    const straight = route({ id: "a", kind: "association", from: "C", to: "P", labels: [] }, { x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 });
    expect(straight).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ]);
  });

  it("keeps a renamed class in its place", () => {
    const d = buildDiagram(parseJava("class A {} class B extends A {}").types, DEFAULT_UML_OPTIONS, roughMeasure);
    const pos = placeNew(d, { A: { x: 10, y: 20 }, Old: { x: 300, y: 400 } });
    expect(pos.B).toEqual({ x: 300, y: 400 });
    expect(pos.A).toEqual({ x: 10, y: 20 });
  });

  it("knows multiplicities", () => {
    expect(multiplicity("Shape", "Shape")).toBe("1");
    expect(multiplicity("Shape[]", "Shape")).toBe("0..*");
    expect(multiplicity("ArrayList<Shape>", "Shape")).toBe("0..*");
    expect(multiplicity("Optional<Shape>", "Shape")).toBe("0..1");
  });
});

describe("routeOrthogonal", () => {
  const crosses = (pts: Point[], r: Rect) =>
    pts.slice(1).some((q, i) => {
      const p = pts[i];
      // Sample each segment; a point strictly inside the box is a crossing.
      for (let t = 0; t <= 1; t += 0.05) {
        const x = p.x + (q.x - p.x) * t;
        const y = p.y + (q.y - p.y) * t;
        if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
      }
      return false;
    });
  const rightAngled = (pts: Point[]) => pts.slice(1).every((q, i) => q.x === pts[i].x || q.y === pts[i].y);

  it("goes around a box in the way", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 };
    const wall = { x: 200, y: -60, w: 80, h: 180 };
    const b = { x: 400, y: 0, w: 100, h: 60 };
    const pts = routeOrthogonal(a, b, [a, wall, b])!;
    expect(pts).not.toBeNull();
    expect(rightAngled(pts)).toBe(true);
    expect(crosses(pts, wall)).toBe(false);
    const onBorder = (p: Point, r: Rect) => (p.x === r.x || p.x === r.x + r.w || p.y === r.y || p.y === r.y + r.h) && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    expect(onBorder(pts[0], a)).toBe(true);
    expect(onBorder(pts[pts.length - 1], b)).toBe(true);
  });

  it("is a straight line between two boxes side by side", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 };
    const b = { x: 300, y: 0, w: 100, h: 60 };
    expect(routeOrthogonal(a, b, [a, b])).toEqual([
      { x: 100, y: 30 },
      { x: 300, y: 30 },
    ]);
  });

  it("uses one bend for boxes diagonal to each other", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 };
    const b = { x: 300, y: 300, w: 100, h: 60 };
    const pts = routeOrthogonal(a, b, [a, b])!;
    expect(rightAngled(pts)).toBe(true);
    expect(pts.length).toBe(3);
  });

  it("passes through bend points the user placed", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 };
    const b = { x: 300, y: 0, w: 100, h: 60 };
    const e = { id: "x", kind: "association" as const, from: "A", to: "B", labels: [] };
    const pts = route(e, a, b, 0, { orthogonal: true, bends: [{ x: 200, y: -80 }] });
    expect(pts.length).toBe(3);
    expect(pts[1]).toEqual({ x: 200, y: -80 });
    expect(pts[0].y).toBeCloseTo(0);
    expect(pts[2].y).toBeCloseTo(0);
  });

  it("meets a box at a right angle when a bend is straight above it", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 };
    const b = { x: 300, y: 0, w: 100, h: 60 };
    const e = { id: "x", kind: "association" as const, from: "A", to: "B", labels: [] };
    const pts = route(e, a, b, 0, { bends: [{ x: 40, y: -50 }, { x: 330, y: -50 }] });
    expect(pts).toEqual([{ x: 40, y: 0 }, { x: 40, y: -50 }, { x: 330, y: -50 }, { x: 330, y: 0 }]);
  });

  it("routes a busy diagram quickly", () => {
    const boxes: Rect[] = [];
    for (let i = 0; i < 40; i++) boxes.push({ x: (i % 8) * 220, y: Math.floor(i / 8) * 200, w: 160, h: 120 });
    const t0 = performance.now();
    for (let i = 0; i < 39; i++) expect(routeOrthogonal(boxes[i], boxes[39 - i], boxes)).not.toBeNull();
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
