import { describe, expect, it } from "vitest";
import { dropZone, isNoOp, SPLIT_FROM } from "./editorDrag";

// The editor area starts at (300, 80); without a side group the main group fills it.
const area = { left: 300, top: 80, width: 1000, height: 600 };
const main = { ...area };

describe("where a drop lands", () => {
  it("opens in the main group over its left part", () => {
    expect(dropZone(400, 300, area, main, null)).toEqual({ group: 0, split: false, box: { left: 0, top: 0, width: 1000, height: 600 } });
    expect(dropZone(300 + 1000 * SPLIT_FROM - 1, 300, area, main, null)?.split).toBe(false);
  });

  it("opens the side group over the right part, taking the right half", () => {
    expect(dropZone(300 + 1000 * SPLIT_FROM, 300, area, main, null)).toEqual({ group: 1, split: true, box: { left: 500, top: 0, width: 500, height: 600 } });
    expect(dropZone(1290, 100, area, main, null)?.group).toBe(1);
  });

  it("goes to the group under the pointer when both are open", () => {
    const left = { ...area, width: 600 };
    const side = { left: 906, top: 80, width: 394, height: 600 };
    // Near the right edge of the main group: still the main group, there is no third one to open.
    expect(dropZone(890, 300, area, left, side)).toEqual({ group: 0, split: false, box: { left: 0, top: 0, width: 600, height: 600 } });
    expect(dropZone(1000, 300, area, left, side)).toEqual({ group: 1, split: false, box: { left: 606, top: 0, width: 394, height: 600 } });
    // The resizer between them takes nothing.
    expect(dropZone(903, 300, area, left, side)).toBeNull();
  });

  it("doesn't split an empty main group", () => {
    expect(dropZone(1290, 300, area, main, null, false)).toEqual({ group: 0, split: false, box: { left: 0, top: 0, width: 1000, height: 600 } });
  });

  it("takes nothing outside the groups", () => {
    expect(dropZone(200, 300, area, main, null)).toBeNull();
    expect(dropZone(400, 700, area, main, null)).toBeNull();
  });

  it("knows when a tab would stay where it is", () => {
    const tab = { kind: "tab" as const, id: "a", group: 0 as const, title: "A.java" };
    const here = dropZone(400, 300, area, main, null)!;
    const split = dropZone(1200, 300, area, main, null)!;
    expect(isNoOp(tab, here)).toBe(true);
    expect(isNoOp(tab, split)).toBe(false);
    expect(isNoOp({ kind: "files", paths: ["C:/p/A.java"] }, here)).toBe(false);
  });
});
