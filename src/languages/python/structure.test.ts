import { describe, expect, it } from "vitest";
import { logicalLines, parsePython } from "./structure";

describe("logicalLines", () => {
  it("joins brackets, backslashes and long strings", () => {
    const src = 'x = [1,\n     2]\n\ndef f(a,\n      b):  # comment\n    """Doc\n    string"""\n    return a + \\\n        b\ns = "a # not a comment"\n';
    expect(logicalLines(src).map((l) => [l.indent, l.text, l.line, l.endLine])).toEqual([
      [0, "x = [1,      2]", 1, 2],
      [0, "def f(a,       b):", 4, 5],
      [4, '""""""', 6, 7],
      [4, "return a +          b", 8, 9],
      [0, 's = ""', 10, 10],
    ]);
  });
});

describe("parsePython", () => {
  const src = `from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum


class Shape(ABC):
    """A shape."""

    count = 0

    def __init__(self, name: str, color="red"):
        self.name = name
        self._color = color
        self.__id = Shape.count
        self.points: list[Point] = []
        self.origin = Point(0, 0)

    @abstractmethod
    def area(self) -> float:
        ...

    @staticmethod
    def unit() -> "Shape":
        return Square(1)

    @property
    def label(self) -> str:
        return self.name


class Square(Shape):
    def __init__(self, side: float):
        super().__init__("square")
        self.side = side

    def area(self) -> float:
        return self.side ** 2

    def __str__(self):
        return f"Square({self.side})"


@dataclass
class Point:
    x: int
    y: int = 0


class Color(Enum):
    RED = 1
    GREEN = 2


def main() -> None:
    print(Square(2).area())


if __name__ == "__main__":
    main()
`;
  const file = parsePython(src, "C:\\p\\shapes.py");

  it("finds classes, kinds and inheritance", () => {
    expect(file.types.map((t) => [t.qualifiedName, t.kind, t.isAbstract, t.extends])).toEqual([
      ["shapes.Shape", "class", true, []],
      ["shapes.Square", "class", false, ["Shape"]],
      ["shapes.Point", "class", false, []],
      ["shapes.Color", "enum", false, []],
    ]);
    expect(file.types[0].line).toBe(6);
    expect(file.types[0].endLine).toBe(28);
    expect(file.types[3].constants).toEqual(["RED", "GREEN"]);
    expect(file.isMain).toBe(true);
    expect(file.functions?.map((f) => [f.name, f.returnType])).toEqual([["main", "void"]]);
  });

  it("reads attributes with their types and visibility", () => {
    const shape = file.types[0];
    expect(shape.fields.map((f) => [f.name, f.type, f.visibility, f.isStatic])).toEqual([
      ["count", "int", "public", true],
      ["name", "str", "public", false],
      ["_color", "str", "protected", false],
      ["__id", "", "private", false],
      ["points", "list[Point]", "public", false],
      ["origin", "Point", "public", false],
      ["label", "str", "public", false],
    ]);
    expect(file.types[2].fields.map((f) => [f.name, f.type, f.isStatic])).toEqual([
      ["x", "int", false],
      ["y", "int", false],
    ]);
  });

  it("reads methods, constructors and what they create", () => {
    const shape = file.types[0];
    expect(shape.methods.map((m) => [m.name, m.isConstructor, m.returnType, m.params.map((p) => `${p.name}:${p.type}`), m.isAbstract, m.isStatic])).toEqual([
      ["Shape", true, null, ["name:str", "color:str"], false, false],
      ["area", false, "float", [], true, false],
      ["unit", false, "Shape", [], false, true],
    ]);
    expect(shape.creates).toEqual(["Point", "Square"]);
    const square = file.types[1];
    expect(square.methods.map((m) => m.name)).toEqual(["Square", "area", "__str__"]);
    expect(square.fields.map((f) => [f.name, f.type])).toEqual([["side", "float"]]);
  });

  it("nests classes and survives odd code", () => {
    const f = parsePython("class Outer:\n    class Inner:\n        pass\n    def go(self): return Outer.Inner()\nclass Broken(\n", "pkg/__init__.py");
    expect(f.types.map((t) => [t.qualifiedName, t.outer])).toEqual([
      ["pkg.Outer", null],
      ["pkg.Outer.Inner", "pkg.Outer"],
      ["pkg.Broken", null],
    ]);
    expect(f.types[0].methods[0].name).toBe("go");
  });
});
