import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  ChevronRight,
  ChevronsDownUp,
  ClipboardCopy,
  ClipboardPaste,
  Code,
  Columns2,
  Copy,
  CopyPlus,
  FilePlus,
  Filter,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Rows3,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { activeTab, get, openDialog, openMenu, set, useStore } from "../lib/store";
import * as A from "../lib/actions";
import { api } from "../lib/api";
import { basename, dirname, join, samePath } from "../lib/paths";
import type { Entry } from "../lib/types";
import type { MenuItem } from "./ui/Menu";
import { Button, IconButton } from "./ui/Button";
import { EmptyState } from "./ui/Feedback";
import { FileIcon } from "./FileIcon";
import { cx } from "../lib/utils";
import { isPreviewable } from "../lib/actions";
import { fuzzy } from "./Palette";
import { rowWindow } from "../lib/rowWindow";
import { t } from "../lib/i18n";
import { useGit } from "../lib/git";
import { letterOf } from "../lib/gitParse";
import { endEditorDrag, PATHS_TYPE, setDragGhost, startEditorDrag } from "../lib/editorDrag";

interface Row {
  entry: Entry;
  depth: number;
}

/** The selection a command applies to: the selection when the entry is in it, else the entry alone. */
function targets(entry: Entry): string[] {
  const sel = get().selection;
  return sel.includes(entry.path) ? sel : [entry.path];
}

function entryMenu(entry: Entry): MenuItem[] {
  const dir = entry.isDir ? entry.path : dirname(entry.path);
  const paths = targets(entry);
  const many = paths.length > 1;
  const isRoot = entry.path === get().root;
  const clip = get().clipboard;
  const items: MenuItem[] = [
    { label: t("New file…"), icon: FilePlus, onSelect: () => A.newFile(dir) },
    { label: t("New Java class…"), icon: Code, onSelect: () => openDialog({ kind: "newJavaFile", dir }) },
    { label: t("New Swing window…"), icon: AppWindow, onSelect: () => A.newSwingWindow(dir) },
    { label: t("New JavaFX window…"), icon: AppWindow, onSelect: () => A.newFxWindow(dir) },
    { label: t("New Nassi–Shneiderman diagram…"), icon: Rows3, onSelect: () => void import("../nsd/open").then((m) => m.newNsd(dir)) },
    { label: t("New folder…"), icon: FolderPlus, onSelect: () => A.newFolder(dir) },
    { type: "separator" },
  ];
  if (!entry.isDir && !many) {
    items.push({ label: t("Open to the side"), icon: Columns2, onSelect: () => void A.openFile(entry.path, undefined, 1) });
    if (isPreviewable(entry.path)) items.push({ label: t("Open in preview"), onSelect: () => A.openPreview(entry.path) });
    items.push({ type: "separator" });
  }
  if (!isRoot) {
    items.push(
      { label: t("Cut"), icon: Scissors, shortcut: "Ctrl+X", onSelect: () => A.copyToClipboard(paths, "cut") },
      { label: t("Copy"), icon: Copy, shortcut: "Ctrl+C", onSelect: () => A.copyToClipboard(paths, "copy") },
    );
  }
  items.push({ label: clip ? t("Paste ({0})", clip.paths.length) : t("Paste"), icon: ClipboardPaste, shortcut: "Ctrl+V", disabled: !clip, onSelect: () => void A.pasteInto(dir) });
  if (!isRoot) {
    items.push(
      { label: t("Duplicate"), icon: CopyPlus, disabled: many, onSelect: () => void A.duplicate(entry.path) },
      { type: "separator" },
      { label: t("Rename…"), icon: Pencil, shortcut: "F2", disabled: many, onSelect: () => A.renamePath(entry.path) },
      { label: many ? t("Delete {0} items", paths.length) : t("Delete"), icon: Trash2, shortcut: "Del", danger: true, onSelect: () => A.deletePaths(paths) },
    );
  }
  items.push(
    { type: "separator" },
    { label: t("Copy path"), icon: ClipboardCopy, onSelect: () => void A.copyPath(entry.path) },
    { label: t("Copy relative path"), onSelect: () => void A.copyPath(entry.path, true) },
    { label: t("Reveal in File Explorer"), icon: FolderOpen, onSelect: () => A.revealInExplorer(entry.path) },
  );
  return items;
}

const DRAG_TYPE = PATHS_TYPE;

export function Explorer() {
  const root = useStore((s) => s.root);
  const tree = useStore((s) => s.tree);
  const expanded = useStore((s) => s.expanded);
  const selected = useStore((s) => s.selected);
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const activePath = useStore((s) => activeTab(s)?.path ?? null);
  const tabs = useStore((s) => s.tabs);
  const problems = useStore((s) => s.problems);
  const dirtyPaths = useMemo(() => new Set(tabs.filter((x) => x.dirty).map((x) => x.path)), [tabs]);
  const gitKinds = useGit((g) => g.kinds);
  const errorPaths = useMemo(() => new Set(problems.filter((p) => p.severity === "error").map((p) => p.path.toLowerCase())), [problems]);
  const [filter, setFilter] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // A long list (a folder with thousands of files) draws only the rows in view.
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setScroll((s) => (s.top === el.scrollTop && s.height === el.clientHeight ? s : { top: el.scrollTop, height: el.clientHeight }));
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [root]);
  const filterRef = useRef<HTMLInputElement>(null);
  const hoverTimer = useRef(0);

  useEffect(() => {
    if (filter !== null && root) {
      api.listFiles(root).then(setAllFiles).catch(() => setAllFiles([]));
      filterRef.current?.focus();
    }
  }, [filter !== null, root, tree]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (!root) return out;
    if (filter) {
      // Filtering: a flat list of matching files.
      const q = filter.trim();
      const hits = allFiles
        .map((f) => ({ f, score: fuzzy(q, f) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 400);
      for (const { f } of hits) {
        const path = join(root, f);
        out.push({ entry: { name: f, path, isDir: false, size: 0, modified: 0 }, depth: 0 });
      }
      return out;
    }
    const walk = (dir: string, depth: number) => {
      for (const entry of tree[dir] ?? []) {
        out.push({ entry, depth });
        if (entry.isDir && expanded[entry.path]) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [root, tree, expanded, filter, allFiles]);

  if (!root) {
    return (
      <div className="side-empty">
        <EmptyState icon={FolderOpen} title={t("No folder open")} compact actions={<Button appearance="primary" onClick={() => A.chooseFolder()}>{t("Open folder")}</Button>}>
          {t("Open a project folder to see its files here.")}
        </EmptyState>
      </div>
    );
  }

  const win = rowWindow(rows.length, scroll.top, scroll.height, rowHeight());
  const index = rows.findIndex((r) => r.entry.path === selected);

  const select = (i: number, extend = false) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    if (extend && selected) {
      const a = rows.findIndex((x) => x.entry.path === selected);
      const b = rows.indexOf(r);
      const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.entry.path);
      set({ selection: range });
    } else {
      set({ selected: r.entry.path, selection: [r.entry.path] });
    }
    const at = rows.indexOf(r);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${at}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
    // Not drawn (far out of view in a long list): scroll to where it is.
    else if (listRef.current && at >= 0) listRef.current.scrollTop = Math.max(0, at * rowHeight() - listRef.current.clientHeight / 2);
  };

  const onClickRow = (e: React.MouseEvent, r: Row, i: number) => {
    const path = r.entry.path;
    if (e.ctrlKey || e.metaKey) {
      const has = selection.includes(path);
      set({ selected: path, selection: has ? selection.filter((p) => p !== path) : [...selection, path] });
      return;
    }
    if (e.shiftKey && selected) {
      const a = rows.findIndex((x) => x.entry.path === selected);
      set({ selection: rows.slice(Math.min(a, i), Math.max(a, i) + 1).map((x) => x.entry.path) });
      return;
    }
    set({ selected: path, selection: [path] });
    if (r.entry.isDir) A.toggleDir(path);
    else void A.openFile(path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[index];
    const ctrl = e.ctrlKey || e.metaKey;
    const dir = row ? (row.entry.isDir ? row.entry.path : dirname(row.entry.path)) : root;
    switch (true) {
      case e.key === "ArrowDown":
        select(index + 1, e.shiftKey);
        break;
      case e.key === "ArrowUp":
        select(index - 1, e.shiftKey);
        break;
      case e.key === "ArrowRight":
        if (row?.entry.isDir) {
          if (!expanded[row.entry.path]) A.toggleDir(row.entry.path, true);
          else select(index + 1);
        }
        break;
      case e.key === "ArrowLeft":
        if (row?.entry.isDir && expanded[row.entry.path]) A.toggleDir(row.entry.path, false);
        else if (row) {
          const parent = rows.findIndex((r) => r.entry.path === dirname(row.entry.path));
          if (parent >= 0) select(parent);
        }
        break;
      case e.key === "Enter":
        if (row) row.entry.isDir ? A.toggleDir(row.entry.path) : void A.openFile(row.entry.path);
        break;
      case e.key === "F2":
        if (row) A.renamePath(row.entry.path);
        break;
      case e.key === "Delete":
        if (row) A.deletePaths(targets(row.entry));
        break;
      case ctrl && e.key.toLowerCase() === "c":
        if (row) A.copyToClipboard(targets(row.entry), "copy");
        break;
      case ctrl && e.key.toLowerCase() === "x":
        if (row) A.copyToClipboard(targets(row.entry), "cut");
        break;
      case ctrl && e.key.toLowerCase() === "v":
        void A.pasteInto(dir);
        break;
      case ctrl && e.key.toLowerCase() === "a":
        set({ selection: rows.map((r) => r.entry.path) });
        break;
      case e.key === "Home":
        select(0);
        break;
      case e.key === "End":
        select(rows.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const dropDir = (r: Row | null) => (r ? (r.entry.isDir ? r.entry.path : dirname(r.entry.path)) : root);

  const rootEntry: Entry = { name: basename(root), path: root, isDir: true, size: 0, modified: 0 };
  const cut = clipboard?.mode === "cut" ? new Set(clipboard.paths) : null;

  return (
    <div className="side-section">
      <div className="side-head">
        <span className="side-title" data-tooltip={root} data-tooltip-overflow>
          {basename(root)}
        </span>
        <IconButton icon={FilePlus} label={t("New file")} spacing="compact" onClick={() => A.newFile(currentDir())} />
        <IconButton icon={Code} label={t("New Java class")} spacing="compact" onClick={() => openDialog({ kind: "newJavaFile", dir: currentDir() })} />
        <IconButton icon={FolderPlus} label={t("New folder")} spacing="compact" onClick={() => A.newFolder(currentDir())} />
        <IconButton icon={Filter} label={t("Filter files")} spacing="compact" selected={filter !== null} onClick={() => setFilter(filter === null ? "" : null)} />
        <IconButton icon={RefreshCw} label={t("Refresh")} spacing="compact" onClick={() => void refreshAll()} />
        <IconButton icon={ChevronsDownUp} label={t("Collapse folders")} spacing="compact" onClick={() => set({ expanded: { [root]: true } })} />
      </div>
      {filter !== null && (
        <div className="explorer-filter">
          <label className="search-field">
            <Filter size={14} aria-hidden="true" />
            <input
              ref={filterRef}
              value={filter}
              placeholder={t("Filter by name")}
              aria-label={t("Filter files")}
              spellCheck={false}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setFilter(null);
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current?.focus();
                  select(0);
                }
                if (e.key === "Enter" && rows[0]) void A.openFile(rows[0].entry.path);
              }}
            />
            <IconButton icon={X} label={t("Close filter")} spacing="compact" onClick={() => setFilter(null)} />
          </label>
        </div>
      )}
      <div
        ref={listRef}
        className={cx("tree", dropTarget === root && "is-drop")}
        role="tree"
        aria-label={t("Files")}
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            openMenu({ items: entryMenu(rootEntry), x: e.clientX, y: e.clientY });
          }
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setDropTarget(root);
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDropTarget(null);
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(DRAG_TYPE);
          setDropTarget(null);
          if (!raw || e.target !== e.currentTarget) return;
          e.preventDefault();
          void A.moveInto(JSON.parse(raw), root);
        }}
      >
        {filter && rows.length === 0 && <p className="search-note">{t("No file matches.")}</p>}
        {win.first > 0 && <div style={{ height: win.first * win.row }} aria-hidden="true" />}
        {rows.slice(win.first, win.last).map((r, j) => {
          const i = win.first + j;
          const { entry } = r;
          const open = entry.isDir && !!expanded[entry.path];
          const isError = !entry.isDir && errorPaths.has(entry.path.toLowerCase());
          const gitKind = gitKinds.get(entry.path.toLowerCase());
          const target = dropDir(r);
          return (
            <div
              key={entry.path}
              data-index={i}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-posinset={win.windowed ? i + 1 : undefined}
              aria-setsize={win.windowed ? rows.length : undefined}
              aria-expanded={entry.isDir && !filter ? open : undefined}
              aria-selected={selection.includes(entry.path)}
              draggable
              className={cx(
                "tree-row",
                selection.includes(entry.path) && "is-selected",
                entry.path === activePath && "is-active",
                cut?.has(entry.path) && "is-cut",
                gitKind && `git-${gitKind}`,
                dropTarget && entry.isDir && samePath(dropTarget, entry.path) && "is-drop",
              )}
              style={{ paddingLeft: 6 + r.depth * 20 }}
              onClick={(e) => onClickRow(e, r, i)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selection.includes(entry.path)) set({ selected: entry.path, selection: [entry.path] });
                openMenu({ items: entryMenu(entry), x: e.clientX, y: e.clientY });
              }}
              onDragStart={(e) => {
                const paths = targets(entry);
                e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
                e.dataTransfer.setData("text/plain", paths.join("\n"));
                e.dataTransfer.effectAllowed = "move";
                // Files (not folders) can also be dropped on an editor group to open them there.
                const isDir = new Map(rows.map((x) => [x.entry.path, x.entry.isDir]));
                const files = paths.filter((p) => isDir.get(p) === false);
                startEditorDrag(files.length ? { kind: "files", paths: files } : null);
                setDragGhost(e, basename(paths[0]), paths.length);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (dropTarget !== target) {
                  setDropTarget(target);
                  // Hovering a closed folder for a moment opens it.
                  window.clearTimeout(hoverTimer.current);
                  if (entry.isDir && !open) hoverTimer.current = window.setTimeout(() => A.toggleDir(entry.path, true), 700);
                }
              }}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData(DRAG_TYPE);
                setDropTarget(null);
                if (!raw) return;
                e.preventDefault();
                e.stopPropagation();
                void A.moveInto(JSON.parse(raw), target);
              }}
              onDragEnd={() => {
                endEditorDrag();
                window.clearTimeout(hoverTimer.current);
                setDropTarget(null);
              }}
            >
              <span className={cx("tree-chevron", open && "is-open", (!entry.isDir || !!filter) && "is-hidden")} aria-hidden="true">
                <ChevronRight size={14} />
              </span>
              <FileIcon name={entry.name} folder={entry.isDir} open={open} />
              <span className={cx("tree-name", isError && "is-error", /^\./.test(basename(entry.name)) && "is-dim")}>
                {filter ? (
                  <>
                    {basename(entry.name)}
                    <span className="tree-dir"> {entry.name.includes("/") ? entry.name.slice(0, entry.name.lastIndexOf("/")) : ""}</span>
                  </>
                ) : (
                  entry.name
                )}
              </span>
              {dirtyPaths.has(entry.path) && <span className="tree-dirty" aria-label={t("Unsaved changes")} />}
              {isError && <span className="tree-error" aria-label={t("Has errors")} />}
              {gitKind && gitKind !== "ignored" && (entry.isDir ? <span className="tree-git-dot" aria-hidden="true" /> : <span className="tree-git">{letterOf(gitKind)}</span>)}
            </div>
          );
        })}
        {win.last < rows.length && <div style={{ height: (rows.length - win.last) * win.row }} aria-hidden="true" />}
      </div>
    </div>
  );
}

/** The height of a row: 1.75rem, as in the style sheet. */
function rowHeight(): number {
  return (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 1.75;
}

function currentDir(): string {
  const s = get();
  const sel = s.selected;
  if (!sel) return s.root!;
  const entry = Object.values(s.tree)
    .flat()
    .find((e) => e?.path === sel);
  return entry?.isDir ? entry.path : dirname(sel);
}

async function refreshAll() {
  const s = get();
  const dirs = Object.keys(s.tree).filter((d) => d === s.root || s.expanded[d]);
  set({ tree: {} });
  for (const d of dirs) await A.loadDir(d);
  await A.reloadJavaIndex();
}
