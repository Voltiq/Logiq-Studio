import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  FileCode,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  History,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Undo2,
  Upload,
  Archive,
  ArchiveRestore,
  GitMerge,
  Columns2,
  Tag as TagIcon,
  Trash2,
  TriangleAlert,
  Play,
  SkipForward,
  X,
} from "lucide-react";
import { openMenu, useStore } from "../lib/store";
import { openFile } from "../lib/actions";
import { basename } from "../lib/paths";
import { Button, IconButton } from "./ui/Button";
import { EmptyState } from "./ui/Feedback";
import { FileIcon } from "./FileIcon";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";
import type { MenuItem } from "./ui/Menu";
import {
  absPath,
  addRemote,
  branches,
  commit,
  commitFiles,
  discard,
  fetchAll,
  initRepo,
  isConflict,
  isStaged,
  isUnstaged,
  kindOf,
  newBranch,
  pull,
  push,
  refreshNow,
  stage,
  switchBranch,
  sync,
  unstage,
  useGit,
  type ChangedFile,
  type Commit,
  type GitFile,
} from "../lib/git";
import { letterOf, relativeTime } from "../lib/gitParse";
import { openCommitDiff, openConflictDiff, openWorkingDiff } from "../lib/diffTabs";
import {
  abortOperation,
  acceptSide,
  applyStash,
  continueOperation,
  createTag,
  deleteTag,
  dropStash,
  markResolved,
  mergeBranch,
  openStashDiff,
  pushTags,
  rebaseOnto,
  skipRebaseCommit,
  stashChanges,
  stashFiles,
} from "../lib/gitMore";
import type { Stash, Tag } from "../lib/git";

/** The branch menu: switch to a branch, or make a new one. */
export async function branchMenu(anchor: HTMLElement) {
  const list = await branches();
  const local = list.filter((b) => !b.remote);
  const remote = list.filter((b) => b.remote && !local.some((l) => l.upstream === b.name));
  const busy = !!useGit.getState().operation;
  const items: MenuItem[] = [
    { label: t("New branch…"), icon: Plus, onSelect: newBranch },
    { label: t("Merge a branch into this one…"), icon: GitMerge, disabled: busy, onSelect: () => mergeBranch(anchor) },
    { label: t("Rebase this branch onto…"), disabled: busy, onSelect: () => rebaseOnto(anchor) },
    { type: "separator" },
    { type: "heading", label: t("Branches") },
    ...local.map((b) => ({ label: b.name, checked: b.current, onSelect: () => !b.current && void switchBranch(b.name) })),
  ];
  if (remote.length) items.push({ type: "heading", label: t("Remote branches") }, ...remote.map((b) => ({ label: b.name, icon: Cloud, onSelect: () => void switchBranch(b.name, true) })));
  openMenu({ anchor, items });
}

function FileRow({ f, staged }: { f: GitFile; staged: boolean }) {
  const kind = kindOf(f);
  const abs = absPath(f.path);
  const name = basename(f.path);
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
  const deleted = (staged ? f.x : f.y) === "D";
  return (
    <div
      className="scm-file"
      role="listitem"
      onClick={() => void (deleted ? undefined : openWorkingDiff(abs, staged))}
      onDoubleClick={() => !deleted && void openFile(abs)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: t("Open changes"), icon: GitPullRequestArrow, disabled: deleted, onSelect: () => void openWorkingDiff(abs, staged) },
            { label: t("Open file"), icon: FileCode, disabled: deleted, onSelect: () => void openFile(abs) },
            { type: "separator" },
            staged ? { label: t("Unstage"), icon: Minus, onSelect: () => void unstage([f.path]) } : { label: t("Stage"), icon: Plus, onSelect: () => void stage([f.path]) },
            ...(!staged ? [{ label: t("Discard changes…"), icon: Undo2, danger: true, onSelect: () => discard([f]) }] : []),
          ],
        });
      }}
      data-tooltip={f.orig ? `${f.orig} → ${f.path}` : f.path}
    >
      <FileIcon name={name} />
      <span className={cx("scm-file-name", deleted && "is-deleted")}>{name}</span>
      <span className="scm-file-dir">{dir}</span>
      <span className="scm-file-actions">
        {!staged && !isConflict(f) && <IconButton icon={Undo2} label={t("Discard changes…")} spacing="compact" onClick={(e) => (e.stopPropagation(), discard([f]))} />}
        {staged ? (
          <IconButton icon={Minus} label={t("Unstage")} spacing="compact" onClick={(e) => (e.stopPropagation(), void unstage([f.path]))} />
        ) : (
          <IconButton icon={Plus} label={t("Stage")} spacing="compact" onClick={(e) => (e.stopPropagation(), void stage([f.path]))} />
        )}
      </span>
      <span className={cx("scm-letter", `is-${kind}`)} aria-label={kind}>
        {staged && kind !== "conflict" ? letterOf(f.x === "A" ? "added" : f.x === "D" ? "deleted" : f.x === "R" ? "renamed" : "modified") : letterOf(kind)}
      </span>
    </div>
  );
}

/** A file with conflicts: open it to choose per block, or take one side for the whole file. */
function ConflictRow({ f }: { f: GitFile }) {
  const abs = absPath(f.path);
  const name = basename(f.path);
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t("Open file"), icon: FileCode, onSelect: () => void openFile(abs) },
        { label: t("Compare current and incoming"), icon: Columns2, onSelect: () => openConflictDiff(abs) },
        { type: "separator" },
        { label: t("Accept current for the whole file"), onSelect: () => void acceptSide(f.path, "current") },
        { label: t("Accept incoming for the whole file"), onSelect: () => void acceptSide(f.path, "incoming") },
        { type: "separator" },
        { label: t("Mark as resolved (stage)"), icon: Check, onSelect: () => void markResolved(f.path) },
      ],
    });
  };
  return (
    <div className="scm-file" role="listitem" onClick={() => void openFile(abs)} onContextMenu={menu} data-tooltip={f.path}>
      <FileIcon name={name} />
      <span className="scm-file-name">{name}</span>
      <span className="scm-file-dir">{dir}</span>
      <span className="scm-file-actions">
        <IconButton icon={Columns2} label={t("Compare current and incoming")} spacing="compact" onClick={(e) => (e.stopPropagation(), openConflictDiff(abs))} />
        <IconButton icon={Check} label={t("Mark as resolved (stage)")} spacing="compact" onClick={(e) => (e.stopPropagation(), void markResolved(f.path))} />
      </span>
      <span className="scm-letter is-conflict" aria-label="conflict">
        !
      </span>
    </div>
  );
}

function StashRow({ s }: { s: Stash }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [open, setOpen] = useState(false);
  const lang = useStore((st) => st.settings.language);
  return (
    <div className="scm-commit">
      <div className="scm-commit-head is-row" role="button" tabIndex={0} aria-expanded={open} onClick={() => (setOpen(!open), !files && void stashFiles(s).then(setFiles, () => setFiles([])))} data-tooltip={s.ref}>
        <Archive size={14} className="scm-commit-icon" aria-hidden="true" />
        <span className="scm-commit-subject">{s.message || s.ref}</span>
        <span className="scm-commit-when">{s.date ? relativeTime(s.date, Date.now(), lang === "system" ? undefined : lang) : ""}</span>
        <span className="scm-file-actions">
          <IconButton icon={ArchiveRestore} label={t("Apply and drop (pop)")} spacing="compact" onClick={(e) => (e.stopPropagation(), void applyStash(s, true))} />
          <IconButton icon={Download} label={t("Apply, keep the stash")} spacing="compact" onClick={(e) => (e.stopPropagation(), void applyStash(s, false))} />
          <IconButton icon={Trash2} label={t("Drop…")} spacing="compact" onClick={(e) => (e.stopPropagation(), dropStash(s))} />
        </span>
      </div>
      {open && (
        <div className="scm-commit-files" role="list">
          {files === null ? (
            <p className="scm-note">{t("Loading…")}</p>
          ) : files.length === 0 ? (
            <p className="scm-note">{t("Only new files (they come back when applied).")}</p>
          ) : (
            files.map((f) => (
              <button key={f.path} type="button" role="listitem" className="scm-file is-commit" onClick={() => openStashDiff(s, f)}>
                <FileIcon name={basename(f.path)} />
                <span className={cx("scm-file-name", f.status === "D" && "is-deleted")}>{basename(f.path)}</span>
                <span className="scm-file-dir">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
                <span className={cx("scm-letter", `is-${f.status === "A" ? "added" : f.status === "D" ? "deleted" : "modified"}`)}>{f.status}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const lang = useStore((st) => st.settings.language);
  return (
    <div className="scm-commit">
      <div className="scm-commit-head is-row" data-tooltip={`${tag.commit.slice(0, 7)}${tag.annotated ? "" : " · " + t("lightweight tag")}`}>
        <TagIcon size={14} className="scm-commit-icon" aria-hidden="true" />
        <span className="scm-commit-subject">
          <strong className="scm-tag-name">{tag.name}</strong> {tag.subject}
        </span>
        <span className="scm-commit-when">{tag.date ? relativeTime(tag.date, Date.now(), lang === "system" ? undefined : lang) : ""}</span>
        <span className="scm-file-actions">
          <IconButton icon={Trash2} label={t("Delete tag…")} spacing="compact" onClick={() => deleteTag(tag)} />
        </span>
      </div>
    </div>
  );
}

/** A merge or rebase that stopped for conflicts: what's going on, and how to go on or give up. */
function OperationBanner({ conflicts }: { conflicts: number }) {
  const o = useGit((s) => s.operation);
  const busy = useGit((s) => s.busy);
  if (!o) return null;
  const what =
    o.kind === "merge" ? t("Merging {0}", o.label) : o.kind === "rebase" ? t("Rebasing onto {0}", o.label) : o.kind === "cherry-pick" ? t("Cherry-picking {0}", o.label) : t("Reverting {0}", o.label);
  return (
    <div className={cx("scm-operation", conflicts > 0 && "is-conflict")} role="status">
      <div className="scm-operation-text">
        {conflicts ? <TriangleAlert size={14} aria-hidden="true" /> : <GitMerge size={14} aria-hidden="true" />}
        <span>
          <strong>{what}</strong>
          <br />
          {conflicts ? (conflicts === 1 ? t("1 file has conflicts.") : t("{0} files have conflicts.", conflicts)) : t("Conflicts resolved: continue when you are ready.")}
        </span>
      </div>
      <div className="scm-operation-actions">
        <Button spacing="compact" appearance="primary" iconBefore={Play} disabled={conflicts > 0 || !!busy} onClick={() => void continueOperation()}>
          {o.kind === "merge" ? t("Commit merge") : t("Continue")}
        </Button>
        {o.kind === "rebase" && (
          <Button spacing="compact" iconBefore={SkipForward} disabled={!!busy} onClick={() => void skipRebaseCommit()}>
            {t("Skip commit")}
          </Button>
        )}
        <Button spacing="compact" appearance="subtle" iconBefore={X} disabled={!!busy} onClick={abortOperation}>
          {t("Abort")}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, count, open, onToggle, actions, children }: { title: string; count: number; open: boolean; onToggle: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="scm-section">
      <div className="scm-section-head">
        <button type="button" className="scm-section-toggle" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <span>{title}</span>
          <span className="scm-count">{count}</span>
        </button>
        <span className="scm-section-actions">{actions}</span>
      </div>
      {open && children}
    </div>
  );
}

function CommitRow({ c }: { c: Commit }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [open, setOpen] = useState(false);
  const lang = useStore((s) => s.settings.language);
  return (
    <div className="scm-commit">
      <button
        type="button"
        className="scm-commit-head"
        aria-expanded={open}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: t("Tag this commit…"), icon: TagIcon, onSelect: () => createTag(c.hash) },
              { label: t("Copy commit id"), onSelect: () => void navigator.clipboard.writeText(c.hash) },
            ],
          });
        }}
        onClick={() => {
          setOpen(!open);
          if (!files) void commitFiles(c.hash).then(setFiles, () => setFiles([]));
        }}
        data-tooltip={`${c.short} · ${c.author} <${c.email}> · ${new Date(c.date).toLocaleString(lang === "system" ? undefined : lang)}`}
      >
        <GitCommitHorizontal size={14} className="scm-commit-icon" aria-hidden="true" />
        <span className="scm-commit-subject">{c.subject}</span>
        {c.refs.slice(0, 2).map((r) => (
          <span key={r} className="scm-ref">
            {r.replace(/^tag: /, "")}
          </span>
        ))}
        <span className="scm-commit-when">{relativeTime(c.date, Date.now(), lang === "system" ? undefined : lang)}</span>
      </button>
      {open && (
        <div className="scm-commit-files" role="list">
          {files === null ? (
            <p className="scm-note">{t("Loading…")}</p>
          ) : files.length === 0 ? (
            <p className="scm-note">{t("No file changes.")}</p>
          ) : (
            files.map((f) => (
              <button key={f.path} type="button" role="listitem" className="scm-file is-commit" onClick={() => void openCommitDiff(c, f)}>
                <FileIcon name={basename(f.path)} />
                <span className={cx("scm-file-name", f.status === "D" && "is-deleted")}>{basename(f.path)}</span>
                <span className="scm-file-dir">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
                <span className={cx("scm-letter", `is-${f.status === "A" ? "added" : f.status === "D" ? "deleted" : f.status === "R" ? "renamed" : "modified"}`)}>{f.status}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function SourceControl() {
  const root = useStore((s) => s.root);
  const info = useGit((s) => s.info);
  const repo = useGit((s) => s.repo);
  const status = useGit((s) => s.status);
  const message = useGit((s) => s.message);
  const busy = useGit((s) => s.busy);
  const log = useGit((s) => s.log);
  const stashes = useGit((s) => s.stashes);
  const tags = useGit((s) => s.tags);
  const operation = useGit((s) => s.operation);
  const [openConflicts, setOpenConflicts] = useState(true);
  const [openStashes, setOpenStashes] = useState(true);
  const [openTags, setOpenTags] = useState(false);
  const [openStaged, setOpenStaged] = useState(true);
  const [openChanges, setOpenChanges] = useState(true);
  const [openHistory, setOpenHistory] = useState(true);

  useEffect(() => void refreshNow(), []);

  const files = status?.files ?? [];
  const conflicts = useMemo(() => files.filter(isConflict), [files]);
  const staged = useMemo(() => files.filter((f) => isStaged(f) && !isConflict(f)), [files]);
  const changes = useMemo(() => files.filter((f) => isUnstaged(f) && !isConflict(f)), [files]);

  if (info === false) {
    return (
      <div className="scm">
        <div className="sidebar-head">
          <span className="sidebar-title">{t("Source control")}</span>
        </div>
        <EmptyState icon={GitBranch} title={t("Git isn't installed")}>
          {t("Install Git for Windows from git-scm.com, then restart Logiq Studio.")}
        </EmptyState>
      </div>
    );
  }
  if (!root) return null;
  if (!repo || !status) {
    return (
      <div className="scm">
        <div className="sidebar-head">
          <span className="sidebar-title">{t("Source control")}</span>
        </div>
        <EmptyState
          icon={GitBranch}
          title={t("No repository yet")}
          actions={
            <Button appearance="primary" iconBefore={GitBranch} loading={busy === "init"} onClick={() => void initRepo()}>
              {t("Create repository")}
            </Button>
          }
        >
          {t("Git keeps the history of your project: every commit is a version you can go back to.")}
        </EmptyState>
      </div>
    );
  }

  const branchLabel = status.detached ? t("(detached)") : (status.branch ?? "");
  const moreMenu = (e: React.MouseEvent<HTMLButtonElement>) =>
    openMenu({
      anchor: e.currentTarget,
      align: "end",
      items: [
        { label: t("Pull"), icon: Download, onSelect: () => void pull() },
        { label: t("Push"), icon: Upload, onSelect: () => void push() },
        { label: t("Fetch"), icon: RefreshCw, onSelect: () => void fetchAll() },
        { type: "separator" },
        { label: t("Commit and amend the last commit"), disabled: status.unborn, onSelect: () => void commit({ amend: true }) },
        { label: t("Stage all changes"), disabled: !changes.length, onSelect: () => void stage(["."]) },
        { label: t("Unstage all"), disabled: !staged.length, onSelect: () => void unstage(staged.map((f) => f.path)) },
        { type: "separator" },
        { label: t("New branch…"), icon: GitBranch, onSelect: newBranch },
        { label: t("Merge a branch into this one…"), icon: GitMerge, disabled: !!operation, onSelect: () => mergeBranch() },
        { label: t("Rebase this branch onto…"), disabled: !!operation, onSelect: () => rebaseOnto() },
        { type: "separator" },
        { label: t("Stash changes…"), icon: Archive, disabled: !files.length, onSelect: stashChanges },
        { label: t("New tag…"), icon: TagIcon, disabled: status.unborn, onSelect: () => createTag() },
        { label: t("Push tags"), disabled: !tags.length, onSelect: () => void pushTags() },
        { type: "separator" },
        { label: t("Add a remote…"), icon: Cloud, onSelect: () => addRemote() },
      ],
    });

  return (
    <div className="scm">
      <div className="sidebar-head">
        <span className="sidebar-title">{t("Source control")}</span>
        <span className="spacer" />
        <IconButton icon={RefreshCw} label={t("Refresh")} spacing="compact" onClick={() => void refreshNow()} />
        <IconButton icon={MoreHorizontal} label={t("More actions")} spacing="compact" onClick={moreMenu} />
      </div>
      <div className="scm-bar">
        <button type="button" className="scm-branch" onClick={(e) => void branchMenu(e.currentTarget)} data-tooltip={t("Switch branch")}>
          <GitBranch size={14} aria-hidden="true" />
          <span>{branchLabel}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="scm-sync"
          disabled={!!busy}
          onClick={() => void sync()}
          data-tooltip={status.upstream ? t("Pull and push ({0})", status.upstream) : t("Publish this branch")}
        >
          {busy === "push" || busy === "pull" ? <RefreshCw size={13} className="is-spinning" aria-hidden="true" /> : status.upstream ? <RefreshCw size={13} aria-hidden="true" /> : <Upload size={13} aria-hidden="true" />}
          {status.upstream ? (
            <>
              <span className="is-mono">{status.behind}</span>
              <ArrowDown size={11} aria-hidden="true" />
              <span className="is-mono">{status.ahead}</span>
              <ArrowUp size={11} aria-hidden="true" />
            </>
          ) : (
            <span>{t("Publish")}</span>
          )}
        </button>
      </div>
      <div className="scm-commit-box">
        <textarea
          className="scm-message"
          value={message}
          rows={Math.min(6, Math.max(2, message.split("\n").length))}
          placeholder={t("Commit message (Ctrl+Enter to commit)")}
          aria-label={t("Commit message")}
          spellCheck
          onChange={(e) => useGit.setState({ message: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void commit();
            }
          }}
        />
        <Button appearance="primary" iconBefore={Check} loading={busy === "commit"} disabled={!files.length && !message} onClick={() => void commit()}>
          {staged.length ? t("Commit {0} staged", staged.length) : t("Commit")}
        </Button>
      </div>
      <OperationBanner conflicts={conflicts.length} />
      <div className="scm-scroll">
        {conflicts.length > 0 && (
          <Section title={t("Merge conflicts")} count={conflicts.length} open={openConflicts} onToggle={() => setOpenConflicts(!openConflicts)}>
            <div role="list">
              {conflicts.map((f) => (
                <ConflictRow key={"x" + f.path} f={f} />
              ))}
            </div>
            <p className="scm-note">{t("Open a file and choose a side above each conflict, then mark it as resolved.")}</p>
          </Section>
        )}
        {staged.length > 0 && (
          <Section
            title={t("Staged changes")}
            count={staged.length}
            open={openStaged}
            onToggle={() => setOpenStaged(!openStaged)}
            actions={<IconButton icon={Minus} label={t("Unstage all")} spacing="compact" onClick={() => void unstage(staged.map((f) => f.path))} />}
          >
            <div role="list">
              {staged.map((f) => (
                <FileRow key={"s" + f.path} f={f} staged />
              ))}
            </div>
          </Section>
        )}
        <Section
          title={t("Changes")}
          count={changes.length}
          open={openChanges}
          onToggle={() => setOpenChanges(!openChanges)}
          actions={
            changes.length > 0 && (
              <>
                <IconButton icon={Undo2} label={t("Discard all changes…")} spacing="compact" onClick={() => discard(changes)} />
                <IconButton icon={Plus} label={t("Stage all changes")} spacing="compact" onClick={() => void stage(["."])} />
              </>
            )
          }
        >
          {changes.length ? (
            <div role="list">
              {changes.map((f) => (
                <FileRow key={"c" + f.path} f={f} staged={false} />
              ))}
            </div>
          ) : (
            <p className="scm-note">{staged.length ? t("Everything is staged.") : t("No changes since the last commit.")}</p>
          )}
        </Section>
        {stashes.length > 0 && (
          <Section title={t("Stashes")} count={stashes.length} open={openStashes} onToggle={() => setOpenStashes(!openStashes)} actions={<IconButton icon={Archive} label={t("Stash changes…")} spacing="compact" onClick={stashChanges} />}>
            {stashes.map((s) => (
              <StashRow key={s.ref} s={s} />
            ))}
          </Section>
        )}
        <Section
          title={t("Tags")}
          count={tags.length}
          open={openTags}
          onToggle={() => setOpenTags(!openTags)}
          actions={
            <>
              {tags.length > 0 && <IconButton icon={Upload} label={t("Push tags")} spacing="compact" onClick={() => void pushTags()} />}
              <IconButton icon={Plus} label={t("New tag…")} spacing="compact" disabled={status.unborn} onClick={() => createTag()} />
            </>
          }
        >
          {tags.length ? tags.map((x) => <TagRow key={x.name} tag={x} />) : <p className="scm-note">{t("No tags. A tag marks a commit, such as a release (v1.0).")}</p>}
        </Section>
        <Section title={t("History")} count={log.length} open={openHistory} onToggle={() => setOpenHistory(!openHistory)} actions={<History size={14} className="scm-muted" aria-hidden="true" />}>
          {status.unborn ? (
            <p className="scm-note">{t("No commits yet.")}</p>
          ) : (
            log.map((c) => <CommitRow key={c.hash} c={c} />)
          )}
        </Section>
      </div>
    </div>
  );
}
