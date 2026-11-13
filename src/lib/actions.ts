/*
 * What the app does: opening folders and files, saving, the explorer's file
 * operations, compiling and running, and following changes on disk. The
 * components call these; none of them keeps state of its own.
 */
import { EditorView } from "@codemirror/view";
import { Text, type EditorState } from "@codemirror/state";
import { open as pickPath, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText, events } from "./api";
import { appendOutput, clearOutput, get, openDialog, set, setSettings, toast, type Tab } from "./store";
import { basename, dirname, extname, invalidName, isInside, join, relative, samePath, stem } from "./paths";
import { activeView, allDocs, dropDoc, getDoc, isDirty, moveDocs, putDoc, setShownPath, shownPath, type Doc } from "../editor/docs";
import { createState, languageEffect, notePathChange, settingsEffects } from "../editor/setup";
import { IMAGE_EXTENSIONS, languageFor } from "../editor/languages";
import { javaIndex } from "../uml/javaIndex";
import { HTML_SKELETON, javaSkeleton, TEMPLATES, type TemplateId } from "./templates";
import type { Diagnostic } from "./types";

// ----- Editor update listener ---------------------------------------------------------

const javaTimers = new Map<string, number>();
let autoSaveTimer = 0;

/** Installed in every editor state; tracks dirty state, the cursor and live structure. */
export const docListener = EditorView.updateListener.of((u) => {
  const path = shownPath();
  if (!path) return;
  const doc = getDoc(path);
  if (!doc) return;
  doc.state = u.state;
  if (u.docChanged) onDocChanged(doc);
  if (u.selectionSet || u.docChanged) {
    const sel = u.state.selection.main;
    const line = u.state.doc.lineAt(sel.head);
    set({ cursor: { line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) } });
  }
});

function onDocChanged(doc: Doc) {
  const dirty = isDirty(doc);
  const tab = get().tabs.find((t) => t.path && samePath(t.path, doc.path));
  if (tab && tab.dirty !== dirty) {
    set((s) => ({ tabs: s.tabs.map((t) => (t === tab ? { ...t, dirty } : t)) }));
  }
  if (extname(doc.path) === "java") {
    window.clearTimeout(javaTimers.get(doc.path));
    javaTimers.set(
      doc.path,
      window.setTimeout(() => javaIndex.set(doc.path, doc.state.doc.toString()), 220),
    );
  }
  if (get().settings.autoSave && dirty) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => void saveAll(true), 1000);
  }
}

// ----- Folders ------------------------------------------------------------------------

function addRecent(path: string) {
  const recent = [path, ...get().settings.recent.filter((p) => !samePath(p, path))].slice(0, 8);
  setSettings({ recent });
}

export async function chooseFolder() {
  const picked = await pickPath({ directory: true, multiple: false, title: "Open folder" }).catch(() => null);
  if (typeof picked === "string") await openFolder(picked);
}

export async function chooseFile() {
  const picked = await pickPath({
    multiple: false,
    title: "Open file",
    filters: [
      { name: "Code", extensions: ["java", "html", "htm", "css", "js", "mjs", "ts", "json", "md", "txt", "xml"] },
      { name: "All files", extensions: ["*"] },
    ],
  }).catch(() => null);
  if (typeof picked !== "string") return;
  const root = get().root;
  if (!root || !isInside(picked, root)) await openFolder(dirname(picked));
  await openFile(picked);
}

export async function openFolder(path: string) {
  if (get().root && samePath(get().root!, path)) return;
  if (!(await closeAllTabs())) return;
  set({ root: path, tree: {}, expanded: { [path]: true }, selected: null, problems: [], output: [], previewOpen: false, previewPath: null });
  addRecent(path);
  void api.watch(path).catch(() => {});
  void api.setPreviewRoot(path).catch(() => {});
  await loadDir(path);
  getCurrentWindow().setTitle(`${basename(path)} — Logiq Studio`).catch(() => {});
  await reloadJavaIndex();
}

export async function closeFolder() {
  if (!(await closeAllTabs())) return;
  set({ root: null, tree: {}, expanded: {}, selected: null, problems: [], previewOpen: false });
  javaIndex.replaceAll([]);
  void api.watch(null).catch(() => {});
  getCurrentWindow().setTitle("Logiq Studio").catch(() => {});
}

export async function reloadJavaIndex() {
  const root = get().root;
  if (!root) return;
  const sources = await api.readSources(root, "java").catch(() => []);
  // Open editors win over the files on disk.
  const merged = sources.map((s) => {
    const doc = getDoc(s.path);
    return doc ? { path: s.path, text: doc.state.doc.toString() } : s;
  });
  javaIndex.replaceAll(merged);
}

export async function loadDir(dir: string) {
  try {
    const entries = await api.listDir(dir);
    set((s) => ({ tree: { ...s.tree, [dir]: entries } }));
  } catch (e) {
    set((s) => ({ tree: { ...s.tree, [dir]: [] } }));
    if (samePath(dir, get().root ?? "")) toast("error", "The folder can't be read", errorText(e));
  }
}

export function toggleDir(dir: string, open?: boolean) {
  const isOpen = open ?? !get().expanded[dir];
  set((s) => ({ expanded: { ...s.expanded, [dir]: isOpen } }));
  if (isOpen && !get().tree[dir]) void loadDir(dir);
}

/** Opens every folder between the root and `path`, so it shows in the explorer. */
export async function revealInTree(path: string) {
  const root = get().root;
  if (!root || !isInside(path, root)) return;
  const chain: string[] = [];
  for (let d = dirname(path); d && isInside(d, root); d = dirname(d)) {
    chain.unshift(d);
    if (samePath(d, root)) break;
  }
  for (const d of chain) {
    set((s) => ({ expanded: { ...s.expanded, [d]: true } }));
    if (!get().tree[d]) await loadDir(d);
  }
  set({ selected: path });
}

// ----- Tabs and files ---------------------------------------------------------------------

function showDoc(doc: Doc) {
  const view = activeView();
  setShownPath(doc.path);
  if (view) {
    view.setState(doc.state);
    view.dispatch({ effects: settingsEffects(get().settings) });
    doc.state = view.state;
  }
}

export function activate(id: string) {
  const tab = get().tabs.find((t) => t.id === id);
  if (!tab) return;
  set({ activeId: id });
  if (tab.kind === "file" && tab.path) {
    const doc = getDoc(tab.path);
    if (doc) showDoc(doc);
    set({ selected: tab.path });
    if (languageFor(tab.path).id === "html" && get().previewOpen) set({ previewPath: tab.path });
  } else {
    setShownPath(null);
  }
}

export async function openFile(path: string, at?: { line: number; col?: number; length?: number }) {
  const existing = get().tabs.find((t) => t.path && samePath(t.path, path));
  if (existing) {
    activate(existing.id);
  } else if (IMAGE_EXTENSIONS.has(extname(path))) {
    const tab: Tab = { id: path, kind: "image", path, title: basename(path), dirty: false };
    set((s) => ({ tabs: insertAfterActive(s.tabs, s.activeId, tab), activeId: tab.id }));
    setShownPath(null);
    return;
  } else {
    let file;
    try {
      file = await api.readText(path);
    } catch (e) {
      const msg = errorText(e);
      if (msg === "binary") {
        toast("info", `${basename(path)} isn't a text file`, "It opens in the app Windows uses for it.");
        openPath(path).catch(() => {});
      } else toast("error", `${basename(path)} can't be opened`, msg);
      return;
    }
    const doc: Doc = {
      path,
      state: createState(path, file.text, get().settings, docListener) as EditorState,
      saved: Text.of(file.text.split("\n")),
      eol: file.eol,
    };
    putDoc(doc);
    const tab: Tab = { id: path, kind: "file", path, title: basename(path), dirty: false };
    set((s) => ({ tabs: insertAfterActive(s.tabs, s.activeId, tab) }));
    activate(tab.id);
  }
  void revealInTree(path);
  if (at) goTo(at.line, at.col ?? 1, at.length ?? 0);
}

function insertAfterActive(tabs: Tab[], activeId: string | null, tab: Tab): Tab[] {
  const i = tabs.findIndex((t) => t.id === activeId);
  if (i < 0) return [...tabs, tab];
  return [...tabs.slice(0, i + 1), tab, ...tabs.slice(i + 1)];
}

/** Moves the cursor of the active editor to a line and column and scrolls there. */
export function goTo(line: number, col = 1, length = 0) {
  const view = activeView();
  if (!view) return;
  requestAnimationFrame(() => {
    const doc = view.state.doc;
    const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
    const from = Math.min(l.to, l.from + Math.max(0, col - 1));
    view.dispatch({
      selection: { anchor: from, head: Math.min(l.to, from + length) },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
  });
}

type SaveChoice = "save" | "discard" | "cancel";

function askToSave(names: string[]): Promise<SaveChoice> {
  return new Promise((resolve) => {
    openDialog({
      kind: "confirm",
      title: names.length === 1 ? `Save changes to ${names[0]}?` : `Save changes to ${names.length} files?`,
      body: names.length === 1 ? "Your changes are lost if you don't save them." : `${names.join(", ")} have unsaved changes. They are lost if you don't save them.`,
      confirmLabel: names.length === 1 ? "Save" : "Save all",
      secondaryLabel: "Don't save",
      onConfirm: () => resolve("save"),
      onSecondary: () => resolve("discard"),
      onCancel: () => resolve("cancel"),
    });
  });
}

/** Closes tabs, asking about unsaved changes first. Returns false when cancelled. */
export async function closeTabs(ids: string[]): Promise<boolean> {
  const tabs = get().tabs.filter((t) => ids.includes(t.id));
  const dirty = tabs.filter((t) => t.dirty && t.path);
  if (dirty.length) {
    const choice = await askToSave(dirty.map((t) => t.title));
    if (choice === "cancel") return false;
    if (choice === "save") {
      for (const t of dirty) if (!(await saveDoc(t.path!))) return false;
    }
  }
  const remaining = get().tabs.filter((t) => !ids.includes(t.id));
  let activeId = get().activeId;
  if (activeId && ids.includes(activeId)) {
    const old = get().tabs.findIndex((t) => t.id === activeId);
    activeId = remaining[Math.min(old, remaining.length - 1)]?.id ?? null;
  }
  for (const t of tabs) {
    if (t.path && t.kind === "file") {
      dropDoc(t.path);
      // A closed Java file's structure comes from disk again.
      if (extname(t.path) === "java") {
        api
          .readText(t.path)
          .then((f) => javaIndex.set(t.path!, f.text))
          .catch(() => javaIndex.remove(t.path!));
      }
    }
  }
  set({ tabs: remaining, activeId: null });
  if (activeId) activate(activeId);
  else setShownPath(null);
  return true;
}

export const closeTab = (id: string) => closeTabs([id]);
export const closeAllTabs = () => closeTabs(get().tabs.map((t) => t.id));

export async function saveDoc(path: string): Promise<boolean> {
  const doc = getDoc(path);
  if (!doc) return true;
  const text = doc.state.doc.toString();
  try {
    await api.writeText(doc.path, text, doc.eol);
  } catch (e) {
    toast("error", `${basename(path)} wasn't saved`, errorText(e));
    return false;
  }
  doc.saved = doc.state.doc;
  set((s) => ({ tabs: s.tabs.map((t) => (t.path && samePath(t.path, path) ? { ...t, dirty: false } : t)) }));
  if (extname(path) === "java") javaIndex.set(path, text);
  const lang = languageFor(path).id;
  if (get().settings.livePreview && (lang === "html" || lang === "css" || lang === "javascript")) {
    set((s) => ({ previewNonce: s.previewNonce + 1 }));
  }
  return true;
}

export async function saveActive() {
  const tab = get().tabs.find((t) => t.id === get().activeId);
  if (tab?.path && tab.kind === "file") await saveDoc(tab.path);
}

export async function saveAll(quiet = false): Promise<boolean> {
  let ok = true;
  for (const t of get().tabs) if (t.dirty && t.path) ok = (await saveDoc(t.path)) && ok;
  if (!quiet && ok) void 0;
  return ok;
}

export async function saveActiveAs() {
  const tab = get().tabs.find((t) => t.id === get().activeId);
  if (!tab?.path || tab.kind !== "file") return;
  const doc = getDoc(tab.path);
  if (!doc) return;
  const target = await pickSavePath({ defaultPath: tab.path, title: "Save as" }).catch(() => null);
  if (!target) return;
  try {
    await api.writeText(target, doc.state.doc.toString(), doc.eol);
  } catch (e) {
    toast("error", "The file wasn't saved", errorText(e));
    return;
  }
  await openFile(target);
}

// ----- Explorer operations -------------------------------------------------------------------

function nameValidator(dir: string, current?: string) {
  return (value: string) => {
    const bad = invalidName(value);
    if (bad) return bad;
    const siblings = get().tree[dir] ?? [];
    if (siblings.some((e) => e.name.toLowerCase() === value.toLowerCase() && e.name !== current)) return `“${value}” already exists here.`;
    return null;
  };
}

async function afterCreate(dir: string) {
  await loadDir(dir);
  toggleDir(dir, true);
}

export function newFile(dir: string) {
  openDialog({
    kind: "prompt",
    title: "New file",
    label: "Name",
    value: "",
    confirmLabel: "Create",
    validate: nameValidator(dir),
    onSubmit: async (name) => {
      const path = join(dir, name);
      const ext = extname(name);
      const text = ext === "java" ? javaSkeleton("class", stem(name), packageFor(dir)) : ext === "html" || ext === "htm" ? HTML_SKELETON : "";
      await api.createFile(path, text);
      await afterCreate(dir);
      await openFile(path);
    },
  });
}

/** The package a Java file in `dir` belongs to, from the folders below a `src` folder or the root. */
export function packageFor(dir: string): string {
  const root = get().root;
  if (!root || !isInside(dir, root)) return "";
  let rel = relative(root, dir);
  if (samePath(dir, root)) return "";
  const src = rel.split("/").indexOf("src");
  if (src >= 0) rel = rel.split("/").slice(src + 1).join("/");
  const parts = rel.split("/").filter(Boolean);
  return parts.every((p) => /^[a-z_$][\w$]*$/i.test(p)) ? parts.join(".") : "";
}

export async function newJavaFile(dir: string, name: string, kind: Parameters<typeof javaSkeleton>[0]) {
  const path = join(dir, `${name}.java`);
  await api.createFile(path, javaSkeleton(kind, name, packageFor(dir)));
  await afterCreate(dir);
  await openFile(path);
  const doc = getDoc(path);
  if (doc) {
    // Put the cursor inside the new type's body.
    const text = doc.state.doc.toString();
    const at = text.indexOf("{\n\n") + 2;
    if (at > 1) {
      const line = doc.state.doc.lineAt(at).number;
      goTo(line, 1);
    }
  }
}

export function newFolder(dir: string) {
  openDialog({
    kind: "prompt",
    title: "New folder",
    label: "Name",
    value: "",
    confirmLabel: "Create",
    validate: nameValidator(dir),
    onSubmit: async (name) => {
      await api.createDir(join(dir, name));
      await afterCreate(dir);
    },
  });
}

export function renamePath(path: string) {
  const dir = dirname(path);
  const name = basename(path);
  openDialog({
    kind: "prompt",
    title: "Rename",
    label: "New name",
    value: name,
    confirmLabel: "Rename",
    selectStem: true,
    validate: nameValidator(dir, name),
    onSubmit: async (value) => {
      if (value === name) return;
      const to = join(dir, value);
      await api.rename(path, to);
      for (const m of moveDocs(path, to)) {
        notePathChange(m.from, m.to);
        const doc = getDoc(m.to);
        if (doc && languageFor(m.from).id !== languageFor(m.to).id) {
          doc.state = doc.state.update({ effects: languageEffect(m.to) }).state;
          if (shownPath() && samePath(shownPath()!, m.from)) showDoc(doc);
        }
        if (shownPath() && samePath(shownPath()!, m.from)) setShownPath(m.to);
      }
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (!t.path || !isInside(t.path, path)) return t;
          const p = to + t.path.slice(path.length);
          return { ...t, id: t.kind === "uml" ? t.id : p, path: p, title: basename(p) };
        }),
        activeId: s.activeId && isInside(s.activeId, path) ? to + s.activeId.slice(path.length) : s.activeId,
        selected: to,
      }));
      await loadDir(dir);
      await reloadJavaIndex();
    },
  });
}

export function deletePath(path: string, isDir: boolean) {
  openDialog({
    kind: "confirm",
    title: `Delete ${basename(path)}?`,
    body: isDir
      ? "The folder and everything in it go to the Recycle Bin. You can restore them from there."
      : "The file goes to the Recycle Bin. You can restore it from there.",
    confirmLabel: "Move to Recycle Bin",
    danger: true,
    onConfirm: async () => {
      try {
        await api.delete(path);
      } catch (e) {
        toast("error", `${basename(path)} wasn't deleted`, errorText(e));
        return;
      }
      const ids = get()
        .tabs.filter((t) => t.path && isInside(t.path, path))
        .map((t) => t.id);
      // The files are gone: close their tabs without asking to save.
      set((s) => ({ tabs: s.tabs.map((t) => (ids.includes(t.id) ? { ...t, dirty: false } : t)) }));
      await closeTabs(ids);
      javaIndex.remove(path);
      await loadDir(dirname(path));
    },
  });
}

export function revealInExplorer(path: string) {
  revealItemInDir(path).catch((e) => toast("error", "Explorer couldn't be opened", errorText(e)));
}

export async function copyPath(path: string, relativeToRoot = false) {
  const root = get().root;
  const text = relativeToRoot && root ? relative(root, path) : path;
  await navigator.clipboard.writeText(text).catch(() => {});
  toast("success", "Path copied", text);
}

// ----- New projects -----------------------------------------------------------------------------

export async function createProject(parent: string, name: string, template: TemplateId) {
  const tpl = TEMPLATES.find((t) => t.id === template)!;
  const root = join(parent, name);
  if (await api.exists(root)) throw new Error(`A folder named “${name}” already exists there.`);
  await api.createDir(root);
  for (const [file, text] of Object.entries(tpl.files)) await api.createFile(join(root, file), text);
  await openFolder(root);
  await openFile(join(root, tpl.open));
  if (template === "web") openPreview();
  if (template === "java-classes") openUml();
}

// ----- Views ---------------------------------------------------------------------------------------

export function openUml() {
  if (!get().tabs.some((t) => t.id === "uml")) {
    const tab: Tab = { id: "uml", kind: "uml", path: null, title: "UML class diagram", dirty: false };
    set((s) => ({ tabs: insertAfterActive(s.tabs, s.activeId, tab) }));
  }
  activate("uml");
}

export function openPreview(path?: string) {
  const active = get().tabs.find((t) => t.id === get().activeId);
  let target = path ?? (active?.path && languageFor(active.path).id === "html" ? active.path : null);
  if (!target) {
    const root = get().root;
    const index = root ? (get().tree[root] ?? []).find((e) => /^index\.html?$/i.test(e.name)) : null;
    target = index?.path ?? get().previewPath;
  }
  if (!target) {
    toast("info", "There's no page to preview", "Open an HTML file, then show the preview.");
    return;
  }
  set({ previewOpen: true, previewPath: target });
}

export function togglePreview() {
  if (get().previewOpen) set({ previewOpen: false });
  else openPreview();
}

export function toggleSidebar(view?: "explorer" | "search" | "outline") {
  const s = get();
  if (!view) set({ sidebar: s.sidebar ? null : "explorer" });
  else set({ sidebar: s.sidebar === view ? null : view });
}

export function togglePanel(tab?: "output" | "problems") {
  const s = get();
  if (tab && s.panelOpen && s.panelTab !== tab) set({ panelTab: tab });
  else set({ panelOpen: !s.panelOpen, panelTab: tab ?? s.panelTab });
}

// ----- Compile and run --------------------------------------------------------------------------

function normalizeDiagnostics(list: Diagnostic[]): Diagnostic[] {
  const windows = (get().root ?? "").includes("\\");
  return list.map((d) => ({ ...d, path: windows ? d.path.replace(/\//g, "\\") : d.path }));
}

function setProblems(problems: Diagnostic[]) {
  set((s) => ({ problems, problemsVersion: s.problemsVersion + 1 }));
}

/** The class whose main method runs: the active file's, else the only one (or one called Main). */
function mainClassFor(path: string | null): { name: string; note?: string } | null {
  if (path) {
    const own = javaIndex.file(path)?.types.find((t) => t.hasMain);
    if (own) return { name: own.qualifiedName };
  }
  const all = javaIndex.types().filter((t) => t.hasMain);
  if (!all.length) return null;
  const pick = all.find((t) => t.name === "Main") ?? all[0];
  return { name: pick.qualifiedName, note: all.length > 1 && path ? `This file has no main method; running ${pick.qualifiedName}.` : undefined };
}

export async function compileJava(): Promise<boolean> {
  const root = get().root;
  if (!root) return false;
  if (get().settings.saveBeforeRun && !(await saveAll(true))) return false;
  set({ run: { status: "compiling", label: "Compiling" }, panelOpen: true, panelTab: "output" });
  clearOutput();
  const jdk = get().settings.jdkHome || get().jdks[0]?.home || null;
  const version = get().jdks.find((j) => j.home === jdk)?.version;
  appendOutput("system", `Compiling with ${version ? `JDK ${version}` : "javac"}…\n`);
  try {
    const result = await api.javaCompile(root, jdk);
    const problems = normalizeDiagnostics(result.diagnostics);
    setProblems(problems);
    const errors = problems.filter((p) => p.severity === "error").length;
    const warnings = problems.length - errors;
    if (!result.ok) {
      appendOutput("stderr", result.output.trimEnd() + "\n");
      appendOutput("error", `Compiling failed: ${errors} error${errors === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.\n`);
      set({ run: { status: "idle" } });
      const first = problems.find((p) => p.severity === "error");
      if (first) void openFile(first.path, { line: first.line, col: first.column || 1 });
      return false;
    }
    if (result.output.trim()) appendOutput("stderr", result.output.trimEnd() + "\n");
    appendOutput("success", `Compiled ${result.files} file${result.files === 1 ? "" : "s"} in ${result.durationMs} ms${warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.\n`);
    set({ run: { status: "idle" } });
    return true;
  } catch (e) {
    appendOutput("error", errorText(e) + "\n");
    set({ run: { status: "idle" } });
    return false;
  }
}

export async function runActive() {
  const s = get();
  if (s.run.status !== "idle") return;
  const tab = s.tabs.find((t) => t.id === s.activeId);
  const path = tab?.path ?? null;
  const lang = path ? languageFor(path).id : tab?.kind === "uml" ? "java" : null;

  if (lang === "html") {
    if (path) await saveDoc(path);
    openPreview(path ?? undefined);
    set((st) => ({ previewNonce: st.previewNonce + 1 }));
    return;
  }
  if (lang === "javascript" && path) {
    if (get().settings.saveBeforeRun) await saveAll(true);
    clearOutput();
    set({ panelOpen: true, panelTab: "output" });
    appendOutput("system", `node ${basename(path)}\n`);
    try {
      const runId = await api.runNode(path, get().settings.nodePath || get().node?.path || null);
      set({ run: { status: "running", runId, label: basename(path), startedAt: Date.now() } });
    } catch (e) {
      appendOutput("error", errorText(e) + "\n");
    }
    return;
  }
  if (lang === "java" || (!lang && javaIndex.types().some((t) => t.hasMain))) {
    if (!(await compileJava())) return;
    const main = mainClassFor(path);
    if (!main) {
      appendOutput("error", "No class has a main method. Add `public static void main(String[] args)` to run the program.\n");
      return;
    }
    if (main.note) appendOutput("system", main.note + "\n");
    appendOutput("system", `Running ${main.name}\n`);
    try {
      const jdk = get().settings.jdkHome || get().jdks[0]?.home || null;
      const runId = await api.runJava(get().root!, main.name, jdk, []);
      set({ run: { status: "running", runId, label: main.name.split(".").pop()!, startedAt: Date.now() } });
    } catch (e) {
      appendOutput("error", errorText(e) + "\n");
    }
    return;
  }
  toast("info", "Nothing to run here", "Open a Java class with a main method, an HTML page or a JavaScript file.");
}

export async function stopRun() {
  if (get().run.status !== "running") return;
  await api.runStop().catch(() => {});
}

export async function sendInput(text: string) {
  const run = get().run;
  if (run.status !== "running") return;
  appendOutput("input", text + "\n");
  await api.runStdin(run.runId, text + "\n").catch((e) => appendOutput("error", errorText(e) + "\n"));
}

// ----- Window and start-up ----------------------------------------------------------------------

export async function requestCloseWindow() {
  const win = getCurrentWindow();
  if (get().run.status === "running") await api.runStop().catch(() => {});
  const dirty = get().tabs.filter((t) => t.dirty);
  if (dirty.length) {
    const choice = await askToSave(dirty.map((t) => t.title));
    if (choice === "cancel") return;
    if (choice === "save" && !(await saveAll(true))) return;
  }
  await win.destroy().catch(() => win.close());
}

let fsTimer = 0;
const fsPending = new Set<string>();

async function applyFsChanges() {
  const paths = [...fsPending];
  fsPending.clear();
  const { tree, root } = get();
  if (!root) return;
  const dirs = new Set<string>();
  for (const p of paths) {
    const parent = dirname(p);
    if (tree[parent]) dirs.add(parent);
    if (tree[p]) dirs.add(p);
  }
  for (const d of dirs) await loadDir(d);
  for (const p of paths) {
    const doc = getDoc(p);
    const isJava = extname(p) === "java";
    if (doc) {
      if (isDirty(doc)) continue;
      try {
        const file = await api.readText(p);
        if (file.text !== doc.saved.toString()) {
          // Changed by another program: take the new text, keep the undo history.
          const changes = { from: 0, to: doc.state.doc.length, insert: file.text };
          const shown = shownPath() && samePath(shownPath()!, p);
          if (shown && activeView()) activeView()!.dispatch({ changes });
          else doc.state = doc.state.update({ changes }).state;
          doc.saved = doc.state.doc;
          set((s) => ({ tabs: s.tabs.map((t) => (t.path && samePath(t.path, p) ? { ...t, dirty: false } : t)) }));
          if (isJava) javaIndex.set(p, file.text);
        }
      } catch {
        // Deleted or unreadable: keep the editor's text so nothing is lost.
      }
    } else if (isJava) {
      api
        .readText(p)
        .then((f) => javaIndex.set(p, f.text))
        .catch(() => javaIndex.remove(p));
    } else if (!extname(p)) {
      // A folder that vanished takes its Java files with it.
      api.exists(p).then((there) => !there && javaIndex.remove(p));
    }
  }
}

let started = false;

export async function init() {
  if (started) return;
  started = true;
  api.detectJdks().then((jdks) => set({ jdks })).catch(() => {});
  api.detectNode().then((node) => set({ node })).catch(() => {});
  await events.onRunOutput((e) => {
    const run = get().run;
    if (run.status === "running" && run.runId === e.runId) appendOutput(e.stream, e.text);
  });
  await events.onRunExit((e) => {
    const run = get().run;
    if (run.status !== "running" || run.runId !== e.runId) return;
    const secs = (e.durationMs / 1000).toFixed(2);
    if (e.code === 0) appendOutput("success", `\nProgram finished in ${secs} s.\n`);
    else if (e.code === null) appendOutput("system", `\nProgram stopped after ${secs} s.\n`);
    else appendOutput("error", `\nProgram ended with exit code ${e.code} after ${secs} s.\n`);
    set({ run: { status: "idle" } });
  });
  await events.onFsChanged((paths) => {
    paths.forEach((p) => fsPending.add(p));
    window.clearTimeout(fsTimer);
    fsTimer = window.setTimeout(() => void applyFsChanges(), 160);
  });
  await events.onOpenPaths((paths) => void openPaths(paths));
  getCurrentWindow()
    .onCloseRequested((e) => {
      e.preventDefault();
      void requestCloseWindow();
    })
    .catch(() => {});
  const launch = await api.launchPaths().catch(() => [] as string[]);
  if (launch.length) await openPaths(launch);
}

async function openPaths(paths: string[]) {
  for (const p of paths) {
    const isFile = !!extname(p);
    if (isFile) {
      const root = get().root;
      if (!root || !isInside(p, root)) await openFolder(dirname(p));
      await openFile(p);
    } else {
      await openFolder(p);
    }
  }
}

/** Applies changed editor settings to the visible editor (others update when shown). */
export function applyEditorSettings() {
  const view = activeView();
  if (view) view.dispatch({ effects: settingsEffects(get().settings) });
  for (const doc of allDocs()) {
    if (shownPath() && samePath(doc.path, shownPath()!)) doc.state = view?.state ?? doc.state;
  }
}
