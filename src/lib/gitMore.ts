/*
 * Git beyond committing: merging and rebasing (with going on or giving up
 * after conflicts), resolving conflicts a whole file at a time, stashes,
 * tags and blame. Like the rest, it all goes through the git command line.
 */
import { openDialog, openMenu, toast } from "./store";
import { api, errorText } from "./api";
import { t } from "./i18n";
import { absPath, branches, git, loadTags, op, push as pushBranch, relPath, useGit, type Stash, type Tag } from "./git";
import { parseBlame, parseConflicts, parseNameStatus, type BlameCommit } from "./gitParse";
import { getDoc } from "../editor/docs";
import { openCommitDiff } from "./diffTabs";

const getG = useGit.getState;

const OP_NAME = { merge: "merge", rebase: "rebase", "cherry-pick": "cherry-pick", revert: "revert" } as const;

/** After a merge or rebase stopped: what to tell. */
function afterConflict(title: string) {
  const conflicts = getG().status?.files.filter((f) => f.x === "U" || f.y === "U" || (f.x === "A" && f.y === "A") || (f.x === "D" && f.y === "D")).length ?? 0;
  if (conflicts) toast("warning", title, t("Resolve the files marked ! (choose a side in the editor), stage them, then continue."));
}

async function pickBranch(anchor: HTMLElement | undefined, title: string, onPick: (name: string) => void) {
  const list = await branches();
  const current = list.find((b) => b.current)?.name;
  const items = list.filter((b) => b.name !== current && !b.name.endsWith("/HEAD")).map((b) => ({ label: b.name, onSelect: () => onPick(b.name) }));
  openMenu({
    ...(anchor ? { anchor } : { x: window.innerWidth / 2 - 120, y: 120 }),
    items: [{ type: "heading", label: title }, ...(items.length ? items : [{ label: t("No other branches"), disabled: true, onSelect: () => {} }])],
  });
}

export function mergeBranch(anchor?: HTMLElement) {
  const into = getG().status?.branch ?? "HEAD";
  void pickBranch(anchor, t("Merge into {0}", into), (name) =>
    void op(
      "merge",
      async () => {
        await git(["merge", "--no-edit", name], { ok: [1] });
      },
      t("The merge didn't happen"),
    ).then(() => {
      if (getG().operation?.kind === "merge") afterConflict(t("The merge stopped with conflicts"));
      else toast("success", t("Merged {0} into {1}", name, into));
    }),
  );
}

export function rebaseOnto(anchor?: HTMLElement) {
  const branch = getG().status?.branch ?? "HEAD";
  void pickBranch(anchor, t("Rebase {0} onto", branch), (name) =>
    openDialog({
      kind: "confirm",
      title: t("Rebase {0} onto {1}?", branch, name),
      body: t("Your commits since the branches split are made again on top of {0}. They get new ids; don't rebase commits you have already pushed and shared.", name),
      confirmLabel: t("Rebase"),
      onConfirm: () =>
        void op("rebase", () => git(["rebase", name], { ok: [1] }), t("The rebase didn't happen")).then(() => {
          if (getG().operation?.kind === "rebase") afterConflict(t("The rebase stopped with conflicts"));
          else toast("success", t("Rebased {0} onto {1}", branch, name));
        }),
    }),
  );
}

/** Goes on with the stopped merge, rebase, cherry-pick or revert once the conflicts are resolved and staged. */
export async function continueOperation() {
  const o = getG().operation;
  if (!o) return;
  const files = getG().status?.files ?? [];
  if (files.some((f) => f.x === "U" || f.y === "U")) {
    toast("error", t("Resolve the conflicts first"), t("Files marked ! still have conflicts. Fix them, then stage them."));
    return;
  }
  // No editor opens: the message git suggests is kept.
  const args = o.kind === "merge" ? ["commit", "--no-edit"] : ["-c", "core.editor=true", OP_NAME[o.kind], "--continue"];
  const ok = await op(o.kind, () => git(args, { ok: o.kind === "rebase" ? [1] : [] }), t("It couldn't continue"));
  if (!ok) return;
  if (getG().operation) afterConflict(o.kind === "rebase" ? t("The rebase stopped with conflicts") : t("It stopped with conflicts again"));
  else toast("success", o.kind === "merge" ? t("Merge committed") : o.kind === "rebase" ? t("Rebase finished") : t("Done"));
}

export function abortOperation() {
  const o = getG().operation;
  if (!o) return;
  openDialog({
    kind: "confirm",
    title: o.kind === "merge" ? t("Abort the merge?") : o.kind === "rebase" ? t("Abort the rebase?") : t("Abort?"),
    body: t("Everything goes back to how it was before it started; conflict resolutions so far are lost."),
    confirmLabel: t("Abort"),
    danger: true,
    onConfirm: () => void op(o.kind, () => git([OP_NAME[o.kind], "--abort"]), t("It wasn't aborted")),
  });
}

export function skipRebaseCommit() {
  return op("rebase", () => git(["-c", "core.editor=true", "rebase", "--skip"], { ok: [1] }), t("The commit wasn't skipped"));
}

/** Takes one side of every conflict in a file and stages it. */
export function acceptSide(rel: string, side: "current" | "incoming") {
  return op(
    "resolve",
    async () => {
      await git(["checkout", side === "current" ? "--ours" : "--theirs", "--", rel]);
      await git(["add", "--", rel]);
      // An open editor shows the chosen text.
      const doc = getDoc(absPath(rel));
      if (doc) {
        const f = await api.readText(absPath(rel));
        const { changeDoc } = await import("./actions");
        changeDoc(absPath(rel), [{ from: 0, to: doc.state.doc.length, insert: f.text }]);
        doc.saved = doc.state.doc;
      }
    },
    t("The conflict wasn't resolved"),
  );
}

/** Stages a conflicted file as resolved, after checking that no markers are left in it. */
export async function markResolved(rel: string) {
  const abs = absPath(rel);
  const text = getDoc(abs)?.state.doc.toString() ?? (await api.readText(abs).catch(() => ({ text: "" }))).text;
  const left = parseConflicts(text).length;
  const go = async () => {
    const doc = getDoc(abs);
    if (doc && doc.state.doc !== doc.saved) {
      const { saveDoc } = await import("./actions");
      await saveDoc(abs);
    }
    await op("resolve", () => git(["add", "--", rel]), t("The file wasn't staged"));
  };
  if (!left) return go();
  openDialog({
    kind: "confirm",
    title: t("Conflict markers are left"),
    body: t("{0} still has {1} conflict blocks (<<<<<<< … >>>>>>>). Stage it anyway?", rel, left),
    confirmLabel: t("Stage anyway"),
    onConfirm: go,
  });
}

// ----- Stashes ------------------------------------------------------------------------------

export function stashChanges() {
  if (!getG().status?.files.length) {
    toast("info", t("Nothing to stash"), t("There are no changes since the last commit."));
    return;
  }
  openDialog({
    kind: "prompt",
    title: t("Stash changes"),
    label: t("Message (optional)"),
    value: "",
    confirmLabel: t("Stash"),
    onSubmit: async (message) => {
      const ok = await op("stash", () => git(["stash", "push", "--include-untracked", ...(message.trim() ? ["-m", message.trim()] : [])]), t("The changes weren't stashed"));
      if (ok) toast("success", t("Changes stashed"), t("The working tree is clean; apply the stash to get them back."));
    },
  });
}

export async function applyStash(s: Stash, pop: boolean) {
  const ok = await op("stash", () => git(["stash", pop ? "pop" : "apply", s.ref], { ok: [1] }), t("The stash wasn't applied"));
  if (ok) {
    if (getG().status?.files.some((f) => f.x === "U" || f.y === "U")) afterConflict(t("Applying the stash left conflicts"));
    else toast("success", pop ? t("Stash applied and dropped") : t("Stash applied"), s.message);
  }
}

export function dropStash(s: Stash) {
  openDialog({
    kind: "confirm",
    title: t("Drop this stash?"),
    body: t("“{0}” is deleted; its changes can't be applied any more.", s.message),
    confirmLabel: t("Drop"),
    danger: true,
    onConfirm: () => void op("stash", () => git(["stash", "drop", s.ref]), t("The stash wasn't dropped")),
  });
}

/** The files a stash changes, opened as diffs against the commit it was made on. */
export async function stashFiles(s: Stash) {
  const out = await git(["stash", "show", "--name-status", "-z", s.ref]).catch(() => "");
  return parseNameStatus(out);
}

export function openStashDiff(s: Stash, f: { path: string; status: string; orig?: string }) {
  openCommitDiff({ hash: s.ref, short: s.ref, author: "", email: "", date: s.date, subject: s.message, refs: [], parents: [`${s.ref}^1`] }, f as never);
}

// ----- Tags ---------------------------------------------------------------------------------

const TAG_NAME = /^(?!-)(?!.*\.\.)(?!.*[\s~^:?*[\\])(?!.*\.lock$)(?!.*\/$)[^\x00-\x1f\x7f]+$/;

/** Tags HEAD (or a commit); with a message it is an annotated tag. */
export function createTag(commit?: string) {
  openDialog({
    kind: "prompt",
    title: commit ? t("Tag commit {0}", commit.slice(0, 7)) : t("New tag"),
    label: t("Name, and after a space an optional message (v1.0 First release)"),
    value: "",
    confirmLabel: t("Create tag"),
    validate: (v) => {
      const name = v.trim().split(/\s+/)[0] ?? "";
      if (!name) return t("Enter a name.");
      return TAG_NAME.test(name) ? null : t("Tag names can't contain spaces or ~ ^ : ? * [ \\ and can't end with / or .lock.");
    },
    onSubmit: async (v) => {
      const [name, ...rest] = v.trim().split(/\s+/);
      const message = rest.join(" ");
      const ok = await op("tag", () => git(["tag", ...(message ? ["-a", "-m", message] : []), name, ...(commit ? [commit] : [])]), t("The tag wasn't created"));
      if (ok) {
        await loadTags();
        toast("success", t("Tagged {0}", name), t("Push it to share it: Git → Push tags."));
      }
    },
  });
}

export function deleteTag(tag: Tag) {
  openDialog({
    kind: "confirm",
    title: t("Delete tag {0}?", tag.name),
    body: t("The tag is deleted here. If you pushed it, it stays on the remote until you delete it there too."),
    confirmLabel: t("Delete"),
    danger: true,
    secondaryLabel: t("Delete here and on origin"),
    onConfirm: () => void op("tag", () => git(["tag", "-d", tag.name]), t("The tag wasn't deleted")).then(loadTags),
    onSecondary: () =>
      void op(
        "tag",
        async () => {
          await git(["tag", "-d", tag.name]);
          await git(["push", "origin", "--delete", `refs/tags/${tag.name}`]);
        },
        t("The tag wasn't deleted"),
      ).then(loadTags),
  });
}

export async function pushTags() {
  const remotes = (await git(["remote"]).catch(() => "")).split("\n").filter(Boolean);
  if (!remotes.length) return pushBranch();
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  const ok = await op("push", () => git(["push", remote, "--tags"]), t("The tags weren't pushed"));
  if (ok) toast("success", t("Tags pushed to {0}", remote));
}

// ----- Blame --------------------------------------------------------------------------------

export interface Blame {
  /** The commit of each line, 0-based by line. */
  lines: (BlameCommit | null)[];
}

/** Who last changed each line, for the editor's text as it is now (unsaved lines are "not committed"). */
export async function blame(abs: string, text: string): Promise<Blame | null> {
  const rel = relPath(abs);
  if (!rel || !getG().head) return null;
  try {
    const out = await git(["blame", "--porcelain", "--contents", "-", "--", rel], { input: text });
    const b = parseBlame(out);
    return { lines: b.lines.map((h) => b.commits.get(h) ?? null) };
  } catch (e) {
    const msg = errorText(e);
    // A file git doesn't know yet has no history to show.
    if (/no such path|not in|does not exist/i.test(msg)) return { lines: text.split("\n").map(() => null) };
    throw e;
  }
}
