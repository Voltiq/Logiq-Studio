import { describe, expect, it } from "vitest";
import { align, snapMove, snapResize } from "./geometry";

const frame = { w: 400, h: 300 };

describe("placing components", () => {
  it("snaps to the grid when nothing is near", () => {
    expect(snapMove({ x: 13, y: 21, w: 50, h: 20 }, [], frame, { grid: 8, smart: false }).box).toMatchObject({ x: 16, y: 24 });
  });

  it("lines up with another component's edge and shows a guide", () => {
    const other = { x: 100, y: 40, w: 80, h: 24 };
    const r = snapMove({ x: 103, y: 120, w: 60, h: 24 }, [other], frame, { grid: 8, smart: true });
    expect(r.box.x).toBe(100);
    expect(r.guides).toEqual([{ axis: "x", at: 100, from: 40, to: 144 }]);
  });

  it("centres in the window", () => {
    const r = snapMove({ x: 168, y: 100, w: 60, h: 20 }, [], frame, { grid: 8, smart: true });
    expect(r.box.x).toBe(170);
  });

  it("resizes from a handle, snapping the moving edge", () => {
    const other = { x: 10, y: 10, w: 200, h: 20 };
    const r = snapResize({ x: 10, y: 50, w: 100, h: 20 }, "e", 97, 0, [other], frame, { grid: 8, smart: true });
    expect(r.box).toEqual({ x: 10, y: 50, w: 200, h: 20 });
    const small = snapResize({ x: 10, y: 50, w: 100, h: 20 }, "nw", 200, 200, [], frame, { grid: 1, smart: false });
    expect(small.box.w).toBe(8);
    expect(small.box.h).toBe(8);
  });

  it("aligns to the first selected and spreads evenly", () => {
    const boxes = [
      { x: 20, y: 10, w: 50, h: 20 },
      { x: 90, y: 40, w: 30, h: 20 },
      { x: 300, y: 70, w: 50, h: 20 },
    ];
    expect(align(boxes, "left").map((b) => b.x)).toEqual([20, 20, 20]);
    expect(align(boxes, "right").map((b) => b.x)).toEqual([20, 40, 20]);
    expect(align(boxes, "sameWidth").map((b) => b.w)).toEqual([50, 50, 50]);
    // From 20 to 350, three boxes 130 wide in all: gaps of 100.
    expect(align(boxes, "spreadX").map((b) => b.x)).toEqual([20, 170, 300]);
  });
});
