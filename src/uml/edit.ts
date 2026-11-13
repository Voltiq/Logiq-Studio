/*
 * Changes made in the diagram, applied to the code: open files change in
 * their editor (one undoable step, saved like any other edit), closed files
 * are rewritten on disk. The diagram follows from the code, as always.
 */
import { api, errorText } from "../lib/api";
import { changeDoc, deletePaths, openFile, loadDir } from "../lib/actions";
import { get, openDialog, toast } from "../lib/store";
import { getDoc } from "../editor/docs";
import { minimalChange } from "../editor/format";
import { dirname, join } from "../lib/paths";
import { t } from "../lib/i18n";
import { javaIndex } from "./javaIndex";
import { parseJava, baseName } from "./javaParser";
import type { JField, JMethod, JType } from "./model";
import { addField, associationType, removeMember, renderClass, setSupertypes, type ClassSpec } from "./codegen";

export function indentUnit(): string {
  const s = get().settings;
  return s.insertSpaces ? " ".repeat(s.tabSize) : "\t";
}

/** The current text of a file: its editor's when open, else from disk. */
async function textOf(path: string): Promise<string> {
  const doc = getDoc(path);
  return doc ? doc.state.doc.toString() : (await api.readText(path)).text;
}

/**
 * Edits the file that declares `qualifiedName`. `change` gets the file's
 * text and the type as parsed from that text right now.
 */
export async function editType(qualifiedName: string, change: (text: string, type: JType) => string): Promise<boolean> {
  const known = javaIndex.types().find((x) => x.qualifiedName === qualifiedName);
  if (!known) {
    toast("error", t("The class was not found"), qualifiedName);
    return false;
  }
  const path = known.path;
  try {
    const text = await textOf(path);
    const type = parseJava(text, path).types.find((x) => x.qualifiedName === qualifiedName);
    if (!type) throw new Error(t("The class was not found"));
    const out = change(text, type);
    if (out === text) return true;
    if (getDoc(path)) changeDoc(path, [minimalChange(text, out)]);
    else {
      await api.writeText(path, out);
      javaIndex.set(path, out);
    }
    return true;
  } catch (e) {
    toast("error", t("The code wasn't changed"), errorText(e));
    return false;
  }
}

export async function createClass(dir: string, spec: ClassSpec, open = true): Promise<string | null> {
  const path = join(dir, `${spec.name}.java`);
  try {
    if (await api.exists(path)) throw new Error(t("“{0}” already exists here.", `${spec.name}.java`));
    const text = renderClass(spec, indentUnit());
    await api.createFile(path, text);
    javaIndex.set(path, text);
    await loadDir(dir);
    if (open) await openFile(path, undefined, 0);
    return path;
  } catch (e) {
    toast("error", t("The class wasn't created"), errorText(e));
    return null;
  }
}

/** Draws generalisation or realisation from `from` to `to` into the code. */
export async function addInheritance(from: JType, to: JType) {
  if (from.qualifiedName === to.qualifiedName) return;
  const name = to.name;
  if (from.kind === "interface") {
    if (to.kind !== "interface") return toast("warning", t("An interface can only extend interfaces"));
    await editType(from.qualifiedName, (text, t2) => setSupertypes(text, t2, [...t2.extends.filter((x) => baseName(x) !== name), name], []));
  } else if (to.kind === "interface") {
    await editType(from.qualifiedName, (text, t2) => setSupertypes(text, t2, t2.extends, [...t2.implements.filter((x) => baseName(x) !== name), name]));
  } else if (from.kind === "class" && to.kind === "class") {
    if (from.extends.length && baseName(from.extends[0]) !== name) toast("info", t("{0} now extends {1}", from.name, name), t("A class extends one class only; {0} was replaced.", baseName(from.extends[0])));
    await editType(from.qualifiedName, (text, t2) => setSupertypes(text, t2, [name], t2.implements));
  } else {
    toast("warning", t("{0} can't extend {1}", from.name, name), t("Enums and records can only implement interfaces."));
  }
}

export async function removeInheritance(from: JType, to: JType) {
  const keep = (list: string[]) => list.filter((x) => baseName(x) !== to.name);
  await editType(from.qualifiedName, (text, t2) => setSupertypes(text, t2, keep(t2.extends), keep(t2.implements)));
}

export function askAssociation(from: JType, to: JType) {
  openDialog({ kind: "association", from: from.qualifiedName, to: to.qualifiedName });
}

export async function addAssociation(from: string, to: string, role: string, many: boolean, visibility: JField["visibility"]) {
  const target = javaIndex.types().find((x) => x.qualifiedName === to);
  if (!target) return;
  const { type, init } = associationType(target.name, many);
  await editType(from, (text, t2) => addField(text, t2, { name: role, type, init, visibility }, {}, indentUnit()));
}

/** Removes the fields that make an association from `from` to `to`. */
export async function removeAssociation(from: JType, to: JType) {
  await editType(from.qualifiedName, (text, type) => {
    let out = text;
    // Last first, so earlier line numbers stay valid.
    const named = (f: JField) => (f.type.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? ([] as string[])).includes(to.name);
    for (const f of type.fields.filter(named).sort((a, b) => b.line - a.line)) out = removeMember(out, f);
    return out;
  });
}

export async function deleteMember(owner: string, member: JField | JMethod) {
  await editType(owner, (text, type) => {
    const fresh = "endLine" in member ? type.methods.find((m) => m.line === member.line) : type.fields.find((f) => f.name === member.name);
    return fresh ? removeMember(text, fresh) : text;
  });
}

/** Deletes a class: its file when it is the only type in it, else just its declaration. */
export async function deleteClass(type: JType) {
  const file = javaIndex.file(type.path);
  const alone = !type.outer && file && file.types.filter((x) => !x.outer).length === 1;
  if (alone) {
    deletePaths([type.path]);
    return;
  }
  openDialog({
    kind: "confirm",
    title: t("Delete {0}?", type.name),
    body: t("Its declaration is removed from {0}. You can undo it there with Ctrl+Z.", type.path.split(/[\\/]/).pop()!),
    confirmLabel: t("Delete"),
    danger: true,
    onConfirm: async () => {
      if (!getDoc(type.path)) await openFile(type.path);
      await editType(type.qualifiedName, (text, t2) => {
        const lines = text.split("\n");
        let start = t2.line - 1;
        while (start > 0 && /^\s*(@|\*|\/\*\*|\/\*)/.test(lines[start - 1])) start--;
        lines.splice(start, t2.endLine - start);
        return lines.join("\n");
      });
    },
  });
}

/** Where a new class for the diagram goes: the folder of the shown classes, else the project. */
export function newClassDir(scopeDir: string | null): string {
  const root = get().root!;
  if (scopeDir) return scopeDir;
  const types = javaIndex.types();
  const dirs = [...new Set(types.map((x) => dirname(x.path)))];
  return dirs.length === 1 ? dirs[0] : root;
}

