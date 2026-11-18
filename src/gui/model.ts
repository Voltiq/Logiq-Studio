import type { Insets, Layout, Region } from "./layout";

/*
 * The model of a Swing window in the designer: the frame (title, size of its
 * content, background) and its components with their bounds, properties and
 * events. The code is the one source of truth; this model is read from it and
 * written back (gui/codegen.ts).
 */

export type ComponentType =
  | "JButton"
  | "JLabel"
  | "JTextField"
  | "JPasswordField"
  | "JTextArea"
  | "JCheckBox"
  | "JRadioButton"
  | "JComboBox"
  | "JList"
  | "JSpinner"
  | "JSlider"
  | "JProgressBar"
  | "JPanel";

export type EventKind = "actionPerformed" | "stateChanged" | "valueChanged" | "mouseClicked" | "keyReleased";

export type Align = "left" | "center" | "right";

export interface GuiComponent {
  type: ComponentType;
  name: string;
  /** The panel it is in (added to); none: the window's content pane. x and y are relative to it. */
  parent?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  tooltip?: string;
  enabled?: boolean;
  /** #rrggbb */
  foreground?: string;
  background?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: Align;
  editable?: boolean;
  selected?: boolean;
  lineWrap?: boolean;
  /** Radio buttons: the ButtonGroup they belong to. */
  group?: string;
  /** Combo boxes and lists. */
  items?: string[];
  /** Spinners, sliders and progress bars. */
  min?: number;
  max?: number;
  value?: number;
  step?: number;
  /** Sliders: tick marks and labels every so many. */
  ticks?: number;
  /** Progress bars: the percentage written on the bar. */
  showText?: boolean;
  /** Panels: a titled border. */
  border?: string;
  /** Panels: how what is inside is laid out; none: where each one's bounds say. */
  layout?: Layout;
  /** In a BorderLayout: the region it is in (the centre when none). */
  region?: Region;
  /** In a JavaFX GridPane: its cell. */
  cell?: { row: number; col: number };
  /** JavaFX panes: the room kept free inside the edge (`<padding>`). */
  padding?: Insets;
  /** Labels and buttons: an image next to the class (`getResource`). */
  icon?: string;
  events: EventKind[];
}

export interface GuiForm {
  className: string;
  title: string;
  /** The content pane's size, which is what the window shows. */
  width: number;
  height: number;
  resizable: boolean;
  background?: string;
  /** How the window's content is laid out; none: where each one's bounds say. */
  layout?: Layout;
  /** In the order they are added (Swing paints the first on top). */
  components: GuiComponent[];
  /** A JavaFX window (an .fxml file and its controller class) rather than a Swing one. */
  toolkit?: "fx";
  /** JavaFX: the root pane's padding. */
  padding?: Insets;
}

export interface ComponentInfo {
  type: ComponentType;
  /** Name prefix for new components: button1, textField1… */
  prefix: string;
  w: number;
  h: number;
  defaults: Partial<GuiComponent>;
  events: EventKind[];
  /** Shown inside a JScrollPane. */
  scroll?: boolean;
  /** Which properties the inspector offers. */
  props: (keyof GuiComponent)[];
}

const COMMON: (keyof GuiComponent)[] = ["tooltip", "enabled", "foreground", "background", "fontSize", "bold", "italic"];

export const COMPONENTS: ComponentInfo[] = [
  { type: "JButton", prefix: "button", w: 104, h: 28, defaults: { text: "Button" }, events: ["actionPerformed"], props: ["text", "icon", ...COMMON] },
  { type: "JLabel", prefix: "label", w: 104, h: 20, defaults: { text: "Label" }, events: ["mouseClicked"], props: ["text", "align", "icon", ...COMMON] },
  { type: "JTextField", prefix: "textField", w: 160, h: 24, defaults: { text: "" }, events: ["actionPerformed", "keyReleased"], props: ["text", "align", "editable", ...COMMON] },
  { type: "JPasswordField", prefix: "passwordField", w: 160, h: 24, defaults: {}, events: ["actionPerformed", "keyReleased"], props: ["tooltip", "enabled", "fontSize"] },
  { type: "JTextArea", prefix: "textArea", w: 220, h: 110, defaults: { text: "" }, events: ["keyReleased"], scroll: true, props: ["text", "editable", "lineWrap", ...COMMON] },
  { type: "JCheckBox", prefix: "checkBox", w: 120, h: 22, defaults: { text: "Check box" }, events: ["actionPerformed"], props: ["text", "selected", ...COMMON] },
  { type: "JRadioButton", prefix: "radioButton", w: 120, h: 22, defaults: { text: "Option" }, events: ["actionPerformed"], props: ["text", "selected", "group", ...COMMON] },
  { type: "JComboBox", prefix: "comboBox", w: 160, h: 24, defaults: { items: ["Item 1", "Item 2", "Item 3"] }, events: ["actionPerformed"], props: ["items", "editable", ...COMMON] },
  { type: "JList", prefix: "list", w: 160, h: 110, defaults: { items: ["Item 1", "Item 2", "Item 3"] }, events: ["valueChanged"], scroll: true, props: ["items", ...COMMON] },
  { type: "JSpinner", prefix: "spinner", w: 88, h: 24, defaults: { min: 0, max: 100, value: 0, step: 1 }, events: ["stateChanged"], props: ["min", "max", "value", "step", "tooltip", "enabled", "fontSize"] },
  { type: "JSlider", prefix: "slider", w: 220, h: 44, defaults: { min: 0, max: 100, value: 50, ticks: 25 }, events: ["stateChanged"], props: ["min", "max", "value", "ticks", "tooltip", "enabled", "background"] },
  { type: "JProgressBar", prefix: "progressBar", w: 220, h: 18, defaults: { min: 0, max: 100, value: 40, showText: true }, events: [], props: ["min", "max", "value", "showText", "tooltip", "foreground", "background"] },
  { type: "JPanel", prefix: "panel", w: 220, h: 140, defaults: { border: "" }, events: ["mouseClicked"], props: ["border", "tooltip", "background"] },
];

export function componentInfo(type: ComponentType): ComponentInfo {
  return COMPONENTS.find((c) => c.type === type)!;
}

export const EVENT_INFO: Record<EventKind, { label: string; method: string; param: string; listener: string }> = {
  actionPerformed: { label: "Clicked / Enter (actionPerformed)", method: "ActionPerformed", param: "ActionEvent", listener: "Action" },
  stateChanged: { label: "Value changed (stateChanged)", method: "StateChanged", param: "ChangeEvent", listener: "Change" },
  valueChanged: { label: "Selection changed (valueChanged)", method: "ValueChanged", param: "ListSelectionEvent", listener: "ListSelection" },
  mouseClicked: { label: "Mouse clicked (mouseClicked)", method: "MouseClicked", param: "MouseEvent", listener: "Mouse" },
  keyReleased: { label: "Key released (keyReleased)", method: "KeyReleased", param: "KeyEvent", listener: "Key" },
};

/** JavaFX: the FXML attribute that names the handler, and the handler's suffix and event class. */
export const FX_EVENTS: Partial<Record<EventKind, { attr: string; method: string; param: string; label: string }>> = {
  actionPerformed: { attr: "onAction", method: "Action", param: "ActionEvent", label: "Clicked / Enter (onAction)" },
  mouseClicked: { attr: "onMouseClicked", method: "MouseClicked", param: "MouseEvent", label: "Mouse clicked (onMouseClicked)" },
  keyReleased: { attr: "onKeyReleased", method: "KeyReleased", param: "KeyEvent", label: "Key released (onKeyReleased)" },
};

/** The handler method's name: `okButton_ActionPerformed` in Swing, `okButton_Action` in JavaFX. */
export function handlerName(component: string, event: EventKind, toolkit?: "fx"): string {
  return `${component}_${toolkit === "fx" ? (FX_EVENTS[event]?.method ?? EVENT_INFO[event].method) : EVENT_INFO[event].method}`;
}

/** The events a component offers: Swing's, or those FXML can name. */
export function eventsOf(type: ComponentType, toolkit?: "fx"): EventKind[] {
  const all = componentInfo(type).events;
  if (toolkit !== "fx") return all;
  const fx = FX_COMPONENTS[type].events;
  return fx;
}

/**
 * JavaFX: what can grow beyond its preferred size when its pane offers room (a VBox's width, a cell): text inputs,
 * lists and sliders across, text areas and lists down too, panes both ways. Buttons, labels and boxes keep theirs.
 */
export const FX_GROW: Record<ComponentType, { w: boolean; h: boolean }> = {
  JButton: { w: false, h: false },
  JLabel: { w: false, h: false },
  JTextField: { w: true, h: false },
  JPasswordField: { w: true, h: false },
  JTextArea: { w: true, h: true },
  JCheckBox: { w: false, h: false },
  JRadioButton: { w: false, h: false },
  JComboBox: { w: false, h: false },
  JList: { w: true, h: true },
  JSpinner: { w: false, h: false },
  JSlider: { w: true, h: false },
  JProgressBar: { w: false, h: false },
  JPanel: { w: true, h: true },
};

/** JavaFX: each component's class, and what it offers. */
export const FX_COMPONENTS: Record<ComponentType, { fx: string; events: EventKind[]; props: (keyof GuiComponent)[] }> = {
  JButton: { fx: "Button", events: ["actionPerformed", "mouseClicked"], props: ["text", "tooltip", "enabled", "foreground", "background", "fontSize", "bold", "italic"] },
  JLabel: { fx: "Label", events: ["mouseClicked"], props: ["text", "align", "tooltip", "enabled", "foreground", "background", "fontSize", "bold", "italic"] },
  JTextField: { fx: "TextField", events: ["actionPerformed", "keyReleased"], props: ["text", "align", "editable", "tooltip", "enabled", "foreground", "background", "fontSize", "bold", "italic"] },
  JPasswordField: { fx: "PasswordField", events: ["actionPerformed", "keyReleased"], props: ["tooltip", "enabled", "fontSize"] },
  JTextArea: { fx: "TextArea", events: ["keyReleased"], props: ["text", "editable", "lineWrap", "tooltip", "enabled", "foreground", "background", "fontSize", "bold", "italic"] },
  JCheckBox: { fx: "CheckBox", events: ["actionPerformed"], props: ["text", "selected", "tooltip", "enabled", "foreground", "background", "fontSize", "bold", "italic"] },
  JRadioButton: { fx: "RadioButton", events: ["actionPerformed"], props: ["text", "selected", "group", "tooltip", "enabled", "foreground", "background", "fontSize", "bold", "italic"] },
  JComboBox: { fx: "ComboBox", events: ["actionPerformed"], props: ["items", "editable", "tooltip", "enabled", "background"] },
  JList: { fx: "ListView", events: ["mouseClicked", "keyReleased"], props: ["items", "tooltip", "enabled", "background"] },
  JSpinner: { fx: "Spinner", events: ["mouseClicked"], props: ["min", "max", "value", "step", "tooltip", "enabled"] },
  JSlider: { fx: "Slider", events: ["mouseClicked"], props: ["min", "max", "value", "ticks", "tooltip", "enabled"] },
  JProgressBar: { fx: "ProgressBar", events: [], props: ["value", "tooltip"] },
  JPanel: { fx: "Pane", events: ["mouseClicked"], props: ["tooltip", "background"] },
};

/** A free name for a new component: button1, button2… */
export function freeName(form: GuiForm, prefix: string): string {
  const taken = new Set(form.components.flatMap((c) => [c.name, c.group ?? ""]));
  for (let i = 1; ; i++) if (!taken.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export function newComponent(form: GuiForm, type: ComponentType, x: number, y: number): GuiComponent {
  const info = componentInfo(type);
  const c: GuiComponent = { type, name: freeName(form, info.prefix), x, y, w: info.w, h: info.h, events: [], ...structuredClone(info.defaults) };
  // What only Swing has: a progress bar's percentage text, a panel's titled border.
  if (form.toolkit === "fx") {
    delete c.showText;
    delete c.border;
  }
  return c;
}

const JAVA_KEYWORDS = new Set(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield".split(
    " ",
  ),
);

/** Why a component name can't be used, or null. */
export function badName(name: string, form: GuiForm, own?: GuiComponent): string | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return "A name starts with a letter and has only letters, digits and _.";
  if (JAVA_KEYWORDS.has(name)) return "That is a Java keyword.";
  if (["cp", "frameWidth", "frameHeight"].includes(name) || name === form.className) return "That name is already used in the class.";
  if (form.components.some((c) => c !== own && (c.name === name || c.group === name || (c.type === "JTextArea" || c.type === "JList" ? `${c.name}ScrollPane` === name : false))))
    return "Another component has that name.";
  return null;
}
