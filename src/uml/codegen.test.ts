import { describe, expect, it } from "vitest";
import { parseJava } from "./javaParser";
import { addField, addMethod, changeField, changeSignature, ensureImports, parseParams, removeMember, renderClass, setSupertypes } from "./codegen";

const type = (src: string, name: string) => parseJava(src).types.find((t) => t.name === name)!;

const ACCOUNT = `public class Account {

    private double balance;

    public Account(double start) {
        balance = start;
    }

    public double getBalance() {
        return balance;
    }
}
`;

describe("renderClass", () => {
  it("writes a class with constructor, getters, setters and toString", () => {
    const src = renderClass({
      name: "Person",
      kind: "class",
      pkg: "people",
      extends: "",
      implements: ["Comparable<Person>"],
      fields: [
        { name: "name", type: "String", visibility: "private" },
        { name: "friends", type: "List<Person>", visibility: "private", isFinal: true, init: "new ArrayList<>()" },
      ],
      constructor: true,
      getters: true,
      setters: true,
      toString: true,
      main: false,
    });
    expect(src).toBe(`package people;

import java.util.ArrayList;
import java.util.List;

public class Person implements Comparable<Person> {

    private String name;
    private final List<Person> friends = new ArrayList<>();

    public Person(String name, List<Person> friends) {
        this.name = name;
        this.friends = friends;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public List<Person> getFriends() {
        return friends;
    }

    @Override
    public String toString() {
        return "Person{" + "name=" + name + ", friends=" + friends + "}";
    }
}
`);
    // What it writes parses back to the same structure.
    const t = parseJava(src).types[0];
    expect(t.fields.map((f) => f.name)).toEqual(["name", "friends"]);
    expect(t.methods.map((m) => m.name)).toEqual(["Person", "getName", "setName", "getFriends", "toString"]);
  });

  it("writes interfaces, enums and records", () => {
    expect(renderClass({ name: "Shape", kind: "interface", pkg: "", extends: "", implements: ["Drawable"], fields: [], constructor: false, getters: false, setters: false, toString: false, main: false })).toBe(
      "public interface Shape extends Drawable {\n\n}\n",
    );
    const e = renderClass({ name: "Color", kind: "enum", pkg: "", extends: "", implements: [], fields: [], constants: ["RED", "GREEN"], constructor: false, getters: false, setters: false, toString: false, main: false });
    expect(parseJava(e).types[0].constants).toEqual(["RED", "GREEN"]);
    const r = renderClass({ name: "Point", kind: "record", pkg: "", extends: "", implements: [], fields: [{ name: "x", type: "int", visibility: "private" }], constructor: true, getters: true, setters: true, toString: false, main: true });
    expect(r).toContain("public record Point(int x) {");
    expect(parseJava(r).types[0].hasMain).toBe(true);
  });
});

describe("editing", () => {
  it("adds a field after the others, with getter and setter", () => {
    const out = addField(ACCOUNT, type(ACCOUNT, "Account"), { name: "owner", type: "String", visibility: "private" }, { getter: true, setter: true });
    const t = parseJava(out).types[0];
    expect(t.fields.map((f) => f.name)).toEqual(["balance", "owner"]);
    expect(t.methods.map((m) => m.name)).toEqual(["Account", "getBalance", "getOwner", "setOwner"]);
    expect(out).toContain("    private double balance;\n    private String owner;\n");
    expect(out).toContain("        return balance;\n    }\n\n    public String getOwner() {");
    expect(out.endsWith("    }\n}\n")).toBe(true);
  });

  it("adds a first field, imports and an enum's semicolon", () => {
    const src = "public class A {\n}\n";
    const out = addField(src, type(src, "A"), { name: "items", type: "List<String>", visibility: "private", init: "new ArrayList<>()" });
    expect(out).toBe("import java.util.ArrayList;\nimport java.util.List;\n\npublic class A {\n    private List<String> items = new ArrayList<>();\n}\n");
    const en = "enum Color {\n    RED, GREEN\n}\n";
    const out2 = addField(en, type(en, "Color"), { name: "code", type: "int", visibility: "private" });
    expect(parseJava(out2).types[0].constants).toEqual(["RED", "GREEN"]);
    expect(parseJava(out2).types[0].fields.map((f) => f.name)).toEqual(["code"]);
  });

  it("adds methods and constructors in the right place", () => {
    const t = type(ACCOUNT, "Account");
    const m = addMethod(ACCOUNT, t, { name: "deposit", returnType: "void", params: [{ name: "amount", type: "double" }], visibility: "public" });
    expect(parseJava(m).types[0].methods.map((x) => x.name)).toEqual(["Account", "getBalance", "deposit"]);
    expect(m).toContain("    public void deposit(double amount) {\n    }\n}");
    const c = addMethod(ACCOUNT, t, { name: "Account", returnType: null, params: [], visibility: "public", body: ["this(0);"] });
    expect(parseJava(c).types[0].methods.map((x) => x.params.length)).toEqual([1, 0, 0]);
    const i = "interface Shape {\n    double area();\n}\n";
    const out = addMethod(i, type(i, "Shape"), { name: "name", returnType: "String", params: [], visibility: "public" });
    expect(out).toContain("    public String name();\n}");
  });

  it("removes members with their annotations", () => {
    const src = "class A {\n    int x;\n\n    /** Doc. */\n    @Override\n    public String toString() {\n        return \"\";\n    }\n\n    void m() {}\n}\n";
    const t = type(src, "A");
    const out = removeMember(src, t.methods[0]);
    expect(out).toBe("class A {\n    int x;\n\n    void m() {}\n}\n");
    const shared = "class B {\n    int a, b = 2, c;\n}\n";
    const out2 = removeMember(shared, type(shared, "B").fields[1]);
    expect(parseJava(out2).types[0].fields.map((f) => f.name)).toEqual(["a", "c"]);
  });

  it("changes fields and signatures", () => {
    const t = type(ACCOUNT, "Account");
    const f = changeField(ACCOUNT, t.fields[0], { name: "balance", type: "long", visibility: "protected", isFinal: false });
    expect(f).toContain("    protected long balance;");
    const s = changeSignature(ACCOUNT, t, t.methods[1], { name: "getBalance", returnType: "double", params: [{ name: "fee", type: "double" }], visibility: "public", isStatic: false });
    expect(s).toContain("    public double getBalance(double fee) {\n        return balance;");
  });

  it("rewrites supertypes", () => {
    const src = "public final class Circle<T extends Number> extends Shape implements A, B {\n}\n";
    const t = type(src, "Circle");
    expect(setSupertypes(src, t, ["Figure"], ["A"])).toBe("public final class Circle<T extends Number> extends Figure implements A {\n}\n");
    expect(setSupertypes(src, t, [], [])).toBe("public final class Circle<T extends Number> {\n}\n");
    const r = "record P(int x, int y) {\n}\n";
    expect(setSupertypes(r, type(r, "P"), [], ["Shape"])).toBe("record P(int x, int y) implements Shape {\n}\n");
    const i = "interface I\n    extends J {\n}\n";
    expect(setSupertypes(i, type(i, "I"), ["J", "K"], [])).toBe("interface I extends J, K {\n}\n");
  });

  it("imports and parameters", () => {
    expect(ensureImports("package p;\n\nclass A {}\n", ["java.util.List"])).toBe("package p;\n\nimport java.util.List;\n\nclass A {}\n");
    expect(ensureImports("import java.util.*;\nclass A {}\n", ["java.util.List"])).toBe("import java.util.*;\nclass A {}\n");
    expect(parseParams("int x, Map<String, List<Integer>> m")).toEqual([
      { type: "int", name: "x" },
      { type: "Map<String, List<Integer>>", name: "m" },
    ]);
    expect(parseParams("int")).toBeNull();
    expect(parseParams("")).toEqual([]);
  });
});
