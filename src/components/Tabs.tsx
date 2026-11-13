import { useRef, useState } from "react";
import { ClipboardCopy, Columns2, FolderOpen, Network, Pin, PinOff, X } from "lucide-react";
import { get, openMenu, useStore, type Group, type Tab } from "../lib/store";
import * as A from "../lib/actions";
import { FileIcon } from "./FileIcon";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";
import type { MenuItem } from "./ui/Menu";

const DRAG_TYPE = "application/x-logiq-tab";

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

  return (
    <div
      ref={strip}
      className={cx("tabs", focused && "is-focused", dropBefore === null && "is-drop-end")}
      role="tablist"
      aria-label={t("Open files")}
      onWheel={(e) => {
        if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        if (e.target === e.currentTarget) setDropBefore(null);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDropBefore(undefined);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG_TYPE);
        const before = dropBefore;
        setDropBefore(undefined);
        if (id) {
          e.preventDefault();
          A.reorderTab(id, before ?? null, group);
        }
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
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.stopPropagation();
            // Before this tab when over its left half, else before the next one.
            const r = e.currentTarget.getBoundingClientRect();
            const next = tabs[tabs.indexOf(tab) + 1]?.id ?? null;
            const target = e.clientX < r.left + r.width / 2 ? tab.id : next;
            if (target !== dropBefore) setDropBefore(target);
          }}
          onDragEnd={() => setDropBefore(undefined)}
        >
          {tab.kind === "uml" ? <Network size={15} className="tab-uml-icon" aria-hidden="true" /> : <FileIcon name={tab.title} />}
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
