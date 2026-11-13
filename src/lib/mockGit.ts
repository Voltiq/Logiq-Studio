/*
 * A small git for the browser stand-in: HEAD, the index and the working
 * tree (the mock's files), so the source control view, the explorer
 * colours, the change bar and diffs can be tried without the native side.
 */
type Files = Map<string, string>;

interface MockCommit {
  hash: string;
  subject: string;
  date: string;
  snapshot: Map<string, string>;
}

export function createMockGit(root: string, files: Files, emit: (event: string, payload: unknown) => void) {
  const rel = (abs: string) => abs.slice(root.length + 1).replace(/\\/g, "/");
  const abs = (r: string) => `${root}\\${r.replace(/\//g, "\\")}`;
  let head = new Map<string, string>();
  const index = new Map<string, string>();
  const commits: MockCommit[] = [];
  let branch = "main";
  const locals = ["main", "feature/shapes-ui"];
  let ahead = 1;
  let ready = false;
  /** Paths with conflicts while a pretend merge of "feature/shapes-ui" waits. */
  const conflicted = new Set<string>();
  let merging: { saved: Map<string, string | undefined> } | null = null;
  const stashes: { message: string; date: string; files: Map<string, string | undefined> }[] = [];
  const gitDir = `${root}\\.git`;

  function setup() {
    if (ready) return;
    ready = true;
    for (const [p, text] of files) if (p.startsWith(root + "\\")) head.set(rel(p), text);
    head.delete("README.md");
    // The committed Circle is an older one, so the working copy shows changes.
    for (const [r, text] of head) {
      if (r.endsWith("Circle.java")) head.set(r, text.replace(/\n\s*@Override[^\n]*\n[^\n]*toString[\s\S]*?\n {4}\}\n/, "\n").replace("radius", "r"));
    }
    for (const [r, text] of head) index.set(r, text);
    const day = 86400000;
    const now = Date.now();
    const snap = new Map(head);
    commits.push(
      { hash: "c3f1a9e2b7d4c6a8e0f2b4d6c8a0e2f4b6d8c0a2", subject: "Draw shapes on the canvas", date: new Date(now - 2 * 3600000).toISOString(), snapshot: snap },
      { hash: "8b2e4d6f0a1c3e5a7b9d1f3a5c7e9b1d3f5a7c9e", subject: "Add Rectangle and Square", date: new Date(now - day).toISOString(), snapshot: snap },
      { hash: "1a3c5e7b9d0f2a4c6e8b0d2f4a6c8e0b2d4f6a8c", subject: "First version", date: new Date(now - 5 * day).toISOString(), snapshot: snap },
    );
  }

  const tags: { name: string; commit: string; subject: string; date: string; annotated: boolean }[] = [];

  function endMerge() {
    merging = null;
    conflicted.clear();
    files.delete(`${gitDir}\\MERGE_HEAD`);
    files.delete(`${gitDir}\\MERGE_MSG`);
  }

  function status(): string {
    const paths = new Set<string>([...head.keys(), ...index.keys()]);
    for (const p of files.keys()) if (p.startsWith(root + "\\") && !p.startsWith(gitDir + "\\")) paths.add(rel(p));
    let out = `## ${branch}${branch === "main" ? `...origin/main${ahead ? ` [ahead ${ahead}]` : ""}` : ""}\0`;
    for (const r of [...paths].sort()) {
      const h = head.get(r);
      const i = index.get(r);
      const w = files.get(abs(r));
      const x = h === undefined ? (i === undefined ? "?" : "A") : i === undefined ? "D" : i !== h ? "M" : " ";
      const y = i === undefined ? (w === undefined ? " " : "?") : w === undefined ? "D" : w !== i ? "M" : " ";
      if (conflicted.has(r)) out += `UU ${r}\0`;
      else if (x === "?") out += `?? ${r}\0`;
      else if (x !== " " || y !== " ") out += `${x}${y} ${r}\0`;
    }
    return out;
  }

  const matches = (r: string, specs: string[]) => specs.some((p) => p === "." || r === p || r.startsWith(p + "/"));
  const allPaths = () => {
    const s = new Set<string>([...head.keys(), ...index.keys()]);
    for (const p of files.keys()) if (p.startsWith(root + "\\") && !p.startsWith(gitDir + "\\")) s.add(rel(p));
    return [...s];
  };

  function exec(args: string[], input: string | null): { code: number; stdout: string; stderr: string } {
    setup();
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    const dash = args.indexOf("--");
    const paths = dash >= 0 ? args.slice(dash + 1) : [];
    switch (args[0]) {
      case "rev-parse":
        if (args[1] === "--absolute-git-dir") return ok(gitDir.replace(/\\/g, "/") + "\n");
        return args[1] === "--show-toplevel" ? ok(root.replace(/\\/g, "/") + "\n") : ok((commits[0]?.hash ?? "") + "\n");
      case "merge": {
        if (args[1] === "--abort") {
          for (const [r, text] of merging?.saved ?? []) {
            if (text === undefined) files.delete(abs(r));
            else files.set(abs(r), text);
            emit("fs-changed", [abs(r)]);
          }
          endMerge();
          return ok();
        }
        // Merging the other branch changes the same line of Circle.java: a conflict.
        const r = [...head.keys()].find((k) => k.endsWith("Circle.java"));
        if (!r) return ok("Already up to date.\n");
        const text = files.get(abs(r)) ?? "";
        const lines = text.split("\n");
        const at = Math.max(0, lines.findIndex((l) => /class Circle/.test(l)));
        const changed = [...lines.slice(0, at + 1), "<<<<<<< HEAD", lines[at + 1] ?? "", "=======", "    private static final String KIND = \"circle\";", `>>>>>>> ${args[args.length - 1]}`, ...lines.slice(at + 2)].join("\n");
        merging = { saved: new Map([[r, text]]) };
        files.set(abs(r), changed);
        conflicted.add(r);
        files.set(`${gitDir}\\MERGE_HEAD`, "8b2e4d6f0a1c3e5a7b9d1f3a5c7e9b1d3f5a7c9e\n");
        files.set(`${gitDir}\\MERGE_MSG`, `Merge branch '${args[args.length - 1]}'\n`);
        emit("fs-changed", [abs(r)]);
        return { code: 1, stdout: `Auto-merging ${r}\nCONFLICT (content): Merge conflict in ${r}\nAutomatic merge failed; fix conflicts and then commit the result.\n`, stderr: "" };
      }
      case "checkout": {
        // --ours / --theirs for a conflicted file.
        for (const r of paths) {
          if (!conflicted.has(r)) continue;
          const text = files.get(abs(r)) ?? "";
          const ours = args.includes("--ours");
          files.set(abs(r), text.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g, (_m, a, b) => (ours ? a : b)));
          emit("fs-changed", [abs(r)]);
        }
        return ok();
      }
      case "stash": {
        if (args[1] === "list") return ok(stashes.map((s, i) => `stash@{${i}}\x1fOn ${branch}: ${s.message}\x1f${s.date}\x1e\n`).join(""));
        if (args[1] === "push") {
          const m = args.indexOf("-m");
          const saved = new Map<string, string | undefined>();
          for (const r of allPaths()) {
            const w = files.get(abs(r));
            const h = head.get(r);
            if (w === h) continue;
            saved.set(r, w);
            if (h === undefined) files.delete(abs(r));
            else files.set(abs(r), h);
            index.set(r, h ?? "");
            if (h === undefined) index.delete(r);
            emit("fs-changed", [abs(r)]);
          }
          stashes.unshift({ message: m >= 0 ? args[m + 1] : `${commits[0]?.hash.slice(0, 7)} ${commits[0]?.subject}`, date: new Date().toISOString(), files: saved });
          return ok("Saved working directory and index state\n");
        }
        const ref = args.find((a) => a.startsWith("stash@{")) ?? "stash@{0}";
        const i = Number(/\{(\d+)\}/.exec(ref)?.[1] ?? 0);
        const s = stashes[i];
        if (!s) return { code: 1, stdout: "", stderr: `error: ${ref} is not a valid reference` };
        if (args[1] === "show") return ok([...s.files.keys()].map((r) => `${head.has(r) ? (s.files.get(r) === undefined ? "D" : "M") : "A"}\0${r}\0`).join(""));
        if (args[1] === "apply" || args[1] === "pop") {
          for (const [r, text] of s.files) {
            if (text === undefined) files.delete(abs(r));
            else files.set(abs(r), text);
            emit("fs-changed", [abs(r)]);
          }
        }
        if (args[1] === "pop" || args[1] === "drop") stashes.splice(i, 1);
        return ok();
      }
      case "tag":
        if (args[1] === "-d") tags.splice(tags.findIndex((x) => x.name === args[2]), 1);
        else {
          const a = args.indexOf("-a") >= 0;
          const name = args.filter((x, i) => !x.startsWith("-") && args[i - 1] !== "-m" && i > 0)[0];
          tags.unshift({ name, commit: commits[0].hash, subject: a ? args[args.indexOf("-m") + 1] : commits[0].subject, date: new Date().toISOString(), annotated: a });
        }
        return ok();
      case "blame": {
        const lines = (input ?? "").replace(/\n$/, "").split("\n");
        const p = paths[0] ?? "";
        const base = (head.get(p) ?? "").split("\n");
        const c = commits[0];
        const z = "0".repeat(40);
        let out = "";
        const told = new Set<string>();
        lines.forEach((l, n) => {
          const hash = base.includes(l) ? (n < 8 ? commits[2].hash : n < 20 ? commits[1].hash : c.hash) : z;
          const first = !told.has(hash);
          told.add(hash);
          out += `${hash} ${n + 1} ${n + 1}${first ? " 1" : ""}\n`;
          if (first) {
            const cm = commits.find((x) => x.hash === hash);
            out += `author ${hash === z ? "Not Committed Yet" : "Ada Lovelace"}\nauthor-time ${Math.floor((cm ? Date.parse(cm.date) : Date.now()) / 1000)}\nsummary ${cm?.subject ?? "Version of the file in the editor"}\nfilename ${p}\n`;
          }
          out += `\t${l}\n`;
        });
        return ok(out);
      }
      case "status":
        return ok(status());
      case "log": {
        const fmt = (c: MockCommit, i: number) =>
          [c.hash, c.hash.slice(0, 7), "Ada Lovelace", "ada@example.invalid", c.date, c.subject, i === 0 ? `HEAD -> ${branch}${branch === "main" && !ahead ? ", origin/main" : ""}` : i === 1 && branch === "main" && ahead ? "origin/main" : "", commits[i + 1]?.hash ?? ""].join("\x1f") + "\x1e\n";
        return ok(commits.map(fmt).join(""));
      }
      case "for-each-ref":
        if (args.includes("refs/tags")) return ok(tags.map((x) => `${x.name}\x1f${x.annotated ? "tag" : "commit"}\x1f${x.commit}${x.annotated ? "f".repeat(40) : ""}\x1f${x.subject}\x1f${x.date}\x1e\n`).join(""));
        return ok(
          [...locals.map((b) => `refs/heads/${b}\x1f${b}\x1f${b === branch ? "*" : " "}\x1f${b === "main" ? "origin/main" : ""}\x1f${b === "main" && ahead ? `[ahead ${ahead}]` : ""}`), "refs/remotes/origin/main\x1forigin/main\x1f \x1f\x1f", "refs/remotes/origin/docs\x1forigin/docs\x1f \x1f\x1f"].join("\n") + "\n",
        );
      case "diff-tree":
        return ok("M\0src/Circle.java\0A\0src/Square.java\0");
      case "add":
        for (const r of paths.length ? paths : []) conflicted.delete(r);
        for (const r of allPaths()) {
          if (!matches(r, paths.length ? paths : ["."])) continue;
          const w = files.get(abs(r));
          if (w === undefined) index.delete(r);
          else index.set(r, w);
        }
        return ok();
      case "restore": {
        const staged = args.includes("--staged");
        for (const r of allPaths()) {
          if (!matches(r, paths)) continue;
          if (staged) {
            const h = head.get(r);
            if (h === undefined) index.delete(r);
            else index.set(r, h);
          } else {
            const i = index.get(r);
            if (i === undefined) files.delete(abs(r));
            else {
              files.set(abs(r), i);
              emit("fs-changed", [abs(r)]);
            }
          }
        }
        return ok();
      }
      case "commit": {
        const msg = (input ?? "").trim() || (merging ? `Merge branch 'feature/shapes-ui'` : commits[0]?.subject) || "";
        endMerge();
        head = new Map(index);
        const hash = Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
        if (args.includes("--amend")) commits.shift();
        else ahead++;
        commits.unshift({ hash, subject: msg.split("\n")[0], date: new Date().toISOString(), snapshot: new Map(head) });
        return ok(`[${branch} ${hash.slice(0, 7)}] ${msg}\n`);
      }
      case "switch": {
        const name = args.includes("-c") ? args[args.indexOf("-c") + 1] : args[args.length - 1];
        if (!locals.includes(name)) locals.push(name);
        branch = name;
        return ok();
      }
      case "config":
        return args.length <= 2 || args[args.length - 1] === "user.email" || args[args.length - 1] === "user.name" ? ok("demo@example.invalid\n") : ok();
      case "remote":
        return ok("origin\n");
      case "init":
        return ok("Initialized empty Git repository\n");
      default:
        return ok();
    }
  }

  function show(spec: string): string | null {
    setup();
    const stage = /^:([23]):(.*)$/.exec(spec);
    const m = stage ? [spec, `:${stage[1]}`, stage[2]] : /^(.*?):(.*)$/.exec(spec);
    if (!m) return null;
    const [, rev, path] = m;
    if (rev === "") return index.get(path) ?? null;
    // A conflict's sides: 2 is the current one, 3 the incoming.
    if (rev === ":2" || rev === ":3") {
      const saved = merging?.saved.get(path);
      if (saved === undefined) return null;
      if (rev === ":2") return saved;
      const lines = saved.split("\n");
      const at = Math.max(0, lines.findIndex((l) => /class Circle/.test(l)));
      return [...lines.slice(0, at + 1), '    private static final String KIND = "circle";', ...lines.slice(at + 2)].join("\n");
    }
    if (/^stash@\{\d+\}\^1$/.test(rev)) return head.get(path) ?? null;
    if (/^stash@\{\d+\}$/.test(rev)) {
      const s = stashes[Number(/\{(\d+)\}/.exec(rev)![1])];
      return s?.files.get(path) ?? null;
    }
    if (rev === "HEAD") return head.get(path) ?? null;
    const base = head.get(path) ?? null;
    // An older commit: the same file with its last method left out.
    if (rev.endsWith("^") && base) return base.replace(/\n {4}public [^\n]*\{[\s\S]*?\n {4}\}\n(?![\s\S]*\n {4}public )/, "\n");
    return base;
  }

  /** push, pull, fetch, clone: progress lines, then the end. */
  function stream(id: number, args: string[]) {
    const lines = args[0] === "clone" ? ["Cloning into 'project'...", "remote: Enumerating objects: 42, done.", "Receiving objects:  50% (21/42)", "Receiving objects: 100% (42/42), done.", "Resolving deltas: 100% (12/12), done."] : ["Enumerating objects: 5, done.", "Writing objects: 100% (3/3), 320 bytes | 320.00 KiB/s, done.", `To https://example.invalid/demo/shapes.git`];
    lines.forEach((line, i) => setTimeout(() => emit("git-progress", { id, line }), 120 * (i + 1)));
    setTimeout(() => {
      if (args[0] === "push") ahead = 0;
      emit("git-done", { id, code: 0 });
    }, 120 * (lines.length + 1));
  }

  return { exec, show, stream };
}
