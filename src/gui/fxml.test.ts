import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { newControllerSource, syncController } from "./fxController";
import { parseXml, writeXml } from "./xml";
import { newFxmlSource, parseFxml, writeFxml } from "./fxml";
import { COMPONENTS, newComponent } from "./model";

/** What Scene Builder writes, more or less, with things the designer doesn't know mixed in. */
const SCENE_BUILDER = `<?xml version="1.0" encoding="UTF-8"?>

<?import javafx.scene.control.Button?>
<?import javafx.scene.control.Label?>
<?import javafx.scene.layout.AnchorPane?>
<?import javafx.scene.image.ImageView?>

<AnchorPane prefHeight="300.0" prefWidth="480.0" style="-fx-background-color: #fafafa; -fx-padding: 4;" xmlns="http://javafx.com/javafx/17" xmlns:fx="http://javafx.com/fxml/1" fx:controller="app.HelloController">
   <children>
      <Label fx:id="title" layoutX="24.0" layoutY="16.0" text="Hello &amp; welcome" textFill="#4a3bd6" style="-fx-font-size: 18px; -fx-font-weight: bold;" />
      <Button fx:id="okButton" layoutX="24.0" layoutY="60.0" mnemonicParsing="false" onAction="#okButton_Action" prefHeight="28.0" prefWidth="104.0" text="OK">
         <tooltip>
            <Tooltip text="Says hello" />
         </tooltip>
      </Button>
      <Button layoutX="140.0" layoutY="60.0" onAction="#somethingElse" text="Other" />
      <ImageView fitHeight="40.0" fitWidth="40.0" layoutX="400.0" layoutY="10.0" />
      <Pane fx:id="box" layoutX="24.0" layoutY="120.0" prefHeight="120.0" prefWidth="200.0">
         <children>
            <CheckBox fx:id="agree" layoutX="8.0" layoutY="8.0" selected="true" text="I agree" />
         </children>
      </Pane>
   </children>
</AnchorPane>
`;

describe("the XML reader", () => {
  it("reads elements, attributes, entities, comments and processing instructions, and writes them back", () => {
    const nodes = parseXml('<?import a.B?><!-- note --><A x="1 &lt; 2" y=\'q\'><B/>text</A>');
    expect(nodes[0]).toEqual({ kind: "pi", target: "import", data: "a.B" });
    expect(nodes[1]).toEqual({ kind: "comment", text: " note " });
    const a = nodes[2] as { attrs: [string, string][] };
    expect(a.attrs).toEqual([
      ["x", "1 < 2"],
      ["y", "q"],
    ]);
    expect(writeXml(nodes)).toBe('<?import a.B?>\n<!-- note -->\n<A x="1 &lt; 2" y="q">\n    <B />\n    text\n</A>\n');
  });

  it("says where a document is broken", () => {
    expect(() => parseXml("<A>\n<B></A>")).toThrow(/line 2/);
    expect(() => parseXml("<A")).toThrow();
  });
});

describe("FXML", () => {
  it("is read into the designer's model", () => {
    const p = parseFxml(SCENE_BUILDER)!;
    const f = p.form;
    expect(f).toMatchObject({ toolkit: "fx", className: "HelloController", width: 480, height: 300, background: "#fafafa" });
    expect(p.controller).toBe("app.HelloController");
    const by = (n: string) => f.components.find((c) => c.name === n)!;
    expect(by("title")).toMatchObject({ type: "JLabel", x: 24, y: 16, text: "Hello & welcome", foreground: "#4a3bd6", fontSize: 18, bold: true });
    expect(by("okButton")).toMatchObject({ type: "JButton", w: 104, h: 28, events: ["actionPerformed"], tooltip: "Says hello" });
    expect(by("agree")).toMatchObject({ type: "JCheckBox", parent: "box", selected: true });
    // A button without fx:id gets a name; a handler of another name stays as written.
    expect(by("button1")).toBeTruthy();
    expect(p.attrs.get("button1")).toContainEqual(["onAction", "#somethingElse"]);
    expect(p.attrs.get("okButton")).toContainEqual(["mnemonicParsing", "false"]);
    expect(p.foreign.get("")!.map((e) => e.name)).toEqual(["ImageView"]);
    expect(p.style.get("")).toBe("-fx-padding: 4");
    // JavaFX's last child is on top, the model's first.
    expect(f.components.map((c) => c.name)).toEqual(["box", "agree", "button1", "okButton", "title"]);
  });

  it("is written back with everything it didn't know, and reads the same again", () => {
    const p = parseFxml(SCENE_BUILDER)!;
    const out = writeFxml(p);
    expect(out).toContain('fx:controller="app.HelloController"');
    expect(out).toContain('mnemonicParsing="false"');
    expect(out).toContain('onAction="#somethingElse"');
    expect(out).toContain("<ImageView ");
    expect(out).toContain("<?import javafx.scene.image.ImageView?>");
    expect(out).toContain("-fx-padding: 4");
    expect(out).toContain('text="Hello &amp; welcome"');
    const again = parseFxml(out)!;
    expect(again.form.components).toEqual(p.form.components);
    expect(writeFxml(again)).toBe(out);
  });

  it("writes every kind of component, and reads it back the same", () => {
    const p = parseFxml(newFxmlSource("app.AllController"))!;
    for (const info of COMPONENTS) {
      const c = newComponent(p.form, info.type, 10, 10 + p.form.components.length * 30);
      if (info.type === "JRadioButton") c.group = "choice";
      if (info.type === "JTextField") Object.assign(c, { align: "center", editable: false, events: ["actionPerformed", "keyReleased"] });
      if (info.type === "JTextArea") Object.assign(c, { lineWrap: true, foreground: "#112233" });
      if (info.type === "JSlider") Object.assign(c, { min: 5, max: 50, value: 20, ticks: 5 });
      if (info.type === "JSpinner") Object.assign(c, { min: 1, max: 9, value: 3, step: 2 });
      if (info.type === "JProgressBar") c.value = 40;
      if (info.type === "JButton") Object.assign(c, { enabled: false, italic: true, background: "#abcdef" });
      p.form.components.push(c);
    }
    const out = writeFxml(p);
    expect(out).toContain('<ToggleGroup fx:id="choice" />');
    expect(out).toContain('toggleGroup="$choice"');
    expect(out).toContain('<Spinner fx:id="spinner1"');
    expect(out).toContain('initialValue="3" amountToStepBy="2"');
    expect(out).toContain('progress="0.4"');
    expect(out).toContain('onKeyReleased="#textField1_KeyReleased"');
    expect(out).toContain('<String fx:value="Item 1" />');
    expect(out).toContain("<?import javafx.collections.FXCollections?>");
    const back = parseFxml(out)!.form.components;
    // An empty text isn't written: the same as none.
    const plain = (c: object) => Object.fromEntries(Object.entries(c).filter(([k, v]) => !(k === "text" && v === "")));
    for (const c of p.form.components) expect(plain(back.find((x) => x.name === c.name)!), c.name).toEqual(plain(c));
  });

  it("isn't read when its root isn't a pane the designer places freely", () => {
    expect(parseFxml('<VBox xmlns:fx="http://javafx.com/fxml/1"/>')).toBeNull();
    expect(parseFxml("not xml <")).toBeNull();
  });
});

describe("the controller", () => {
  const todo = (c: string) => `TODO: what happens for ${c}`;
  const form = () => {
    const p = parseFxml(newFxmlSource("app.HelloController"))!;
    const f = p.form;
    const b = { ...newComponent(f, "JButton", 8, 8), events: ["actionPerformed" as const] };
    f.components.push(b);
    f.components.push({ ...newComponent(f, "JTextField", 8, 40), events: ["keyReleased" as const] });
    f.components.push({ ...newComponent(f, "JRadioButton", 8, 80), group: "size" });
    f.components.push(newComponent(f, "JComboBox", 8, 120));
    f.components.push(newComponent(f, "JSpinner", 8, 160));
    f.components.push({ ...newComponent(f, "JPanel", 200, 8), events: ["mouseClicked" as const] });
    return f;
  };

  it("gets a field for each component and a handler for each event, once", () => {
    const f = form();
    const src = syncController(newControllerSource("HelloController", "app", { fields: "the designer writes this part", initialize: "Runs once the window is loaded." }), f, "HelloController", todo);
    expect(src).toContain("@FXML private Button button1;");
    expect(src).toContain("@FXML private ComboBox<String> comboBox1;");
    expect(src).toContain("@FXML private Spinner<Integer> spinner1;");
    expect(src).toContain("@FXML private ToggleGroup size;");
    expect(src).toContain("private void button1_Action(ActionEvent event) {");
    expect(src).toContain("private void textField1_KeyReleased(KeyEvent event) {");
    expect(src).toContain("private void panel1_MouseClicked(MouseEvent event) {");
    expect(src).toContain("import javafx.event.ActionEvent;");
    expect(src).toContain("import javafx.scene.input.KeyEvent;");
    // Again: nothing more.
    expect(syncController(src, f, "HelloController", todo)).toBe(src);
  });

  it("compiles with javac against JavaFX's classes", () => {
    const javac = findJavac();
    if (!javac) return;
    const f = form();
    const src = syncController(newControllerSource("HelloController", "app", { fields: "x", initialize: "y" }), f, "HelloController", todo);
    const dir = mkdtempSync(join(tmpdir(), "logiq-fx-"));
    try {
      // Stand-ins with JavaFX's names: what the controller uses of them.
      const stubs: Record<string, string> = {
        "javafx/fxml/FXML.java": "package javafx.fxml; import java.lang.annotation.*; @Retention(RetentionPolicy.RUNTIME) public @interface FXML {}",
        "javafx/event/ActionEvent.java": "package javafx.event; public class ActionEvent {}",
        "javafx/scene/input/MouseEvent.java": "package javafx.scene.input; public class MouseEvent {}",
        "javafx/scene/input/KeyEvent.java": "package javafx.scene.input; public class KeyEvent {}",
        "javafx/scene/layout/Pane.java": "package javafx.scene.layout; public class Pane {}",
        ...Object.fromEntries(
          ["Button", "Label", "TextField", "PasswordField", "TextArea", "CheckBox", "RadioButton", "Slider", "ProgressBar", "ToggleGroup"].map((n) => [`javafx/scene/control/${n}.java`, `package javafx.scene.control; public class ${n} {}`]),
        ),
        "javafx/scene/control/ComboBox.java": "package javafx.scene.control; public class ComboBox<T> {}",
        "javafx/scene/control/ListView.java": "package javafx.scene.control; public class ListView<T> {}",
        "javafx/scene/control/Spinner.java": "package javafx.scene.control; public class Spinner<T> {}",
        "app/HelloController.java": src,
      };
      for (const [file, text] of Object.entries(stubs)) {
        mkdirSync(join(dir, dirname(file)), { recursive: true });
        writeFileSync(join(dir, file), text);
      }
      execFileSync(javac, ["-encoding", "UTF-8", "-Xlint:all", "-Werror", "-d", join(dir, "out"), ...Object.keys(stubs).map((f) => join(dir, f))], { stdio: "pipe" });
    } catch (e) {
      throw new Error(String((e as { stderr?: Buffer }).stderr ?? e) + "\n" + src);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

function findJavac(): string | null {
  for (const home of [process.env.JAVA_HOME, "C:\Program Files\Java\jdk-27", "C:\Program Files\Java\jdk-25"].filter(Boolean) as string[]) {
    const p = join(home, "bin", process.platform === "win32" ? "javac.exe" : "javac");
    if (existsSync(p)) return p;
  }
  try {
    execFileSync("javac", ["-version"], { stdio: "ignore" });
    return "javac";
  } catch {
    return null;
  }
}
