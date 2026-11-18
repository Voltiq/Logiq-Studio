/*
 * JavaFX windows: an .fxml file the designer reads into the same model as a Swing window, and writes back. The
 * root is an AnchorPane (free placement, like a Swing window without a layout); panes inside it hold components
 * too. What the designer doesn't know (attributes, elements, imports, style rules) is kept as it is.
 *
 * Swing paints the first added component on top, JavaFX the last child: the model keeps Swing's order and the
 * children are written (and read) the other way round.
 */
import { attr, elements, parseXml, writeXml, type XmlElement, type XmlNode } from "./xml";
import { componentInfo, COMPONENTS, FX_COMPONENTS, FX_EVENTS, freeName, handlerName, type Align, type ComponentType, type EventKind, type GuiComponent, type GuiForm } from "./model";
import { childrenOf, isContainer, layoutOf, parentOf } from "./tree";
import { FX_PANES, defaultFxLayout, type FlowAlign, type Insets, type Layout, type Region } from "./layout";

export interface FxParsed {
  form: GuiForm;
  /** The root element's name (AnchorPane, Pane…) and the attributes the designer doesn't write. */
  rootName: string;
  rootAttrs: [string, string][];
  /** The controller class (`fx:controller`), qualified. */
  controller?: string;
  /** Imports the designer doesn't need itself. */
  imports: string[];
  /** Per component (or the root, ""): attributes, style rules and elements the designer doesn't know. */
  attrs: Map<string, [string, string][]>;
  style: Map<string, string>;
  props: Map<string, XmlElement[]>;
  /** Children of a pane (or the root, "") that aren't components the designer knows: kept, written after the rest. */
  foreign: Map<string, XmlElement[]>;
  /** Other things in `<fx:define>` than toggle groups. */
  defines: XmlElement[];
  /** The element names of panes without a layout (AnchorPane or Pane), by name ("" for the root). */
  paneNames: Map<string, string>;
}

const BY_FX = new Map<string, ComponentType>(Object.entries(FX_COMPONENTS).map(([k, v]) => [v.fx, k as ComponentType]));
// Panes: free placement (AnchorPane, Pane) or with their layout (VBox, GridPane…).
for (const pane of ["AnchorPane", "Pane", ...FX_PANES.map((x) => x.fx)]) BY_FX.set(pane, "JPanel");
const PANE_LAYOUT = new Map(FX_PANES.map((x) => [x.fx, x.kind]));
const FLOW_ALIGN: Record<string, FlowAlign> = { TOP_LEFT: "left", TOP_CENTER: "center", TOP_RIGHT: "right" };
const REGION_EL: Record<Region, string> = { NORTH: "top", SOUTH: "bottom", WEST: "left", EAST: "right", CENTER: "center" };
const EL_REGION = new Map(Object.entries(REGION_EL).map(([r, e]) => [e, r as Region]));

/** A pane's layout from its element (its name and attributes), and the attributes that said it. */
function readLayout(e: XmlElement): { layout?: Layout; used: Set<string> } {
  const used = new Set<string>();
  const kind = PANE_LAYOUT.get(e.name);
  if (!kind) return { used };
  const l = defaultFxLayout(kind);
  const n = (k: string) => {
    const v = num(attr(e, k));
    if (v !== undefined) used.add(k);
    return v;
  };
  if (l.kind === "vbox" || l.kind === "hbox") {
    l.spacing = n("spacing") ?? 0;
    const key = l.kind === "vbox" ? "fillWidth" : "fillHeight";
    const f = attr(e, key);
    if (f !== undefined) {
      used.add(key);
      l.fill = f !== "false";
    }
  }
  if (l.kind === "flow" || l.kind === "gridpane") {
    l.hgap = n("hgap") ?? 0;
    l.vgap = n("vgap") ?? 0;
  }
  if (l.kind === "flow") {
    const a = attr(e, "alignment");
    if (a && FLOW_ALIGN[a]) {
      l.align = FLOW_ALIGN[a];
      used.add("alignment");
    }
  }
  return { layout: l, used };
}

function layoutAttrs(l: Layout | undefined): [string, string][] {
  if (!l) return [];
  const out: [string, string][] = [];
  if (l.kind === "vbox" || l.kind === "hbox") {
    if (l.spacing) out.push(["spacing", dec(l.spacing)]);
    if (!l.fill) out.push([l.kind === "vbox" ? "fillWidth" : "fillHeight", "false"]);
  }
  if (l.kind === "flow" || l.kind === "gridpane") {
    if (l.hgap) out.push(["hgap", dec(l.hgap)]);
    if (l.vgap) out.push(["vgap", dec(l.vgap)]);
  }
  if (l.kind === "flow" && l.align !== "left") out.push(["alignment", l.align === "center" ? "TOP_CENTER" : "TOP_RIGHT"]);
  return out;
}

/** `<padding><Insets top=… right=… bottom=… left=…/></padding>`, when it says only that. */
function readInsets(e: XmlElement): Insets | null {
  const i = elements(e);
  if (i.length !== 1 || i[0].name !== "Insets" || !i[0].attrs.every(([k, v]) => ["top", "right", "bottom", "left"].includes(k) && num(v) !== undefined)) return null;
  const v = (k: string) => num(attr(i[0], k)) ?? 0;
  return { top: v("top"), right: v("right"), bottom: v("bottom"), left: v("left") };
}

const paddingEl = (i: Insets): XmlElement => el("padding", [], [el("Insets", [["bottom", dec(i.bottom)], ["left", dec(i.left)], ["right", dec(i.right)], ["top", dec(i.top)]])]);

/** The element name of a pane: by its layout, or as it was (AnchorPane, Pane). */
function paneName(p: FxParsed, name: string, layout: Layout | undefined, fallback = "Pane"): string {
  return layout ? FX_PANES.find((x) => x.kind === layout.kind)!.fx : (p.paneNames.get(name) ?? fallback);
}

const num = (s: string | undefined) => (s === undefined || s === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));
const int = (s: string | undefined) => (num(s) === undefined ? undefined : Math.round(num(s)!));
const dec = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Splits a style into the rules the designer knows (background, font, text colour) and the rest. */
function readStyle(style: string, c: Partial<GuiComponent>): string {
  const rest: string[] = [];
  for (const rule of style.split(";")) {
    const m = /^\s*(-fx-[\w-]+)\s*:\s*(.*?)\s*$/.exec(rule);
    if (!m) {
      if (rule.trim()) rest.push(rule.trim());
      continue;
    }
    const [, key, value] = m;
    if (key === "-fx-background-color" && COLOR.test(value)) c.background = value.toLowerCase();
    else if (key === "-fx-text-fill" && COLOR.test(value)) c.foreground = value.toLowerCase();
    else if (key === "-fx-font-size" && /^\d+(\.\d+)?(px)?$/.test(value)) c.fontSize = Math.round(parseFloat(value));
    else if (key === "-fx-font-weight" && value === "bold") c.bold = true;
    else if (key === "-fx-font-style" && value === "italic") c.italic = true;
    else rest.push(`${key}: ${value}`);
  }
  return rest.join("; ");
}

function writeStyle(c: Partial<GuiComponent>, labeled: boolean, rest = ""): string {
  const rules: string[] = [];
  if (c.background) rules.push(`-fx-background-color: ${c.background}`);
  if (c.foreground && !labeled) rules.push(`-fx-text-fill: ${c.foreground}`);
  if (c.fontSize) rules.push(`-fx-font-size: ${c.fontSize}px`);
  if (c.bold) rules.push("-fx-font-weight: bold");
  if (c.italic) rules.push("-fx-font-style: italic");
  if (rest) rules.push(rest);
  return rules.join("; ");
}

/** Labeled controls take their text colour as `textFill`; the text inputs as a style rule. */
const LABELED = new Set<ComponentType>(["JButton", "JLabel", "JCheckBox", "JRadioButton"]);
const ALIGN: Record<string, Align> = { CENTER_LEFT: "left", TOP_LEFT: "left", BASELINE_LEFT: "left", CENTER: "center", TOP_CENTER: "center", CENTER_RIGHT: "right", TOP_RIGHT: "right" };

/** The items of a ComboBox or ListView: `<items><FXCollections fx:factory="observableArrayList"><String fx:value="…"/>…`. */
function readItems(e: XmlElement): string[] | null {
  const list = elements(e)[0];
  if (!list || list.name !== "FXCollections" || attr(list, "fx:factory") !== "observableArrayList") return null;
  const items = elements(list);
  if (!items.every((s) => s.name === "String" && attr(s, "fx:value") !== undefined)) return null;
  return items.map((s) => attr(s, "fx:value")!);
}

/** Reads an .fxml file; null when it isn't one the designer can show (no AnchorPane or Pane at the root). */
export function parseFxml(text: string, fallbackName = "Window"): FxParsed | null {
  let nodes: XmlNode[];
  try {
    nodes = parseXml(text);
  } catch {
    return null;
  }
  const root = nodes.find((n): n is XmlElement => n.kind === "element");
  if (!root || BY_FX.get(root.name) !== "JPanel") return null;
  const imports = nodes.filter((n) => n.kind === "pi" && n.target === "import").map((n) => (n as { data: string }).data);
  const controller = attr(root, "fx:controller");
  const form: GuiForm = { className: controller?.split(".").pop() ?? fallbackName, title: "", width: int(attr(root, "prefWidth")) ?? 600, height: int(attr(root, "prefHeight")) ?? 400, resizable: true, components: [], toolkit: "fx" };
  const out: FxParsed = { form, rootName: root.name, rootAttrs: [], controller, imports, attrs: new Map(), style: new Map(), props: new Map(), foreign: new Map(), defines: [], paneNames: new Map() };
  const rootStyle: Partial<GuiComponent> = {};
  const rootLayout = readLayout(root);
  if (rootLayout.layout) form.layout = rootLayout.layout;
  else out.paneNames.set("", root.name);
  for (const [k, v] of root.attrs) {
    if (k === "prefWidth" || k === "prefHeight" || k === "fx:controller" || rootLayout.used.has(k)) continue;
    if (k === "style") out.style.set("", readStyle(v, rootStyle));
    else out.rootAttrs.push([k, v]);
  }
  form.background = rootStyle.background;
  const taken = new Set<string>();

  const readPane = (pane: XmlElement, parent: string | undefined) => {
    for (const p of elements(pane)) {
      if (p.name === "fx:define") {
        for (const d of elements(p)) {
          // Toggle groups are written again for the radio buttons in them.
          if (d.name !== "ToggleGroup" || !attr(d, "fx:id")) out.defines.push(d);
        }
        continue;
      }
      const isBorder = pane.name === "BorderPane";
      if (isBorder && EL_REGION.has(p.name)) {
        // A BorderPane's regions: one component each.
        for (const e of elements(p)) {
          const type = BY_FX.get(e.name);
          if (!type) {
            out.props.set(parent ?? "", [...(out.props.get(parent ?? "") ?? []), p]);
            continue;
          }
          const c = readComponent(e, type, parent);
          c.region = EL_REGION.get(p.name);
          form.components.push(c);
          if (type === "JPanel") readPane(e, c.name);
        }
        continue;
      }
      if (p.name === "padding" && readInsets(p)) {
        const padding = readInsets(p)!;
        if (parent) form.components.find((c) => c.name === parent)!.padding = padding;
        else form.padding = padding;
        continue;
      }
      if (p.name !== "children") {
        // Something else on the pane (stylesheets, constraints…): kept.
        out.props.set(parent ?? "", [...(out.props.get(parent ?? "") ?? []), p]);
        continue;
      }
      // JavaFX paints the last child on top, Swing the first: a free pane is read from the end. In a pane with a
      // layout the order is the layout's, and stays.
      const laid = parent ? form.components.find((c) => c.name === parent)?.layout : form.layout;
      for (const e of laid ? elements(p) : [...elements(p)].reverse()) {
        const type = BY_FX.get(e.name);
        if (!type) {
          const kept = out.foreign.get(parent ?? "") ?? [];
          out.foreign.set(parent ?? "", laid ? [...kept, e] : [e, ...kept]);
          continue;
        }
        const c = readComponent(e, type, parent);
        form.components.push(c);
        if (type === "JPanel") readPane(e, c.name);
      }
    }
  };

  const readComponent = (e: XmlElement, type: ComponentType, parent: string | undefined): GuiComponent => {
    const info = componentInfo(type);
    let name = attr(e, "fx:id") ?? "";
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || taken.has(name)) name = freeName({ ...form, components: [...form.components, ...[...taken].map((n) => ({ name: n }) as GuiComponent)] }, info.prefix);
    taken.add(name);
    const c: GuiComponent = { type, name, x: 0, y: 0, w: info.w, h: info.h, events: [] };
    if (parent) c.parent = parent;
    if (type === "JSlider") Object.assign(c, { min: 0, max: 100, value: 0 });
    if (type === "JSpinner") Object.assign(c, { min: 0, max: 100, value: 0, step: 1 });
    if (type === "JProgressBar") Object.assign(c, { min: 0, max: 100, value: 0 });
    const keep: [string, string][] = [];
    const events = new Map<string, EventKind>(Object.entries(FX_EVENTS).map(([k, v]) => [v!.attr, k as EventKind]));
    let showTicks = false;
    const pane = type === "JPanel" ? readLayout(e) : { used: new Set<string>() };
    if (pane.layout) c.layout = pane.layout;
    else if (type === "JPanel") out.paneNames.set(name, e.name);
    for (const [k, v] of e.attrs) {
      if (pane.used.has(k)) continue;
      switch (k) {
        case "fx:id":
          continue;
        case "GridPane.rowIndex":
        case "GridPane.columnIndex":
          if (int(v) !== undefined && int(v)! >= 0) {
            c.cell = { row: c.cell?.row ?? 0, col: c.cell?.col ?? 0, [k === "GridPane.rowIndex" ? "row" : "col"]: int(v)! };
          } else keep.push([k, v]);
          continue;
        case "layoutX":
          c.x = int(v) ?? 0;
          continue;
        case "layoutY":
          c.y = int(v) ?? 0;
          continue;
        case "prefWidth":
          if (int(v) !== undefined && int(v)! > 0) c.w = int(v)!;
          else keep.push([k, v]);
          continue;
        case "prefHeight":
          if (int(v) !== undefined && int(v)! > 0) c.h = int(v)!;
          else keep.push([k, v]);
          continue;
        case "text":
          if (info.props.includes("text")) c.text = v;
          else keep.push([k, v]);
          continue;
        case "style":
          out.style.set(name, readStyle(v, c));
          continue;
        case "textFill":
          if (COLOR.test(v) && LABELED.has(type)) c.foreground = v.toLowerCase();
          else keep.push([k, v]);
          continue;
        case "disable":
          if (v === "true") c.enabled = false;
          continue;
        case "editable":
          c.editable = v === "true";
          continue;
        case "selected":
          if (v === "true") c.selected = true;
          continue;
        case "wrapText":
          if (type === "JTextArea" && v === "true") c.lineWrap = true;
          else keep.push([k, v]);
          continue;
        case "alignment":
          if ((type === "JLabel" || type === "JTextField") && ALIGN[v]) c.align = ALIGN[v] === "left" ? undefined : ALIGN[v];
          else keep.push([k, v]);
          continue;
        case "toggleGroup":
          if (type === "JRadioButton" && /^\$\w+$/.test(v)) c.group = v.slice(1);
          else keep.push([k, v]);
          continue;
        case "min":
        case "max":
          if ((type === "JSlider" || type === "JSpinner") && num(v) !== undefined) c[k] = int(v);
          else keep.push([k, v]);
          continue;
        case "value":
        case "initialValue":
          if ((type === "JSlider" && k === "value") || (type === "JSpinner" && k === "initialValue")) c.value = int(v) ?? 0;
          else keep.push([k, v]);
          continue;
        case "amountToStepBy":
          if (type === "JSpinner") c.step = int(v) ?? 1;
          else keep.push([k, v]);
          continue;
        case "majorTickUnit":
          if (type === "JSlider") c.ticks = int(v);
          else keep.push([k, v]);
          continue;
        case "showTickMarks":
        case "showTickLabels":
          if (type === "JSlider") showTicks ||= v === "true";
          else keep.push([k, v]);
          continue;
        case "progress":
          if (type === "JProgressBar" && num(v) !== undefined) c.value = Math.round(num(v)! * 100);
          else keep.push([k, v]);
          continue;
      }
      const ev = events.get(k);
      if (ev && FX_COMPONENTS[type].events.includes(ev) && v === `#${handlerName(name, ev, "fx")}`) c.events.push(ev);
      else keep.push([k, v]);
    }
    if (type === "JSlider" && !showTicks) delete c.ticks;
    if (keep.length) out.attrs.set(name, keep);
    for (const p of elements(e)) {
      // A pane's elements are read with what is in it (readPane).
      if (type === "JPanel" && p.name !== "tooltip") continue;
      if (p.name === "tooltip" && elements(p)[0]?.name === "Tooltip" && attr(elements(p)[0], "text") !== undefined && elements(p)[0].attrs.length === 1) {
        c.tooltip = attr(elements(p)[0], "text");
        continue;
      }
      if (p.name === "items" && (type === "JComboBox" || type === "JList")) {
        const items = readItems(p);
        if (items) {
          c.items = items;
          continue;
        }
      }
      out.props.set(name, [...(out.props.get(name) ?? []), p]);
    }
    return c;
  };

  readPane(root, undefined);
  return out;
}

const el = (name: string, attrs: [string, string][] = [], children: XmlNode[] = []): XmlElement => ({ kind: "element", name, attrs, children });

/** The FXML of a component, with what is inside it. */
function writeComponent(p: FxParsed, c: GuiComponent): XmlElement {
  const f = p.form;
  const type = c.type;
  const parent = parentOf(f, c) ?? null;
  const inLayout = layoutOf(f, parent);
  // A pane with a layout places what is in it: no layoutX and layoutY then; in a GridPane, the cell.
  const a: [string, string][] = [["fx:id", c.name]];
  if (inLayout?.kind === "gridpane") {
    if (c.cell?.col) a.push(["GridPane.columnIndex", String(c.cell.col)]);
    if (c.cell?.row) a.push(["GridPane.rowIndex", String(c.cell.row)]);
  }
  if (!inLayout) a.push(["layoutX", dec(Math.round(c.x))], ["layoutY", dec(Math.round(c.y))]);
  a.push(["prefWidth", dec(Math.round(c.w))], ["prefHeight", dec(Math.round(c.h))]);
  if (isContainer(c)) a.push(...layoutAttrs(c.layout));
  const props = FX_COMPONENTS[type].props;
  if (c.text && props.includes("text")) a.push(["text", c.text]);
  if (c.align && c.align !== "left" && (type === "JLabel" || type === "JTextField")) a.push(["alignment", c.align === "center" ? "CENTER" : "CENTER_RIGHT"]);
  if (c.foreground && LABELED.has(type)) a.push(["textFill", c.foreground]);
  if (c.enabled === false) a.push(["disable", "true"]);
  if (c.editable !== undefined && c.editable !== (type !== "JComboBox")) a.push(["editable", String(c.editable)]);
  if (c.selected && (type === "JCheckBox" || type === "JRadioButton")) a.push(["selected", "true"]);
  if (c.lineWrap && type === "JTextArea") a.push(["wrapText", "true"]);
  if (c.group && type === "JRadioButton") a.push(["toggleGroup", `$${c.group}`]);
  if (type === "JSlider") {
    a.push(["min", dec(c.min ?? 0)], ["max", dec(c.max ?? 100)], ["value", dec(c.value ?? 0)]);
    if (c.ticks) a.push(["majorTickUnit", dec(c.ticks)], ["showTickMarks", "true"], ["showTickLabels", "true"]);
  }
  if (type === "JSpinner") a.push(["min", String(c.min ?? 0)], ["max", String(c.max ?? 100)], ["initialValue", String(c.value ?? 0)], ["amountToStepBy", String(c.step ?? 1)]);
  if (type === "JProgressBar") a.push(["progress", String(Math.max(0, Math.min(1, (c.value ?? 0) / 100)))]);
  for (const ev of c.events) {
    const info = FX_EVENTS[ev];
    if (info && FX_COMPONENTS[type].events.includes(ev)) a.push([info.attr, `#${handlerName(c.name, ev, "fx")}`]);
  }
  const style = writeStyle(c, LABELED.has(type), p.style.get(c.name));
  if (style) a.push(["style", style]);
  a.push(...(p.attrs.get(c.name) ?? []));
  const kids: XmlNode[] = [];
  if (c.tooltip && props.includes("tooltip")) kids.push(el("tooltip", [], [el("Tooltip", [["text", c.tooltip]])]));
  if (c.items && (type === "JComboBox" || type === "JList")) kids.push(el("items", [], [el("FXCollections", [["fx:factory", "observableArrayList"]], c.items.map((i) => el("String", [["fx:value", i]])))]));
  if (isContainer(c) && c.padding) kids.push(paddingEl(c.padding));
  kids.push(...(p.props.get(c.name) ?? []));
  if (isContainer(c)) kids.push(...paneContent(p, c.name, c.layout));
  return el(isContainer(c) ? paneName(p, c.name, c.layout) : FX_COMPONENTS[type].fx, a, kids);
}

/** What is in a pane: its `<children>`, or a BorderPane's regions (top, left, center, right, bottom). */
function paneContent(p: FxParsed, container: string | null, layout: Layout | undefined): XmlNode[] {
  const kids = childrenOf(p.form, container);
  const foreign = p.foreign.get(container ?? "") ?? [];
  if (layout?.kind === "border") {
    const out: XmlNode[] = [];
    for (const r of ["NORTH", "WEST", "CENTER", "EAST", "SOUTH"] as Region[]) {
      // The last one added to a region is shown: that one is written.
      const inRegion = kids.filter((k) => (k.region ?? "CENTER") === r);
      if (inRegion.length) out.push(el(REGION_EL[r], [], [writeComponent(p, inRegion[inRegion.length - 1])]));
    }
    if (foreign.length) out.push(el("children", [], foreign));
    return out;
  }
  const inside = (layout ? kids : [...kids].reverse()).map((x) => writeComponent(p, x));
  return inside.length || foreign.length ? [el("children", [], [...foreign, ...inside])] : [];
}

const NEEDED = ["javafx.scene.control.*", "javafx.scene.layout.*"];

/** The whole .fxml for the form. */
export function writeFxml(p: FxParsed): string {
  const f = p.form;
  const imports = [...NEEDED];
  if (f.components.some((c) => c.items)) imports.push("java.lang.String", "javafx.collections.FXCollections");
  if (f.padding || f.components.some((c) => c.padding)) imports.push("javafx.geometry.Insets");
  const all = [...imports, ...p.imports.filter((i) => !imports.includes(i))];
  const attrs: [string, string][] = [["prefHeight", dec(Math.round(f.height))], ["prefWidth", dec(Math.round(f.width))], ...layoutAttrs(f.layout)];
  const style = writeStyle({ background: f.background }, true, p.style.get(""));
  if (style) attrs.push(["style", style]);
  const rest = p.rootAttrs.filter(([k]) => k !== "xmlns" && k !== "xmlns:fx");
  attrs.push(...rest);
  attrs.push(["xmlns", p.rootAttrs.find(([k]) => k === "xmlns")?.[1] ?? "http://javafx.com/javafx/21"], ["xmlns:fx", "http://javafx.com/fxml/1"]);
  if (p.controller) attrs.push(["fx:controller", p.controller]);
  const kids: XmlNode[] = [];
  const groups = [...new Set(f.components.map((c) => c.group).filter((g): g is string => !!g))];
  if (groups.length || p.defines.length) kids.push(el("fx:define", [], [...groups.map((g) => el("ToggleGroup", [["fx:id", g]])), ...p.defines]));
  if (f.padding) kids.push(paddingEl(f.padding));
  kids.push(...(p.props.get("") ?? []));
  kids.push(...paneContent(p, null, f.layout));
  const head: XmlNode[] = [{ kind: "pi", target: "xml", data: 'version="1.0" encoding="UTF-8"' }, { kind: "text", text: "" }, ...all.map((i): XmlNode => ({ kind: "pi", target: "import", data: i }))];
  return writeXml(head) + "\n" + writeXml([el(paneName(p, "", f.layout, p.rootName === "AnchorPane" || p.rootName === "Pane" ? p.rootName : "AnchorPane"), attrs, kids)]);
}

/** A new window's .fxml: an empty AnchorPane with its controller. */
export function newFxmlSource(controller: string): string {
  return writeFxml({ form: { className: controller.split(".").pop()!, title: "", width: 420, height: 280, resizable: true, components: [], toolkit: "fx" }, rootName: "AnchorPane", rootAttrs: [], controller, imports: [], attrs: new Map(), style: new Map(), props: new Map(), foreign: new Map(), defines: [], paneNames: new Map() });
}

/** The JavaFX class of each kind of component, for the palette. */
export const FX_NAMES = Object.fromEntries(COMPONENTS.map((c) => [c.type, FX_COMPONENTS[c.type].fx])) as Record<ComponentType, string>;
