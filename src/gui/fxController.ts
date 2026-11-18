/*
 * The controller class of a JavaFX window (`fx:controller`): the designer writes its `@FXML` fields between the
 * `// GUI-BEGIN fields` and `// GUI-END fields` comments, and a handler method for each event it is asked for
 * (`okButton_Action(ActionEvent event)`), once; everything else in the class is yours.
 */
import { FIELDS_BEGIN, FIELDS_END, classEnd, hasMethod, indentLines, region } from "./codegen";
import { FX_COMPONENTS, FX_EVENTS, handlerName, type EventKind, type GuiComponent, type GuiForm } from "./model";

function fieldType(c: GuiComponent): string {
  const fx = FX_COMPONENTS[c.type].fx;
  if (c.type === "JComboBox" || c.type === "JList") return `${fx}<String>`;
  if (c.type === "JSpinner") return `${fx}<Integer>`;
  return fx;
}

export function controllerFieldLines(form: GuiForm): string[] {
  const out = form.components.map((c) => `@FXML private ${fieldType(c)} ${c.name};`);
  for (const g of [...new Set(form.components.map((c) => c.group).filter((x): x is string => !!x))]) out.push(`@FXML private ToggleGroup ${g};`);
  return out;
}

const imports = (form: GuiForm): string[] => {
  const used = new Set(form.components.flatMap((c) => c.events));
  const out = ["javafx.fxml.FXML", "javafx.scene.control.*", "javafx.scene.layout.*"];
  if (used.has("actionPerformed")) out.push("javafx.event.ActionEvent");
  if (used.has("mouseClicked")) out.push("javafx.scene.input.MouseEvent");
  if (used.has("keyReleased")) out.push("javafx.scene.input.KeyEvent");
  return out;
};

function ensureImports(text: string, needed: string[]): string {
  const missing = needed.filter((i) => !new RegExp(`^\\s*import\\s+${i.replace(/[.*]/g, (x) => "\\" + x)}\\s*;`, "m").test(text));
  if (!missing.length) return text;
  const lines = missing.map((i) => `import ${i};`).join("\n") + "\n";
  const all = [...text.matchAll(/^\s*import\s+[\w.*]+\s*;[^\n]*\n/gm)];
  if (all.length) {
    const last = all[all.length - 1];
    const at = last.index! + last[0].length;
    return text.slice(0, at) + lines + text.slice(at);
  }
  const pkg = /^\s*package\s+[\w.]+\s*;[^\n]*\n/m.exec(text);
  if (pkg) return text.slice(0, pkg.index + pkg[0].length) + "\n" + lines + text.slice(pkg.index + pkg[0].length);
  return lines + "\n" + text;
}

/** The controller with its fields written from the form, imports added and a handler for each new event. */
export function syncController(text: string, form: GuiForm, className: string, todo: (component: string, event: EventKind) => string): string {
  let out = text;
  const fr = region(out, FIELDS_BEGIN, FIELDS_END);
  if (fr) out = out.slice(0, fr.from) + indentLines(controllerFieldLines(form), fr.indent) + out.slice(fr.to);
  for (const c of form.components) {
    for (const e of c.events) {
      const info = FX_EVENTS[e];
      if (!info) continue;
      const name = handlerName(c.name, e, "fx");
      if (hasMethod(out, name)) continue;
      const at = classEnd(out, className);
      if (at < 0) continue;
      const before = out.slice(0, at).replace(/\s*$/, "");
      out = before + `\n\n    @FXML\n    private void ${name}(${info.param} event) {\n        // ${todo(c.name, e)}\n    }\n` + out.slice(at);
    }
  }
  return ensureImports(out, imports(form));
}

/** A new controller class with the designer's region and an initialize method. */
export function newControllerSource(className: string, pkg: string, texts: { fields: string; initialize: string }): string {
  const head = pkg ? `package ${pkg};\n\n` : "";
  return `${head}import javafx.fxml.FXML;
import javafx.scene.control.*;
import javafx.scene.layout.*;

public class ${className} {

    // GUI-BEGIN fields: ${texts.fields}
    // GUI-END fields

    @FXML
    private void initialize() {
        // ${texts.initialize}
    }
}
`;
}
