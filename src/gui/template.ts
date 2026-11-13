/* The "Swing window" project: a small greeting form made with the designer, its button already answering. */
import { newWindowSource, parseForm, writeForm } from "./codegen";
import type { GuiComponent } from "./model";
import { t } from "../lib/i18n";

export function swingTemplate(): string {
  const base = newWindowSource("GreetingWindow", "", t("Greeting"), {
    fields: t("the designer writes this part"),
    components: t("the designer writes this part"),
    lookFallback: t("The default look stays."),
  });
  const p = parseForm(base)!;
  const c = (x: Partial<GuiComponent> & Pick<GuiComponent, "type" | "name" | "x" | "y" | "w" | "h">): GuiComponent => ({ events: [], ...x });
  p.form.width = 400;
  p.form.height = 200;
  p.form.components = [
    c({ type: "JLabel", name: "nameLabel", x: 24, y: 24, w: 120, h: 24, text: t("Your name:") }),
    c({ type: "JTextField", name: "nameField", x: 144, y: 24, w: 232, h: 24, events: ["actionPerformed"] }),
    c({ type: "JButton", name: "greetButton", x: 144, y: 64, w: 120, h: 28, text: t("Greet me"), events: ["actionPerformed"] }),
    c({ type: "JLabel", name: "answerLabel", x: 24, y: 112, w: 352, h: 40, align: "center", fontSize: 18, bold: true, foreground: "#4a3bd6" }),
  ];
  const src = writeForm(base, p, (name) => `TODO ${name}`);
  return src
    .replace(/(void greetButton_ActionPerformed\(ActionEvent evt\) \{\n)\s*\/\/ TODO greetButton\n/, `$1        String name = nameField.getText().trim();\n        answerLabel.setText(name.isEmpty() ? ${JSON.stringify(t("Type your name first."))} : ${JSON.stringify(t("Hello, "))} + name + "!");\n`)
    .replace(/(void nameField_ActionPerformed\(ActionEvent evt\) \{\n)\s*\/\/ TODO nameField\n/, `$1        // ${t("Enter in the text field does the same as the button.")}\n        greetButton_ActionPerformed(evt);\n`);
}
