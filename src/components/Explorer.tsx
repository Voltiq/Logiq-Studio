import { useMemo, useRef } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  ClipboardCopy,
  Code,
  Columns2,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { get, openDialog, openMenu, set, useStore } from "../lib/store";
import * as A from "../lib/actions";
import { basename, dirname } from "../lib/paths";
import type { Entry } from "../lib/types";
import type { MenuItem } from "./ui/Menu";
import { Button, IconButton } from "./ui/Button";
import { EmptyState } from "./ui/Feedback";
import { FileIcon } from "./FileIcon";
import { cx } from "../lib/utils";
import { languageFor } from "../editor/languages";

interface Row {
  entry: Entry;
  depth: number;
}

function entryMenu(entry: Entry): MenuItem[] {
  const dir = entry.isDir ? entry.path : dirname(entry.path);
  const items: MenuItem[] = [
    { label: "New file…", icon: FilePlus, onSelect: () => A.newFile(dir) },
    { label: "New Java class…", icon: Code, onSelect: () => openDialog({ kind: "newJavaFile", dir }) },
    { label: "New folder…", icon: FolderPlus, onSelect: () => A.newFolder(dir) },
    { type: "separator" },
  ];
  if (!entry.isDir && languageFor(entry.path).id === "html") {
    items.push({ label: "Open in preview", icon: Columns2, onSelect: () => A.openPreview(entry.path) }, { type: "separator" });
  }
  if (entry.path !== get().root) {
    items.push(
      { label: "Rename…", icon: Pencil, shortcut: "F2", onSelect: () => A.renamePath(entry.path) },
      { label: "Delete", icon: Trash2, shortcut: "Del", danger: true, onSelect: () => A.deletePath(entry.path, entry.isDir) },
      { type: "separator" },
    );
  }
  items.push(
    { label: "Copy path", icon: ClipboardCopy, onSelect: () => void A.copyPath(entry.path) },
    { label: "Copy relative path", onSelect: () => void A.copyPath(entry.path, true) },
    { label: "Reveal in File Explorer", icon: FolderOpen, onSelect: () => A.revealInExplorer(entry.path) },
  );
  return items;
}

export function Explorer() {
  const root = useStore((s) => s.root);
  const tree = useStore((s) => s.tree);
  const expanded = useStore((s) => s.expanded);
  const selected = useStore((s) => s.selected);
  const activePath = useStore((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null);
  const tabs = useStore((s) => s.tabs);
  const problems = useStore((s) => s.problems);
  const dirtyPaths = useMemo(() => new Set(tabs.filter((t) => t.dirty).map((t) => t.path)), [tabs]);
  const errorPaths = useMemo(() => new Set(problems.filter((p) => p.severity === "error").map((p) => p.path.toLowerCase())), [problems]);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of tree[dir] ?? []) {
        out.push({ entry, depth });
        if (entry.isDir && expanded[entry.path]) walk(entry.path, depth + 1);
      }
    };
    if (root) walk(root, 0);
    return out;
  }, [root, tree, expanded]);

  if (!root) {
    return (
      <div className="side-empty">
        <EmptyState icon={FolderOpen} title="No folder open" compact actions={<Button appearance="primary" onClick={() => A.chooseFolder()}>Open folder</Button>}>
          Open a project folder to see its files here.
        </EmptyState>
      </div>
    );
  }

  const index = rows.findIndex((r) => r.entry.path === selected);
  const select = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    set({ selected: r.entry.path });
    listRef.current?.querySelector<HTMLElement>(`[data-index="${rows.indexOf(r)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[index];
    switch (e.key) {
      case "ArrowDown":
        select(index + 1);
        break;
      case "ArrowUp":
        select(index - 1);
        break;
      case "ArrowRight":
        if (row?.entry.isDir) {
          if (!expanded[row.entry.path]) A.toggleDir(row.entry.path, true);
          else select(index + 1);
        }
        break;
      case "ArrowLeft":
        if (row?.entry.isDir && expanded[row.entry.path]) A.toggleDir(row.entry.path, false);
        else if (row) {
          const parent = rows.findIndex((r) => r.entry.path === dirname(row.entry.path));
          if (parent >= 0) select(parent);
        }
        break;
      case "Enter":
        if (row) row.entry.isDir ? A.toggleDir(row.entry.path) : void A.openFile(row.entry.path);
        break;
      case "F2":
        if (row) A.renamePath(row.entry.path);
        break;
      case "Delete":
        if (row) A.deletePath(row.entry.path, row.entry.isDir);
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(rows.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const rootEntry: Entry = { name: basename(root), path: root, isDir: true, size: 0, modified: 0 };

  return (
    <div className="side-section">
      <div className="side-head">
        <span className="side-title" data-tooltip={root} data-tooltip-overflow>
          {basename(root)}
        </span>
        <IconButton icon={FilePlus} label="New file" spacing="compact" onClick={() => A.newFile(currentDir())} />
        <IconButton icon={Code} label="New Java class" spacing="compact" onClick={() => openDialog({ kind: "newJavaFile", dir: currentDir() })} />
        <IconButton icon={FolderPlus} label="New folder" spacing="compact" onClick={() => A.newFolder(currentDir())} />
        <IconButton icon={RefreshCw} label="Refresh" spacing="compact" onClick={() => void refreshAll()} />
        <IconButton icon={ChevronsDownUp} label="Collapse folders" spacing="compact" onClick={() => set({ expanded: { [root]: true } })} />
      </div>
      <div
        ref={listRef}
        className="tree"
        role="tree"
        aria-label="Files"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            openMenu({ items: entryMenu(rootEntry), x: e.clientX, y: e.clientY });
          }
        }}
      >
        {rows.map((r, i) => {
          const { entry } = r;
          const open = entry.isDir && !!expanded[entry.path];
          const isError = !entry.isDir && errorPaths.has(entry.path.toLowerCase());
          return (
            <div
              key={entry.path}
              data-index={i}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={entry.isDir ? open : undefined}
              aria-selected={entry.path === selected}
              className={cx("tree-row", entry.path === selected && "is-selected", entry.path === activePath && "is-active")}
              style={{ paddingLeft: 6 + r.depth * 14 }}
              onClick={() => {
                set({ selected: entry.path });
                if (entry.isDir) A.toggleDir(entry.path);
                else void A.openFile(entry.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                set({ selected: entry.path });
                openMenu({ items: entryMenu(entry), x: e.clientX, y: e.clientY });
              }}
            >
              <span className={cx("tree-chevron", open && "is-open", !entry.isDir && "is-hidden")} aria-hidden="true">
                <ChevronRight size={14} />
              </span>
              <FileIcon name={entry.name} folder={entry.isDir} open={open} />
              <span className={cx("tree-name", isError && "is-error", /^\./.test(entry.name) && "is-dim")}>{entry.name}</span>
              {dirtyPaths.has(entry.path) && <span className="tree-dirty" aria-label="Unsaved changes" />}
              {isError && <span className="tree-error" aria-label="Has errors" />}
            </div>
          );
        })}
      </div>
    </div>
  );
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
