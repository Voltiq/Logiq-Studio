import { describe, expect, it } from "vitest";
import { parseJava } from "./javaParser";
import { buildDiagram, DEFAULT_UML_OPTIONS, roughMeasure } from "./diagram";
import { describeNode, neighbour, panIntoView } from "./describe";

const src = `
interface Drawable { void draw(); }
abstract class Shape implements Drawable {
  protected double x;
  private String name;
  public abstract double area();
}
class Circle extends Shape {
  private double radius;
  public double area() { return 0; }
  public void draw() {}
}
class Drawing { private java.util.List<Shape> shapes; void add(Shape s) {} }
`;
const types = parseJava(src, "A.java").types;
const d = buildDiagram(types, DEFAULT_UML_OPTIONS, roughMeasure);
const byId = new Map(d.nodes.map((n) => [n.id, n]));

describe("the diagram in words", () => {
  it("says what a class is, has and is linked to", () => {
    const shape = describeNode(byId.get("Shape")!, d.edges, byId);
    expect(shape).toContain("Abstract class Shape, implements Drawable.");
    expect(shape).toContain("Attributes: protected x: double; private name: String.");
    expect(shape).toContain("Methods: public area(): double.");
    expect(shape).toContain("Extended or implemented by Circle.");
    expect(shape).toContain("Used by Drawing.");
    expect(describeNode(byId.get("Circle")!, d.edges, byId)).toContain("Class Circle, extends Shape.");
    expect(describeNode(byId.get("Drawable")!, d.edges, byId)).toMatch(/^Interface Drawable\./);
    expect(describeNode(byId.get("Drawing")!, d.edges, byId)).toContain("Has Shape.");
  });
});

describe("moving between classes with the arrow keys", () => {
  const nodes = d.nodes;
  const positions = { Drawable: { x: 300, y: 0 }, Shape: { x: 300, y: 200 }, Circle: { x: 300, y: 500 }, Drawing: { x: 800, y: 220 } };

  it("goes to the nearest class in that direction", () => {
    expect(neighbour(nodes, positions, "Shape", "up")).toBe("Drawable");
    expect(neighbour(nodes, positions, "Shape", "down")).toBe("Circle");
    expect(neighbour(nodes, positions, "Shape", "right")).toBe("Drawing");
    expect(neighbour(nodes, positions, "Shape", "left")).toBeNull();
    // Nothing straight above Drawing, so the nearest one that is higher at all.
    expect(neighbour(nodes, positions, "Drawing", "up")).toBe("Drawable");
    expect(neighbour(nodes, positions, "nothing", "up")).toBe(nodes[0].id);
  });

  it("pans a class into view only when it is outside", () => {
    const stage = { w: 800, h: 600 };
    expect(panIntoView({ x: 100, y: 100, w: 200, h: 100 }, { x: 0, y: 0, k: 1 }, stage)).toEqual({ dx: 0, dy: 0 });
    expect(panIntoView({ x: 900, y: 100, w: 200, h: 100 }, { x: 0, y: 0, k: 1 }, stage)).toEqual({ dx: -324, dy: 0 });
    expect(panIntoView({ x: -50, y: 700, w: 200, h: 100 }, { x: 0, y: 0, k: 0.5 }, stage)).toEqual({ dx: 49, dy: 0 });
  });
});
