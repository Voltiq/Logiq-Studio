/*
 * Reading git's machine-readable output. Kept apart from the store and the
 * commands so it can be tested on its own.
 */

/** What changed in a file, from `git status --porcelain=v1`: X is the index, Y the working tree. */
export interface GitFile {
  /** Relative to the repository, with forward slashes. */
  path: string;
  /** The old name of a renamed or copied file. */
  orig?: string;
  x: string;
  y: string;
}

export type GitKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict" | "ignored";

export interface GitStatus {
  branch: string | null;
  /** No commit yet in this repository. */
  unborn: boolean;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function isConflict(f: GitFile) {
  return CONFLICT.has(f.x + f.y);
}

/** Whether a file has changes in the index (staged). */
export function isStaged(f: GitFile) {
  return !isConflict(f) && f.x !== " " && f.x !== "?" && f.x !== "!";
}

/** Whether a file has changes in the working tree that aren't staged. */
export function isUnstaged(f: GitFile) {
  return isConflict(f) || (f.y !== " " && f.y !== "!");
}

/** The one word the explorer shows for a file: its working tree state wins over the index. */
export function kindOf(f: GitFile): GitKind {
  if (isConflict(f)) return "conflict";
  if (f.x === "?") return "untracked";
  if (f.x === "!") return "ignored";
  const c = f.y !== " " ? f.y : f.x;
  if (c === "D") return "deleted";
  if (c === "A") return "added";
  if (c === "R" || c === "C") return "renamed";
  return "modified";
}

/** The letter shown beside a file (as VS Code shows them). */
export function letterOf(kind: GitKind): string {
  return { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflict: "!", ignored: "" }[kind];
}

/** `git status --porcelain=v1 -b -z` */
export function parseStatus(out: string): GitStatus {
  const parts = out.split("\0");
  const status: GitStatus = { branch: null, unborn: false, detached: false, upstream: null, ahead: 0, behind: 0, files: [] };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith("## ")) {
      const head = p.slice(3);
      const track = /\[(.*)\]$/.exec(head)?.[1] ?? "";
      status.ahead = +(/ahead (\d+)/.exec(track)?.[1] ?? 0);
      status.behind = +(/behind (\d+)/.exec(track)?.[1] ?? 0);
      const names = head.replace(/\s*\[.*\]$/, "");
      if (names.startsWith("No commits yet on ") || names.startsWith("Initial commit on ")) {
        status.unborn = true;
        status.branch = names.replace(/^(No commits yet|Initial commit) on /, "");
      } else if (names.startsWith("HEAD (no branch)")) {
        status.detached = true;
      } else {
        const [branch, upstream] = names.split("...");
        status.branch = branch;
        status.upstream = upstream ?? null;
      }
      continue;
    }
    const x = p[0];
    const y = p[1];
    const path = p.slice(3);
    const f: GitFile = { path, x, y };
    if (x === "R" || x === "C") f.orig = parts[++i];
    status.files.push(f);
  }
  return status;
}

export interface Commit {
  hash: string;
  short: string;
  author: string;
  email: string;
  /** ISO 8601 */
  date: string;
  subject: string;
  refs: string[];
  parents: string[];
}

/** The `--format` that `parseLog` reads. */
export const LOG_FORMAT = "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1f%P%x1e";

export function parseLog(out: string): Commit[] {
  return out
    .split("\x1e")
    .map((r) => r.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((r) => {
      const [hash, short, author, email, date, subject, refs, parents] = r.split("\x1f");
      return {
        hash,
        short,
        author,
        email,
        date,
        subject,
        refs: refs ? refs.split(", ").map((x) => x.replace(/^HEAD -> /, "")).filter(Boolean) : [],
        parents: parents ? parents.trim().split(" ").filter(Boolean) : [],
      };
    });
}

export interface Branch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  /** "[ahead 1, behind 2]", "[gone]" or "" */
  track: string;
}

/** The `--format` that `parseBranches` reads, for `git for-each-ref refs/heads refs/remotes`. */
export const BRANCH_FORMAT = "--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)";

export function parseBranches(out: string): Branch[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, name, head, upstream, track] = line.split("\x1f");
      return { name, remote: ref.startsWith("refs/remotes/"), current: head === "*", upstream: upstream || null, track: track ?? "" };
    })
    .filter((b) => !(b.remote && b.name.endsWith("/HEAD")) && b.name !== "origin");
}

export interface ChangedFile {
  status: string;
  path: string;
  orig?: string;
}

/** `git diff-tree --name-status -z` */
export function parseNameStatus(out: string): ChangedFile[] {
  const parts = out.split("\0").filter((p, i, a) => p || i < a.length - 1);
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status) continue;
    if (status[0] === "R" || status[0] === "C") {
      files.push({ status: status[0], orig: parts[i + 1], path: parts[i + 2] });
      i += 2;
    } else {
      files.push({ status: status[0], path: parts[i + 1] });
      i += 1;
    }
  }
  return files;
}

/** The folder name `git clone` would make for a URL. */
export function cloneFolderName(url: string): string {
  const clean = url.trim().replace(/[\\/]+$/, "").replace(/\.git$/i, "");
  const last = clean.split(/[\\/:]/).pop() ?? "";
  return last.replace(/[<>:"|?*]/g, "") || "repository";
}

/** "3 minutes ago", "yesterday", "12 Mar" in the interface language. */
export function relativeTime(iso: string, now = Date.now(), locale?: string): string {
  const then = new Date(iso).getTime();
  const s = Math.round((then - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

// ----- Stashes, tags, blame, conflicts ------------------------------------------------------

export interface Stash {
  /** stash@{0} */
  ref: string;
  message: string;
  date: string;
}

export const STASH_FORMAT = "--format=%gd%x1f%gs%x1f%cI%x1e";

export function parseStashes(out: string): Stash[] {
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [ref, message, date] = r.split("\x1f");
      // "On main: my message" / "WIP on main: abc123 subject"
      return { ref, message: (message ?? "").replace(/^(WIP )?[Oo]n [^:]+: /, ""), date: date ?? "" };
    });
}

export interface Tag {
  name: string;
  /** The commit it points at. */
  commit: string;
  subject: string;
  date: string;
  annotated: boolean;
}

export const TAG_FORMAT = "--format=%(refname:short)%1f%(objecttype)%1f%(*objectname)%(objectname)%1f%(contents:subject)%1f%(creatordate:iso-strict)%1e";

export function parseTags(out: string): Tag[] {
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [name, type, ids, subject, date] = r.split("\x1f");
      // For an annotated tag "%(*objectname)%(objectname)" is the commit then the tag object.
      return { name, annotated: type === "tag", commit: (ids ?? "").slice(0, 40), subject: subject ?? "", date: date ?? "" };
    });
}

export interface BlameCommit {
  hash: string;
  author: string;
  /** Seconds since 1970. */
  time: number;
  summary: string;
  /** Not committed yet (lines changed in the editor or the working tree). */
  uncommitted: boolean;
}

/** Reads `git blame --porcelain`: the commit of every line, in order. */
export function parseBlame(out: string): { lines: string[]; commits: Map<string, BlameCommit> } {
  const commits = new Map<string, BlameCommit>();
  const lines: string[] = [];
  let current: BlameCommit | null = null;
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("\t")) {
      if (current) lines.push(current.hash);
      continue;
    }
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
    if (head) {
      const hash = head[1];
      current = commits.get(hash) ?? { hash, author: "", time: 0, summary: "", uncommitted: /^0+$/.test(hash) };
      commits.set(hash, current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("author ")) current.author = line.slice(7);
    else if (line.startsWith("author-time ")) current.time = Number(line.slice(12));
    else if (line.startsWith("summary ")) current.summary = line.slice(8);
  }
  return { lines, commits };
}

export interface ConflictBlock {
  /** Line numbers (1-based) of the markers; `base` only with diff3/zdiff3 style. */
  start: number;
  base: number | null;
  middle: number;
  end: number;
  /** What the markers name: "HEAD", "feature", "abc123 (message)". */
  current: string;
  incoming: string;
}

/** The conflict blocks git left in a file's text. */
export function parseConflicts(text: string): ConflictBlock[] {
  const out: ConflictBlock[] = [];
  const lines = text.split("\n");
  let open: Partial<ConflictBlock> | null = null;
  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, "");
    const n = i + 1;
    if (/^<{7}(\s|$)/.test(l)) open = { start: n, base: null, current: l.slice(7).trim() };
    else if (open && open.middle === undefined && /^\|{7}(\s|$)/.test(l)) open.base = n;
    else if (open && open.middle === undefined && /^={7}$/.test(l)) open.middle = n;
    else if (open && open.middle !== undefined && /^>{7}(\s|$)/.test(l)) {
      out.push({ ...(open as ConflictBlock), end: n, incoming: l.slice(7).trim() });
      open = null;
    }
  });
  return out;
}

/** A conflict block's text with one side chosen ("both": current, then incoming). */
export function resolveConflict(lines: string[], b: ConflictBlock, take: "current" | "incoming" | "both"): string[] {
  const current = lines.slice(b.start, (b.base ?? b.middle) - 1);
  const incoming = lines.slice(b.middle, b.end - 1);
  return take === "current" ? current : take === "incoming" ? incoming : [...current, ...incoming];
}
