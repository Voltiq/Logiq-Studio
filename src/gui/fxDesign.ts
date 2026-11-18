/*
 * The designer's side of JavaFX windows: renaming a component in the FXML, finding the controller class, and
 * keeping it in step (its @FXML fields and handler methods) after each change.
 */
import { api } from "../lib/api";
import { getDoc } from "../editor/docs";
import { changeDoc } from "../lib/actions";
import { minimalChange } from "./codegen";
import { dirname, join } from "../lib/paths";
import { javaIndex } from "../uml/javaIndex";
import { t } from "../lib/i18n";
import { newControllerSource, syncController } from "./fxController";
import type { FxParsed } from "./fxml";
import type { EventKind, GuiForm } from "./model";

/** Renames a component in a parsed FXML: its name, what is inside it, what the designer kept for it. */
export function renameInFxml(p: FxParsed, from: string, to: string) {
  for (const c of p.form.components) {
    if (c.name === from) c.name = to;
    if (c.parent === from) c.parent = to;
  }
  for (const m of [p.attrs, p.style, p.props, p.foreign] as Map<string, unknown>[]) {
    if (!m.has(from)) continue;
    m.set(to, m.get(from));
    m.delete(from);
  }
}

/** Forgets what the designer kept for a deleted component. */
export function forgetInFxml(p: FxParsed, name: string) {
  for (const m of [p.attrs, p.style, p.props, p.foreign] as Map<string, unknown>[]) m.delete(name);
}

/** Where the controller class is: the file that declares it, or beside the .fxml. */
export function controllerPath(fxmlPath: string, controller: string): string {
  const known = javaIndex.types().find((x) => x.qualifiedName === controller);
  return known?.path ?? join(dirname(fxmlPath), `${controller.split(".").pop()}.java`);
}

async function textOf(path: string): Promise<string | null> {
  const doc = getDoc(path);
  if (doc) return doc.state.doc.toString();
  return api
    .readText(path)
    .then((f) => f.text)
    .catch(() => null);
}

/** Writes a file's new text: into its editor when open (one undo step there), else to disk. */
async function put(path: string, before: string | null, after: string) {
  if (before === after) return;
  if (getDoc(path) && before !== null) {
    const change = minimalChange(before, after);
    if (change) changeDoc(path, [change], "input.design");
    return;
  }
  if (before === null) await api.createFile(path, after);
  else await api.writeText(path, after);
  javaIndex.set(path, after);
}

/** Brings the controller in step with the window: made when it doesn't exist yet. */
export async function syncControllerFile(fxmlPath: string, form: GuiForm, controller: string | undefined, todo: (component: string, e: EventKind) => string) {
  if (!controller) return;
  const path = controllerPath(fxmlPath, controller);
  const className = controller.split(".").pop()!;
  const before = await textOf(path);
  const pkg = controller.includes(".") ? controller.slice(0, controller.lastIndexOf(".")) : "";
  const base = before ?? newControllerSource(className, pkg, { fields: t("the designer writes this part"), initialize: t("Runs once the window is loaded.") });
  await put(path, before, syncController(base, form, className, todo));
}

/** Renames a component in the controller (its field and handlers) too. */
export async function renameInController(fxmlPath: string, controller: string | undefined, rename: (text: string) => string) {
  if (!controller) return;
  const path = controllerPath(fxmlPath, controller);
  const before = await textOf(path);
  if (before !== null) await put(path, before, rename(before));
}
