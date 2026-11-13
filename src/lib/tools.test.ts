// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseReport, testSkeleton } from "./tools";
import { splitArgs } from "./runConfig";
import { layoutTrace, traceToPlantUml } from "../uml/SequenceView";
import { parseJava } from "../uml/javaParser";

describe("JUnit report", () => {
  it("reads passed, failed, errored and skipped tests", () => {
    const xml = `<?xml version="1.0"?>
<testsuite name="JUnit Jupiter" tests="4">
  <testcase name="area()" classname="shapes.CircleTest" time="0.012"/>
  <testcase name="moveBy()" classname="shapes.CircleTest" time="0.003">
    <failure message="expected: &lt;2.0&gt; but was: &lt;1.0&gt;" type="org.opentest4j.AssertionFailedError">at CircleTest.moveBy(CircleTest.java:14)</failure>
  </testcase>
  <testcase name="broken()" classname="shapes.CircleTest" time="0"><error message="boom" type="java.lang.IllegalStateException"/></testcase>
  <testcase name="later()" classname="shapes.SquareTest" time="0"><skipped message="not yet"/></testcase>
</testsuite>`;
    const cases = parseReport(xml);
    expect(cases.map((c) => `${c.cls}.${c.name}:${c.status}`)).toEqual(["shapes.CircleTest.area:passed", "shapes.CircleTest.moveBy:failed", "shapes.CircleTest.broken:error", "shapes.SquareTest.later:skipped"]);
    expect(cases[1].message).toBe("expected: <2.0> but was: <1.0>");
    expect(cases[1].detail).toContain("CircleTest.java:14");
    expect(parseReport("")).toEqual([]);
  });

  it("writes a test class that parses", () => {
    const src = testSkeleton("Circle", "shapes", ["area", "moveBy"]);
    const t = parseJava(src).types[0];
    expect(t.qualifiedName).toBe("shapes.CircleTest");
    expect(t.methods.map((m) => m.name)).toEqual(["area", "moveBy"]);
    expect(src).toContain("import org.junit.jupiter.api.Test;");
  });
});

describe("program arguments", () => {
  it("splits like a shell", () => {
    expect(splitArgs(`input.txt 42 "two words" '' x`)).toEqual(["input.txt", "42", "two words", "", "x"]);
    expect(splitArgs("   ")).toEqual([]);
  });
});

describe("sequence diagram", () => {
  const trace = {
    participants: ["actor", "Main", "c1:Counter"],
    calls: [
      { kind: "call" as const, from: "actor", to: "Main", method: "main", args: "", depth: 0 },
      { kind: "call" as const, from: "Main", to: "c1:Counter", method: "new", args: "", depth: 1 },
      { kind: "return" as const, from: "c1:Counter", to: "Main", method: "new", value: "", depth: 1 },
      { kind: "call" as const, from: "Main", to: "c1:Counter", method: "add", args: "2", depth: 1 },
      { kind: "return" as const, from: "c1:Counter", to: "Main", method: "add", value: "2", depth: 1 },
      { kind: "return" as const, from: "Main", to: "actor", method: "main", value: "", depth: 0 },
    ],
    truncated: false,
  };

  it("lays out calls, returns and activations", () => {
    const l = layoutTrace(trace);
    expect(l.rows.map((r) => `${r.kind} ${r.from}->${r.to} ${r.label}`)).toEqual([
      "call 0->1 main()",
      "call 1->2 «create»()",
      "call 1->2 add(2)",
      "return 2->1 2",
      "return 1->0 ",
    ]);
    expect(l.activations).toHaveLength(3);
    expect(l.rows.every((r, i) => i === 0 || r.y > l.rows[i - 1].y)).toBe(true);
  });

  it("exports PlantUML", () => {
    const p = traceToPlantUml(trace);
    expect(p).toContain('"Main" -> "c1:Counter" : add(2)');
    expect(p).toContain('"c1:Counter" --> "Main" : 2');
  });
});
