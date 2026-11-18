import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasDesignerRegions, methodLine, minimalChange, newWindowSource, parseForm, renameInCode, statements, writeForm, type ParsedForm } from "./codegen";
import { COMPONENTS, freeName, newComponent, type GuiComponent } from "./model";
import { swingTemplate } from "./template";
import { absBox, childrenOf, codeOrder, containerAt, copyComponents, descendants, dropInto, moveInto, pasteComponents, placeInOrder, setLayout, topmost } from "./tree";

const TEXTS = { fields: "the designer writes this part", components: "the designer writes this part", lookFallback: "The default look stays." };

function sample(): string {
  return newWindowSource("Greeting", "", "Hello", TEXTS);
}

function withComponents(src: string, mutate: (p: ParsedForm) => void): string {
  const p = parseForm(src)!;
  mutate(p);
  return writeForm(src, p, (c) => `TODO: ${c}`);
}

describe("the designer's code", () => {
  it("makes a new window class with both regions", () => {
    const src = sample();
    expect(hasDesignerRegions(src)).toBe(true);
    const p = parseForm(src)!;
    expect(p.form).toMatchObject({ className: "Greeting", title: "Hello", width: 420, height: 280, resizable: true, components: [] });
    expect(src).toContain('setTitle("Hello");');
    expect(src).toContain("cp.setPreferredSize(new Dimension(420, 280));");
    expect(src).toContain("SwingUtilities.invokeLater(Greeting::new);");
  });

  it("writes and reads every kind of component the same", () => {
    let src = sample();
    const made: GuiComponent[] = [];
    src = withComponents(src, (p) => {
      for (const info of COMPONENTS) {
        const c = newComponent(p.form, info.type, 10 + made.length * 3, 20 + made.length * 5);
        made.push(c);
        p.form.components.push(c);
      }
      const b = p.form.components[0];
      Object.assign(b, { text: 'Say "hi"\nnow', tooltip: "Grüße", enabled: false, foreground: "#112233", background: "#ffeedd", fontSize: 16, bold: true, events: ["actionPerformed"] });
      const label = p.form.components.find((c) => c.type === "JLabel")!;
      Object.assign(label, { align: "center", icon: "images/logo.png", italic: true, events: ["mouseClicked"] });
      const radio = p.form.components.find((c) => c.type === "JRadioButton")!;
      Object.assign(radio, { group: "sizeGroup", selected: true });
      const field = p.form.components.find((c) => c.type === "JTextField")!;
      Object.assign(field, { editable: false, align: "right", events: ["actionPerformed", "keyReleased"] });
      Object.assign(p.form.components.find((c) => c.type === "JComboBox")!, { editable: true, items: ["Rot", "Grün", 'A "B"'] });
      Object.assign(p.form.components.find((c) => c.type === "JSlider")!, { min: 10, max: 90, value: 30, ticks: 20, events: ["stateChanged"] });
      Object.assign(p.form.components.find((c) => c.type === "JList")!, { events: ["valueChanged"] });
      Object.assign(p.form.components.find((c) => c.type === "JTextArea")!, { lineWrap: true, text: "Notes" });
      Object.assign(p.form.components.find((c) => c.type === "JPanel")!, { border: "Size", background: "#eeeeee" });
      Object.assign(p.form, { title: "Größe", width: 500, height: 360, resizable: false, background: "#f0f0f0" });
    });
    const back = parseForm(src)!;
    expect(back.form.title).toBe("Größe");
    expect(back.form).toMatchObject({ width: 500, height: 360, resizable: false, background: "#f0f0f0" });
    expect(back.extra).toEqual([]);
    expect([...back.extras.values()].flat()).toEqual([]);
    const strip = (c: GuiComponent) => JSON.parse(JSON.stringify(c));
    const want = parseForm(writeForm(src, back))!.form.components.map(strip);
    expect(back.form.components.map(strip)).toEqual(want);
    const button = back.form.components[0];
    expect(button).toMatchObject({ text: 'Say "hi"\nnow', tooltip: "Grüße", enabled: false, foreground: "#112233", background: "#ffeedd", fontSize: 16, bold: true, events: ["actionPerformed"] });
    expect(back.form.components.find((c) => c.type === "JComboBox")).toMatchObject({ editable: true, items: ["Rot", "Grün", 'A "B"'] });
    expect(back.form.components.find((c) => c.type === "JSlider")).toMatchObject({ min: 10, max: 90, value: 30, ticks: 20, events: ["stateChanged"] });
    expect(back.form.components.find((c) => c.type === "JRadioButton")).toMatchObject({ group: "sizeGroup", selected: true });
    expect(back.form.components.find((c) => c.type === "JTextField")).toMatchObject({ editable: false, align: "right", events: ["actionPerformed", "keyReleased"] });
    expect(back.form.components.find((c) => c.type === "JLabel")).toMatchObject({ align: "center", icon: "images/logo.png", italic: true, events: ["mouseClicked"] });
    expect(back.form.components.map((c) => [c.name, c.x, c.y])).toEqual(made.map((c) => [c.name, c.x, c.y]));
    // Writing again changes nothing.
    expect(writeForm(src, back)).toBe(src);
    // The handlers exist once, with the event import they need.
    expect(src.match(/void button1_ActionPerformed\(ActionEvent evt\)/g)).toHaveLength(1);
    expect(src).toContain("public void slider1_StateChanged(ChangeEvent evt)");
    expect(src).toContain("import javax.swing.event.*;");
    expect(methodLine(src, "list1_ValueChanged")).toBeGreaterThan(10);
  });

  it("reads code that was formatted, and keeps statements it doesn't know", () => {
    let src = withComponents(sample(), (p) => {
      const b = newComponent(p.form, "JButton", 20, 30);
      b.events = ["actionPerformed"];
      p.form.components.push(b);
    });
    // As a formatter would break it, plus a line of the user's own in the region.
    src = src
      .replace("button1.setBounds(20, 30, 104, 28);", "button1.setBounds(\n            20,\n            30,\n            104,\n            28\n        );\n        button1.setMnemonic(KeyEvent.VK_B); // mine")
      .replace("cp.setLayout(null);", "cp.setLayout(null);\n        getRootPane().setDefaultButton(button1);");
    const p = parseForm(src)!;
    expect(p.form.components[0]).toMatchObject({ name: "button1", x: 20, y: 30, w: 104, h: 28 });
    expect(p.extras.get("button1")).toEqual(["button1.setMnemonic(KeyEvent.VK_B)"]);
    expect(p.extra).toEqual(["getRootPane().setDefaultButton(button1)"]);
    p.form.components[0].x = 40;
    const out = writeForm(src, p);
    expect(out).toContain("button1.setBounds(40, 30, 104, 28);");
    expect(out).toContain("button1.setMnemonic(KeyEvent.VK_B);");
    expect(out).toContain("getRootPane().setDefaultButton(button1);");
  });

  it("renames a component in code, handlers included, but not in strings and comments", () => {
    const src = 'okButton.setText("okButton"); // okButton\nokButtonX = 1; okButton_ActionPerformed(e); notesScrollPane; okButton.getText();';
    expect(renameInCode(src, "okButton", "sendButton")).toBe('sendButton.setText("okButton"); // okButton\nokButtonX = 1; sendButton_ActionPerformed(e); notesScrollPane; sendButton.getText();');
    expect(renameInCode("notesScrollPane.x", "notes", "memo")).toBe("memoScrollPane.x");
  });

  it("splits statements outside strings and brackets", () => {
    expect(statements('a("x;y"); b(new X() { void f() { g(); } }); // c;\nd()')).toEqual(['a("x;y")', "b(new X() { void f() { g(); } })", "d()"]);
  });

  it("finds the smallest change", () => {
    expect(minimalChange("abcdef", "abXYef")).toEqual({ from: 2, to: 4, insert: "XY" });
    expect(minimalChange("same", "same")).toBeNull();
  });
});

/** A window with a panel holding a button, a text area (in its scroll pane) and a panel with a label. */
function nested(): string {
  return withComponents(sample(), (p) => {
    const panel = newComponent(p.form, "JPanel", 20, 30);
    p.form.components.push(panel);
    const button = { ...newComponent(p.form, "JButton", 10, 24), parent: panel.name };
    p.form.components.push(button);
    const area = { ...newComponent(p.form, "JTextArea", 10, 60), parent: panel.name, w: 100, h: 40 };
    p.form.components.push(area);
    const inner = { ...newComponent(p.form, "JPanel", 120, 10), parent: panel.name, w: 90, h: 60 };
    p.form.components.push(inner);
    p.form.components.push({ ...newComponent(p.form, "JLabel", 4, 4), parent: inner.name });
    p.form.components.push(newComponent(p.form, "JCheckBox", 260, 30));
  });
}

/** A window with a BorderLayout: a toolbar panel (FlowLayout) at the top, a grid of buttons in the centre, a label below. */
function laidOut(): string {
  return withComponents(sample(), (p) => {
    const f = p.form;
    f.layout = { kind: "border", hgap: 4, vgap: 4 };
    const bar = { ...newComponent(f, "JPanel", 0, 0), layout: { kind: "flow", align: "left", hgap: 5, vgap: 5 } as const, region: "NORTH" as const, h: 40 };
    f.components.push(bar);
    f.components.push({ ...newComponent(f, "JButton", 0, 0), parent: bar.name, w: 80, h: 26 });
    f.components.push({ ...newComponent(f, "JTextField", 0, 0), parent: bar.name, w: 120 });
    const grid = { ...newComponent(f, "JPanel", 0, 0), layout: { kind: "grid", rows: 2, cols: 2, hgap: 6, vgap: 6 } as const, region: "CENTER" as const };
    f.components.push(grid);
    for (let i = 0; i < 4; i++) f.components.push({ ...newComponent(f, "JButton", 0, 0), parent: grid.name });
    f.components.push({ ...newComponent(f, "JLabel", 0, 0), region: "SOUTH" as const });
    f.components.push({ ...newComponent(f, "JTextArea", 0, 0), region: "EAST" as const, w: 120 });
  });
}

describe("layout managers", () => {
  it("are written for the window and the panels, the components asking for their size", () => {
    const src = laidOut();
    expect(src).toContain("cp.setLayout(new BorderLayout(4, 4));");
    expect(src).toContain("panel1.setLayout(new FlowLayout(FlowLayout.LEFT, 5, 5));");
    expect(src).toContain("panel2.setLayout(new GridLayout(2, 2, 6, 6));");
    expect(src).toContain("cp.add(panel1, BorderLayout.NORTH);");
    expect(src).toContain("cp.add(panel2, BorderLayout.CENTER);");
    expect(src).toContain("cp.add(label1, BorderLayout.SOUTH);");
    expect(src).toContain("cp.add(textArea1ScrollPane, BorderLayout.EAST);");
    expect(src).toContain("textArea1ScrollPane.setPreferredSize(new Dimension(120, 110));");
    expect(src).toContain("button1.setPreferredSize(new Dimension(80, 26));");
    expect(src).toContain("panel1.add(button1);");
    // In a grid every cell is the same: no size, no bounds.
    expect(src).not.toMatch(/button[2-5]\.set(Bounds|PreferredSize)/);
    expect(src).not.toContain("setBounds(");
  });

  it("are read back, and writing what was read changes nothing", () => {
    const src = laidOut();
    const p = parseForm(src)!;
    const by = (n: string) => p.form.components.find((c) => c.name === n)!;
    expect(p.form.layout).toEqual({ kind: "border", hgap: 4, vgap: 4 });
    expect(by("panel1")).toMatchObject({ layout: { kind: "flow", align: "left" }, region: "NORTH" });
    expect(by("panel2")).toMatchObject({ layout: { kind: "grid", rows: 2, cols: 2 } });
    expect(by("textArea1")).toMatchObject({ region: "EAST", w: 120, h: 110 });
    expect(by("button1")).toMatchObject({ parent: "panel1", w: 80, h: 26 });
    expect(p.extra).toEqual([]);
    expect([...p.extras.values()].flat()).toEqual([]);
    expect(writeForm(src, p)).toBe(src);
  });

  it("place the components as Swing would", () => {
    const f = parseForm(laidOut())!.form;
    const by = (n: string) => f.components.find((c) => c.name === n)!;
    // The window is 420 × 280; north 40 high, south the label's 20, east the text area's 120.
    expect(absBox(f, by("panel1"))).toEqual({ x: 0, y: 0, w: 420, h: 40 });
    expect(absBox(f, by("label1"))).toEqual({ x: 0, y: 260, w: 420, h: 20 });
    expect(absBox(f, by("textArea1"))).toEqual({ x: 300, y: 44, w: 120, h: 212 });
    expect(absBox(f, by("panel2"))).toEqual({ x: 0, y: 44, w: 296, h: 212 });
    // Flow in the north panel: from the left, 5 gaps.
    expect(absBox(f, by("button1"))).toMatchObject({ x: 5, w: 80 });
    expect(absBox(f, by("textField1"))).toMatchObject({ x: 90, w: 120 });
    // The grid's four buttons share the centre panel.
    expect(absBox(f, by("button3"))).toEqual({ x: 151, y: 44, w: 145, h: 103 });
  });

  it("change without anything jumping", () => {
    const f = parseForm(nested())!.form;
    const by = (n: string) => f.components.find((c) => c.name === n)!;
    // The outer panel's components, put in reading order by a flow layout (button1 and panel2 share a row).
    setLayout(f, "panel1", { kind: "flow", align: "center", hgap: 5, vgap: 5 });
    expect(childrenOf(f, "panel1").map((c) => c.name)).toEqual(["button1", "panel2", "textArea1"]);
    // And back to none: each where the flow had it.
    const flowed = absBox(f, by("button1"));
    setLayout(f, "panel1", undefined);
    expect(absBox(f, by("button1"))).toEqual(flowed);
    // To a border layout: each to the region it is nearest.
    setLayout(f, null, { kind: "border", hgap: 0, vgap: 0 });
    expect(by("checkBox1").region).toBe("NORTH");
    expect(by("panel1").region).toBe("CENTER");
  });

  it("take what is dropped where the pointer is: a place in the order, or a region", () => {
    const f = parseForm(laidOut())!.form;
    const by = (n: string) => f.components.find((c) => c.name === n)!;
    // The label (south) dropped in the north panel's flow, left of the text field.
    const field = absBox(f, by("textField1"));
    dropInto(f, [{ name: "label1", abs: { x: 0, y: 0 } }], "panel1", { x: field.x + 5, y: field.y + 5 });
    expect(by("label1").parent).toBe("panel1");
    expect(by("label1").region).toBeUndefined();
    expect(childrenOf(f, "panel1").map((c) => c.name)).toEqual(["button1", "label1", "textField1"]);
    // The text area (east) dropped in the window's west: it goes there.
    dropInto(f, [{ name: "textArea1", abs: { x: 0, y: 0 } }], null, { x: 10, y: 140 });
    expect(by("textArea1").region).toBe("WEST");
    // Dropped on the centre, where the grid panel is: they swap.
    dropInto(f, [{ name: "textArea1", abs: { x: 0, y: 0 } }], null, { x: 210, y: 140 });
    expect(by("textArea1").region).toBe("CENTER");
    expect(by("panel2").region).toBe("WEST");
  });

  it("put a pasted copy at the end of a flow, or in a free region", () => {
    const f = parseForm(laidOut())!.form;
    const name = (form: typeof f, c: GuiComponent) => freeName(form, COMPONENTS.find((i) => i.type === c.type)!.prefix);
    const [copy] = pasteComponents(f, copyComponents(f, ["button1"]), 16, name);
    expect(childrenOf(f, "panel1").map((c) => c.name)).toEqual(["button1", "textField1", copy]);
    const [label] = pasteComponents(f, copyComponents(f, ["label1"]), 16, name);
    expect(f.components.find((c) => c.name === label)).toMatchObject({ region: "WEST" });
    expect(f.components.find((c) => c.name === label)!.parent).toBeUndefined();
  });

  it("give each component its own region when switching to a border layout, while there are free ones", () => {
    const src = withComponents(sample(), (p) => {
      for (let i = 0; i < 6; i++) p.form.components.push(newComponent(p.form, "JButton", 150 + i, 120 + i));
    });
    const f = parseForm(src)!.form;
    setLayout(f, null, { kind: "border", hgap: 0, vgap: 0 });
    const regions = f.components.map((c) => c.region);
    expect(new Set(regions.slice(0, 5)).size).toBe(5);
    expect(regions[0]).toBe("CENTER");
    // A sixth can only share the centre, where Swing shows the last added.
    expect(regions[5]).toBe("CENTER");
  });

  it("keep their place in the order when moved", () => {
    const f = parseForm(laidOut())!.form;
    const field = f.components.find((c) => c.name === "textField1")!;
    placeInOrder(f, field, 0);
    expect(childrenOf(f, "panel1").map((c) => c.name)).toEqual(["textField1", "button1"]);
    placeInOrder(f, field, 5);
    expect(childrenOf(f, "panel1").map((c) => c.name)).toEqual(["button1", "textField1"]);
  });
});

describe("components inside panels", () => {
  it("are added to their panel, which has no layout manager, after it is set up", () => {
    const src = nested();
    expect(src).toContain("panel1.setLayout(null);");
    expect(src).toContain("panel1.add(button1);");
    expect(src).toContain("panel1.add(textArea1ScrollPane);");
    expect(src).toContain("panel1.add(panel2);");
    expect(src).toContain("panel2.add(label1);");
    expect(src).toContain("cp.add(panel1);");
    expect(src).toContain("cp.add(checkBox1);");
    expect(src).not.toContain("cp.add(button1);");
    // Relative to the panel, as setBounds is.
    expect(src).toContain("button1.setBounds(10, 24, 104, 28);");
    expect(src.indexOf("cp.add(panel1);")).toBeLessThan(src.indexOf("button1.setBounds("));
    expect(src.indexOf("panel2.setLayout(null);")).toBeLessThan(src.indexOf("label1.setBounds("));
  });

  it("are read back inside their panel", () => {
    const f = parseForm(nested())!.form;
    const by = (n: string) => f.components.find((c) => c.name === n)!;
    expect(by("button1").parent).toBe("panel1");
    expect(by("textArea1").parent).toBe("panel1");
    expect(by("panel2").parent).toBe("panel1");
    expect(by("label1").parent).toBe("panel2");
    expect(by("panel1").parent).toBeUndefined();
    expect(by("checkBox1").parent).toBeUndefined();
    expect(by("button1")).toMatchObject({ x: 10, y: 24 });
    // Writing what was read changes nothing.
    const src = nested();
    expect(writeForm(src, parseForm(src)!)).toBe(src);
  });

  it("know where they are in the window, which panel a point is in, and what a panel holds", () => {
    const f = parseForm(nested())!.form;
    const by = (n: string) => f.components.find((c) => c.name === n)!;
    expect(absBox(f, by("label1"))).toEqual({ x: 20 + 120 + 4, y: 30 + 10 + 4, w: 104, h: 20 });
    expect(containerAt(f, 25, 35)).toBe("panel1");
    expect(containerAt(f, 150, 50)).toBe("panel2");
    expect(containerAt(f, 150, 50, ["panel2"])).toBe("panel1");
    expect(containerAt(f, 5, 5)).toBeNull();
    expect(descendants(f, "panel1").map((c) => c.name).sort()).toEqual(["button1", "label1", "panel2", "textArea1"]);
    expect(topmost(f, ["panel2", "label1", "checkBox1"])).toEqual(["panel2", "checkBox1"]);
    expect(codeOrder(f).map((c) => c.name)).toEqual(["panel1", "button1", "textArea1", "panel2", "label1", "checkBox1"]);
  });

  it("keep their place in the window when they move into another panel", () => {
    const f = parseForm(nested())!.form;
    const label = f.components.find((c) => c.name === "label1")!;
    const before = absBox(f, label);
    moveInto(f, label, null, before);
    expect(label.parent).toBeUndefined();
    expect(label).toMatchObject({ x: before.x, y: before.y });
    moveInto(f, label, "panel1", before);
    expect(label).toMatchObject({ parent: "panel1", x: before.x - 20, y: before.y - 30 });
  });

  it("are copied with what is inside them, and a copy lands beside its original, not in it", () => {
    const f = parseForm(nested())!.form;
    const name = (form: typeof f, c: GuiComponent) => freeName(form, COMPONENTS.find((i) => i.type === c.type)!.prefix);
    const by = (n: string) => f.components.find((c) => c.name === n)!;
    // Duplicating the outer panel: a new panel in the window, with copies of all four inside it.
    const outer = pasteComponents(f, copyComponents(f, ["panel1"]), 16, name);
    expect(outer).toEqual(["panel3"]);
    expect(by("panel3").parent).toBeUndefined();
    expect(by("panel3")).toMatchObject({ x: 36, y: 46 });
    expect(descendants(f, "panel3").length).toBe(4);
    // Duplicating a button inside the panel: the copy stays in that panel.
    const [copy] = pasteComponents(f, copyComponents(f, ["button1"]), 16, name);
    expect(by(copy)).toMatchObject({ parent: "panel1", x: 26, y: 40 });
    // A panel and something inside it, selected together, is copied once.
    expect(copyComponents(f, ["panel2", "label1"]).map((c) => c.name)).toEqual(["panel2", "label1"]);
  });

  it("ignore a loop in hand-written code", () => {
    const f = parseForm(nested())!.form;
    f.components.find((c) => c.name === "panel1")!.parent = "panel2";
    expect(() => codeOrder(f)).not.toThrow();
    expect(absBox(f, f.components.find((c) => c.name === "label1")!)).toBeTruthy();
  });
});

let javac: string | null = null;
for (const home of [process.env.JAVA_HOME, "C:\\Program Files\\Java\\jdk-27", "C:\\Program Files\\Java\\jdk-25"].filter(Boolean) as string[]) {
  const p = join(home, "bin", process.platform === "win32" ? "javac.exe" : "javac");
  if (existsSync(p)) javac = p;
}
if (!javac) {
  try {
    execFileSync("javac", ["-version"], { stdio: "ignore" });
    javac = "javac";
  } catch {
    javac = null;
  }
}

// javac's first start on a cold machine (a CI runner) takes several seconds: these tests get a minute.
describe.skipIf(!javac)("with the real javac", () => {
  it("compiles the Swing window template, its button already answering", () => {
    const src = swingTemplate();
    expect(src).toContain("answerLabel.setText(");
    expect(src).toContain("greetButton_ActionPerformed(evt);");
    expect(parseForm(src)!.form.components.map((c) => c.name)).toEqual(["nameLabel", "nameField", "greetButton", "answerLabel"]);
    const dir = mkdtempSync(join(tmpdir(), "logiq-gui-"));
    writeFileSync(join(dir, "GreetingWindow.java"), src);
    try {
      execFileSync(javac!, ["-encoding", "UTF-8", "-Xlint:unchecked,deprecation", "-Werror", "-d", join(dir, "out"), join(dir, "GreetingWindow.java")], { stdio: "pipe" });
    } catch (e) {
      throw new Error(String((e as { stderr: Buffer }).stderr) + "\n" + src);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("compiles a window laid out with border, flow and grid layouts", () => {
    const src = laidOut().replace(/\bGreeting\b/g, "Laid");
    const dir = mkdtempSync(join(tmpdir(), "logiq-gui-"));
    writeFileSync(join(dir, "Laid.java"), src);
    try {
      execFileSync(javac!, ["-encoding", "UTF-8", "-Xlint:unchecked,deprecation", "-Werror", "-d", join(dir, "out"), join(dir, "Laid.java")], { stdio: "pipe" });
    } catch (e) {
      throw new Error(String((e as { stderr: Buffer }).stderr) + "\n" + src);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("compiles a window with components inside panels", () => {
    const src = nested().replace(/\bGreeting\b/g, "Nested");
    const dir = mkdtempSync(join(tmpdir(), "logiq-gui-"));
    writeFileSync(join(dir, "Nested.java"), src);
    try {
      execFileSync(javac!, ["-encoding", "UTF-8", "-Xlint:unchecked,deprecation", "-Werror", "-d", join(dir, "out"), join(dir, "Nested.java")], { stdio: "pipe" });
    } catch (e) {
      throw new Error(String((e as { stderr: Buffer }).stderr) + "\n" + src);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("compiles a window with every component, event and property", () => {
    const src = withComponents(newWindowSource("Everything", "", "All", TEXTS), (p) => {
      for (const info of COMPONENTS) {
        const c = newComponent(p.form, info.type, 8, 8 + p.form.components.length * 30);
        c.events = [...info.events];
        c.tooltip = "tip";
        if (info.props.includes("foreground")) c.foreground = "#123456";
        if (info.props.includes("background")) c.background = "#abcdef";
        if (info.props.includes("fontSize")) Object.assign(c, { fontSize: 14, bold: true, italic: true });
        if (c.type === "JRadioButton") c.group = "choices";
        if (c.type === "JPanel") c.border = "Frame";
        if (c.type === "JTextArea") c.lineWrap = true;
        if (c.type === "JComboBox") c.editable = true;
        if (c.type === "JTextField") Object.assign(c, { editable: false, align: "center" });
        if (c.type === "JSlider") Object.assign(c, { min: 5, value: 20 });
        p.form.components.push(c);
      }
      p.form.background = "#fafafa";
      p.form.resizable = false;
    });
    const dir = mkdtempSync(join(tmpdir(), "logiq-gui-"));
    writeFileSync(join(dir, "Everything.java"), src);
    try {
      execFileSync(javac!, ["-encoding", "UTF-8", "-Xlint:unchecked,deprecation", "-Werror", "-d", join(dir, "out"), join(dir, "Everything.java")], { stdio: "pipe" });
    } catch (e) {
      throw new Error(String((e as { stderr: Buffer }).stderr) + "\n" + src);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
