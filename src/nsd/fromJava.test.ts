import { describe, expect, it } from "vitest";
import { javaMethods, methodAt, nsdOfMethod } from "./fromJava";
import { blockAt, fromFile, insertAfter, moveBlock, newBlock, removeBlock, toFile, type Nsd } from "./model";

const SOURCE = `
public class Drawing {
    private java.util.List<Shape> shapes = new java.util.ArrayList<>();

    public Drawing(String title) {
        this.title = title;
    }

    public double totalArea() {
        double sum = 0;
        for (Shape s : shapes) {
            sum += s.area();
        }
        return sum;
    }

    void grade(int points) {
        if (points >= 90) {
            System.out.println("A");
        } else if (points >= 50) {
            System.out.println("pass");
        } else {
            System.out.println("fail");
            drawAll();
        }
        int i = 0;
        while (i < 3) i++;
        do {
            i--;
        } while (i > 0);
        for (int k = 0; k < 10; k++) {
            if (k == 5) break;
        }
        switch (points) {
            case 1:
                System.out.println("one");
                break;
            case 2, 3:
                System.out.println("few");
                break;
            default:
                System.out.println("many");
        }
        String s = switch (i) { default -> "x"; };
        try {
            risky();
        } catch (java.io.IOException e) {
            throw new RuntimeException(e);
        } finally {
            i = 0;
        }
    }

    void drawAll() {}
    void risky() throws java.io.IOException {}
}
`;

describe("Nassi–Shneiderman diagrams from Java", () => {
  it("lists the methods and finds the one at the cursor", () => {
    expect(javaMethods(SOURCE).map((m) => m.signature)).toEqual(["Drawing(String title)", "totalArea()", "grade(int points)", "drawAll()", "risky()"]);
    expect(methodAt(SOURCE, SOURCE.indexOf("sum +="))?.name).toBe("totalArea");
    expect(methodAt(SOURCE, SOURCE.indexOf("private java"))).toBeNull();
  });

  it("turns a for-each loop and a return into a loop and an exit", () => {
    const d = nsdOfMethod(SOURCE, "totalArea()")!;
    expect(d.title).toBe("totalArea()");
    expect(d.body).toEqual([
      { kind: "action", text: "double sum = 0" },
      { kind: "while", cond: "for each Shape s in shapes", body: [{ kind: "action", text: "sum += s.area()" }] },
      { kind: "exit", text: "return sum" },
    ]);
  });

  it("reads decisions, loops, switches and try", () => {
    const d = nsdOfMethod(SOURCE, "grade")!;
    const [ifs, decl, whileLoop, doLoop, forLoop, sw, swExpr, tryGroup, catchGroup, finallyGroup] = d.body;
    // else-if is a decision inside the "no" branch; a call of the class's own method is a call.
    expect(ifs).toEqual({
      kind: "if",
      cond: "points >= 90",
      yes: [{ kind: "action", text: 'System.out.println("A")' }],
      no: [
        {
          kind: "if",
          cond: "points >= 50",
          yes: [{ kind: "action", text: 'System.out.println("pass")' }],
          no: [
            { kind: "action", text: 'System.out.println("fail")' },
            { kind: "call", text: "drawAll()" },
          ],
        },
      ],
    });
    expect(decl).toEqual({ kind: "action", text: "int i = 0" });
    expect(whileLoop).toEqual({ kind: "while", cond: "while i < 3", body: [{ kind: "action", text: "i++" }] });
    expect(doLoop).toEqual({ kind: "repeat", cond: "while i > 0", body: [{ kind: "action", text: "i--" }] });
    expect(forLoop).toEqual({ kind: "while", cond: "for (int k = 0; k < 10; k++)", body: [{ kind: "if", cond: "k == 5", yes: [{ kind: "exit", text: "break" }], no: [] }] });
    // The closing break of a case isn't a step of its own.
    expect(sw).toEqual({
      kind: "switch",
      expr: "points",
      cases: [
        { label: "1", body: [{ kind: "action", text: 'System.out.println("one")' }] },
        { label: "2, 3", body: [{ kind: "action", text: 'System.out.println("few")' }] },
        { label: "default", body: [{ kind: "action", text: 'System.out.println("many")' }] },
      ],
    });
    expect(swExpr).toEqual({ kind: "action", text: 'String s = switch (i) { default -> "x"; }' });
    expect(tryGroup).toEqual({ kind: "group", title: "try", body: [{ kind: "call", text: "risky()" }] });
    expect(catchGroup).toEqual({ kind: "group", title: "catch (java.io.IOException e)", body: [{ kind: "exit", text: "throw new RuntimeException(e)" }] });
    expect(finallyGroup).toEqual({ kind: "group", title: "finally", body: [{ kind: "action", text: "i = 0" }] });
  });

  it("reads a constructor", () => {
    expect(nsdOfMethod(SOURCE, "Drawing(String title)")?.body).toEqual([{ kind: "action", text: "this.title = title" }]);
  });
});

describe("editing a diagram", () => {
  const start: Nsd = { title: "t", body: [newBlock("action"), newBlock("if")] };

  it("inserts after a block, into an empty branch, moves and removes", () => {
    const a = insertAfter(start, { list: [], index: 0 }, { kind: "exit", text: "return" });
    expect(a.at).toEqual({ list: [], index: 1 });
    expect(a.nsd.body.map((b) => b.kind)).toEqual(["action", "exit", "if"]);
    // The empty "yes" branch of the decision, now at index 2.
    const b = insertAfter(a.nsd, { list: [2, "yes"], index: 0 }, { kind: "action", text: "x" });
    expect(blockAt(b.nsd, b.at)).toEqual({ kind: "action", text: "x" });
    const c = moveBlock(b.nsd, { list: [], index: 1 }, -1);
    expect(c.nsd.body.map((x) => x.kind)).toEqual(["exit", "action", "if"]);
    expect(removeBlock(c.nsd, { list: [], index: 0 }).body.map((x) => x.kind)).toEqual(["action", "if"]);
    // The original is left as it was.
    expect(start.body.map((x) => x.kind)).toEqual(["action", "if"]);
  });

  it("keeps a diagram in a file", () => {
    const d: Nsd = { title: "Sort", body: [newBlock("switch"), newBlock("repeat")] };
    expect(fromFile(toFile(d), "x")).toEqual(d);
    expect(fromFile("", "New")).toEqual({ title: "New", body: [] });
    expect(() => fromFile('{"format":"other"}', "x")).toThrow();
  });
});
