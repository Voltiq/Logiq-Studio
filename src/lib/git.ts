/*
 * Git for the open folder: its status (for the explorer, the editor gutter
 * and the source control view), staging, committing, branches, history and
 * syncing with a remote. Everything goes through the `git` command line.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, errorText } from "./api";
import { closeDialog, get as getApp, openDialog, toast, useStore } from "./store";
import { basename, join, samePath } from "./paths";
import { t } from "./i18n";
import { BRANCH_FORMAT, isConflict, isStaged, isUnstaged, kindOf, LOG_FORMAT, parseBranches, parseLog, parseNameStatus, parseStatus, type Branch, type ChangedFile, type Commit, type GitFile, type GitKind, type GitStatus } from "./gitParse";

export interface GitInfo {
  version: string;
  name: string;
  email: string;
}

interface GitState {
  /** Git's version, null while unknown, false when git isn't installed. */
  info: GitInfo | null | false;
  /** The repository's top folder (Windows separators), or null when the folder isn't in one. */
  repo: string | null;
  status: GitStatus | null;
  /** Kind of change by lower-cased absolute path; folders get the strongest kind inside them. */
  kinds: Map<string, GitKind>;
  head: string | null;
  log: Commit[];
  /** The commit message being written. */
  message: string;
  /** What's running: "commit", "push"… */
  busy: string | null;
  /** Bumped whenever the status was read again (the editor gutters follow it). */
  version: number;
}

export const useGit = create<GitState>(() => ({ info: null, repo: null, status: null, kinds: new Map(), head: null, log: [], message: "", busy: null, version: 0 }));
const setG = useGit.setState;
const getG = useGit.getState;

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs git in the repository (or `cwd`); throws git's message when it fails. */
export async function git(args: string[], opts: { cwd?: string; input?: string; ok?: number[] } = {}): Promise<string> {
  const cwd = opts.cwd ?? getG().repo ?? getApp().root ?? "";
  const r = await invoke<Result>("git_exec", { cwd, args, input: opts.input ?? null });
  if (r.code !== 0 && !(opts.ok ?? []).includes(r.code)) throw new Error(cleanError(r.stderr || r.stdout) || t("Git stopped with code {0}.", r.code));
  return r.stdout;
}

function cleanError(text: string) {
  return text
    .split("\n")
    .map((l) => l.replace(/^(fatal|error|hint): ?/, "").trim())
    .filter((l) => l && !/^Use '--force'|^\(use "/.test(l))
    .slice(0, 6)
    .join("\n");
}

const winPath = (p: string) => p.replace(/\//g, "\\");
/** An absolute path for a path relative to the repository. */
export const absPath = (rel: string) => join(getG().repo ?? "", winPath(rel));
/** The repository-relative path (forward slashes) of an absolute path. */
export function relPath(abs: string): string | null {
  const repo = getG().repo;
  if (!repo) return null;
  const a = abs.replace(/\//g, "\\");
  if (!a.toLowerCase().startsWith(repo.toLowerCase() + "\\")) return null;
  return a.slice(repo.length + 1).replace(/\\/g, "/");
}

// ----- Status ----------------------------------------------------------------------------

const RANK: Record<GitKind, number> = { ignored: 0, renamed: 1, modified: 2, added: 3, untracked: 3, deleted: 4, conflict: 5 };

function kindsFor(repo: string, files: GitFile[]): Map<string, GitKind> {
  const kinds = new Map<string, GitKind>();
  for (const f of files) {
    const k = kindOf(f);
    const abs = join(repo, winPath(f.path)).toLowerCase();
    kinds.set(abs, k);
    if (k === "ignored") continue;
    // Folders show what's inside them.
    let dir = abs;
    while ((dir = dir.slice(0, Math.max(0, dir.lastIndexOf("\\")))).length > repo.length) {
      const was = kinds.get(dir);
      if (was && RANK[was] >= RANK[k]) break;
      kinds.set(dir, k === "untracked" || k === "added" ? "added" : k === "deleted" || k === "conflict" ? k : "modified");
    }
  }
  return kinds;
}

let refreshTimer = 0;
let refreshing: Promise<void> | null = null;
let again = false;

/** Reads the status again, soon (several calls in a row read it once). */
export function refreshGit(delay = 250) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refreshNow(), delay);
}

export async function refreshNow(): Promise<void> {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      await readStatus();
    } finally {
      refreshing = null;
      if (again) {
        again = false;
        void refreshNow();
      }
    }
  })();
  return refreshing;
}

async function readStatus() {
  const root = getApp().root;
  if (!root || getG().info === false) {
    setG({ repo: null, status: null, kinds: new Map(), head: null, log: [] });
    return;
  }
  let repo = getG().repo;
  if (!repo || !samePath(root, repo) && !root.toLowerCase().startsWith(repo.toLowerCase() + "\\")) {
    const top = await git(["rev-parse", "--show-toplevel"], { cwd: root }).catch(() => null);
    repo = top ? winPath(top.trim()) : null;
  }
  if (!repo) {
    setG({ repo: null, status: null, kinds: new Map(), head: null, log: [] });
    return;
  }
  try {
    const out = await git(["status", "--porcelain=v1", "-b", "-z", "-uall", "--ignored=matching"], { cwd: repo });
    const status = parseStatus(out);
    // Ignored files only dim the explorer; they aren't changes.
    const changes = status.files.filter((f) => f.x !== "!");
    const head = status.unborn ? null : (await git(["rev-parse", "HEAD"], { cwd: repo }).catch(() => "")).trim() || null;
    const headChanged = head !== getG().head;
    setG((s) => ({ repo, status: { ...status, files: changes }, kinds: kindsFor(repo!, status.files), head, version: s.version + 1 }));
    if (headChanged || !getG().log.length) void loadLog();
  } catch {
    setG({ repo: null, status: null, kinds: new Map(), head: null });
  }
}

export async function loadLog(limit = 200) {
  if (!getG().repo || getG().status?.unborn) {
    setG({ log: [] });
    return;
  }
  const out = await git(["log", "-n", String(limit), LOG_FORMAT]).catch(() => "");
  setG({ log: parseLog(out) });
}

/** The kind of change of a file or folder, for the explorer. */
export function gitKindOf(path: string): GitKind | undefined {
  return getG().kinds.get(path.toLowerCase());
}

export function stagedFiles(): GitFile[] {
  return getG().status?.files.filter(isStaged) ?? [];
}

export function unstagedFiles(): GitFile[] {
  return getG().status?.files.filter(isUnstaged) ?? [];
}

// ----- Base text for the gutter and diffs ---------------------------------------------------

const baseCache = new Map<string, Promise<string | null>>();

/** A file's text in the last commit, or null when it isn't committed (or not in a repository). */
export function headText(abs: string): Promise<string | null> {
  const rel = relPath(abs);
  const head = getG().head;
  if (!rel || !head) return Promise.resolve(null);
  const key = `${head}:${rel}`;
  let p = baseCache.get(key);
  if (!p) {
    p = invoke<string | null>("git_show_file", { cwd: getG().repo, spec: `HEAD:${rel}` }).then((x) => (x === null ? null : x.replace(/\r\n/g, "\n")));
    baseCache.set(key, p);
    if (baseCache.size > 200) baseCache.delete(baseCache.keys().next().value!);
  }
  return p;
}

export function showFile(spec: string): Promise<string | null> {
  return invoke<string | null>("git_show_file", { cwd: getG().repo, spec }).then((x) => (x === null ? null : x.replace(/\r\n/g, "\n")));
}

// ----- Changing things ----------------------------------------------------------------------

async function op(name: string, f: () => Promise<unknown>, failTitle: string): Promise<boolean> {
  setG({ busy: name });
  try {
    await f();
    return true;
  } catch (e) {
    toast("error", failTitle, errorText(e));
    return false;
  } finally {
    setG({ busy: null });
    await refreshNow();
  }
}

export function stage(paths: string[]) {
  return op("stage", () => git(["add", "-A", "--", ...paths]), t("The changes weren't staged"));
}

export function unstage(paths: string[]) {
  const unborn = getG().status?.unborn;
  return op("unstage", () => (unborn ? git(["rm", "--cached", "-r", "-q", "--", ...paths]) : git(["restore", "--staged", "--", ...paths])), t("The changes weren't unstaged"));
}

/** Throws away changes in the working tree, after asking. New files go to the Recycle Bin. */
export function discard(files: GitFile[]) {
  if (!files.length) return;
  const untracked = files.filter((f) => f.x === "?");
  const tracked = files.filter((f) => f.x !== "?");
  const one = files.length === 1 ? basename(files[0].path) : null;
  openDialog({
    kind: "confirm",
    title: one ? t("Discard the changes to {0}?", one) : t("Discard the changes to {0} files?", files.length),
    body: untracked.length
      ? t("Changed files go back to their last committed or staged state; new files go to the Recycle Bin.")
      : t("The files go back to their last committed or staged state. This can't be undone."),
    confirmLabel: t("Discard"),
    danger: true,
    onConfirm: async () => {
      await op(
        "discard",
        async () => {
          if (tracked.length) await git(["restore", "--worktree", "--", ...tracked.map((f) => f.path)]);
          for (const f of untracked) await api.delete(absPath(f.path));
        },
        t("The changes weren't discarded"),
      );
    },
  });
}

/** Asks for the name and e-mail git puts on commits, and saves them for every repository. */
export function askIdentity(then?: () => void) {
  const info = getG().info || { name: "", email: "", version: "" };
  openDialog({
    kind: "prompt",
    title: t("Who are you?"),
    label: t("Your name, as it appears on your commits"),
    value: info.name,
    confirmLabel: t("Next"),
    validate: (v) => (v ? null : t("Enter a name.")),
    onSubmit: (name) => {
      window.setTimeout(
        () =>
          openDialog({
            kind: "prompt",
            title: t("Who are you?"),
            label: t("Your e-mail address, as it appears on your commits"),
            value: info.email,
            confirmLabel: t("Save"),
            validate: (v) => (/^\S+@\S+$/.test(v) ? null : t("Enter an e-mail address.")),
            onSubmit: async (email) => {
              await git(["config", "--global", "user.name", name]);
              await git(["config", "--global", "user.email", email]);
              setG({ info: { ...(getG().info || { version: "" }), name, email } as GitInfo });
              closeDialog();
              then?.();
            },
          }),
        0,
      );
    },
  });
}

/** Commits the staged changes; with nothing staged, offers to commit every change. */
export async function commit(opts: { amend?: boolean } = {}): Promise<void> {
  const message = getG().message.trim();
  if (!message && !opts.amend) {
    toast("warning", t("Write a commit message first"), t("One line that says what the change does, like “Add a Circle class”."));
    return;
  }
  const staged = stagedFiles();
  const all = getG().status?.files ?? [];
  if (all.some(isConflict)) {
    toast("error", t("Resolve the conflicts first"), t("Files marked ! still have conflict markers. Fix them, then stage them."));
    return;
  }
  const run = async (stageAll: boolean) => {
    const ok = await op(
      "commit",
      async () => {
        if (stageAll) await git(["add", "-A"]);
        const args = ["commit", "-F", "-"];
        if (opts.amend) args.push("--amend");
        if (opts.amend && !message) args.splice(1, 2, "--no-edit");
        await git(args, { input: message ? message + "\n" : undefined });
      },
      t("The commit wasn't made"),
    );
    if (ok) {
      setG({ message: "" });
      toast("success", opts.amend ? t("Last commit changed") : t("Committed"), message.split("\n")[0]);
    }
  };
  if (!getG().info || !(getG().info as GitInfo).name || !(getG().info as GitInfo).email) {
    const local = await git(["config", "user.email"]).catch(() => "");
    if (!local.trim()) {
      askIdentity(() => void commit(opts));
      return;
    }
  }
  if (!staged.length && !opts.amend) {
    if (!all.length) {
      toast("info", t("Nothing to commit"), t("There are no changes since the last commit."));
      return;
    }
    openDialog({
      kind: "confirm",
      title: t("Commit every change?"),
      body: t("No changes are staged. Stage all {0} changed files and commit them?", all.length),
      confirmLabel: t("Stage all and commit"),
      onConfirm: () => run(true),
    });
    return;
  }
  await run(false);
}

export async function initRepo() {
  const root = getApp().root;
  if (!root) return;
  const ok = await op("init", () => git(["init"], { cwd: root }), t("The repository wasn't created"));
  if (ok) {
    setG({ repo: root });
    toast("success", t("Repository created"), t("Stage your files and make the first commit."));
  }
}

// ----- Branches -----------------------------------------------------------------------------

export async function branches(): Promise<Branch[]> {
  return parseBranches(await git(["for-each-ref", BRANCH_FORMAT, "refs/heads", "refs/remotes"]).catch(() => ""));
}

export function switchBranch(name: string, remote = false) {
  // A remote branch is checked out as a local one that tracks it.
  const local = remote ? name.replace(/^[^/]+\//, "") : name;
  return op("switch", () => git(remote ? ["switch", "--track", "-c", local, name] : ["switch", local]), t("The branch wasn't switched"));
}

export function newBranch() {
  openDialog({
    kind: "prompt",
    title: t("New branch"),
    label: t("Name"),
    value: "",
    confirmLabel: t("Create and switch"),
    validate: (v) => (!v ? t("Enter a name.") : /[\s~^:?*[\\]|\.\.|@\{|\/$|\.lock$|^-/.test(v) ? t("Branch names can't contain spaces or ~ ^ : ? * [ \\ and can't end with / or .lock.") : null),
    onSubmit: async (name) => {
      await git(["switch", "-c", name]);
      await refreshNow();
      toast("success", t("Switched to {0}", name));
    },
  });
}

// ----- Remotes ------------------------------------------------------------------------------

let jobId = 1;
let jobsListening: Promise<void> | null = null;
const jobs = new Map<number, { lines: string[]; onLine?: (line: string) => void; done: (code: number) => void }>();

function listenJobs() {
  jobsListening ??= (async () => {
    await listen<{ id: number; line: string }>("git-progress", (e) => {
      const j = jobs.get(e.payload.id);
      if (!j) return;
      j.lines.push(e.payload.line);
      j.onLine?.(e.payload.line);
    });
    await listen<{ id: number; code: number }>("git-done", (e) => {
      jobs.get(e.payload.id)?.done(e.payload.code);
      jobs.delete(e.payload.id);
    });
  })();
  return jobsListening;
}

/** Runs a long git command with progress lines; resolves with its exit code and output. */
export async function gitStream(args: string[], opts: { cwd?: string; onLine?: (line: string) => void; onStart?: (id: number) => void } = {}): Promise<{ code: number; lines: string[]; id: number }> {
  await listenJobs();
  const id = jobId++;
  opts.onStart?.(id);
  return new Promise((resolve, reject) => {
    const job = { lines: [] as string[], onLine: opts.onLine, done: (code: number) => resolve({ code, lines: job.lines, id }) };
    jobs.set(id, job);
    invoke("git_stream", { id, cwd: opts.cwd ?? getG().repo ?? getApp().root ?? "", args }).catch((e) => {
      jobs.delete(id);
      reject(e);
    });
  });
}

export function cancelJob(id: number) {
  void invoke("git_cancel", { id }).catch(() => {});
}

function lastError(lines: string[]) {
  const useful = lines.filter((l) => !/^(remote: )?(Counting|Compressing|Receiving|Resolving|Writing|Enumerating|Total|Unpacking)/.test(l));
  return cleanError(useful.slice(-8).join("\n"));
}

async function remotes(): Promise<string[]> {
  return (await git(["remote"]).catch(() => "")).split("\n").filter(Boolean);
}

/** Asks for a remote's URL and adds it as origin. */
export function addRemote(then?: () => void) {
  openDialog({
    kind: "prompt",
    title: t("Add a remote"),
    label: t("Repository URL (for example https://github.com/you/project.git)"),
    value: "",
    confirmLabel: t("Add"),
    validate: (v) => (/^(https?:\/\/|git@|ssh:\/\/|file:\/\/|[A-Za-z]:\\)/.test(v) ? null : t("That doesn't look like a repository URL.")),
    onSubmit: async (url) => {
      await git(["remote", "add", "origin", url]);
      toast("success", t("Remote added"), url);
      closeDialog();
      then?.();
    },
  });
}

async function remoteOp(name: "push" | "pull" | "fetch", args: string[], failTitle: string, success?: string): Promise<boolean> {
  setG({ busy: name });
  try {
    const r = await gitStream(args);
    if (r.code !== 0) {
      const msg = lastError(r.lines);
      toast("error", failTitle, msg || t("Git stopped with code {0}.", r.code));
      return false;
    }
    if (success) toast("success", success);
    return true;
  } catch (e) {
    toast("error", failTitle, errorText(e));
    return false;
  } finally {
    setG({ busy: null });
    await refreshNow();
  }
}

export async function push(): Promise<boolean> {
  const s = getG().status;
  if (!s?.branch) return false;
  if (!(await remotes()).length) {
    addRemote(() => void push());
    return false;
  }
  if (s.unborn) {
    toast("warning", t("Nothing to push yet"), t("Make the first commit, then push it."));
    return false;
  }
  const args = s.upstream ? ["push", "--progress"] : ["push", "--progress", "-u", "origin", s.branch];
  return remoteOp("push", args, t("The push failed"), t("Pushed to {0}", s.upstream ?? `origin/${s.branch}`));
}

export async function pull(): Promise<boolean> {
  const s = getG().status;
  if (!s?.upstream) {
    toast("info", t("This branch doesn't track a remote branch"), t("Push it once, then it can pull."));
    return false;
  }
  // Open files that change follow by themselves (the folder is watched).
  return remoteOp("pull", ["pull", "--progress"], t("The pull failed"));
}

export function fetchAll() {
  return remoteOp("fetch", ["fetch", "--all", "--prune", "--progress"], t("Fetching failed"), t("Fetched"));
}

/** Pull, then push: what the sync button does. */
export async function sync() {
  const s = getG().status;
  if (s?.upstream && s.behind > 0 && !(await pull())) return;
  if (!s?.upstream || (getG().status?.ahead ?? 0) > 0) await push();
}

// ----- History ------------------------------------------------------------------------------

/** The files a commit changed (against its first parent). */
export async function commitFiles(hash: string): Promise<ChangedFile[]> {
  return parseNameStatus(await git(["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "-m", "--first-parent", "--root", hash]));
}

export async function fileLog(abs: string, limit = 100): Promise<Commit[]> {
  const rel = relPath(abs);
  if (!rel) return [];
  return parseLog(await git(["log", "-n", String(limit), "--follow", LOG_FORMAT, "--", rel]).catch(() => ""));
}

// ----- Clone --------------------------------------------------------------------------------

/** Clones `url` into `dir` (which must not exist yet) and reports progress. */
export async function clone(url: string, dir: string, onLine: (line: string) => void, onStart?: (id: number) => void): Promise<{ ok: boolean; message: string; id: number }> {
  const parent = dir.slice(0, dir.lastIndexOf("\\"));
  const r = await gitStream(["clone", "--progress", url, dir], { cwd: parent, onLine, onStart });
  return { ok: r.code === 0, message: r.code === 0 ? "" : lastError(r.lines), id: r.id };
}

// ----- Keeping up -------------------------------------------------------------------------------

export async function initGit() {
  const info = await invoke<GitInfo | null>("git_info").catch(() => null);
  setG({ info: info ?? false });
  // The folder that's open, changes on disk, and coming back to the window.
  let lastRoot: string | null = null;
  useStore.subscribe((s) => {
    if (s.root !== lastRoot) {
      lastRoot = s.root;
      setG({ repo: null, status: null, kinds: new Map(), head: null, log: [], message: "" });
      if (s.root) void refreshNow();
    }
  });
  lastRoot = getApp().root;
  if (lastRoot) void refreshNow();
  const { events } = await import("./api");
  await events.onFsChanged(() => refreshGit(400));
  window.addEventListener("focus", () => refreshGit(50));
  // Commits made in a terminal change only .git, which the watcher leaves out.
  window.setInterval(() => {
    if (document.visibilityState === "visible" && getG().repo && !getG().busy) refreshGit(0);
  }, 5000);
}

export { kindOf, isStaged, isUnstaged, isConflict };
export type { GitFile, GitKind, Commit, Branch, ChangedFile };
