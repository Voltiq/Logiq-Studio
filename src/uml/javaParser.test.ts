import { describe, expect, it } from "vitest";
import { baseName, parseJava, simpleType, typeNames } from "./javaParser";

describe("parseJava", () => {
  it("reads a class with fields, constructors and methods", () => {
    const f = parseJava(
      `package shop.model;
import java.util.*;
import static java.lang.Math.max;

/** An account. */
@Entity
public abstract class Account extends Base implements Comparable<Account>, java.io.Serializable {
  private static final long serialVersionUID = 1L;
  protected double balance = 0, limit;
  private List<Transaction> history = new ArrayList<>();
  Map<String, Integer> counts = new HashMap<String, Integer>(), other;
  int[] numbers = {1, 2, 3}, more[];
  String s = "}{;", c = '}' + "";

  public Account(double start) { this.balance = start; }
  Account() { this(0); }

  public abstract void close();
  public double getBalance() { if (x) { return balance; } return 0; }
  protected static <T extends Comparable<T>> T best(List<? extends T> items, T... more) throws IOException { return null; }
  @Override public int compareTo(Account other) { return 0; }
  int legacy()[] { return null; }
}`,
      "Account.java",
    );
    expect(f.package).toBe("shop.model");
    expect(f.imports).toEqual(["java.util.*"]);
    expect(f.types).toHaveLength(1);
    const t = f.types[0];
    expect(t.qualifiedName).toBe("shop.model.Account");
    expect(t.kind).toBe("class");
    expect(t.isAbstract).toBe(true);
    expect(t.visibility).toBe("public");
    expect(t.extends).toEqual(["Base"]);
    expect(t.implements).toEqual(["Comparable<Account>", "java.io.Serializable"]);
    expect(t.fields.map((x) => `${x.visibility} ${x.type} ${x.name}`)).toEqual([
      "private long serialVersionUID",
      "protected double balance",
      "protected double limit",
      "private List<Transaction> history",
      "package Map<String, Integer> counts",
      "package Map<String, Integer> other",
      "package int[] numbers",
      "package int[][] more",
      "package String s",
      "package String c",
    ]);
    expect(t.fields[0].isStatic && t.fields[0].isFinal).toBe(true);
    expect(t.methods.map((m) => m.name)).toEqual(["Account", "Account", "close", "getBalance", "best", "compareTo", "legacy"]);
    expect(t.methods[0].isConstructor).toBe(true);
    expect(t.methods[0].params).toEqual([{ name: "start", type: "double" }]);
    expect(t.methods[2].isAbstract).toBe(true);
    const best = t.methods[4];
    expect(best.isStatic).toBe(true);
    expect(best.typeParams).toBe("<T extends Comparable<T>>");
    expect(best.returnType).toBe("T");
    expect(best.params).toEqual([
      { name: "items", type: "List<? extends T>" },
      { name: "more", type: "T..." },
    ]);
    expect(t.methods[6].returnType).toBe("int[]");
    expect(t.creates).toEqual(["ArrayList", "HashMap"]);
    expect(t.line).toBe(7);
    expect(t.endLine).toBe(23);
  });

  it("reads interfaces, enums, records, nested types and main", () => {
    const f = parseJava(`
interface Shape extends Drawable, Comparable<Shape> {
  double PI2 = 6.28;
  double area();
  default String label() { return "s"; }
  static Shape unit() { return new Circle(1); }
}
enum Color { RED("r") { void x() {} }, GREEN("g"), BLUE; private final String code; Color(String c) { code = c; } }
record Point(int x, int y) implements Shape {
  Point { if (x < 0) throw new IllegalArgumentException(); }
  public double area() { return 0; }
}
public class Main {
  static class Node<T> { T value; Node<T> next; }
  private class Inner {}
  public static void main(String[] args) {
    Shape s = new Circle(2);
    Runnable r = () -> { new Square(); };
    for (int i = 0; i < 3; i++) {}
  }
}`);
    const [shape, color, point, main, node, inner] = f.types;
    expect(f.types.map((t) => t.name)).toEqual(["Shape", "Color", "Point", "Main", "Node", "Inner"]);
    expect(shape.kind).toBe("interface");
    expect(shape.extends).toEqual(["Drawable", "Comparable<Shape>"]);
    expect(shape.fields[0]).toMatchObject({ name: "PI2", isStatic: true, isFinal: true, visibility: "public" });
    expect(shape.methods.map((m) => [m.name, m.isAbstract, m.isStatic])).toEqual([
      ["area", true, false],
      ["label", false, false],
      ["unit", false, true],
    ]);
    expect(shape.creates).toEqual(["Circle"]);
    expect(color.kind).toBe("enum");
    expect(color.constants).toEqual(["RED", "GREEN", "BLUE"]);
    expect(color.fields.map((x) => x.name)).toEqual(["code"]);
    expect(color.methods[0].isConstructor).toBe(true);
    expect(point.kind).toBe("record");
    expect(point.fields.map((x) => `${x.type} ${x.name}`)).toEqual(["int x", "int y"]);
    expect(point.implements).toEqual(["Shape"]);
    expect(point.methods.map((m) => m.name)).toEqual(["Point", "area"]);
    expect(main.hasMain).toBe(true);
    expect(main.creates.sort()).toEqual(["Circle", "Square"]);
    expect(node.outer).toBe("Main");
    expect(node.qualifiedName).toBe("Main.Node");
    expect(node.typeParams).toBe("<T>");
    expect(node.isStatic).toBe(true);
    expect(node.fields.map((x) => x.type)).toEqual(["T", "Node<T>"]);
    expect(inner.visibility).toBe("private");
    expect(inner.isStatic).toBe(false);
  });

  it("survives half-typed code", () => {
    const f = parseJava(`public class Broken {
  private int a
  public void m( {
  String s = "unterminated;
  public int ok() { return 1; }
  private Strin`);
    expect(f.types).toHaveLength(1);
    expect(f.types[0].name).toBe("Broken");
    expect(() => parseJava("class { } } ) ( <<< >>> @")).not.toThrow();
    expect(() => parseJava("")).not.toThrow();
  });

  it("reads umlauts, annotations with arguments and generic bounds", () => {
    const f = parseJava(`
@SuppressWarnings({"a", "b"})
public final class Größe<K extends Comparable<K>, V> {
  @Deprecated(since = "1") private @NonNull String bezeichnung;
  public <R> R map(java.util.function.Function<? super V, ? extends R> f) { return null; }
}`);
    const t = f.types[0];
    expect(t.name).toBe("Größe");
    expect(t.isFinal).toBe(true);
    expect(t.typeParams).toBe("<K extends Comparable<K>, V>");
    expect(t.fields[0]).toMatchObject({ name: "bezeichnung", type: "String", visibility: "private" });
    expect(t.methods[0].params[0].type).toBe("java.util.function.Function<? super V, ? extends R>");
  });
});

describe("type helpers", () => {
  it("names and shortens types", () => {
    expect(baseName("java.util.List<Shape>[]")).toBe("List");
    expect(baseName("Shape...")).toBe("Shape");
    expect(simpleType("java.util.Map<java.lang.String, shop.Item>")).toBe("Map<String, Item>");
    expect(typeNames("Map<String, List<? extends Shape>>")).toEqual(["Map", "String", "List", "Shape"]);
  });
});
