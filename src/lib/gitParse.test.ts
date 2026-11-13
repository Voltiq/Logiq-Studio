import { describe, expect, it } from "vitest";
import { cloneFolderName, isStaged, isUnstaged, kindOf, LOG_FORMAT, parseBlame, parseBranches, parseConflicts, parseLog, parseNameStatus, parseStashes, parseStatus, parseTags, resolveConflict } from "./gitParse";

describe("parseStatus", () => {
  it("reads the branch, tracking and files", () => {
    const out = "## main...origin/main [ahead 2, behind 1]\0 M src/Grüße.java\0M  README.md\0R  src/New.java\0src/Old.java\0?? notes.txt\0UU conflict.txt\0";
    const s = parseStatus(out);
    expect(s.branch).toBe("main");
    expect(s.upstream).toBe("origin/main");
    expect([s.ahead, s.behind]).toEqual([2, 1]);
    expect(s.files.map((f) => [f.path, kindOf(f), isStaged(f), isUnstaged(f)])).toEqual([
      ["src/Grüße.java", "modified", false, true],
      ["README.md", "modified", true, false],
      ["src/New.java", "renamed", true, false],
      ["notes.txt", "untracked", false, true],
      ["conflict.txt", "conflict", false, true],
    ]);
    expect(s.files[2].orig).toBe("src/Old.java");
  });

  it("knows a repository without commits and a detached head", () => {
    expect(parseStatus("## No commits yet on main\0?? a.txt\0")).toMatchObject({ unborn: true, branch: "main" });
    expect(parseStatus("## HEAD (no branch)\0")).toMatchObject({ detached: true, branch: null });
    expect(parseStatus("## feature\0")).toMatchObject({ branch: "feature", upstream: null, ahead: 0 });
  });

  it("puts a change in the working tree before one in the index", () => {
    expect(kindOf({ path: "a", x: "A", y: "M" })).toBe("modified");
    expect(kindOf({ path: "a", x: "M", y: "D" })).toBe("deleted");
    expect(kindOf({ path: "a", x: "A", y: " " })).toBe("added");
  });
});

describe("parseLog", () => {
  it("reads several commits", () => {
    expect(LOG_FORMAT).toContain("%x1e");
    const row = (h: string, subject: string) => `${h}\x1f${h.slice(0, 3)}\x1fAda\x1fada@example.invalid\x1f2026-11-13T10:00:00+01:00\x1f${subject}\x1f\x1f\x1e\n`;
    const commits = parseLog(row("abc123", "Ändere: Kreis") + row("def456", "First"));
    expect(commits.map((c) => [c.short, c.subject, c.author])).toEqual([
      ["abc", "Ändere: Kreis", "Ada"],
      ["def", "First", "Ada"],
    ]);
    expect(commits[1]).toMatchObject({ refs: [], parents: [] });
  });

  it("reads refs", () => {
    const [c] = parseLog("h\x1fs\x1fA\x1fe\x1f2026-01-01T00:00:00Z\x1fFix\x1fHEAD -> main, origin/main, tag: v1\x1fp1 p2\x1e");
    expect(c.refs).toEqual(["main", "origin/main", "tag: v1"]);
    expect(c.parents).toEqual(["p1", "p2"]);
  });
});

describe("parseBranches", () => {
  it("reads local and remote branches without origin/HEAD", () => {
    const out = ["refs/heads/main\x1fmain\x1f*\x1forigin/main\x1f[ahead 1]", "refs/heads/feature\x1ffeature\x1f \x1f\x1f", "refs/remotes/origin/HEAD\x1forigin/HEAD\x1f \x1f\x1f", "refs/remotes/origin/main\x1forigin/main\x1f \x1f\x1f"].join("\n") + "\n";
    expect(parseBranches(out)).toEqual([
      { name: "main", remote: false, current: true, upstream: "origin/main", track: "[ahead 1]" },
      { name: "feature", remote: false, current: false, upstream: null, track: "" },
      { name: "origin/main", remote: true, current: false, upstream: null, track: "" },
    ]);
  });
});

describe("parseNameStatus", () => {
  it("reads changed files and renames", () => {
    expect(parseNameStatus("M\0src/A.java\0R087\0old.txt\0new.txt\0A\0b.txt\0")).toEqual([
      { status: "M", path: "src/A.java" },
      { status: "R", orig: "old.txt", path: "new.txt" },
      { status: "A", path: "b.txt" },
    ]);
  });
});

describe("cloneFolderName", () => {
  it("names the folder like git does", () => {
    expect(cloneFolderName("https://github.com/acme/shapes.git")).toBe("shapes");
    expect(cloneFolderName("git@github.com:acme/shapes.git")).toBe("shapes");
    expect(cloneFolderName("https://example.org/repo/")).toBe("repo");
  });
});

describe("stashes, tags, blame and conflicts", () => {
  it("reads the stash list", () => {
    const out = "stash@{0}\x1fOn main: half a feature\x1f2026-11-13T10:00:00+01:00\x1e\nstash@{1}\x1fWIP on main: abc123 Add a class\x1f2026-11-12T09:00:00+01:00\x1e\n";
    expect(parseStashes(out)).toEqual([
      { ref: "stash@{0}", message: "half a feature", date: "2026-11-13T10:00:00+01:00" },
      { ref: "stash@{1}", message: "abc123 Add a class", date: "2026-11-12T09:00:00+01:00" },
    ]);
  });

  it("reads tags, annotated or not", () => {
    const c = "a".repeat(40);
    const tagObj = "b".repeat(40);
    const out = `v1.0\x1ftag\x1f${c}${tagObj}\x1fFirst release\x1f2026-11-13T10:00:00+01:00\x1e\nwip\x1fcommit\x1f${c}\x1fAdd a class\x1f2026-11-12T09:00:00+01:00\x1e\n`;
    expect(parseTags(out)).toEqual([
      { name: "v1.0", annotated: true, commit: c, subject: "First release", date: "2026-11-13T10:00:00+01:00" },
      { name: "wip", annotated: false, commit: c, subject: "Add a class", date: "2026-11-12T09:00:00+01:00" },
    ]);
  });

  it("reads porcelain blame", () => {
    const a = "1".repeat(40);
    const z = "0".repeat(40);
    const out = `${a} 1 1 2\nauthor Ada Lovelace\nauthor-mail <ada@example.com>\nauthor-time 1700000000\nsummary Add Main\nfilename Main.java\n\tline one\n${a} 2 2\n\tline two\n${z} 3 3 1\nauthor Not Committed Yet\nauthor-time 1800000000\nsummary Version of Main.java from Main.java\nfilename Main.java\n\tnew line\n`;
    const b = parseBlame(out);
    expect(b.lines).toEqual([a, a, z]);
    expect(b.commits.get(a)).toEqual({ hash: a, author: "Ada Lovelace", time: 1700000000, summary: "Add Main", uncommitted: false });
    expect(b.commits.get(z)?.uncommitted).toBe(true);
  });

  it("finds conflict blocks and resolves them", () => {
    const text = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nb\n<<<<<<< HEAD\nx\n||||||| base\no\n=======\ny\n>>>>>>> feature\n";
    const blocks = parseConflicts(text);
    expect(blocks).toEqual([
      { start: 2, base: null, middle: 4, end: 6, current: "HEAD", incoming: "feature" },
      { start: 8, base: 10, middle: 12, end: 14, current: "HEAD", incoming: "feature" },
    ]);
    const lines = text.split("\n");
    expect(resolveConflict(lines, blocks[0], "current")).toEqual(["mine"]);
    expect(resolveConflict(lines, blocks[0], "incoming")).toEqual(["theirs"]);
    expect(resolveConflict(lines, blocks[1], "both")).toEqual(["x", "y"]);
  });
});
