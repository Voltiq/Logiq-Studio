import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "./version";

describe("the version", () => {
  it("is the same everywhere it is written", () => {
    const read = (f: string) => readFileSync(f, "utf8");
    expect(JSON.parse(read("package.json")).version).toBe(APP_VERSION);
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe(APP_VERSION);
    expect(/^version = "([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1]).toBe(APP_VERSION);
    // The changelog has this version's notes: the release workflow publishes them.
    expect(read("CHANGELOG.md")).toMatch(new RegExp(`^## ${APP_VERSION.replace(/\./g, "\\.")}\\b`, "m"));
  });
});
