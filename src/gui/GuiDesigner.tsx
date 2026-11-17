import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  ArrowUpDown,
  ChevronsUpDown,
  CircleDot,
  Code,
  Copy,
  Gauge,
  Grid3x3,
  KeyRound,
  List,
  Magnet,
  PanelTop,
  Play,
  Redo2,
  RectangleHorizontal,
  SlidersHorizontal,
  SquareCheck,
  TextCursorInput,
  Trash2,
  Type,
  Undo2,
  AlignLeft,
  BringToFront,
  SendToBack,
  type LucideIcon,
} from "lucide-react";
import { undo, redo } from "@codemirror/commands";
import { getDoc } from "../editor/docs";
import { changeDoc, focusGroup, moveToGroup, openFile, runActive, runOnDoc, watchDoc } from "../lib/actions";
import { get, openMenu, toast } from "../lib/store";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/Feedback";
import type { MenuItem } from "../components/ui/Menu";
import { methodLine, minimalChange, parseForm, renameInCode, writeForm, type ParsedForm } from "./codegen";
import { COMPONENTS, componentInfo, freeName, handlerName, newComponent, type ComponentType, type EventKind, type GuiComponent } from "./model";
import { align, bounds, clampInto, intersects, snapMove, snapResize, type AlignKind, type Box, type Guide, type Handle } from "./geometry";
import { ComponentView } from "./render";
import { Inspector } from "./Inspector";

/*
 * The GUI designer: a palette of Swing components, the window to drag them
 * into, and an inspector for the selected one's properties and events. Each
 * change is written into the class's code at once (the designer's regions,
 * plus a handler method for a new event), so the editor's undo undoes it and
 * the code can be changed by hand: the designer reads it back.
 */

const ICONS: Record<ComponentType, LucideIcon> = {
  JButton: RectangleHorizontal,
  JLabel: Type,
  JTextField: TextCursorInput,
  JPasswordField: KeyRound,
  JTextArea: AlignLeft,
  JCheckBox: SquareCheck,
  JRadioButton: CircleDot,
  JComboBox: ChevronsUpDown,
  JList: List,
  JSpinner: ArrowUpDown,
  JSlider: SlidersHorizontal,
  JProgressBar: Gauge,
  JPanel: PanelTop,
};

const LABELS: Record<ComponentType, string> = {
  JButton: "Button",
  JLabel: "Label",
  JTextField: "Text field",
  JPasswordField: "Password field",
  JTextArea: "Text area",
  JCheckBox: "Check box",
  JRadioButton: "Radio button",
  JComboBox: "Combo box",
  JList: "List",
  JSpinner: "Spinner",
  JSlider: "Slider",
  JProgressBar: "Progress bar",
  JPanel: "Panel",
};

const DRAG_TYPE = "application/x-logiq-swing";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Drag =
  | { kind: "move"; start: { x: number; y: number }; origin: Map<string, Box>; moved: boolean }
  | { kind: "resize"; name: string; handle: Handle; start: { x: number; y: number }; origin: Box }
  | { kind: "marquee"; start: { x: number; y: number }; base: string[] }
  | { kind: "create"; type: ComponentType; start: { x: number; y: number } };

interface Preview {
  boxes: Map<string, Box>;
  guides: Guide[];
  marquee?: Box;
  creating?: Box;
}

/** Components copied with Ctrl+C, for Ctrl+V (in any window). */
let clipboard: GuiComponent[] = [];

/** Where a new component goes in the code: panels last (Swing draws them under the others). */
function insert(list: GuiComponent[], c: GuiComponent) {
  if (c.type === "JPanel") list.push(c);
  else {
    const at = list.findIndex((x) => x.type === "JPanel");
    list.splice(at < 0 ? list.length : at, 0, c);
  }
}

export function GuiDesigner({ path }: { path: string }) {
  const [text, setText] = useState(() => getDoc(path)?.state.doc.toString() ?? "");
  useEffect(() => {
    const read = () => setText(getDoc(path)?.state.doc.toString() ?? "");
    read();
    return watchDoc(path, read);
  }, [path]);
  const parsed = useMemo(() => parseForm(text), [text]);
  const form = parsed?.form ?? null;

  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<ComponentType | null>(null);
  const [preview, setPreviewState] = useState<Preview | null>(null);
  // Also in a ref: the pointer can be released before React has drawn the last move.
  const previewRef = useRef<Preview | null>(null);
  const setPreview = (p: Preview | null) => {
    previewRef.current = p;
    setPreviewState(p);
  };
  const [smart, setSmart] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<Drag | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);

  // Forget selected names that are gone (deleted, or renamed in the code).
  useEffect(() => {
    if (!form) return;
    const names = new Set(form.components.map((c) => c.name));
    setSelection((s) => (s.every((n) => names.has(n)) ? s : s.filter((n) => names.has(n))));
  }, [form]);

  const todo = useCallback((component: string, e: EventKind) => {
    void e;
    return t("TODO: what happens when {0} is used", component);
  }, []);

  /** Changes the form and writes it into the code (one undo step). */
  const edit = useCallback(
    (mutate: (p: ParsedForm) => void) => {
      const doc = getDoc(path);
      if (!doc) return;
      const src = doc.state.doc.toString();
      const p = parseForm(src);
      if (!p) return;
      mutate(p);
      const change = minimalChange(src, writeForm(src, p, todo));
      if (change) changeDoc(path, [change], "input.design");
    },
    [path, todo],
  );

  const rename = (from: string, to: string) => {
    const doc = getDoc(path);
    if (!doc || from === to) return;
    const src = doc.state.doc.toString();
    const change = minimalChange(src, renameInCode(src, from, to));
    if (change) changeDoc(path, [change], "input.design");
    setSelection((s) => s.map((n) => (n === from ? to : n)));
  };

  const goToHandler = (method: string) => {
    const line = methodLine(getDoc(path)?.state.doc.toString() ?? "", method);
    void showCode(line ?? undefined);
  };

  /** Shows the class's code beside the designer (in the other editor group). */
  const showCode = async (line?: number) => {
    const design = get().tabs.find((x) => x.id === `gui:${path}`);
    const code = get().tabs.find((x) => x.kind === "file" && x.path?.toLowerCase() === path.toLowerCase());
    if (design && code && code.group === design.group) moveToGroup(code.id, design.group === 0 ? 1 : 0);
    const now = get().tabs.find((x) => x.kind === "file" && x.path?.toLowerCase() === path.toLowerCase());
    // The jump to the line goes to the group the code is in.
    if (now) focusGroup(now.group);
    await openFile(path, line ? { line, col: 1 } : undefined);
  };

  const addEvent = (name: string, e: EventKind, on: boolean, jump = false) => {
    edit((p) => {
      const c = p.form.components.find((x) => x.name === name);
      if (!c) return;
      c.events = on ? [...new Set([...c.events, e])] : c.events.filter((x) => x !== e);
    });
    if (on && jump) window.setTimeout(() => goToHandler(handlerName(name, e)), 0);
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const r = content.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  if (!form || !parsed) {
    return (
      <div className="gd gd-empty">
        <EmptyState icon={AppWindow} title={t("No designer regions in this class")} actions={<Button onClick={() => void showCode()}>{t("Open the code")}</Button>}>
          {t("The designer works on classes it made (File → New Swing window), between the // GUI-BEGIN and // GUI-END comments.")}
        </EmptyState>
      </div>
    );
  }

  const shown = form.components.map((c) => {
    const b = preview?.boxes.get(c.name);
    return b ? { ...c, ...b } : c;
  });
  const selected = selection.map((n) => shown.find((c) => c.name === n)).filter((c): c is GuiComponent => !!c);
  const others = (names: Set<string>) => shown.filter((c) => !names.has(c.name));
  const frame = { w: form.width, h: form.height };
  const opts = { grid: 8, smart };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    canvas.current?.focus();
    const p = point(e);
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-name],[data-handle]");
    try {
      canvas.current?.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured.
    }
    if (tool) {
      drag.current = { kind: "create", type: tool, start: p };
      return;
    }
    if (target?.dataset.handle && selected.length === 1) {
      const c = selected[0];
      drag.current = { kind: "resize", name: c.name, handle: target.dataset.handle as Handle, start: p, origin: { x: c.x, y: c.y, w: c.w, h: c.h } };
      return;
    }
    const name = target?.dataset.name;
    if (name) {
      let next = selection;
      if (e.shiftKey || e.ctrlKey) next = selection.includes(name) ? selection.filter((n) => n !== name) : [...selection, name];
      else if (!selection.includes(name)) next = [name];
      setSelection(next);
      if (!next.includes(name)) return;
      const origin = new Map(next.map((n) => [n, shown.find((c) => c.name === n)!]).map(([n, c]) => [n as string, { x: (c as GuiComponent).x, y: (c as GuiComponent).y, w: (c as GuiComponent).w, h: (c as GuiComponent).h }]));
      drag.current = { kind: "move", start: p, origin, moved: false };
      return;
    }
    drag.current = { kind: "marquee", start: p, base: e.shiftKey || e.ctrlKey ? selection : [] };
    if (!e.shiftKey && !e.ctrlKey) setSelection([]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.kind === "move") {
      if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
      d.moved = true;
      const all = bounds([...d.origin.values()]);
      const free = e.altKey ? { box: { ...all, x: all.x + dx, y: all.y + dy }, guides: [] } : snapMove({ ...all, x: all.x + dx, y: all.y + dy }, others(new Set(d.origin.keys())), frame, opts);
      const ox = free.box.x - all.x;
      const oy = free.box.y - all.y;
      const boxes = new Map([...d.origin].map(([n, b]) => [n, clampInto({ ...b, x: Math.round(b.x + ox), y: Math.round(b.y + oy) }, frame)]));
      setPreview({ boxes, guides: free.guides });
    } else if (d.kind === "resize") {
      const r = snapResize(d.origin, d.handle, dx, dy, others(new Set([d.name])), frame, e.altKey ? { grid: 1, smart: false } : opts);
      setPreview({ boxes: new Map([[d.name, { ...r.box, x: Math.round(r.box.x), y: Math.round(r.box.y), w: Math.round(r.box.w), h: Math.round(r.box.h) }]]), guides: r.guides });
    } else if (d.kind === "marquee") {
      const m = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
      setPreview({ boxes: new Map(), guides: [], marquee: m });
      const hit = shown.filter((c) => intersects(m, c)).map((c) => c.name);
      setSelection([...new Set([...d.base, ...hit])]);
    } else if (d.kind === "create") {
      const g = e.altKey ? 1 : 8;
      const x = Math.round(Math.min(d.start.x, p.x) / g) * g;
      const y = Math.round(Math.min(d.start.y, p.y) / g) * g;
      setPreview({ boxes: new Map(), guides: [], creating: { x, y, w: Math.round(Math.abs(dx) / g) * g, h: Math.round(Math.abs(dy) / g) * g } });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const pv = previewRef.current;
    setPreview(null);
    if (!d) return;
    if (d.kind === "move" && d.moved && pv) {
      edit((p) => {
        for (const c of p.form.components) {
          const b = pv.boxes.get(c.name);
          if (b) Object.assign(c, { x: b.x, y: b.y });
        }
      });
    } else if (d.kind === "resize" && pv) {
      const b = pv.boxes.get(d.name);
      if (b) edit((p) => Object.assign(p.form.components.find((c) => c.name === d.name)!, b));
    } else if (d.kind === "create") {
      const at = point(e);
      const big = pv?.creating && pv.creating.w >= 8 && pv.creating.h >= 8 ? pv.creating : null;
      place(d.type, big ?? { x: Math.round(Math.min(d.start.x, at.x) / 8) * 8, y: Math.round(Math.min(d.start.y, at.y) / 8) * 8 });
      if (!e.shiftKey) setTool(null);
    }
  };

  /** Puts a new component into the window. */
  const place = (type: ComponentType, at: { x: number; y: number; w?: number; h?: number }) => {
    let name = "";
    edit((p) => {
      const c = newComponent(p.form, type, Math.max(0, at.x), Math.max(0, at.y));
      if (at.w && at.h) Object.assign(c, { w: at.w, h: at.h });
      name = c.name;
      insert(p.form.components, c);
    });
    if (name) setSelection([name]);
  };

  const remove = (names: string[]) => {
    if (!names.length) return;
    edit((p) => {
      p.form.components = p.form.components.filter((c) => !names.includes(c.name));
      for (const n of names) p.extras.delete(n);
    });
    setSelection([]);
  };

  const paste = (list: GuiComponent[], offset: number) => {
    if (!list.length) return;
    const names: string[] = [];
    edit((p) => {
      for (const src of list) {
        const c: GuiComponent = { ...structuredClone(src), x: src.x + offset, y: src.y + offset, events: [] };
        c.name = freeName(p.form, componentInfo(c.type).prefix);
        names.push(c.name);
        insert(p.form.components, c);
      }
    });
    setSelection(names);
  };

  const nudge = (dx: number, dy: number) =>
    edit((p) => {
      for (const c of p.form.components) if (selection.includes(c.name)) Object.assign(c, { x: c.x + dx, y: c.y + dy });
    });

  const reorder = (front: boolean) =>
    edit((p) => {
      const moving = p.form.components.filter((c) => selection.includes(c.name));
      const rest = p.form.components.filter((c) => !selection.includes(c.name));
      // Swing paints what is added first on top.
      p.form.components = front ? [...moving, ...rest] : [...rest, ...moving];
    });

  const doAlign = (kind: AlignKind) => {
    const boxes = align(selected, kind);
    edit((p) => {
      selected.forEach((s, i) => Object.assign(p.form.components.find((c) => c.name === s.name)!, { x: boxes[i].x, y: boxes[i].y, w: boxes[i].w, h: boxes[i].h }));
    });
  };

  /** Double-click: the component's main event, written if it isn't yet, and its handler shown. */
  const openDefaultEvent = (c: GuiComponent) => {
    const e = c.events[0] ?? componentInfo(c.type).events[0];
    if (!e) return;
    if (c.events.includes(e)) goToHandler(handlerName(c.name, e));
    else addEvent(c.name, e, true, true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? 8 : 1;
    const key = e.key.toLowerCase();
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Delete" || e.key === "Backspace") return handled(), remove(selection);
    if (e.key === "Escape") return handled(), setTool(null), setSelection([]);
    // Without a mouse: an arrow key picks the first component, Tab goes on to the next one.
    if (!selection.length && e.key.startsWith("Arrow") && form.components.length) return handled(), setSelection([form.components[0].name]);
    if (e.key === "Tab" && selection.length === 1 && form.components.length > 1 && !mod) {
      const i = form.components.findIndex((c) => c.name === selection[0]);
      const next = i + (e.shiftKey ? -1 : 1);
      // Past the last (or before the first) one, Tab leaves the canvas as usual.
      if (next >= 0 && next < form.components.length) return handled(), setSelection([form.components[next].name]);
      return;
    }
    if (selection.length && e.key.startsWith("Arrow")) {
      handled();
      return nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
    }
    if (e.key === "Enter" && selected.length === 1) return handled(), openDefaultEvent(selected[0]);
    if (!mod) return;
    if (key === "a") return handled(), setSelection(form.components.map((c) => c.name));
    if (key === "c" || key === "x") {
      handled();
      clipboard = structuredClone(selected);
      if (key === "x") remove(selection);
      return;
    }
    if (key === "v") return handled(), paste(clipboard, 16);
    if (key === "d") return handled(), paste(selected, 16);
  };

  const contextMenu = (e: React.MouseEvent, c: GuiComponent) => {
    e.preventDefault();
    e.stopPropagation();
    const sel = selection.includes(c.name) ? selection : [c.name];
    setSelection(sel);
    const events = c.events.map((ev): MenuItem => ({ label: `${handlerName(c.name, ev)}()`, icon: Code, onSelect: () => goToHandler(handlerName(c.name, ev)) }));
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(events.length ? [{ type: "heading" as const, label: t("Event handlers") }, ...events, { type: "separator" as const }] : []),
        ...(sel.length === 1 && componentInfo(c.type).events.length && !c.events.length ? [{ label: t("Write an event handler"), icon: Code, onSelect: () => openDefaultEvent(c) }, { type: "separator" as const }] : []),
        { label: t("Bring to front"), icon: BringToFront, onSelect: () => reorder(true) },
        { label: t("Send to back"), icon: SendToBack, onSelect: () => reorder(false) },
        { label: t("Duplicate"), icon: Copy, shortcut: "Ctrl+D", onSelect: () => paste(sel.map((n) => shown.find((x) => x.name === n)!).filter(Boolean), 16) },
        { type: "separator" },
        { label: t("Delete"), icon: Trash2, danger: true, shortcut: "Del", onSelect: () => remove(sel) },
      ],
    });
  };

  const single = selected.length === 1 ? selected[0] : null;
  const selBox = selected.length > 1 ? bounds(selected) : null;

  return (
    <div className="gd">
      <div className="gd-toolbar">
        <span className="gd-title">
          <AppWindow size={14} aria-hidden="true" />
          {form.className}
        </span>
        <span className="spacer" />
        <IconButton icon={Undo2} label={t("Undo")} shortcut="Ctrl+Z" spacing="compact" onClick={() => runOnDoc(path, undo)} />
        <IconButton icon={Redo2} label={t("Redo")} shortcut="Ctrl+Y" spacing="compact" onClick={() => runOnDoc(path, redo)} />
        <span className="gd-sep" />
        <IconButton icon={Magnet} label={smart ? t("Snapping to other components: on") : t("Snapping to other components: off")} spacing="compact" selected={smart} onClick={() => setSmart(!smart)} />
        <IconButton icon={Grid3x3} label={showGrid ? t("Hide the grid") : t("Show the grid")} spacing="compact" selected={showGrid} onClick={() => setShowGrid(!showGrid)} />
        <select className="gd-zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label={t("Zoom")}>
          {[0.75, 1, 1.25, 1.5, 2].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)} %
            </option>
          ))}
        </select>
        <span className="gd-sep" />
        <Button spacing="compact" iconBefore={Code} onClick={() => void showCode()}>
          {t("Code")}
        </Button>
        <Button spacing="compact" appearance="primary" iconBefore={Play} onClick={() => void runActive()}>
          {t("Run")}
        </Button>
      </div>
      <div className="gd-body">
        <div className="gd-palette" role="toolbar" aria-label={t("Components")}>
          <div className="gd-palette-head">{t("Components")}</div>
          {COMPONENTS.map((c) => {
            const Icon = ICONS[c.type];
            return (
              <button
                key={c.type}
                type="button"
                className={cx("gd-palette-item", tool === c.type && "is-selected")}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, c.type);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => setTool(tool === c.type ? null : c.type)}
                data-tooltip={`${c.type} — ${t("drag into the window, or click and then draw it")}`}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{t(LABELS[c.type])}</span>
              </button>
            );
          })}
        </div>
        <div
          ref={canvas}
          className={cx("gd-canvas", tool && "is-placing")}
          tabIndex={0}
          role="application"
          aria-label={t("Window designer, components: {0}. Arrow keys select and move, Tab goes to the next component, Enter opens its event handler, Delete removes it.", form.components.length)}
          onKeyDown={onKeyDown}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const type = e.dataTransfer.getData(DRAG_TYPE) as ComponentType;
            if (!type) return;
            e.preventDefault();
            const p = point(e);
            const info = componentInfo(type);
            place(type, { x: Math.round((p.x - info.w / 2) / 8) * 8, y: Math.round((p.y - info.h / 2) / 8) * 8 });
            canvas.current?.focus();
          }}
        >
          <div className="gd-window" style={{ width: form.width * zoom + 2 }}>
            <div className="gd-titlebar">
              <AppWindow size={13} aria-hidden="true" />
              <span className="gd-titlebar-text">{form.title || form.className}</span>
              <span className="gd-titlebar-buttons" aria-hidden="true">
                <span>&#x2013;</span>
                <span>{form.resizable ? "□" : ""}</span>
                <span>&#x2715;</span>
              </span>
            </div>
            <div
              ref={content}
              className={cx("gd-content", showGrid && "has-grid")}
              style={{ width: form.width * zoom, height: form.height * zoom, background: form.background, backgroundSize: `${8 * zoom}px ${8 * zoom}px` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={(e) => {
                const name = (e.target as HTMLElement).closest<HTMLElement>("[data-name]")?.dataset.name;
                const c = name && form.components.find((x) => x.name === name);
                if (c) openDefaultEvent(c);
              }}
            >
              <div className="gd-scale" style={{ transform: `scale(${zoom})` }}>
                {/* Swing paints the first added on top: draw in reverse. */}
                {[...shown].reverse().map((c) => (
                  <div
                    key={c.name}
                    data-name={c.name}
                    className={cx("gd-comp", selection.includes(c.name) && "is-selected")}
                    style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
                    onContextMenu={(e) => contextMenu(e, c)}
                    title={c.name}
                    role="img"
                    aria-label={`${c.type} ${c.name}${c.text ? `: ${c.text}` : ""}`}
                  >
                    <ComponentView c={c} />
                  </div>
                ))}
                {selected.map((c) => (
                  <div key={"sel" + c.name} className="gd-selection" style={{ left: c.x, top: c.y, width: c.w, height: c.h }} />
                ))}
                {single &&
                  HANDLES.map((h) => (
                    <span
                      key={h}
                      data-handle={h}
                      className={`gd-handle is-${h}`}
                      style={{
                        left: single.x + (h.includes("w") ? 0 : h.includes("e") ? single.w : single.w / 2),
                        top: single.y + (h.includes("n") ? 0 : h.includes("s") ? single.h : single.h / 2),
                        transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                      }}
                    />
                  ))}
                {selBox && <div className="gd-group" style={{ left: selBox.x - 3, top: selBox.y - 3, width: selBox.w + 6, height: selBox.h + 6 }} />}
                {preview?.guides.map((g, i) =>
                  g.axis === "x" ? (
                    <div key={i} className="gd-guide is-x" style={{ left: g.at, top: g.from, height: g.to - g.from }} />
                  ) : (
                    <div key={i} className="gd-guide is-y" style={{ top: g.at, left: g.from, width: g.to - g.from }} />
                  ),
                )}
                {preview?.marquee && <div className="gd-marquee" style={{ left: preview.marquee.x, top: preview.marquee.y, width: preview.marquee.w, height: preview.marquee.h }} />}
                {preview?.creating && <div className="gd-creating" style={{ left: preview.creating.x, top: preview.creating.y, width: preview.creating.w, height: preview.creating.h }} />}
                {single && preview?.boxes.has(single.name) && (
                  <div className="gd-size" style={{ left: single.x, top: single.y + single.h + 6 }}>
                    {single.x}, {single.y} · {single.w} × {single.h}
                  </div>
                )}
              </div>
              {!form.components.length && !tool && <div className="gd-hint">{t("Drag a component from the left into the window")}</div>}
            </div>
          </div>
        </div>
        <div className="gd-inspector">
          <Inspector
            form={form}
            selected={selected}
            onForm={(patch) => edit((p) => Object.assign(p.form, patch))}
            onComponent={(name, patch) =>
              edit((p) => {
                const c = p.form.components.find((x) => x.name === name);
                if (!c) return;
                Object.assign(c, patch);
                for (const k of Object.keys(patch) as (keyof GuiComponent)[]) if (patch[k] === undefined) delete c[k];
              })
            }
            onRename={(from, to) => {
              if (from === to) return;
              if (form.components.some((c) => c.name === to)) return toast("error", t("Another component has that name."));
              rename(from, to);
            }}
            onEvent={(name, ev, on) => addEvent(name, ev, on)}
            onGoToHandler={goToHandler}
            onAlign={doAlign}
            onDelete={() => remove(selection)}
          />
        </div>
      </div>
    </div>
  );
}
