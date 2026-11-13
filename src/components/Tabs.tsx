import { useRef } from "react";
import { ClipboardCopy, FolderOpen, Network, X } from "lucide-react";
import { openMenu, useStore, type Tab } from "../lib/store";
import * as A from "../lib/actions";
import { FileIcon } from "./FileIcon";
import { cx } from "../lib/utils";

function tabMenu(tab: Tab, tabs: Tab[]) {
  const i = tabs.indexOf(tab);
  return [
    { label: "Close", shortcut: "Ctrl+W", onSelect: () => void A.closeTab(tab.id) },
    { label: "Close others", disabled: tabs.length < 2, onSelect: () => void A.closeTabs(tabs.filter((t) => t !== tab).map((t) => t.id)) },
    { label: "Close to the right", disabled: i === tabs.length - 1, onSelect: () => void A.closeTabs(tabs.slice(i + 1).map((t) => t.id)) },
    { label: "Close saved", onSelect: () => void A.closeTabs(tabs.filter((t) => !t.dirty).map((t) => t.id)) },
    { label: "Close all", onSelect: () => void A.closeAllTabs() },
    ...(tab.path
      ? [
          { type: "separator" as const },
          { label: "Copy path", icon: ClipboardCopy, onSelect: () => void A.copyPath(tab.path!) },
          { label: "Reveal in File Explorer", icon: FolderOpen, onSelect: () => A.revealInExplorer(tab.path!) },
        ]
      : []),
  ];
}

export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeId);
  const strip = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={strip}
      className="tabs"
      role="tablist"
      aria-label="Open files"
      onWheel={(e) => {
        if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
      }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          className={cx("tab", tab.id === activeId && "is-on", tab.dirty && "is-dirty")}
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
            openMenu({ items: tabMenu(tab, tabs), x: e.clientX, y: e.clientY });
          }}
        >
          {tab.kind === "uml" ? <Network size={15} className="tab-uml-icon" aria-hidden="true" /> : <FileIcon name={tab.title} />}
          <span className="tab-title">{tab.title}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${tab.title}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              void A.closeTab(tab.id);
            }}
          >
            <span className="tab-dot" aria-hidden="true" />
            <X size={13} className="tab-x" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
