import { describe, expect, it } from "vitest";
import { settingsFromFile, settingsToFile } from "./settingsFile";
import { DEFAULT_SETTINGS } from "./settings";

describe("settings as a file", () => {
  it("round-trips what belongs to the person, not the computer", () => {
    const mine = { ...DEFAULT_SETTINGS, fontSize: 16, wordWrap: true, language: "de" as const, jdkHome: "C:\\jdk", recent: ["C:\\p"], cFlags: "-O2", uml: { ...DEFAULT_SETTINGS.uml, showPrivate: !DEFAULT_SETTINGS.uml.showPrivate } };
    const file = settingsToFile(mine, "1.0.0");
    expect(file).not.toContain("jdkHome");
    expect(file).not.toContain("recent");
    const back = settingsFromFile(file);
    expect(back.ignored).toEqual([]);
    expect(back.settings).toMatchObject({ fontSize: 16, wordWrap: true, language: "de", cFlags: "-O2" });
    expect(back.settings.uml?.showPrivate).toBe(mine.uml.showPrivate);
    expect(back.settings.jdkHome).toBeUndefined();
  });

  it("takes only what is valid", () => {
    const file = JSON.stringify({
      file: "Logiq Studio settings",
      version: "9.9.9",
      settings: { fontSize: 500, tabSize: "4", theme: "neon", wordWrap: true, madeUp: 1, recent: ["x"], uml: { showPrivate: "yes", nope: 1 }, language: "fr" },
    });
    const r = settingsFromFile(file);
    expect(r.settings).toEqual({ wordWrap: true, language: "fr", uml: DEFAULT_SETTINGS.uml });
    expect(r.ignored.sort()).toEqual(["fontSize", "madeUp", "recent", "tabSize", "theme"]);
  });

  it("refuses other files", () => {
    expect(() => settingsFromFile("hello")).toThrow();
    expect(() => settingsFromFile('{"name":"package"}')).toThrow("settings file");
  });
});
