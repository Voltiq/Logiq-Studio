/*
 * Dragging files and tabs into the editor groups.
 *
 * A drag only carries its data to the drop, so what is being dragged is kept here as well: the editor area
 * can then show, while the pointer moves, where the files will land (this group, or a new group at the side).
 */
import { create } from "zustand";
import type { Group } from "../editor/docs";

export const PATHS_TYPE = "application/x-logiq-paths";
export const TAB_TYPE = "application/x-logiq-tab";

export type EditorDrag = { kind: "files"; paths: string[] } | { kind: "tab"; id: string; group: Group; title: string };

export const useEditorDrag = create<{ drag: EditorDrag | null }>(() => ({ drag: null }));

export function startEditorDrag(drag: EditorDrag | null) {
  useEditorDrag.setState({ drag });
}

export function endEditorDrag() {
  if (useEditorDrag.getState().drag) useEditorDrag.setState({ drag: null });
}

export function currentEditorDrag(): EditorDrag | null {
  return useEditorDrag.getState().drag;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a drop lands: in a group, and whether it opens the side group, which isn't there yet. */
export interface DropZone {
  group: Group;
  split: boolean;
  /** The part of the editor area the drop takes, relative to it. */
  box: Box;
}

/** Without a side group, the right part of the editor that opens one. */
export const SPLIT_FROM = 0.62;

/**
 * The zone under the pointer, from the boxes of the editor area, its main group and its side group (when
 * open), all in window coordinates. Null outside the groups. An empty main group takes the drop all over:
 * splitting it would leave it empty.
 */
export function dropZone(x: number, y: number, area: Box, main: Box, side: Box | null, canSplit = true): DropZone | null {
  const inside = (b: Box) => x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height;
  const rel = (b: Box): Box => ({ left: b.left - area.left, top: b.top - area.top, width: b.width, height: b.height });
  if (side && inside(side)) return { group: 1, split: false, box: rel(side) };
  if (!inside(main)) return null;
  if (!side && canSplit && x >= main.left + main.width * SPLIT_FROM) {
    const half = Math.round(main.width / 2);
    return { group: 1, split: true, box: rel({ ...main, left: main.left + main.width - half, width: half }) };
  }
  return { group: 0, split: false, box: rel(main) };
}

/** A drop that would change nothing: a tab let go over the group it is in. */
export function isNoOp(drag: EditorDrag, zone: DropZone): boolean {
  return drag.kind === "tab" && drag.group === zone.group && !zone.split;
}

/** The small label that follows the pointer instead of the browser's picture of the row. */
export function setDragGhost(e: { dataTransfer: DataTransfer | null }, title: string, count = 1) {
  if (!e.dataTransfer) return;
  const el = document.createElement("div");
  el.className = "drag-ghost";
  const name = document.createElement("span");
  name.className = "drag-ghost-name";
  name.textContent = title;
  el.append(name);
  if (count > 1) {
    const badge = document.createElement("span");
    badge.className = "drag-ghost-count";
    badge.textContent = `+${count - 1}`;
    el.append(badge);
  }
  document.body.append(el);
  e.dataTransfer.setDragImage(el, 14, 16);
  // The browser takes its picture now; the element isn't needed after that.
  window.setTimeout(() => el.remove(), 0);
}
