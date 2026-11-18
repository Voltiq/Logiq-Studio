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
import { changeDoc, focusGroup, moveToGroup, openFile, runActive, runFxWindow, runOnDoc, watchDoc } from "../lib/actions";
import { get, openMenu, toast } from "../lib/store";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/Feedback";
import type { MenuItem } from "../components/ui/Menu";
import { methodLine, minimalChange, parseForm, renameInCode, writeForm, type ParsedForm } from "./codegen";
import { FX_NAMES, parseFxml, writeFxml, type FxParsed } from "./fxml";
import { controllerPath, forgetInFxml, renameInController, renameInFxml, syncControllerFile } from "./fxDesign";
import { api } from "../lib/api";
import { stem } from "../lib/paths";
import { COMPONENTS, componentInfo, eventsOf, freeName, handlerName, newComponent, type ComponentType, type EventKind, type GuiComponent } from "./model";

/** What the designer edits: a Swing class's form, or a JavaFX window's FXML. */
type Editable = ParsedForm | FxParsed;
import { align, bounds, clampInto, intersects, snapMove, snapResize, type AlignKind, type Box, type Guide, type Handle } from "./geometry";
import { ComponentView } from "./render";
import { cellAt, childBoxes, childrenOf, codeOrder, containerAt, copyComponents, descendants, dropInto, isContainer, layoutOf, moveInto, originOf, parentOf, pasteComponents, placeInOrder, setLayout, topmost } from "./tree";
import { indexAt, regionAt, type Layout, type Region } from "./layout";
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
  /** In a laid-out panel: where in its order (a bar), or which region, they would go. */
  slot?: Box;
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
  // A JavaFX window (.fxml, with its controller class) or a Swing window class.
  const fx = /\.fxml$/i.test(path);
  const parsed = useMemo<Editable | null>(() => (fx ? parseFxml(text, stem(path)) : parseForm(text)), [text, fx, path]);
  const form = parsed?.form ?? null;
  const toolkit = form?.toolkit;
  /** The controller's sync after the last change (handlers are jumped to once it is written). */
  const synced = useRef<Promise<void>>(Promise.resolve());

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
    (mutate: (p: Editable) => void) => {
      const doc = getDoc(path);
      if (!doc) return;
      const src = doc.state.doc.toString();
      const p = fx ? parseFxml(src, stem(path)) : parseForm(src);
      if (!p) return;
      mutate(p);
      const out = "rootName" in p ? writeFxml(p) : writeForm(src, p, todo);
      const change = minimalChange(src, out);
      if (change) changeDoc(path, [change], "input.design");
      // JavaFX: the controller gets the fields and handlers.
      if ("rootName" in p) synced.current = synced.current.then(() => syncControllerFile(path, p.form, p.controller, todo)).catch((e) => toast("error", t("The controller wasn't changed"), String(e)));
    },
    [path, todo, fx],
  );

  const rename = (from: string, to: string) => {
    const doc = getDoc(path);
    if (!doc || from === to) return;
    const src = doc.state.doc.toString();
    let out = renameInCode(src, from, to);
    if (fx) {
      const p = parseFxml(src, stem(path));
      if (!p) return;
      renameInFxml(p, from, to);
      out = writeFxml(p);
      synced.current = synced.current.then(() => renameInController(path, p.controller, (text) => renameInCode(text, from, to)));
    }
    const change = minimalChange(src, out);
    if (change) changeDoc(path, [change], "input.design");
    setSelection((s) => s.map((n) => (n === from ? to : n)));
  };

  /** The file the handlers are in: the class itself, or a JavaFX window's controller. */
  const handlerFile = () => (fx && parsed && "controller" in parsed && parsed.controller ? controllerPath(path, parsed.controller) : path);

  const goToHandler = async (method: string) => {
    await synced.current;
    const file = handlerFile();
    const text = getDoc(file)?.state.doc.toString() ?? (await api.readText(file).then((f) => f.text).catch(() => ""));
    void showCode(methodLine(text, method) ?? undefined, file);
  };

  /** Shows code beside the designer (in the other editor group): the class's, or another file's. */
  const showCode = async (line?: number, file = path) => {
    const design = get().tabs.find((x) => x.id === `gui:${path}`);
    const same = (x: { kind: string; path?: string | null }) => x.kind === "file" && x.path?.toLowerCase() === file.toLowerCase();
    const code = get().tabs.find(same);
    if (design && code && code.group === design.group) moveToGroup(code.id, design.group === 0 ? 1 : 0);
    const now = get().tabs.find(same);
    // The jump to the line goes to the group the code is in; a file not open yet opens beside the designer.
    if (now) focusGroup(now.group);
    else if (design) focusGroup(design.group === 0 ? 1 : 0);
    await openFile(file, line ? { line, col: 1 } : undefined);
  };

  const addEvent = (name: string, e: EventKind, on: boolean, jump = false) => {
    edit((p) => {
      const c = p.form.components.find((x) => x.name === name);
      if (!c) return;
      c.events = on ? [...new Set([...c.events, e])] : c.events.filter((x) => x !== e);
    });
    if (on && jump) window.setTimeout(() => void goToHandler(handlerName(name, e, toolkit)), 0);
  };

  const point = (e: { clientX: number; clientY: number }) => {
    const r = content.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  if (!form || !parsed) {
    return (
      <div className="gd gd-empty">
        {fx ? (
          <EmptyState icon={AppWindow} title={t("This FXML can't be shown yet")} actions={<Button onClick={() => void showCode()}>{t("Open the code")}</Button>}>
            {t("The designer shows FXML whose root is a pane (AnchorPane, Pane, VBox, HBox, FlowPane, GridPane, BorderPane or StackPane) and that is well-formed XML.")}
          </EmptyState>
        ) : (
          <EmptyState icon={AppWindow} title={t("No designer regions in this class")} actions={<Button onClick={() => void showCode()}>{t("Open the code")}</Button>}>
            {t("The designer works on classes it made (File → New Swing window), between the // GUI-BEGIN and // GUI-END comments.")}
          </EmptyState>
        )}
      </div>
    );
  }

  // Where everything is in the window (components in panels are placed relative to them), with what is being
  // dragged where it is going.
  const byName = new Map(form.components.map((c) => [c.name, c]));
  const absCache = new Map<string, Box>();
  const laidCache = new Map<string | null, Map<string, Box> | null>();
  const absOf = (c: GuiComponent, depth = 0): Box => {
    const known = absCache.get(c.name);
    if (known) return known;
    const parent = parentOf(form, c) ?? null;
    const o = parent && depth < 50 ? absOf(byName.get(parent)!, depth + 1) : { x: 0, y: 0, w: form.width, h: form.height };
    // In a laid-out panel (or window) the layout places it, at the size the panel has now.
    if (!laidCache.has(parent)) laidCache.set(parent, childBoxes(form, parent, { w: o.w, h: o.h }));
    const rel = laidCache.get(parent)?.get(c.name) ?? { x: c.x, y: c.y, w: c.w, h: c.h };
    const b = preview?.boxes.get(c.name) ?? { x: rel.x + o.x, y: rel.y + o.y, w: rel.w, h: rel.h };
    absCache.set(c.name, b);
    return b;
  };
  /** The box of a container (or the window, null), in window coordinates. */
  const containerBox = (name: string | null): Box => (name && byName.has(name) ? absOf(byName.get(name)!) : { x: 0, y: 0, w: form.width, h: form.height });
  /** Where a drop at a point goes in a laid-out container: the marker to show. */
  const slotAt = (into: string | null, x: number, y: number, moving: string[]): Box | undefined => {
    const layout = layoutOf(form, into);
    if (!layout) return undefined;
    const cb = containerBox(into);
    if (layout.kind === "border") {
      const r = regionAt(cb, x - cb.x, y - cb.y);
      const q = { w: cb.w / 4, h: cb.h / 4 };
      return r === "NORTH" ? { ...cb, h: q.h } : r === "SOUTH" ? { ...cb, y: cb.y + cb.h - q.h, h: q.h } : r === "WEST" ? { x: cb.x, y: cb.y + q.h, w: q.w, h: cb.h / 2 } : r === "EAST" ? { x: cb.x + cb.w - q.w, y: cb.y + q.h, w: q.w, h: cb.h / 2 } : { x: cb.x + q.w, y: cb.y + q.h, w: cb.w / 2, h: cb.h / 2 };
    }
    if (layout.kind === "stack") return cb;
    const stay = childrenOf(form, into).filter((c) => !moving.includes(c.name));
    if (layout.kind === "gridpane") {
      // The cell under the pointer: where the column and row are now, or a new one past them.
      const cell = cellAt(form, into, { x, y }, stay.length === childrenOf(form, into).length ? [] : childrenOf(form, into).filter((c) => moving.includes(c.name)));
      const inCol = stay.filter((c) => (c.cell?.col ?? 0) === cell.col).map(absOf);
      const inRow = stay.filter((c) => (c.cell?.row ?? 0) === cell.row).map(absOf);
      const cx = inCol.length ? Math.min(...inCol.map((b) => b.x)) : stay.length ? Math.max(...stay.map((c) => absOf(c).x + absOf(c).w)) + 4 : cb.x;
      const cy = inRow.length ? Math.min(...inRow.map((b) => b.y)) : stay.length ? Math.max(...stay.map((c) => absOf(c).y + absOf(c).h)) + 4 : cb.y;
      const w = inCol.length ? Math.max(...inCol.map((b) => b.w)) : 60;
      const h = inRow.length ? Math.max(...inRow.map((b) => b.h)) : 24;
      return { x: cx, y: cy, w, h };
    }
    const boxes = stay.map((c) => absOf(c));
    if (!boxes.length) return cb;
    const along = layout.kind === "vbox" ? "down" : layout.kind === "hbox" ? "across" : undefined;
    const i = indexAt(boxes, x, y, along);
    const b = boxes[Math.min(i, boxes.length - 1)];
    // A column: a bar above (or below the last); else a bar left of it (or right of the last).
    if (along === "down") return { x: b.x, y: i < boxes.length ? b.y - 3 : b.y + b.h + 1, w: Math.max(12, b.w), h: 2 };
    return { x: i < boxes.length ? b.x - 3 : b.x + b.w + 1, y: b.y, w: 2, h: Math.max(12, b.h) };
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
      const target = containerAt(form, p.x, p.y, [...d.origin.keys()]);
      const slot = slotAt(target, p.x, p.y, [...d.origin.keys()]);
      // Into a layout: it decides the place, so no guides.
      setPreview({ boxes, guides: slot ? [] : free.guides, moving: true, target, slot });
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
        // In a laid-out panel the pointer picks the place in its order, or its region.
        dropInto(p.form, names.map((n) => ({ name: n, abs: pv.boxes.get(n)! })), containerAt(p.form, at.x, at.y, names), at);
      });
    } else if (d.kind === "resize" && pv) {
      const b = pv.boxes.get(d.name);
      if (b)
        edit((p) => {
          const c = p.form.components.find((x) => x.name === d.name);
          if (!c) return;
          // In a layout only the size it asks for counts.
          if (layoutOf(p.form, parentOf(p.form, c) ?? null)) return Object.assign(c, { w: b.w, h: b.h });
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
      dropInto(p.form, [{ name: c.name, abs: { x: Math.max(0, at.x), y: Math.max(0, at.y) } }], containerAt(p.form, pointer.x, pointer.y, [c.name]), pointer);
    });
    if (name) setSelection([name]);
  };

  /** Deletes components, and what is inside deleted panels. */
  const remove = (names: string[]) => {
    if (!names.length) return;
    edit((p) => {
      const gone = new Set(names.flatMap((n) => [n, ...descendants(p.form, n).map((d) => d.name)]));
      p.form.components = p.form.components.filter((c) => !gone.has(c.name));
      for (const n of gone) {
        if ("extras" in p) p.extras.delete(n);
        else forgetInFxml(p, n);
      }
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

  /** Arrow keys: free components move; in a GridPane to the next cell; in other layouts earlier or later in the order. */
  const nudge = (dx: number, dy: number) =>
    edit((p) => {
      const moving = topmost(p.form, selection);
      for (const n of moving) {
        const c = p.form.components.find((x) => x.name === n);
        if (!c) continue;
        const parent = parentOf(p.form, c) ?? null;
        const layout = layoutOf(p.form, parent);
        if (!layout) Object.assign(c, { x: c.x + dx, y: c.y + dy });
        else if (layout.kind === "gridpane") c.cell = { row: Math.max(0, (c.cell?.row ?? 0) + Math.sign(dy)), col: Math.max(0, (c.cell?.col ?? 0) + Math.sign(dx)) };
        else if (layout.kind !== "border") {
          const i = childrenOf(p.form, parent).indexOf(c);
          placeInOrder(p.form, c, Math.max(0, i + Math.sign(dx + dy)));
        }
      }
    });

  /** Moves a component in its layout's order by one. */
  const reorderOne = (name: string, by: number) =>
    edit((p) => {
      const c = p.form.components.find((x) => x.name === name);
      if (!c) return;
      const i = childrenOf(p.form, parentOf(p.form, c) ?? null).indexOf(c);
      placeInOrder(p.form, c, Math.max(0, i + by));
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
    // A layout places its own components: only the free ones are lined up.
    const free = selected.filter((s) => !layoutOf(form, parentOf(form, s) ?? null));
    const boxes = align(free, kind);
    edit((p) => {
      const own = free.map((s) => p.form.components.find((c) => c.name === s.name)!);
      // Window coordinates back to each one's panel, all worked out before any moves.
      const origins = own.map((c) => originOf(p.form, c));
      own.forEach((c, i) => Object.assign(c, { x: boxes[i].x - origins[i].x, y: boxes[i].y - origins[i].y, w: boxes[i].w, h: boxes[i].h }));
    });
  };

  /** Double-click: the component's main event, written if it isn't yet, and its handler shown. */
  const openDefaultEvent = (c: GuiComponent) => {
    const e = c.events[0] ?? eventsOf(c.type, toolkit)[0];
    if (!e) return;
    if (c.events.includes(e)) void goToHandler(handlerName(c.name, e, toolkit));
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
    const events = c.events.map((ev): MenuItem => ({ label: `${handlerName(c.name, ev, toolkit)}()`, icon: Code, onSelect: () => void goToHandler(handlerName(c.name, ev, toolkit)) }));
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(events.length ? [{ type: "heading" as const, label: t("Event handlers") }, ...events, { type: "separator" as const }] : []),
        ...(sel.length === 1 && eventsOf(c.type, toolkit).length && !c.events.length ? [{ label: t("Write an event handler"), icon: Code, onSelect: () => openDefaultEvent(c) }, { type: "separator" as const }] : []),
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
    <div className={cx("gd", fx && "is-fx")}>
      <div className="gd-toolbar">
        <span className="gd-title">
          <AppWindow size={14} aria-hidden="true" />
          {fx ? `${stem(path)}.fxml` : form.className}
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
        <Button spacing="compact" appearance="primary" iconBefore={Play} onClick={() => void (fx ? runFxWindow(path) : runActive())}>
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
                data-tooltip={`${fx ? FX_NAMES[c.type] : c.type} — ${t("drag into the window, or click and then draw it")}`}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{fx ? FX_NAMES[c.type] : t(LABELS[c.type])}</span>
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
              <span className="gd-titlebar-text">{fx ? stem(path) : form.title || form.className}</span>
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
                {preview?.moving && preview.slot && <div className="gd-slot" style={{ left: preview.slot.x, top: preview.slot.y, width: preview.slot.w, height: preview.slot.h }} />}
                {selected.map((c) => (
                  <div key={"sel" + c.name} className="gd-selection" style={{ left: c.x, top: c.y, width: c.w, height: c.h }} />
                ))}
                {single &&
                  layoutOf(form, parentOf(form, single) ?? null)?.kind !== "grid" &&
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
            parentLayout={single ? layoutOf(form, parentOf(form, single) ?? null) : undefined}
            onLayout={(container: string | null, layout: Layout | undefined) => edit((p) => setLayout(p.form, container, layout))}
            onRegion={(name: string, region: Region) =>
              edit((p) => {
                const c = p.form.components.find((x) => x.name === name);
                if (!c) return;
                // Whoever was there takes this one's old region.
                const holder = childrenOf(p.form, parentOf(p.form, c) ?? null).find((s) => s !== c && (s.region ?? "CENTER") === region);
                if (holder) holder.region = c.region ?? "CENTER";
                c.region = region;
              })
            }
            onOrder={reorderOne}
            hidden={(() => {
              // The container shown: the selected panel, or the window when nothing is selected.
              const shownContainer = single && isContainer(single) ? single.name : selected.length ? undefined : null;
              if (shownContainer === undefined || layoutOf(form, shownContainer)?.kind !== "border") return [];
              // Covered by one added later to the same region (Swing shows the last).
              const kids = childrenOf(form, shownContainer);
              return kids.filter((k, i) => kids.slice(i + 1).some((o) => (o.region ?? "CENTER") === (k.region ?? "CENTER"))).map((k) => k.name);
            })()}
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
