import { describe, expect, it } from "vitest";
import { parseJava } from "./javaParser";
import { autoLayout, buildDiagram, DEFAULT_UML_OPTIONS, multiplicity, roughMeasure, route } from "./diagram";

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

  it("knows multiplicities", () => {
    expect(multiplicity("Shape", "Shape")).toBe("1");
    expect(multiplicity("Shape[]", "Shape")).toBe("0..*");
    expect(multiplicity("ArrayList<Shape>", "Shape")).toBe("0..*");
    expect(multiplicity("Optional<Shape>", "Shape")).toBe("0..1");
  });
});
