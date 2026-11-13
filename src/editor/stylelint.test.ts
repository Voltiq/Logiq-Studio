import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { parseStylelint } from "./stylelint";

describe("parseStylelint", () => {
  it("turns Stylelint's report into problems", () => {
    const doc = Text.of(["a { color: #ff; }", "b {}"]);
    const json = JSON.stringify([
      {
        source: "C:\\p\\style.css",
        warnings: [
          { line: 1, column: 12, endLine: 1, endColumn: 15, rule: "color-no-invalid-hex", severity: "error", text: 'Unexpected invalid hex color "#ff" (color-no-invalid-hex)' },
          { line: 2, column: 3, rule: "block-no-empty", severity: "warning", text: "Unexpected empty block (block-no-empty)" },
        ],
      },
    ]);
    const d = parseStylelint(json, doc);
    expect(d.map((x) => [doc.sliceString(x.from, x.to), x.severity, x.source, x.message])).toEqual([
      ["#ff", "error", "stylelint(color-no-invalid-hex)", 'Unexpected invalid hex color "#ff"'],
      ["{", "warning", "stylelint(block-no-empty)", "Unexpected empty block"],
    ]);
  });

  it("ignores what isn't a report", () => {
    expect(parseStylelint("Error: No configuration provided", Text.of(["a{}"]))).toEqual([]);
  });
});
