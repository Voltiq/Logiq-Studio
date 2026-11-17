/*
 * The git commands the app runs for merging, rebasing, stashes, tags and
 * blame, against a real repository in a temporary folder, read with the
 * app's own parsers. Skipped when git isn't installed.
 */
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBlame, parseConflicts, parseStashes, parseStatus, parseTags, resolveConflict, STASH_FORMAT, TAG_FORMAT, isConflict } from "./gitParse";

// Each test runs git several times; a cold CI runner needs more than the default 5 seconds.
vi.setConfig({ testTimeout: 60_000 });

let hasGit = true;
try {
  execFileSync("git", ["--version"]);
} catch {
  hasGit = false;
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "logiq-git-"));
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-c", "core.quotepath=false", "-c", "color.ui=never", "-c", "core.autocrlf=false", ...args], {
      cwd: dir,
      input,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" },
      stdio: ["pipe", "pipe", "pipe"],
    });
  const tryGit = (args: string[]) => {
    try {
      return { code: 0, out: git(args) };
    } catch (e) {
      return { code: (e as { status: number }).status, out: String((e as { stdout: string }).stdout) };
    }
  };
  git(["init", "-q", "-b", "main"]);
  return { dir, git, tryGit, write: (f: string, s: string) => writeFileSync(join(dir, f), s), read: (f: string) => readFileSync(join(dir, f), "utf8") };
}

describe.skipIf(!hasGit)("git with a real repository", () => {
  it("merges with a conflict, resolves it and commits", () => {
    const r = repo();
    r.write("Grüße.txt", "a\nshared\nz\n");
    r.git(["add", "-A"]);
    r.git(["commit", "-q", "-m", "start"]);
    r.git(["switch", "-q", "-c", "feature"]);
    r.write("Grüße.txt", "a\nfeature side\nz\n");
    r.git(["commit", "-q", "-am", "feature change"]);
    r.git(["switch", "-q", "main"]);
    r.write("Grüße.txt", "a\nmain side\nz\n");
    r.git(["commit", "-q", "-am", "main change"]);

    const merge = r.tryGit(["merge", "--no-edit", "feature"]);
    expect(merge.code).toBe(1);
    expect(existsSync(join(r.dir, ".git", "MERGE_HEAD"))).toBe(true);
    expect(readFileSync(join(r.dir, ".git", "MERGE_MSG"), "utf8")).toMatch(/'feature'/);
    const status = parseStatus(r.git(["status", "--porcelain=v1", "-b", "-z", "-uall"]));
    expect(status.files.filter(isConflict).map((f) => f.path)).toEqual(["Grüße.txt"]);

    const text = r.read("Grüße.txt").replace(/\r\n/g, "\n");
    const blocks = parseConflicts(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].current).toBe("HEAD");
    expect(blocks[0].incoming).toBe("feature");
    const lines = text.split("\n");
    const resolved = [...lines.slice(0, blocks[0].start - 1), ...resolveConflict(lines, blocks[0], "both"), ...lines.slice(blocks[0].end)].join("\n");
    r.write("Grüße.txt", resolved);
    r.git(["add", "--", "Grüße.txt"]);
    r.git(["commit", "--no-edit"]);
    expect(existsSync(join(r.dir, ".git", "MERGE_HEAD"))).toBe(false);
    expect(r.read("Grüße.txt")).toBe("a\nmain side\nfeature side\nz\n");
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("rebases, stops on a conflict, takes a side and continues without an editor", () => {
    const r = repo();
    r.write("f.txt", "1\n");
    r.git(["add", "-A"]);
    r.git(["commit", "-q", "-m", "start"]);
    r.git(["switch", "-q", "-c", "topic"]);
    r.write("f.txt", "topic\n");
    r.git(["commit", "-q", "-am", "topic"]);
    r.git(["switch", "-q", "main"]);
    r.write("f.txt", "main\n");
    r.git(["commit", "-q", "-am", "main"]);
    r.git(["switch", "-q", "topic"]);
    expect(r.tryGit(["rebase", "main"]).code).toBe(1);
    expect(existsSync(join(r.dir, ".git", "rebase-merge"))).toBe(true);
    const onto = readFileSync(join(r.dir, ".git", "rebase-merge", "onto"), "utf8").trim();
    expect(r.git(["name-rev", "--name-only", "--exclude=refs/tags/*", onto]).trim()).toBe("main");
    r.git(["checkout", "--theirs", "--", "f.txt"]);
    r.git(["add", "--", "f.txt"]);
    r.git(["-c", "core.editor=true", "rebase", "--continue"]);
    expect(existsSync(join(r.dir, ".git", "rebase-merge"))).toBe(false);
    expect(r.read("f.txt")).toBe("topic\n");
    expect(r.git(["log", "--format=%s"]).trim().split("\n")).toEqual(["topic", "main", "start"]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("stashes with untracked files, lists, applies and drops", () => {
    const r = repo();
    r.write("a.txt", "1\n");
    r.git(["add", "-A"]);
    r.git(["commit", "-q", "-m", "start"]);
    r.write("a.txt", "2\n");
    r.write("new.txt", "new\n");
    r.git(["stash", "push", "--include-untracked", "-m", "halb fertig"]);
    expect(existsSync(join(r.dir, "new.txt"))).toBe(false);
    const list = parseStashes(r.git(["stash", "list", STASH_FORMAT]));
    expect(list.map((s) => [s.ref, s.message])).toEqual([["stash@{0}", "halb fertig"]]);
    expect(r.git(["stash", "show", "--name-status", list[0].ref]).trim()).toBe("M\ta.txt");
    expect(r.git(["show", `${list[0].ref}^1:a.txt`])).toBe("1\n");
    r.git(["stash", "pop", list[0].ref]);
    expect(r.read("a.txt")).toBe("2\n");
    expect(r.read("new.txt")).toBe("new\n");
    expect(parseStashes(r.git(["stash", "list", STASH_FORMAT]))).toEqual([]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("tags (annotated and light) and blames unsaved text", () => {
    const r = repo();
    r.write("Main.java", "class Main {\n}\n");
    r.git(["add", "-A"]);
    r.git(["commit", "-q", "-m", "Add Main"]);
    const head = r.git(["rev-parse", "HEAD"]).trim();
    r.git(["tag", "-a", "-m", "First release", "v1.0"]);
    r.git(["tag", "light"]);
    const tags = parseTags(r.git(["for-each-ref", "--sort=-creatordate", TAG_FORMAT, "refs/tags"]));
    expect(tags.map((x) => [x.name, x.annotated, x.commit === head]).sort()).toEqual([
      ["light", false, true],
      ["v1.0", true, true],
    ]);
    expect(tags.find((x) => x.name === "v1.0")?.subject).toBe("First release");

    const b = parseBlame(r.git(["blame", "--porcelain", "--contents", "-", "--", "Main.java"], "class Main {\n    int x;\n}\n"));
    expect(b.lines).toHaveLength(3);
    expect(b.commits.get(b.lines[0])?.summary).toBe("Add Main");
    expect(b.commits.get(b.lines[0])?.author).toBe("Ada");
    expect(b.commits.get(b.lines[1])?.uncommitted).toBe(true);
    expect(b.lines[2]).toBe(head);
    rmSync(r.dir, { recursive: true, force: true });
  });
});
