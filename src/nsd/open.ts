/*
 * Opening Nassi–Shneiderman diagrams: a .nsd file (drawn by hand, editable), or the method at the cursor
 * (drawn from its code, following it as it changes).
 */
import { activeTab, get, openDialog, toast } from "../lib/store";
import { activeView } from "../editor/docs";
import { api, errorText } from "../lib/api";
import { basename, extname, invalidName, join, stem } from "../lib/paths";
import { t } from "../lib/i18n";
import { methodAt } from "./fromJava";
import { toFile, type Nsd } from "./model";

/** Tab ids: "nsd:<file>" for a .nsd file, "nsd-code:<java file>#<signature>" for a method. */
export const nsdFileId = (path: string) => `nsd:${path}`;
export const nsdCodeId = (path: string, signature: string) => `nsd-code:${path}#${signature}`;

export function parseNsdId(id: string): { file: string } | { code: string; signature: string } | null {
  if (id.startsWith("nsd:")) return { file: id.slice(4) };
  if (id.startsWith("nsd-code:")) {
    const rest = id.slice(9);
    const hash = rest.indexOf("#");
    return hash > 0 ? { code: rest.slice(0, hash), signature: rest.slice(hash + 1) } : null;
  }
  return null;
}

const actions = () => import("../lib/actions");

export async function openNsdFile(path: string, group?: 0 | 1) {
  const { openViewTab } = await actions();
  openViewTab({ id: nsdFileId(path), kind: "nsd", path, title: stem(path), dirty: false, group });
}

export async function openNsdOfMethod(path: string, signature: string, group?: 0 | 1) {
  const { openViewTab } = await actions();
  const name = signature.replace(/\(.*$/, "");
  openViewTab({ id: nsdCodeId(path, signature), kind: "nsd", path, title: t("{0} (structogram)", `${name}()`), dirty: false, group });
}

/** The method the cursor is in, beside its code. */
export async function nsdAtCursor() {
  const tab = activeTab();
  const view = activeView();
  if (!tab?.path || tab.kind !== "file" || extname(tab.path) !== "java" || !view) {
    toast("info", t("Put the cursor in a Java method"), t("The diagram is drawn from the method the cursor is in."));
    return;
  }
  const m = methodAt(view.state.doc.toString(), view.state.selection.main.head);
  if (!m) {
    toast("info", t("Put the cursor in a Java method"), t("The diagram is drawn from the method the cursor is in."));
    return;
  }
  await openNsdOfMethod(tab.path, m.signature, tab.group === 0 ? 1 : 0);
}

/** A new, empty .nsd file in `dir`, opened to draw in. */
export function newNsd(dir: string, from?: Nsd) {
  openDialog({
    kind: "prompt",
    title: t("New Nassi–Shneiderman diagram"),
    label: t("Name"),
    value: from ? from.title.replace(/\(.*$/, "") : t("Structogram"),
    confirmLabel: t("Create"),
    validate: (v) => {
      const problem = invalidName(v.trim().replace(/\.nsd$/i, ""));
      return problem ? t(problem) : null;
    },
    onSubmit: async (v) => {
      const name = v.trim().replace(/\.nsd$/i, "");
      const path = join(dir, `${name}.nsd`);
      try {
        if (await api.exists(path).catch(() => false)) throw new Error(t("{0} already exists.", basename(path)));
        await api.writeText(path, toFile(from ?? { title: name, body: [{ kind: "action", text: t("Input") }, { kind: "action", text: t("Processing") }, { kind: "action", text: t("Output") }] }));
        const { loadDir } = await actions();
        await loadDir(dir).catch(() => {});
        await openNsdFile(path);
      } catch (e) {
        toast("error", t("The diagram wasn't created"), errorText(e));
      }
    },
  });
}

/** The folder new diagrams go in: the selected folder, else the project's. */
export function nsdDir(): string | null {
  return get().root;
}
