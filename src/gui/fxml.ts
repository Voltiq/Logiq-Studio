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
import { childrenOf, isContainer } from "./tree";

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
}

const BY_FX = new Map<string, ComponentType>(Object.entries(FX_COMPONENTS).map(([k, v]) => [v.fx, k as ComponentType]));
// Panes the designer treats as a free-placement panel.
for (const pane of ["AnchorPane", "Pane"]) BY_FX.set(pane, "JPanel");

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
  const out: FxParsed = { form, rootName: root.name, rootAttrs: [], controller, imports, attrs: new Map(), style: new Map(), props: new Map(), foreign: new Map(), defines: [] };
  const rootStyle: Partial<GuiComponent> = {};
  for (const [k, v] of root.attrs) {
    if (k === "prefWidth" || k === "prefHeight" || k === "fx:controller") continue;
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
      if (p.name !== "children") {
        // Something else on the pane (padding, stylesheets…): kept.
        out.props.set(parent ?? "", [...(out.props.get(parent ?? "") ?? []), p]);
        continue;
      }
      // JavaFX paints the last child on top, Swing the first: read from the end.
      for (const e of [...elements(p)].reverse()) {
        const type = BY_FX.get(e.name);
        if (!type) {
          out.foreign.set(parent ?? "", [e, ...(out.foreign.get(parent ?? "") ?? [])]);
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
    for (const [k, v] of e.attrs) {
      switch (k) {
        case "fx:id":
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
      if (p.name === "children" && type === "JPanel") continue;
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
  const a: [string, string][] = [["fx:id", c.name], ["layoutX", dec(Math.round(c.x))], ["layoutY", dec(Math.round(c.y))], ["prefWidth", dec(Math.round(c.w))], ["prefHeight", dec(Math.round(c.h))]];
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
  if (c.tooltip) kids.push(el("tooltip", [], [el("Tooltip", [["text", c.tooltip]])]));
  if (c.items && (type === "JComboBox" || type === "JList")) kids.push(el("items", [], [el("FXCollections", [["fx:factory", "observableArrayList"]], c.items.map((i) => el("String", [["fx:value", i]])))]));
  kids.push(...(p.props.get(c.name) ?? []));
  if (isContainer(c)) {
    const inside = [...childrenOf(f, c.name)].reverse().map((x) => writeComponent(p, x));
    const foreign = p.foreign.get(c.name) ?? [];
    if (inside.length || foreign.length) kids.push(el("children", [], [...foreign, ...inside]));
  }
  return el(FX_COMPONENTS[type].fx, a, kids);
}

const NEEDED = ["javafx.scene.control.*", "javafx.scene.layout.*"];

/** The whole .fxml for the form. */
export function writeFxml(p: FxParsed): string {
  const f = p.form;
  const imports = [...NEEDED];
  if (f.components.some((c) => c.items)) imports.push("java.lang.String", "javafx.collections.FXCollections");
  const all = [...imports, ...p.imports.filter((i) => !imports.includes(i))];
  const attrs: [string, string][] = [["prefHeight", dec(Math.round(f.height))], ["prefWidth", dec(Math.round(f.width))]];
  const style = writeStyle({ background: f.background }, true, p.style.get(""));
  if (style) attrs.push(["style", style]);
  const rest = p.rootAttrs.filter(([k]) => k !== "xmlns" && k !== "xmlns:fx");
  attrs.push(...rest);
  attrs.push(["xmlns", p.rootAttrs.find(([k]) => k === "xmlns")?.[1] ?? "http://javafx.com/javafx/21"], ["xmlns:fx", "http://javafx.com/fxml/1"]);
  if (p.controller) attrs.push(["fx:controller", p.controller]);
  const kids: XmlNode[] = [];
  const groups = [...new Set(f.components.map((c) => c.group).filter((g): g is string => !!g))];
  if (groups.length || p.defines.length) kids.push(el("fx:define", [], [...groups.map((g) => el("ToggleGroup", [["fx:id", g]])), ...p.defines]));
  kids.push(...(p.props.get("") ?? []));
  const top = [...childrenOf(f, null)].reverse().map((c) => writeComponent(p, c));
  const foreign = p.foreign.get("") ?? [];
  if (top.length || foreign.length) kids.push(el("children", [], [...foreign, ...top]));
  const head: XmlNode[] = [{ kind: "pi", target: "xml", data: 'version="1.0" encoding="UTF-8"' }, { kind: "text", text: "" }, ...all.map((i): XmlNode => ({ kind: "pi", target: "import", data: i }))];
  return writeXml(head) + "\n" + writeXml([el(p.rootName, attrs, kids)]);
}

/** A new window's .fxml: an empty AnchorPane with its controller. */
export function newFxmlSource(controller: string): string {
  return writeFxml({ form: { className: controller.split(".").pop()!, title: "", width: 420, height: 280, resizable: true, components: [], toolkit: "fx" }, rootName: "AnchorPane", rootAttrs: [], controller, imports: [], attrs: new Map(), style: new Map(), props: new Map(), foreign: new Map(), defines: [] });
}

/** The JavaFX class of each kind of component, for the palette. */
export const FX_NAMES = Object.fromEntries(COMPONENTS.map((c) => [c.type, FX_COMPONENTS[c.type].fx])) as Record<ComponentType, string>;
