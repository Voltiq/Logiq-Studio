import { describe, expect, it } from "vitest";
import { shortMessage } from "./inlineProblems";

describe("the message after a line", () => {
  it("names what javac couldn't find", () => {
    expect(shortMessage("cannot find symbol\nsymbol:   variable raduis\nlocation: class Circle")).toBe("cannot find symbol: variable raduis");
  });

  it("keeps the first line of other messages", () => {
    expect(shortMessage("incompatible types: String cannot be converted to int")).toBe("incompatible types: String cannot be converted to int");
    expect(shortMessage("';' expected\n")).toBe("';' expected");
  });

  it("is cut short when it is very long", () => {
    const m = shortMessage("x".repeat(400));
    expect(m.length).toBe(140);
    expect(m.endsWith("…")).toBe(true);
  });
});
