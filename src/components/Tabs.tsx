import { useEffect, useRef, useState, type DragEvent } from "react";
import { AppWindow, ClipboardCopy, Columns2, FolderOpen, GitCompare, ListVideo, Network, Pin, PinOff, Rows3, X } from "lucide-react";
import { get, openMenu, useStore, type Group, type Tab } from "../lib/store";
import * as A from "../lib/actions";
import { FileIcon } from "./FileIcon";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";
import type { MenuItem } from "./ui/Menu";
import { endEditorDrag, PATHS_TYPE, setDragGhost, startEditorDrag, TAB_TYPE, useEditorDrag } from "../lib/editorDrag";

const DRAG_TYPE = TAB_TYPE;
/** A tab from either group, or files from the explorer. */
const takes = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE) || (e.dataTransfer.types.includes(PATHS_TYPE) && useEditorDrag.getState().drag?.kind === "files");

function tabMenu(tab: Tab): MenuItem[] {
  const tabs = get().tabs.filter((x) => x.group === tab.group);
  const i = tabs.indexOf(tab);
  const unpinned = (list: Tab[]) => list.filter((x) => !x.pinned).map((x) => x.id);
  return [
    { label: t("Close"), shortcut: "Ctrl+W", onSelect: () => void A.closeTab(tab.id) },
    { label: t("Close others"), disabled: tabs.length < 2, onSelect: () => void A.closeTabs(unpinned(tabs.filter((x) => x !== tab))) },
    { label: t("Close to the right"), disabled: i === tabs.length - 1, onSelect: () => void A.closeTabs(unpinned(tabs.slice(i + 1))) },
    { label: t("Close saved"), onSelect: () => void A.closeTabs(unpinned(tabs.filter((x) => !x.dirty))) },
    { label: t("Close all"), onSelect: () => void A.closeTabs(unpinned(tabs)) },
    { type: "separator" },
    { label: tab.pinned ? t("Unpin") : t("Pin"), icon: tab.pinned ? PinOff : Pin, onSelect: () => A.togglePin(tab.id) },
    { label: tab.group === 0 ? t("Move to the side") : t("Move back"), icon: Columns2, shortcut: "Ctrl+\\", onSelect: () => A.moveToGroup(tab.id, tab.group === 0 ? 1 : 0) },
    ...(tab.path
      ? [
          { type: "separator" as const },
          { label: t("Copy path"), icon: ClipboardCopy, onSelect: () => void A.copyPath(tab.path!) },
          { label: t("Reveal in File Explorer"), icon: FolderOpen, onSelect: () => A.revealInExplorer(tab.path!) },
        ]
      : []),
  ];
}

/* The tabs of one editor group. Drag to reorder, or onto the other group to move. */
export function Tabs({ group }: { group: Group }) {
  const all = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.active[group]);
  const focused = useStore((s) => s.focusGroup === group);
  const tabs = all.filter((x) => x.group === group);
  const strip = useRef<HTMLDivElement>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  // When the tabs don't all fit: which ends have more beyond them (those edges fade out).
  const [more, setMore] = useState({ start: false, end: false });
  const measure = () => {
    const el = strip.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
  };
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The active tab is kept in view.
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(".tab.is-on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [activeId, tabs.length]);

  return (
    <div
      ref={strip}
      className={cx("tabs", focused && "is-focused", dropBefore === null && "is-drop-end", more.start && "has-more-start", more.end && "has-more-end")}
      onScroll={measure}
      role="tablist"
      aria-label={t("Open files")}
      onWheel={(e) => {
        if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
      }}
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (e.target === e.currentTarget) setDropBefore(null);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDropBefore(undefined);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG_TYPE);
        const before = dropBefore;
        setDropBefore(undefined);
        const drag = useEditorDrag.getState().drag;
        if (id) {
          e.preventDefault();
          A.reorderTab(id, before ?? null, group);
        } else if (drag?.kind === "files") {
          // The files open here, where they were let go; folders among them stay where they are.
          e.preventDefault();
          void A.openFilesIn(drag.paths, group, before ?? null);
        }
        endEditorDrag();
      }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          draggable
          className={cx("tab", tab.id === activeId && "is-on", tab.dirty && "is-dirty", tab.pinned && "is-pinned", dropBefore === tab.id && "is-drop")}
          data-tooltip={tab.path ?? tab.title}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              void A.closeTab(tab.id);
            }
          }}
          onClick={() => A.activate(tab.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") A.activate(tab.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu({ items: tabMenu(tab), x: e.clientX, y: e.clientY });
          }}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, tab.id);
            e.dataTransfer.effectAllowed = "move";
            startEditorDrag({ kind: "tab", id: tab.id, group, title: tab.title });
            setDragGhost(e, tab.title);
          }}
          onDragOver={(e) => {
            if (!takes(e)) return;
            e.preventDefault();
            e.stopPropagation();
            // Before this tab when over its left half, else before the next one.
            const r = e.currentTarget.getBoundingClientRect();
            const next = tabs[tabs.indexOf(tab) + 1]?.id ?? null;
            const target = e.clientX < r.left + r.width / 2 ? tab.id : next;
            if (target !== dropBefore) setDropBefore(target);
          }}
          onDragEnd={() => {
            setDropBefore(undefined);
            endEditorDrag();
          }}
        >
          {tab.kind === "uml" ? <Network size={15} className="tab-uml-icon" aria-hidden="true" /> : tab.kind === "sequence" ? <ListVideo size={15} className="tab-uml-icon" aria-hidden="true" /> : tab.kind === "diff" ? <GitCompare size={15} className="tab-uml-icon" aria-hidden="true" /> : tab.kind === "gui" ? <AppWindow size={15} className="tab-uml-icon" aria-hidden="true" /> : tab.kind === "nsd" ? <Rows3 size={15} className="tab-uml-icon" aria-hidden="true" /> : <FileIcon name={tab.title} />}
          <span className="tab-title">{tab.title}</span>
          {tab.pinned ? (
            <button
              type="button"
              className="tab-close is-pin"
              aria-label={t("Unpin {0}", tab.title)}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                A.togglePin(tab.id);
              }}
            >
              {tab.dirty ? <span className="tab-dot is-shown" aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}
            </button>
          ) : (
            <button
              type="button"
              className="tab-close"
              aria-label={t("Close {0}", tab.title)}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                void A.closeTab(tab.id);
              }}
            >
              <span className="tab-dot" aria-hidden="true" />
              <X size={13} className="tab-x" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
