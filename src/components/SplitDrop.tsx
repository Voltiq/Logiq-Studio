import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Columns2, FileInput, MoveRight } from "lucide-react";
import * as A from "../lib/actions";
import { useStore } from "../lib/store";
import { currentEditorDrag, dropZone, endEditorDrag, isNoOp, useEditorDrag, type Box, type DropZone, type EditorDrag } from "../lib/editorDrag";
import { basename } from "../lib/paths";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";

const box = (el: Element | null): Box | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** What the preview says: where the drop goes, and what is dropped. */
function labels(drag: EditorDrag, zone: DropZone) {
  const tab = drag.kind === "tab";
  const title = tab ? t(zone.group === 1 ? "Move to the side" : "Move here") : t(zone.split || zone.group === 1 ? "Open to the side" : "Open here");
  const what = tab ? drag.title : drag.paths.length === 1 ? basename(drag.paths[0]) : t("{0} files", drag.paths.length);
  return { title, what, icon: zone.split ? Columns2 : tab ? MoveRight : FileInput };
}

interface Shown {
  zone: DropZone;
  title: string;
  what: string;
  icon: typeof Columns2;
}

/**
 * The editor groups, which take files from the explorer and tabs from either group. While something is
 * dragged over them, a preview shows where it lands; without a side group, the right part of the editor
 * opens one.
 */
export function SplitDropArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useEditorDrag((s) => s.drag);
  const hasSide = useStore((s) => s.tabs.some((x) => x.group === 1));
  // A split needs something to stay in the main group besides what is dragged away from it.
  const canSplit = useStore((s) => s.tabs.some((x) => x.group === 0 && !(drag?.kind === "tab" && drag.id === x.id)));
  const [shown, setShown] = useState<Shown | null>(null);
  const [live, setLive] = useState(false);
  const [landing, setLanding] = useState(false);
  const landTimer = useRef(0);

  // Whatever way a drag ends (dropped elsewhere, Esc), the preview goes.
  useEffect(() => {
    const end = () => {
      endEditorDrag();
      setLive(false);
    };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
      window.clearTimeout(landTimer.current);
    };
  }, []);

  const zoneAt = (x: number, y: number) => {
    const el = ref.current;
    if (!el) return null;
    const area = box(el)!;
    const main = box(el.querySelector(":scope > .stage"));
    const side = box(el.querySelector(":scope > .side-group"));
    return main ? dropZone(x, y, area, main, side, canSplit) : null;
  };

  const onOver = (e: DragEvent) => {
    const d = currentEditorDrag();
    if (!d) return;
    // The tab strips take their own drops, in between the tabs.
    if ((e.target as HTMLElement).closest?.(".tabs")) {
      setLive(false);
      return;
    }
    const zone = zoneAt(e.clientX, e.clientY);
    if (!zone || isNoOp(d, zone)) {
      setLive(false);
      return;
    }
    // Over the editor too: a file is opened, not its path typed in.
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!live || !shown || shown.zone.group !== zone.group || shown.zone.split !== zone.split) {
      setShown({ zone, ...labels(d, zone) });
      setLive(true);
      setLanding(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    const d = currentEditorDrag();
    if (!d || (e.target as HTMLElement).closest?.(".tabs")) return;
    const zone = zoneAt(e.clientX, e.clientY);
    if (!zone || isNoOp(d, zone)) return;
    e.preventDefault();
    e.stopPropagation();
    endEditorDrag();
    setLive(false);
    setShown({ zone, ...labels(d, zone) });
    setLanding(true);
    window.clearTimeout(landTimer.current);
    landTimer.current = window.setTimeout(() => setLanding(false), 420);
    if (d.kind === "files") void A.openFilesIn(d.paths, zone.group);
    else A.moveToGroup(d.id, zone.group);
  };

  const visible = live || landing;
  const Icon = shown?.icon ?? FileInput;

  return (
    <div
      ref={ref}
      className={cx("groups", drag && "is-dragging")}
      onDragOverCapture={onOver}
      onDragEnterCapture={onOver}
      onDragLeave={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) setLive(false);
      }}
      onDropCapture={onDrop}
    >
      {children}
      {!hasSide && canSplit && (
        <div className={cx("split-hint", drag && "is-shown", live && shown?.zone.split && "is-taken")} aria-hidden="true">
          <Columns2 size={16} />
          <span>{t("Split")}</span>
        </div>
      )}
      <div
        className={cx("drop-preview", visible && "is-shown", shown?.zone.split && "is-split", landing && "is-landing")}
        style={shown ? { left: shown.zone.box.left, top: shown.zone.box.top, width: shown.zone.box.width, height: shown.zone.box.height } : undefined}
        aria-hidden="true"
      >
        {shown && (
          <div className="drop-pill" key={`${shown.zone.group}-${shown.zone.split}`}>
            <Icon size={18} className="drop-pill-icon" />
            <span className="drop-pill-text">
              <span className="drop-pill-title">{shown.title}</span>
              <span className="drop-pill-what">{shown.what}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
