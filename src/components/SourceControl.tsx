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
import { openCommitDiff, openWorkingDiff } from "../lib/diffTabs";

/** The branch menu: switch to a branch, or make a new one. */
export async function branchMenu(anchor: HTMLElement) {
  const list = await branches();
  const local = list.filter((b) => !b.remote);
  const remote = list.filter((b) => b.remote && !local.some((l) => l.upstream === b.name));
  const items: MenuItem[] = [
    { label: t("New branch…"), icon: Plus, onSelect: newBranch },
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
  const [openStaged, setOpenStaged] = useState(true);
  const [openChanges, setOpenChanges] = useState(true);
  const [openHistory, setOpenHistory] = useState(true);

  useEffect(() => void refreshNow(), []);

  const files = status?.files ?? [];
  const staged = useMemo(() => files.filter(isStaged), [files]);
  const changes = useMemo(() => files.filter(isUnstaged), [files]);

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
      <div className="scm-scroll">
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
