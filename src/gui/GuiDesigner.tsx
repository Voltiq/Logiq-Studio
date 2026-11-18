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
import { childrenOf, codeOrder, containerAt, copyComponents, descendants, isContainer, moveInto, originOf, parentOf, pasteComponents, topmost } from "./tree";
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
  /** Where the dragged components are, in window coordinates. */
  boxes: Map<string, Box>;
  /** They are being moved (drawn above everything, and may go into another panel). */
  moving?: boolean;
  /** The panel they would go into. */
  target?: string | null;
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

  // Where everything is in the window (components in panels are placed relative to them), with what is being
  // dragged where it is going.
  const byName = new Map(form.components.map((c) => [c.name, c]));
  const absCache = new Map<string, Box>();
  const absOf = (c: GuiComponent, depth = 0): Box => {
    const known = absCache.get(c.name);
    if (known) return known;
    const parent = parentOf(form, c);
    const o = parent && depth < 50 ? absOf(byName.get(parent)!, depth + 1) : { x: 0, y: 0 };
    const b = preview?.boxes.get(c.name) ?? { x: c.x + o.x, y: c.y + o.y, w: c.w, h: c.h };
    absCache.set(c.name, b);
    return b;
  };
  const shown = form.components.map((c) => ({ ...c, ...absOf(c) }));
  const selected = selection.map((n) => shown.find((c) => c.name === n)).filter((c): c is GuiComponent => !!c);
  /** What can be snapped to: everything but these and what is inside them. */
  const others = (names: Set<string>) => {
    const out = new Set([...names].flatMap((n) => [n, ...descendants(form, n).map((d) => d.name)]));
    return shown.filter((c) => !out.has(c.name));
  };
  /** The selection with whatever is inside selected panels, ready to copy. */
  const copyOf = (names: string[]) => copyComponents(form, names);
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
      // A selected panel takes what is inside it along.
      const origin = new Map(topmost(form, next).map((n) => [n, absOf(byName.get(n)!)]));
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
      setPreview({ boxes, guides: free.guides, moving: true, target: containerAt(form, p.x, p.y, [...d.origin.keys()]) });
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
      // Where the pointer lets go decides the panel they go into (or the window).
      const at = point(e);
      edit((p) => {
        const names = [...pv.boxes.keys()];
        const into = containerAt(p.form, at.x, at.y, names);
        for (const n of names) {
          const c = p.form.components.find((x) => x.name === n);
          if (c) moveInto(p.form, c, into, pv.boxes.get(n)!);
        }
      });
    } else if (d.kind === "resize" && pv) {
      const b = pv.boxes.get(d.name);
      if (b)
        edit((p) => {
          const c = p.form.components.find((x) => x.name === d.name);
          if (!c) return;
          const o = originOf(p.form, c);
          Object.assign(c, { x: b.x - o.x, y: b.y - o.y, w: b.w, h: b.h });
        });
    } else if (d.kind === "create") {
      const at = point(e);
      const big = pv?.creating && pv.creating.w >= 8 && pv.creating.h >= 8 ? pv.creating : null;
      place(d.type, big ?? { x: Math.round(Math.min(d.start.x, at.x) / 8) * 8, y: Math.round(Math.min(d.start.y, at.y) / 8) * 8 }, d.start);
      if (!e.shiftKey) setTool(null);
    }
  };

  /** Puts a new component into the window, or into the panel under `pointer`; `at` is in window coordinates. */
  const place = (type: ComponentType, at: { x: number; y: number; w?: number; h?: number }, pointer: { x: number; y: number } = at) => {
    let name = "";
    edit((p) => {
      const c = newComponent(p.form, type, 0, 0);
      if (at.w && at.h) Object.assign(c, { w: at.w, h: at.h });
      name = c.name;
      insert(p.form.components, c);
      moveInto(p.form, c, containerAt(p.form, pointer.x, pointer.y, [c.name]), { x: Math.max(0, at.x), y: Math.max(0, at.y) });
    });
    if (name) setSelection([name]);
  };

  /** Deletes components, and what is inside deleted panels. */
  const remove = (names: string[]) => {
    if (!names.length) return;
    edit((p) => {
      const gone = new Set(names.flatMap((n) => [n, ...descendants(p.form, n).map((d) => d.name)]));
      p.form.components = p.form.components.filter((c) => !gone.has(c.name));
      for (const n of gone) p.extras.delete(n);
    });
    setSelection([]);
  };

  /**
   * Adds copies (from copyOf: the outer ones in window coordinates, what was inside them relative to them). An
   * outer copy goes into the panel where it lands.
   */
  const paste = (list: GuiComponent[], offset: number) => {
    if (!list.length) return;
    let names: string[] = [];
    edit((p) => {
      names = pasteComponents(p.form, list, offset, (f, x) => freeName(f, componentInfo(x.type).prefix), insert);
    });
    setSelection(names);
  };

  const nudge = (dx: number, dy: number) =>
    edit((p) => {
      const moving = topmost(p.form, selection);
      for (const c of p.form.components) if (moving.includes(c.name)) Object.assign(c, { x: c.x + dx, y: c.y + dy });
    });

  /** Puts a component into another panel (or the window), where it is now in the window, but inside the panel's area. */
  const putInto = (name: string, parent: string | null) => {
    const c = byName.get(name);
    if (!c) return;
    const b = absOf(c);
    edit((p) => {
      const own = p.form.components.find((x) => x.name === name);
      if (!own) return;
      moveInto(p.form, own, parent, b);
      // Outside its panel Swing doesn't show it: pull it in.
      const box = parent ? p.form.components.find((x) => x.name === parent) : { w: p.form.width, h: p.form.height };
      if (box) {
        own.x = Math.max(0, Math.min(own.x, box.w - Math.min(own.w, box.w)));
        own.y = Math.max(0, Math.min(own.y, box.h - Math.min(own.h, box.h)));
      }
    });
  };

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
      const own = selected.map((s) => p.form.components.find((c) => c.name === s.name)!);
      // Window coordinates back to each one's panel, all worked out before any moves.
      const origins = own.map((c) => originOf(p.form, c));
      own.forEach((c, i) => Object.assign(c, { x: boxes[i].x - origins[i].x, y: boxes[i].y - origins[i].y, w: boxes[i].w, h: boxes[i].h }));
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
    if (!selection.length && e.key.startsWith("Arrow") && form.components.length) return handled(), setSelection([codeOrder(form)[0].name]);
    if (e.key === "Tab" && selection.length === 1 && form.components.length > 1 && !mod) {
      const order = codeOrder(form);
      const i = order.findIndex((c) => c.name === selection[0]);
      const next = i + (e.shiftKey ? -1 : 1);
      // Past the last (or before the first) one, Tab leaves the canvas as usual.
      if (next >= 0 && next < order.length) return handled(), setSelection([order[next].name]);
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
      clipboard = copyOf(selection);
      if (key === "x") remove(selection);
      return;
    }
    if (key === "v") return handled(), paste(clipboard, 16);
    if (key === "d") return handled(), paste(copyOf(selection), 16);
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
        { label: t("Duplicate"), icon: Copy, shortcut: "Ctrl+D", onSelect: () => paste(copyOf(sel), 16) },
        { type: "separator" },
        { label: t("Delete"), icon: Trash2, danger: true, shortcut: "Del", onSelect: () => remove(sel) },
      ],
    });
  };

  /** A component at `at` (relative to what it is drawn in), with what is inside it. */
  const renderComp = (c: GuiComponent, at: { x: number; y: number }, lifted = false): React.ReactNode => {
    const b = absOf(c);
    const panel = isContainer(c);
    const inside = panel ? childrenOf(form, c.name).length : 0;
    return (
      <div
        key={c.name}
        data-name={c.name}
        className={cx("gd-comp", selection.includes(c.name) && "is-selected", lifted && "is-lifted", panel && "is-container")}
        style={{ left: at.x, top: at.y, width: b.w, height: b.h }}
        onContextMenu={(e) => contextMenu(e, c)}
        title={c.name}
        role={panel ? "group" : "img"}
        aria-label={panel ? t("{0} {1}, {2} components inside", c.type, c.name, inside) : `${c.type} ${c.name}${c.text ? `: ${c.text}` : ""}`}
      >
        <ComponentView c={c} />
        {panel && inside > 0 && <div className="gd-children">{renderLevel(c.name)}</div>}
      </div>
    );
  };

  /** What is in the window (null) or a panel, placed relative to it. Swing paints the first added on top: drawn in reverse. */
  const renderLevel = (parent: string | null): React.ReactNode[] => {
    const o = parent ? absOf(byName.get(parent)!) : { x: 0, y: 0 };
    return [...childrenOf(form, parent)]
      .reverse()
      .filter((c) => !(preview?.moving && preview.boxes.has(c.name)))
      .map((c) => {
        const b = absOf(c);
        return renderComp(c, { x: b.x - o.x, y: b.y - o.y });
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
            place(type, { x: Math.round((p.x - info.w / 2) / 8) * 8, y: Math.round((p.y - info.h / 2) / 8) * 8 }, p);
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
                {renderLevel(null)}
                {/* What is being moved, above everything until it lands. */}
                {preview?.moving && [...preview.boxes.keys()].map((n) => byName.get(n)).filter((c): c is GuiComponent => !!c).reverse().map((c) => renderComp(c, absOf(c), true))}
                {preview?.moving && preview.target && byName.has(preview.target) && (() => {
                  const b = absOf(byName.get(preview.target)!);
                  return <div className="gd-drop-target" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />;
                })()}
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
            selected={selected.map((s) => byName.get(s.name)!)}
            containers={
              single
                ? form.components.filter((c) => isContainer(c) && c.name !== single.name && !descendants(form, single.name).some((d) => d.name === c.name)).map((c) => c.name)
                : []
            }
            onContainer={putInto}
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
