import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasDesignerRegions, methodLine, minimalChange, newWindowSource, parseForm, renameInCode, statements, writeForm, type ParsedForm } from "./codegen";
import { COMPONENTS, freeName, newComponent, type GuiComponent } from "./model";
import { swingTemplate } from "./template";
import { absBox, codeOrder, containerAt, copyComponents, descendants, moveInto, pasteComponents, topmost } from "./tree";

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
