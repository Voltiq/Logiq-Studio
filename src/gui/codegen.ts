/*
 * The designer's code: a Swing window class with two regions the designer
 * writes, the fields and the components (in the constructor), between
 * `// GUI-BEGIN …` and `// GUI-END …` comments. Everything else is yours: the
 * event handlers are methods outside the regions, made once and then left
 * alone. Reading works on statements, not lines, so formatted code reads too,
 * and statements the designer doesn't know (`okButton.setMnemonic(…)`) are
 * kept with their component.
 */
import { codeOrder, childrenOf, parentOf } from "./tree";
import { componentInfo, COMPONENTS, EVENT_INFO, handlerName, type Align, type ComponentType, type EventKind, type GuiComponent, type GuiForm } from "./model";

export interface ParsedForm {
  form: GuiForm;
  /** Statements in the components region that belong to no component, kept as they are. */
  extra: string[];
  /** Per component: statements the designer doesn't know, kept as they are. */
  extras: Map<string, string[]>;
}

const FIELDS_BEGIN = /^([ \t]*)\/\/ GUI-BEGIN fields\b.*$/m;
const FIELDS_END = /^[ \t]*\/\/ GUI-END fields\b.*$/m;
const COMPONENTS_BEGIN = /^([ \t]*)\/\/ GUI-BEGIN components\b.*$/m;
const COMPONENTS_END = /^[ \t]*\/\/ GUI-END components\b.*$/m;

interface Region {
  /** Where the region's content starts and ends (between the marker lines). */
  from: number;
  to: number;
  indent: string;
}

function region(text: string, begin: RegExp, end: RegExp): Region | null {
  const b = begin.exec(text);
  if (!b) return null;
  const rest = text.slice(b.index + b[0].length);
  const e = end.exec(rest);
  if (!e) return null;
  const from = b.index + b[0].length + 1;
  const to = b.index + b[0].length + e.index;
  return { from: Math.min(from, to), to, indent: b[1] };
}

/** Whether a Java source has the designer's regions. */
export function hasDesignerRegions(text: string): boolean {
  return !!region(text, FIELDS_BEGIN, FIELDS_END) && !!region(text, COMPONENTS_BEGIN, COMPONENTS_END);
}

// ----- Java literals ---------------------------------------------------------------------------

export function javaString(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r") + '"';
}

function unescapeJava(s: string): string {
  return s.replace(/\\(u+[0-9a-fA-F]{4}|.)/g, (_m, c: string) => {
    if (c[0] === "u") return String.fromCharCode(parseInt(c.replace(/^u+/, ""), 16));
    return ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "0": "\0" } as Record<string, string>)[c] ?? c;
  });
}

function color(hex: string): string {
  return `new Color(0x${hex.replace("#", "").toUpperCase()})`;
}

const NAMED_COLORS: Record<string, string> = {
  BLACK: "#000000",
  WHITE: "#ffffff",
  RED: "#ff0000",
  GREEN: "#00ff00",
  BLUE: "#0000ff",
  YELLOW: "#ffff00",
  ORANGE: "#ffc800",
  PINK: "#ffafaf",
  GRAY: "#808080",
  LIGHT_GRAY: "#c0c0c0",
  DARK_GRAY: "#404040",
  CYAN: "#00ffff",
  MAGENTA: "#ff00ff",
};

function parseColor(arg: string): string | undefined {
  let m = /^new Color\(0x([0-9a-fA-F]{6})\)$/.exec(arg);
  if (m) return "#" + m[1].toLowerCase();
  m = /^new Color\((\d+),(\d+),(\d+)\)$/.exec(arg.replace(/\s+/g, ""));
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, "0")).join("");
  m = /^Color\.(\w+)$/.exec(arg);
  if (m) return NAMED_COLORS[m[1].toUpperCase()];
  return undefined;
}

// ----- Statements --------------------------------------------------------------------------------

/** Splits code into statements at semicolons outside brackets, strings and comments; comments are dropped. */
export function statements(code: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      cur += " ";
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 1;
      cur += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      cur += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    if (c === ";" && depth <= 0) {
      const s = cur.trim();
      if (s) out.push(s);
      cur = "";
      depth = 0;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Collapses white space outside string literals, so formatted code reads like generated code. */
function squash(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j;
    } else if (/\s/.test(c)) {
      const prev = out[out.length - 1] ?? "";
      const next = s.slice(i).trimStart()[0] ?? "";
      // Keep one space between words only.
      if (/[\w$]/.test(prev) && /[\w$]/.test(next) && !out.endsWith(" ")) out += " ";
    } else out += c;
  }
  return out;
}

const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;

/** The string literals in a text (an array initialiser's items). */
function strings(s: string): string[] {
  return [...s.matchAll(new RegExp(STRING, "g"))].map((m) => unescapeJava(m[1]));
}

// ----- Writing ------------------------------------------------------------------------------------

const SCROLLED = (c: GuiComponent) => !!componentInfo(c.type).scroll;
const outer = (c: GuiComponent) => (SCROLLED(c) ? `${c.name}ScrollPane` : c.name);

function fieldType(c: GuiComponent): string {
  return c.type === "JComboBox" || c.type === "JList" ? `${c.type}<String>` : c.type;
}

export function fieldLines(form: GuiForm): string[] {
  const out: string[] = [];
  for (const c of form.components) {
    out.push(`private ${fieldType(c)} ${c.name} = new ${c.type}${c.type === "JComboBox" || c.type === "JList" ? "<>" : ""}();`);
    if (SCROLLED(c)) out.push(`private JScrollPane ${c.name}ScrollPane = new JScrollPane(${c.name});`);
  }
  const groups = [...new Set(form.components.map((c) => c.group).filter((g): g is string => !!g))];
  for (const g of groups) out.push(`private ButtonGroup ${g} = new ButtonGroup();`);
  return out;
}

/** What a component of a type is when made with `new`, so only the differences are written. */
const BASE: Partial<Record<ComponentType, Partial<GuiComponent>>> = {
  JSlider: { min: 0, max: 100, value: 50 },
  JProgressBar: { min: 0, max: 100, value: 0 },
};

const EDITABLE_DEFAULT = (t: ComponentType) => t !== "JComboBox";

function listenerLine(c: GuiComponent, e: EventKind): string {
  const h = handlerName(c.name, e);
  switch (e) {
    case "actionPerformed":
      return `${c.name}.addActionListener(e -> ${h}(e));`;
    case "stateChanged":
      return `${c.name}.addChangeListener(e -> ${h}(e));`;
    case "valueChanged":
      return `${c.name}.addListSelectionListener(e -> ${h}(e));`;
    case "mouseClicked":
      return `${c.name}.addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent e) { ${h}(e); } });`;
    case "keyReleased":
      return `${c.name}.addKeyListener(new KeyAdapter() { @Override public void keyReleased(KeyEvent e) { ${h}(e); } });`;
  }
}

/** A component's statements; `container` is what it is added to (cp, or its panel), `holds` whether it has components inside. */
export function componentLines(c: GuiComponent, extras: string[] = [], container = "cp", holds = false): string[] {
  const n = c.name;
  const out: string[] = [`${outer(c)}.setBounds(${Math.round(c.x)}, ${Math.round(c.y)}, ${Math.round(c.w)}, ${Math.round(c.h)});`];
  const hasText = ["JButton", "JLabel", "JTextField", "JTextArea", "JCheckBox", "JRadioButton"].includes(c.type);
  if (hasText && c.text) out.push(`${n}.setText(${javaString(c.text)});`);
  if (c.icon) out.push(`${n}.setIcon(new ImageIcon(getClass().getResource(${javaString(c.icon)})));`);
  if (c.align && c.align !== "left" && (c.type === "JLabel" || c.type === "JTextField")) out.push(`${n}.setHorizontalAlignment(SwingConstants.${c.align.toUpperCase()});`);
  if (c.type === "JComboBox" && c.items) out.push(`${n}.setModel(new DefaultComboBoxModel<>(new String[] {${c.items.map(javaString).join(", ")}}));`);
  if (c.type === "JList" && c.items) out.push(`${n}.setListData(new String[] {${c.items.map(javaString).join(", ")}});`);
  if (c.type === "JSpinner") out.push(`${n}.setModel(new SpinnerNumberModel(${c.value ?? 0}, ${c.min ?? 0}, ${c.max ?? 100}, ${c.step ?? 1}));`);
  if (c.type === "JSlider" || c.type === "JProgressBar") {
    const base = BASE[c.type]!;
    if ((c.min ?? base.min) !== base.min) out.push(`${n}.setMinimum(${c.min});`);
    if ((c.max ?? base.max) !== base.max) out.push(`${n}.setMaximum(${c.max});`);
    if ((c.value ?? base.value) !== base.value) out.push(`${n}.setValue(${c.value});`);
  }
  if (c.type === "JSlider" && c.ticks) out.push(`${n}.setMajorTickSpacing(${c.ticks});`, `${n}.setPaintTicks(true);`, `${n}.setPaintLabels(true);`);
  if (c.type === "JProgressBar" && c.showText) out.push(`${n}.setStringPainted(true);`);
  if (c.editable !== undefined && c.editable !== EDITABLE_DEFAULT(c.type)) out.push(`${n}.setEditable(${c.editable});`);
  if (c.selected) out.push(`${n}.setSelected(true);`);
  if (c.lineWrap) out.push(`${n}.setLineWrap(true);`, `${n}.setWrapStyleWord(true);`);
  if (c.enabled === false) out.push(`${n}.setEnabled(false);`);
  if (c.tooltip) out.push(`${n}.setToolTipText(${javaString(c.tooltip)});`);
  if (c.foreground) out.push(`${n}.setForeground(${color(c.foreground)});`);
  if (c.background) {
    out.push(`${n}.setBackground(${color(c.background)});`);
    if (c.type === "JLabel") out.push(`${n}.setOpaque(true);`);
  }
  if (c.fontSize || c.bold || c.italic) {
    const style = [c.bold && "Font.BOLD", c.italic && "Font.ITALIC"].filter(Boolean).join(" | ");
    const args = [style, c.fontSize ? `${c.fontSize}f` : ""].filter(Boolean).join(", ");
    out.push(`${n}.setFont(${n}.getFont().deriveFont(${args}));`);
  }
  if (c.type === "JPanel" && holds) out.push(`${n}.setLayout(null);`);
  if (c.type === "JPanel" && c.border) out.push(`${n}.setBorder(BorderFactory.createTitledBorder(${javaString(c.border)}));`);
  if (c.group) out.push(`${c.group}.add(${n});`);
  for (const e of c.events) out.push(listenerLine(c, e));
  out.push(...extras.map((x) => (x.endsWith(";") || x.endsWith("}") ? x : x + ";")));
  out.push(`${container}.add(${outer(c)});`);
  return out;
}

export function componentsCode(p: ParsedForm): string[] {
  const f = p.form;
  const out = [`setTitle(${javaString(f.title)});`];
  if (!f.resizable) out.push("setResizable(false);");
  out.push("Container cp = getContentPane();", "cp.setLayout(null);", `cp.setPreferredSize(new Dimension(${Math.round(f.width)}, ${Math.round(f.height)}));`);
  if (f.background) out.push(`cp.setBackground(${color(f.background)});`);
  out.push(...p.extra.map((x) => (x.endsWith(";") || x.endsWith("}") ? x : x + ";")));
  for (const c of codeOrder(f)) out.push("", ...componentLines(c, p.extras.get(c.name) ?? [], parentOf(f, c) ?? "cp", childrenOf(f, c.name).length > 0));
  out.push("", "pack();");
  return out;
}

function indentLines(lines: string[], indent: string): string {
  return lines.map((l) => (l ? indent + l : "")).join("\n") + (lines.length ? "\n" : "");
}

// ----- Reading -----------------------------------------------------------------------------------

const TYPES = new Set<string>(COMPONENTS.map((c) => c.type));

function className(text: string): string {
  return /\bclass\s+(\w+)\s+extends\s+(?:javax\.swing\.)?JFrame\b/.exec(text)?.[1] ?? /\bpublic\s+class\s+(\w+)/.exec(text)?.[1] ?? "Window";
}

/** Reads the form from a class with the designer's regions; null when it has none. */
export function parseForm(text: string): ParsedForm | null {
  const fr = region(text, FIELDS_BEGIN, FIELDS_END);
  const cr = region(text, COMPONENTS_BEGIN, COMPONENTS_END);
  if (!fr || !cr) return null;
  const form: GuiForm = { className: className(text), title: "", width: 400, height: 300, resizable: true, components: [] };
  const byName = new Map<string, GuiComponent>();
  const scrollOf = new Map<string, string>();
  const groups = new Set<string>();
  for (const raw of statements(text.slice(fr.from, fr.to))) {
    const s = squash(raw);
    const m = /^(?:private |protected |public )?(?:final )?([\w.]+)(?:<[^>]*>)? ?(\w+)=new ([\w.]+)(?:<[^>]*>)?\((.*)\)$/.exec(s);
    if (!m) continue;
    const type = m[1].replace(/^javax\.swing\./, "");
    if (type === "JScrollPane") {
      if (/^\w+$/.test(m[4])) scrollOf.set(m[2], m[4]);
      continue;
    }
    if (type === "ButtonGroup") {
      groups.add(m[2]);
      continue;
    }
    if (!TYPES.has(type)) continue;
    const c: GuiComponent = { type: type as ComponentType, name: m[2], x: 0, y: 0, w: componentInfo(type as ComponentType).w, h: componentInfo(type as ComponentType).h, events: [] };
    // Defaults the designer writes only when they differ.
    if (c.type === "JSlider") Object.assign(c, { min: 0, max: 100, value: 50 });
    if (c.type === "JProgressBar") Object.assign(c, { min: 0, max: 100, value: 0 });
    if (c.type === "JSpinner") Object.assign(c, { min: 0, max: 100, value: 0, step: 1 });
    byName.set(c.name, c);
  }
  const scrollToInner = new Map([...scrollOf].map(([pane, inner]) => [pane, inner]));
  const order: string[] = [];
  const extra: string[] = [];
  const extras = new Map<string, string[]>();
  const keep = (name: string | null, raw: string) => {
    if (!name) extra.push(raw);
    else extras.set(name, [...(extras.get(name) ?? []), raw]);
  };

  for (const raw of statements(text.slice(cr.from, cr.to))) {
    const s = squash(raw);
    let m: RegExpExecArray | null;
    if ((m = new RegExp(`^setTitle\\(${STRING}\\)$`).exec(s))) form.title = unescapeJava(m[1]);
    else if ((m = /^setResizable\((true|false)\)$/.exec(s))) form.resizable = m[1] === "true";
    else if (/^Container cp=getContentPane\(\)$|^cp\.setLayout\(null\)$|^pack\(\)$/.test(s)) continue;
    else if ((m = /^cp\.setPreferredSize\(new Dimension\((\d+),(\d+)\)\)$/.exec(s))) {
      form.width = +m[1];
      form.height = +m[2];
    } else if ((m = /^cp\.setBackground\((.*)\)$/.exec(s))) form.background = parseColor(m[1]);
    else if ((m = /^cp\.add\((\w+)\)$/.exec(s))) {
      const name = scrollToInner.get(m[1]) ?? m[1];
      if (byName.has(name) && !order.includes(name)) order.push(name);
    } else if ((m = /^(\w+)\.add\((\w+)\)$/.exec(s)) && groups.has(m[1]) && byName.has(m[2])) byName.get(m[2])!.group = m[1];
    else if ((m = /^(\w+)\.add\((\w+)\)$/.exec(s)) && byName.get(m[1])?.type === "JPanel" && byName.has(scrollToInner.get(m[2]) ?? m[2])) {
      // Added to a panel: it is inside it.
      const name = scrollToInner.get(m[2]) ?? m[2];
      byName.get(name)!.parent = m[1];
      if (!order.includes(name)) order.push(name);
    }
    else if ((m = /^(\w+)\.(\w+)\((.*)\)$/s.exec(s))) {
      const target = scrollToInner.get(m[1]) ?? m[1];
      const c = byName.get(target);
      if (!c) keep(null, raw);
      else if (!applyCall(c, m[1] !== target, m[2], m[3])) keep(c.name, raw);
    } else keep(null, raw);
  }
  form.components = [...order.map((n) => byName.get(n)!), ...[...byName.values()].filter((c) => !order.includes(c.name))];
  return { form, extra, extras };
}

/** Reads one `component.method(args)` statement into the component; false when it isn't one the designer writes. */
function applyCall(c: GuiComponent, onScrollPane: boolean, method: string, args: string): boolean {
  const str = () => {
    const m = new RegExp(`^${STRING}$`).exec(args);
    return m ? unescapeJava(m[1]) : null;
  };
  const num = () => (/^-?\d+(\.\d+)?$/.test(args) ? Number(args) : null);
  const bool = () => (args === "true" ? true : args === "false" ? false : null);
  if (method === "setBounds") {
    const m = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(args);
    if (!m) return false;
    [c.x, c.y, c.w, c.h] = [+m[1], +m[2], +m[3], +m[4]];
    return true;
  }
  if (onScrollPane) return false;
  switch (method) {
    case "setText": {
      const v = str();
      if (v === null) return false;
      c.text = v;
      return true;
    }
    case "setToolTipText": {
      const v = str();
      if (v === null) return false;
      c.tooltip = v;
      return true;
    }
    case "setIcon": {
      const m = new RegExp(`^new ImageIcon\\(getClass\\(\\)\\.getResource\\(${STRING}\\)\\)$`).exec(args);
      if (!m) return false;
      c.icon = unescapeJava(m[1]);
      return true;
    }
    case "setHorizontalAlignment": {
      const m = /^(?:SwingConstants|JLabel|JTextField)\.(LEFT|CENTER|RIGHT|LEADING|TRAILING)$/.exec(args);
      if (!m) return false;
      c.align = (m[1] === "LEADING" ? "left" : m[1] === "TRAILING" ? "right" : m[1].toLowerCase()) as Align;
      return true;
    }
    case "setModel": {
      let m = /^new DefaultComboBoxModel(?:<\w*>)?\(new String\[\]\{(.*)\}\)$/s.exec(args);
      if (m && c.type === "JComboBox") {
        c.items = strings(m[1]);
        return true;
      }
      m = /^new SpinnerNumberModel\((-?\d+),(-?\d+),(-?\d+),(\d+)\)$/.exec(args);
      if (m && c.type === "JSpinner") {
        [c.value, c.min, c.max, c.step] = [+m[1], +m[2], +m[3], +m[4]];
        return true;
      }
      return false;
    }
    case "setListData": {
      const m = /^new String\[\]\{(.*)\}$/s.exec(args);
      if (!m || c.type !== "JList") return false;
      c.items = strings(m[1]);
      return true;
    }
    case "setMinimum":
    case "setMaximum":
    case "setValue":
    case "setMajorTickSpacing": {
      const v = num();
      if (v === null) return false;
      const key = ({ setMinimum: "min", setMaximum: "max", setValue: "value", setMajorTickSpacing: "ticks" } as const)[method];
      c[key] = v;
      return true;
    }
    case "setLayout":
      // A panel with components inside is written with no layout manager.
      return c.type === "JPanel" && args === "null";
    case "setPaintTicks":
    case "setPaintLabels":
    case "setOpaque":
    case "setWrapStyleWord":
      return bool() !== null;
    case "setStringPainted":
    case "setEditable":
    case "setSelected":
    case "setLineWrap":
    case "setEnabled": {
      const v = bool();
      if (v === null) return false;
      const key = ({ setStringPainted: "showText", setEditable: "editable", setSelected: "selected", setLineWrap: "lineWrap", setEnabled: "enabled" } as const)[method];
      c[key] = v;
      return true;
    }
    case "setForeground":
    case "setBackground": {
      const v = parseColor(args);
      if (!v) return false;
      c[method === "setForeground" ? "foreground" : "background"] = v;
      return true;
    }
    case "setFont": {
      const m = new RegExp(`^${c.name}\\.getFont\\(\\)\\.deriveFont\\((.*)\\)$`).exec(args);
      if (!m) return false;
      const size = /(\d+(?:\.\d+)?)f?$/.exec(m[1]);
      if (size && !/Font\.\w+$/.test(m[1])) c.fontSize = Math.round(+size[1]);
      c.bold = /Font\.BOLD/.test(m[1]) || undefined;
      c.italic = /Font\.ITALIC/.test(m[1]) || undefined;
      return true;
    }
    case "setBorder": {
      const m = new RegExp(`^BorderFactory\\.createTitledBorder\\(${STRING}\\)$`).exec(args);
      if (!m) return false;
      c.border = unescapeJava(m[1]);
      return true;
    }
    case "addActionListener":
    case "addChangeListener":
    case "addListSelectionListener":
    case "addMouseListener":
    case "addKeyListener": {
      const event = (
        {
          addActionListener: "actionPerformed",
          addChangeListener: "stateChanged",
          addListSelectionListener: "valueChanged",
          addMouseListener: "mouseClicked",
          addKeyListener: "keyReleased",
        } as const
      )[method];
      // Only the designer's own wiring: it calls the handler with the component's name.
      if (!args.includes(handlerName(c.name, event))) return false;
      if (method === "addMouseListener" && !/mouseClicked/.test(args)) return false;
      if (method === "addKeyListener" && !/keyReleased/.test(args)) return false;
      if (!c.events.includes(event)) c.events.push(event);
      return true;
    }
  }
  return false;
}

// ----- Updating the source -----------------------------------------------------------------------

const IMPORTS = ["java.awt.*", "java.awt.event.*", "javax.swing.*"];

function ensureImports(text: string, form: GuiForm): string {
  const needed = [...IMPORTS];
  if (form.components.some((c) => c.events.some((e) => e === "stateChanged" || e === "valueChanged"))) needed.push("javax.swing.event.*");
  const missing = needed.filter((i) => !new RegExp(`^\\s*import\\s+${i.replace(/[.*]/g, (x) => "\\" + x)}\\s*;`, "m").test(text));
  if (!missing.length) return text;
  const lines = missing.map((i) => `import ${i};`).join("\n") + "\n";
  const imports = [...text.matchAll(/^\s*import\s+[\w.*]+\s*;[^\n]*\n/gm)];
  if (imports.length) {
    const last = imports[imports.length - 1];
    const at = last.index! + last[0].length;
    return text.slice(0, at) + lines + text.slice(at);
  }
  const pkg = /^\s*package\s+[\w.]+\s*;[^\n]*\n/m.exec(text);
  if (pkg) {
    const at = pkg.index + pkg[0].length;
    return text.slice(0, at) + "\n" + lines + text.slice(at);
  }
  return lines + "\n" + text;
}

/** Where the class's closing brace is: the last `}` of the text, which for one top-level class is its own. */
function classEnd(text: string, name: string): number {
  const start = new RegExp(`\\bclass\\s+${name}\\b`).exec(text);
  if (!start) return text.lastIndexOf("}");
  let depth = 0;
  let i = text.indexOf("{", start.index);
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) < 0 ? text.length : text.indexOf("*/", i + 2) + 1;
    else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return text.lastIndexOf("}");
}

/** Whether the class already has a method of that name. */
export function hasMethod(text: string, name: string): boolean {
  return new RegExp(`\\b(void|\\w+)\\s+${name}\\s*\\(`).test(text);
}

function addHandlers(text: string, form: GuiForm, todo: (component: string, event: EventKind) => string): string {
  let out = text;
  for (const c of form.components) {
    for (const e of c.events) {
      const name = handlerName(c.name, e);
      if (hasMethod(out, name)) continue;
      const at = classEnd(out, form.className);
      if (at < 0) continue;
      const before = out.slice(0, at).replace(/\s*$/, "");
      const stub = `\n\n    public void ${name}(${EVENT_INFO[e].param} evt) {\n        // ${todo(c.name, e)}\n    }\n`;
      out = before + stub + out.slice(at);
    }
  }
  return out;
}

/** The source with the regions written from the form, imports added and handler stubs for new events. */
export function writeForm(text: string, parsed: ParsedForm, todo: (component: string, event: EventKind) => string = (c) => `TODO: what happens for ${c}`): string {
  const cr = region(text, COMPONENTS_BEGIN, COMPONENTS_END);
  const fr = region(text, FIELDS_BEGIN, FIELDS_END);
  if (!cr || !fr) return text;
  let out = text;
  // The later region first, so the earlier one's offsets stay right.
  const regions = [
    { r: cr, body: indentLines(componentsCode(parsed), cr.indent) },
    { r: fr, body: indentLines(fieldLines(parsed.form), fr.indent) },
  ].sort((a, b) => b.r.from - a.r.from);
  for (const { r, body } of regions) out = out.slice(0, r.from) + body + out.slice(r.to);
  out = ensureImports(out, parsed.form);
  return addHandlers(out, parsed.form, todo);
}

/** Renames a component everywhere in the code: its field, its scroll pane, its handlers (`old_…`), outside strings and comments. */
export function renameInCode(text: string, from: string, to: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      const end = text[i + 1] === "/" ? text.indexOf("\n", i) : text.indexOf("*/", i + 2) + 2;
      const j = end <= 0 || end < i ? text.length : end;
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c) && !/[\w$]/.test(text[i - 1] ?? "")) {
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (word === from) out += to;
      else if (word === `${from}ScrollPane`) out += `${to}ScrollPane`;
      else if (word.startsWith(`${from}_`)) out += to + word.slice(from.length);
      else out += word;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The smallest single change that turns `a` into `b`. */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** The line (1-based) of a method's declaration, or null. */
export function methodLine(text: string, name: string): number | null {
  const m = new RegExp(`\\b(void|\\w+)\\s+${name}\\s*\\(`).exec(text);
  return m ? text.slice(0, m.index).split("\n").length : null;
}

/** A new window class: an empty form in a JFrame with a main method that shows it in the system's look. */
export function newWindowSource(className: string, pkg: string, title: string, texts: { fields: string; components: string; lookFallback: string }): string {
  const head = pkg ? `package ${pkg};\n\n` : "";
  const form: ParsedForm = { form: { className, title, width: 420, height: 280, resizable: true, components: [] }, extra: [], extras: new Map() };
  const src = `${head}import java.awt.*;
import java.awt.event.*;
import javax.swing.*;

public class ${className} extends JFrame {

    // GUI-BEGIN fields: ${texts.fields}
    // GUI-END fields

    public ${className}() {
        // GUI-BEGIN components: ${texts.components}
        // GUI-END components
        setDefaultCloseOperation(WindowConstants.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);
        setVisible(true);
    }

    public static void main(String[] args) {
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Exception e) {
            // ${texts.lookFallback}
        }
        SwingUtilities.invokeLater(${className}::new);
    }
}
`;
  return writeForm(src, form);
}
