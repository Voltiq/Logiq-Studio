import { describe, expect, it } from "vitest";
import { defaultLayout, indexAt, layoutCode, layoutItems, parseLayout, parseRegion, regionAt, TITLED_INSETS, type Layout } from "./layout";

const items = (...sizes: [number, number][]) => sizes.map(([w, h], i) => ({ name: `c${i}`, w, h }));

describe("FlowLayout", () => {
  it("lines components up in a centred row, each centred in the row's height", () => {
    const b = layoutItems(defaultLayout("flow"), { w: 300, h: 100 }, items([100, 20], [50, 30]));
    // 100 + 5 + 50 = 155 wide; (300 - 10 - 155) / 2 = 67.5 to the left of the first, after the 5 gap.
    expect(b.get("c0")).toEqual({ x: 73, y: 10, w: 100, h: 20 });
    expect(b.get("c1")).toEqual({ x: 178, y: 5, w: 50, h: 30 });
  });

  it("wraps to a new row when the next doesn't fit", () => {
    const l: Layout = { kind: "flow", align: "left", hgap: 5, vgap: 5 };
    const b = layoutItems(l, { w: 200, h: 200 }, items([90, 20], [90, 20], [90, 30]));
    expect(b.get("c0")).toMatchObject({ x: 5, y: 5 });
    expect(b.get("c1")).toMatchObject({ x: 100, y: 5 });
    expect(b.get("c2")).toMatchObject({ x: 5, y: 30 });
  });

  it("goes to the right when told to", () => {
    const b = layoutItems({ kind: "flow", align: "right", hgap: 0, vgap: 0 }, { w: 100, h: 50 }, items([40, 10]));
    expect(b.get("c0")).toMatchObject({ x: 60, y: 0 });
  });
});

describe("GridLayout", () => {
  it("gives every cell the same size, in rows from the top left, gaps between", () => {
    const b = layoutItems({ kind: "grid", rows: 2, cols: 2, hgap: 10, vgap: 4 }, { w: 210, h: 104 }, items([1, 1], [1, 1], [1, 1]));
    expect(b.get("c0")).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(b.get("c1")).toEqual({ x: 110, y: 0, w: 100, h: 50 });
    expect(b.get("c2")).toEqual({ x: 0, y: 54, w: 100, h: 50 });
  });

  it("works out the columns from the rows, as Swing does", () => {
    const b = layoutItems({ kind: "grid", rows: 1, cols: 0, hgap: 0, vgap: 0 }, { w: 300, h: 30 }, items([1, 1], [1, 1], [1, 1]));
    expect([...b.values()].map((x) => x.x)).toEqual([0, 100, 200]);
    const byCols = layoutItems({ kind: "grid", rows: 0, cols: 2, hgap: 0, vgap: 0 }, { w: 100, h: 90 }, items([1, 1], [1, 1], [1, 1]));
    expect(byCols.get("c2")).toEqual({ x: 0, y: 45, w: 50, h: 45 });
  });
});

describe("BorderLayout", () => {
  it("puts north and south across, west and east between, the centre in what is left", () => {
    const list = [
      { name: "n", w: 10, h: 30, region: "NORTH" as const },
      { name: "s", w: 10, h: 20, region: "SOUTH" as const },
      { name: "w", w: 50, h: 10, region: "WEST" as const },
      { name: "e", w: 40, h: 10, region: "EAST" as const },
      { name: "c", w: 1, h: 1 },
    ];
    const b = layoutItems({ kind: "border", hgap: 5, vgap: 2 }, { w: 300, h: 200 }, list);
    expect(b.get("n")).toEqual({ x: 0, y: 0, w: 300, h: 30 });
    expect(b.get("s")).toEqual({ x: 0, y: 180, w: 300, h: 20 });
    expect(b.get("e")).toEqual({ x: 260, y: 32, w: 40, h: 146 });
    expect(b.get("w")).toEqual({ x: 0, y: 32, w: 50, h: 146 });
    expect(b.get("c")).toEqual({ x: 55, y: 32, w: 200, h: 146 });
  });

  it("shows only the last one added to a region", () => {
    const b = layoutItems(defaultLayout("border"), { w: 100, h: 100 }, [
      { name: "a", w: 1, h: 1 },
      { name: "b", w: 1, h: 1 },
    ]);
    expect(b.has("a")).toBe(false);
    expect(b.get("b")).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("keeps clear of a titled border", () => {
    const b = layoutItems(defaultLayout("border"), { w: 100, h: 100 }, [{ name: "c", w: 1, h: 1 }], TITLED_INSETS);
    expect(b.get("c")).toEqual({ x: 7, y: 20, w: 86, h: 73 });
  });
});

describe("dropping into a layout", () => {
  it("picks the region a point is nearest to", () => {
    const size = { w: 200, h: 100 };
    expect(regionAt(size, 100, 10)).toBe("NORTH");
    expect(regionAt(size, 100, 90)).toBe("SOUTH");
    expect(regionAt(size, 10, 50)).toBe("WEST");
    expect(regionAt(size, 190, 50)).toBe("EAST");
    expect(regionAt(size, 100, 50)).toBe("CENTER");
  });

  it("finds the place in the order", () => {
    const boxes = [
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 60, y: 0, w: 50, h: 20 },
      { x: 0, y: 30, w: 50, h: 20 },
    ];
    expect(indexAt(boxes, 10, 10)).toBe(0);
    expect(indexAt(boxes, 40, 10)).toBe(1);
    expect(indexAt(boxes, 100, 10)).toBe(2);
    expect(indexAt(boxes, 5, 40)).toBe(2);
    expect(indexAt(boxes, 45, 40)).toBe(3);
  });
});

describe("the code of a layout", () => {
  it("is written and read back", () => {
    for (const l of [defaultLayout("flow"), { kind: "flow", align: "left", hgap: 8, vgap: 2 } as Layout, { kind: "grid", rows: 3, cols: 2, hgap: 4, vgap: 4 } as Layout, { kind: "border", hgap: 6, vgap: 6 } as Layout]) {
      // As the reader sees code: one space between words only.
      expect(parseLayout(layoutCode(l).replace(/,\s+/g, ","))).toEqual(l);
    }
  });

  it("reads Swing's other ways of writing them", () => {
    expect(parseLayout("new FlowLayout()")).toEqual(defaultLayout("flow"));
    expect(parseLayout("new FlowLayout(FlowLayout.LEADING)")).toMatchObject({ align: "left" });
    expect(parseLayout("new GridLayout(2,3)")).toEqual({ kind: "grid", rows: 2, cols: 3, hgap: 0, vgap: 0 });
    expect(parseLayout("new BorderLayout()")).toEqual(defaultLayout("border"));
    expect(parseLayout("new java.awt.BorderLayout(3,4)")).toEqual({ kind: "border", hgap: 3, vgap: 4 });
    expect(parseLayout("new BoxLayout(panel,BoxLayout.Y_AXIS)")).toBeNull();
    expect(parseRegion("BorderLayout.NORTH")).toBe("NORTH");
    expect(parseRegion('"East"')).toBe("EAST");
    expect(parseRegion("BorderLayout.PAGE_START")).toBeNull();
  });
});
