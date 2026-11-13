/*
 * What the app does: opening folders and files, editor groups and tabs,
 * saving, the explorer's file operations, compiling and running, following
 * changes on disk, and keeping the session across restarts. The components
 * call these; none of them keeps state of its own.
 */
import { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { open as pickPath, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText, events } from "./api";
import { activeIdOf, activeTab, appendOutput, clearOutput, get, openDialog, set, setSettings, toast, type Group, type Tab } from "./store";
import { basename, dirname, extname, invalidName, isInside, join, relative, samePath, stem } from "./paths";
import {
  activeView,
  allDocs,
  dropDoc,
  focusedGroup,
  getDoc,
  groupOfView,
  groupShowing,
  isDirty,
  moveDocs,
  putDoc,
  setFocusedGroup,
  setShownPath,
  shownPath,
  viewOf,
  type Doc,
} from "../editor/docs";
import { createState, languageEffect, notePathChange, settingsEffects } from "../editor/setup";
import { IMAGE_EXTENSIONS, languageFor } from "../editor/languages";
import { canFormat, formatText, formatView } from "../editor/format";
import { javaIndex } from "../uml/javaIndex";
import { HTML_SKELETON, javaSkeleton, TEMPLATES, type TemplateId } from "./templates";
import type { Diagnostic } from "./types";
import { t } from "./i18n";

// ----- Editor listeners ---------------------------------------------------------------

const javaTimers = new Map<string, number>();
let autoSaveTimer = 0;

/** Installed in every editor state: dirty state, cursor, live structure, session. */
const docListener = EditorView.updateListener.of((u) => {
  const g = groupOfView(u.view);
  if (g === null) return;
  const path = shownPath(g);
  if (!path) return;
  const doc = getDoc(path);
  if (!doc) return;
  doc.state = u.state;
  if (u.docChanged) onDocChanged(doc);
  if ((u.selectionSet || u.docChanged || u.focusChanged) && g === focusedGroup()) {
    const sel = u.state.selection.main;
    const line = u.state.doc.lineAt(sel.head);
    set({ cursor: { line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) } });
  }
});

/** Clicking into an editor makes its group the focused one. */
const focusTracker = EditorView.domEventHandlers({
  focus: (_e, view) => {
    const g = groupOfView(view);
    if (g !== null) focusGroup(g);
    return false;
  },
});

export const editorHooks = [docListener, focusTracker];

export function focusGroup(g: Group) {
  setFocusedGroup(g);
  if (get().focusGroup !== g) {
    set({ focusGroup: g });
    const tab = activeTab();
    if (tab?.path) set({ selected: tab.path });
  }
}

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
  scheduleSession();
}

/** Applies changes to an open document, in its view when it is shown. */
export function changeDoc(path: string, changes: { from: number; to: number; insert: string }[]) {
  const doc = getDoc(path);
  if (!doc) return;
  const g = groupShowing(path);
  if (g !== null && viewOf(g)) viewOf(g)!.dispatch({ changes, userEvent: "input.rename" });
  else {
    doc.state = doc.state.update({ changes }).state;
    onDocChanged(doc);
  }
}

// ----- Folders ------------------------------------------------------------------------

function addRecent(path: string) {
  const recent = [path, ...get().settings.recent.filter((p) => !samePath(p, path))].slice(0, 8);
  setSettings({ recent });
}

export async function chooseFolder() {
  const picked = await pickPath({ directory: true, multiple: false, title: t("Open folder") }).catch(() => null);
  if (typeof picked === "string") await openFolder(picked);
}

export async function chooseFile() {
  const picked = await pickPath({
    multiple: false,
    title: t("Open file"),
    filters: [
      { name: t("Code"), extensions: ["java", "html", "htm", "css", "js", "mjs", "ts", "json", "md", "txt", "xml"] },
      { name: t("All files"), extensions: ["*"] },
    ],
  }).catch(() => null);
  if (typeof picked !== "string") return;
  const root = get().root;
  if (!root || !isInside(picked, root)) await openFolder(dirname(picked));
  await openFile(picked);
}

export async function openFolder(path: string) {
  if (get().root && samePath(get().root!, path)) return;
  if (!(await closeAllTabs(true))) return;
  set({ root: path, tree: {}, expanded: { [path]: true }, selected: null, selection: [], problems: [], output: [], previewOpen: false, previewPath: null });
  addRecent(path);
  void api.watch(path).catch(() => {});
  void api.setPreviewRoot(path).catch(() => {});
  await loadDir(path);
  getCurrentWindow().setTitle(`${basename(path)} — Logiq Studio`).catch(() => {});
  await reloadJavaIndex();
  scheduleSession();
}

export async function closeFolder() {
  if (!(await closeAllTabs(true))) return;
  set({ root: null, tree: {}, expanded: {}, selected: null, selection: [], problems: [], previewOpen: false });
  javaIndex.replaceAll([]);
  void api.watch(null).catch(() => {});
  getCurrentWindow().setTitle("Logiq Studio").catch(() => {});
  scheduleSession();
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
    if (samePath(dir, get().root ?? "")) toast("error", t("The folder can't be read"), errorText(e));
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
  set({ selected: path, selection: [path] });
}

// ----- Groups and tabs ---------------------------------------------------------------------

function showDocIn(g: Group, doc: Doc) {
  const view = viewOf(g);
  // A file is shown in one group only.
  const other = (1 - g) as Group;
  if (shownPath(other) && samePath(shownPath(other)!, doc.path)) setShownPath(other, null);
  setShownPath(g, doc.path);
  if (view) {
    view.setState(doc.state);
    view.dispatch({ effects: settingsEffects(get().settings) });
    doc.state = view.state;
  }
}

function setActive(g: Group, id: string | null) {
  set((s) => {
    const active: [string | null, string | null] = [...s.active];
    active[g] = id;
    return { active };
  });
}

export function activate(id: string, focus = true) {
  const tab = get().tabs.find((t) => t.id === id);
  if (!tab) return;
  const g = tab.group;
  setActive(g, id);
  if (focus) focusGroup(g);
  if (tab.kind === "file" && tab.path) {
    const doc = getDoc(tab.path);
    if (doc) showDoc(g, doc);
    // Typing goes to the file just opened or switched to.
    if (focus) requestAnimationFrame(() => viewOf(g)?.focus());
    set({ selected: tab.path });
    if (languageFor(tab.path).id !== "text" && get().previewOpen && isPreviewable(tab.path)) set({ previewPath: tab.path });
  } else {
    setShownPath(g, null);
  }
  scheduleSession();
}

function showDoc(g: Group, doc: Doc) {
  showDocIn(g, doc);
}

function targetGroup(): Group {
  const s = get();
  const g = s.focusGroup;
  return g === 1 && !s.tabs.some((t) => t.group === 1) ? 0 : g;
}

function insertTab(tab: Tab) {
  set((s) => {
    const i = s.tabs.findIndex((t) => t.id === s.active[tab.group]);
    const tabs = i < 0 ? [...s.tabs, tab] : [...s.tabs.slice(0, i + 1), tab, ...s.tabs.slice(i + 1)];
    return { tabs: sortPinned(tabs) };
  });
}

/** Pinned tabs come first in their group. */
function sortPinned(tabs: Tab[]): Tab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

export async function openFile(path: string, at?: { line: number; col?: number; length?: number }, group?: Group) {
  const existing = get().tabs.find((t) => t.path && samePath(t.path, path));
  if (existing) {
    activate(existing.id);
  } else if (IMAGE_EXTENSIONS.has(extname(path))) {
    const tab: Tab = { id: path, kind: "image", path, title: basename(path), dirty: false, group: group ?? targetGroup() };
    insertTab(tab);
    activate(tab.id);
    return;
  } else {
    let file;
    try {
      file = await api.readText(path);
    } catch (e) {
      const msg = errorText(e);
      if (msg === "binary") {
        toast("info", t("{0} isn't a text file", basename(path)), t("It opens in the app Windows uses for it."));
        openPath(path).catch(() => {});
      } else toast("error", t("{0} can't be opened", basename(path)), msg);
      return;
    }
    if (!getDoc(path)) {
      putDoc({
        path,
        state: createState(path, file.text, get().settings, editorHooks),
        saved: Text.of(file.text.split("\n")),
        eol: file.eol,
      });
    }
    const tab: Tab = { id: path, kind: "file", path, title: basename(path), dirty: false, group: group ?? targetGroup() };
    insertTab(tab);
    activate(tab.id);
  }
  void revealInTree(path);
  if (at) goTo(at.line, at.col ?? 1, at.length ?? 0);
}

/** Moves the cursor of the focused editor to a line and column and scrolls there. */
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

/** Moves a tab to the other editor group (the side group opens when needed). */
export function moveToGroup(id: string, g: Group) {
  const tab = get().tabs.find((t) => t.id === id);
  if (!tab || tab.group === g) return;
  const from = tab.group;
  const fromTabs = get().tabs.filter((t) => t.group === from && t.id !== id);
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, group: g } : t)) }));
  // The group it left shows its next tab.
  if (get().active[from] === id) {
    const old = get().tabs.filter((t) => t.group === from || t.id === id).findIndex((t) => t.id === id);
    const next = fromTabs[Math.min(Math.max(0, old - 1), fromTabs.length - 1)];
    setActive(from, next?.id ?? null);
    if (next) activate(next.id, false);
    else setShownPath(from, null);
  }
  activate(id);
}

/** Split: the active tab moves to the side group (or back when it is already there). */
export function splitEditor() {
  const tab = activeTab();
  if (!tab) return;
  moveToGroup(tab.id, tab.group === 0 ? 1 : 0);
}

export function reorderTab(id: string, beforeId: string | null, group: Group) {
  const tab = get().tabs.find((x) => x.id === id);
  if (!tab || id === beforeId) return;
  if (tab.group !== group) moveToGroup(id, group);
  set((s) => {
    const moving = s.tabs.find((x) => x.id === id)!;
    const rest = s.tabs.filter((x) => x.id !== id);
    const i = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
    const tabs = i < 0 ? [...rest, moving] : [...rest.slice(0, i), moving, ...rest.slice(i)];
    return { tabs: sortPinned(tabs) };
  });
  scheduleSession();
}

export function togglePin(id: string) {
  set((s) => ({ tabs: sortPinned(s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t))) }));
  scheduleSession();
}

type SaveChoice = "save" | "discard" | "cancel";

function askToSave(names: string[]): Promise<SaveChoice> {
  return new Promise((resolve) => {
    openDialog({
      kind: "confirm",
      title: names.length === 1 ? t("Save changes to {0}?", names[0]) : t("Save changes to {0} files?", names.length),
      body: names.length === 1 ? t("Your changes are lost if you don't save them.") : t("{0} have unsaved changes. They are lost if you don't save them.", names.join(", ")),
      confirmLabel: names.length === 1 ? t("Save") : t("Save all"),
      secondaryLabel: t("Don't save"),
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
  const before = get().tabs;
  const remaining = before.filter((t) => !ids.includes(t.id));
  const nextActive = ([0, 1] as Group[]).map((g) => {
    const id = get().active[g];
    if (!id || !ids.includes(id)) return id;
    const inGroup = before.filter((t) => t.group === g);
    const left = remaining.filter((t) => t.group === g);
    const old = inGroup.findIndex((t) => t.id === id);
    return left[Math.min(old, left.length - 1)]?.id ?? null;
  }) as [string | null, string | null];
  for (const t of tabs) {
    if (t.path && t.kind === "file") {
      const g = groupShowing(t.path);
      if (g !== null) setShownPath(g, null);
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
  const focus = get().focusGroup;
  set({ tabs: remaining, active: [null, null] });
  for (const g of [0, 1] as Group[]) {
    if (nextActive[g]) activate(nextActive[g]!, false);
    else setShownPath(g, null);
  }
  // The side group closes with its last tab.
  const sideLeft = remaining.some((t) => t.group === 1);
  focusGroup(sideLeft ? focus : 0);
  scheduleSession();
  return true;
}

export const closeTab = (id: string) => closeTabs([id]);
/** Closes every tab; pinned ones too when `all`. */
export const closeAllTabs = (all = false) => closeTabs(get().tabs.filter((t) => all || !t.pinned).map((t) => t.id));

export async function saveDoc(path: string): Promise<boolean> {
  const doc = getDoc(path);
  if (!doc) return true;
  if (get().settings.formatOnSave && canFormat(path)) {
    const g = groupShowing(path);
    try {
      if (g !== null && viewOf(g)) await formatView(viewOf(g)!, path, get().settings);
      else {
        const r = await formatText(path, doc.state.doc.toString(), doc.state.selection.main.head, get().settings);
        doc.state = doc.state.update({ changes: { from: 0, to: doc.state.doc.length, insert: r.text } }).state;
      }
    } catch {
      // Code that doesn't parse is saved as it is.
    }
  }
  const text = doc.state.doc.toString();
  try {
    await api.writeText(doc.path, text, doc.eol);
  } catch (e) {
    toast("error", t("{0} wasn't saved", basename(path)), errorText(e));
    return false;
  }
  doc.saved = doc.state.doc;
  set((s) => ({ tabs: s.tabs.map((t) => (t.path && samePath(t.path, path) ? { ...t, dirty: false } : t)) }));
  if (extname(path) === "java") javaIndex.set(path, text);
  const lang = languageFor(path).id;
  if (get().settings.livePreview && (lang === "html" || lang === "css" || lang === "javascript")) {
    set((s) => ({ previewNonce: s.previewNonce + 1 }));
  }
  scheduleSession();
  return true;
}

export async function saveActive() {
  const tab = activeTab();
  if (tab?.path && tab.kind === "file") await saveDoc(tab.path);
}

export async function saveAll(_quiet = false): Promise<boolean> {
  let ok = true;
  for (const t of get().tabs) if (t.dirty && t.path) ok = (await saveDoc(t.path)) && ok;
  return ok;
}

export async function saveActiveAs() {
  const tab = activeTab();
  if (!tab?.path || tab.kind !== "file") return;
  const doc = getDoc(tab.path);
  if (!doc) return;
  const target = await pickSavePath({ defaultPath: tab.path, title: t("Save as") }).catch(() => null);
  if (!target) return;
  try {
    await api.writeText(target, doc.state.doc.toString(), doc.eol);
  } catch (e) {
    toast("error", t("The file wasn't saved"), errorText(e));
    return;
  }
  await openFile(target);
}

export async function formatActive() {
  const view = activeView();
  const path = shownPath();
  if (!view || !path) return;
  try {
    await formatView(view, path, get().settings);
  } catch (e) {
    const err = e as { message: string; line?: number };
    toast("warning", t("The file wasn't formatted"), err.line ? t("Line {0}: {1}", err.line, err.message) : err.message);
  }
}

// ----- Explorer operations -------------------------------------------------------------------

function nameValidator(dir: string, current?: string) {
  return (value: string) => {
    const bad = invalidName(value);
    if (bad) return t(bad);
    const siblings = get().tree[dir] ?? [];
    if (siblings.some((e) => e.name.toLowerCase() === value.toLowerCase() && e.name !== current)) return t("“{0}” already exists here.", value);
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
    title: t("New file"),
    label: t("Name"),
    value: "",
    confirmLabel: t("Create"),
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
    if (at > 1) goTo(doc.state.doc.lineAt(at).number, 1);
  }
}

export function newFolder(dir: string) {
  openDialog({
    kind: "prompt",
    title: t("New folder"),
    label: t("Name"),
    value: "",
    confirmLabel: t("Create"),
    validate: nameValidator(dir),
    onSubmit: async (name) => {
      await api.createDir(join(dir, name));
      await afterCreate(dir);
    },
  });
}

/**
 * Renames or moves a file or folder on disk, and carries open editors, tabs
 * and the explorer along.
 */
export async function movePath(path: string, to: string) {
  await api.rename(path, to);
  for (const m of moveDocs(path, to)) {
    notePathChange(m.from, m.to);
    const doc = getDoc(m.to);
    if (doc && languageFor(m.from).id !== languageFor(m.to).id) {
      doc.state = doc.state.update({ effects: languageEffect(m.to) }).state;
      const g = groupShowing(m.to);
      if (g !== null) showDocIn(g, doc);
    }
  }
  const map = (id: string | null) => (id && isInside(id, path) ? to + id.slice(path.length) : id);
  set((s) => ({
    tabs: s.tabs.map((t) => {
      if (!t.path || !isInside(t.path, path)) return t;
      const p = to + t.path.slice(path.length);
      return { ...t, id: t.kind === "uml" ? t.id : p, path: p, title: basename(p) };
    }),
    active: [map(s.active[0]), map(s.active[1])],
    selected: to,
    selection: [to],
    previewPath: s.previewPath && isInside(s.previewPath, path) ? to + s.previewPath.slice(path.length) : s.previewPath,
  }));
  await loadDir(dirname(path));
  if (!samePath(dirname(path), dirname(to))) await loadDir(dirname(to));
  await reloadJavaIndex();
  scheduleSession();
}

export function renamePath(path: string) {
  const dir = dirname(path);
  const name = basename(path);
  openDialog({
    kind: "prompt",
    title: t("Rename"),
    label: t("New name"),
    value: name,
    confirmLabel: t("Rename"),
    selectStem: true,
    validate: nameValidator(dir, name),
    onSubmit: async (value) => {
      if (value !== name) await movePath(path, join(dir, value));
    },
  });
}

/** Drops files from the explorer into a folder. */
export async function moveInto(paths: string[], dir: string) {
  const list = paths.filter((p) => !samePath(dirname(p), dir) && !isInside(dir, p));
  if (!list.length) return;
  for (const p of list) {
    try {
      await movePath(p, join(dir, basename(p)));
    } catch (e) {
      toast("error", t("{0} wasn't moved", basename(p)), errorText(e));
    }
  }
  toggleDir(dir, true);
}

export function deletePaths(paths: string[]) {
  if (!paths.length) return;
  const one = paths.length === 1;
  const entry = Object.values(get().tree)
    .flat()
    .find((e) => e && one && samePath(e.path, paths[0]));
  openDialog({
    kind: "confirm",
    title: one ? t("Delete {0}?", basename(paths[0])) : t("Delete {0} selected items?", paths.length),
    body: one && entry?.isDir ? t("The folder and everything in it go to the Recycle Bin. You can restore them from there.") : t("They go to the Recycle Bin. You can restore them from there."),
    confirmLabel: t("Move to Recycle Bin"),
    danger: true,
    onConfirm: async () => {
      for (const path of paths) {
        try {
          await api.delete(path);
        } catch (e) {
          toast("error", t("{0} wasn't deleted", basename(path)), errorText(e));
          continue;
        }
        const ids = get()
          .tabs.filter((t) => t.path && isInside(t.path, path))
          .map((t) => t.id);
        // The files are gone: close their tabs without asking to save.
        set((s) => ({ tabs: s.tabs.map((t) => (ids.includes(t.id) ? { ...t, dirty: false } : t)) }));
        await closeTabs(ids);
        javaIndex.remove(path);
        await loadDir(dirname(path));
      }
      set({ selection: [], selected: null });
    },
  });
}

export const deletePath = (path: string) => deletePaths([path]);

/** "Name copy.ext", "Name copy 2.ext"… for a path that is free in `dir`. */
async function freeName(dir: string, name: string): Promise<string> {
  if (!(await api.exists(join(dir, name)))) return join(dir, name);
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 100; i++) {
    const candidate = join(dir, `${base} copy${i > 1 ? " " + i : ""}${ext}`);
    if (!(await api.exists(candidate))) return candidate;
  }
  return join(dir, `${base} ${Date.now()}${ext}`);
}

export function copyToClipboard(paths: string[], mode: "copy" | "cut") {
  if (paths.length) set({ clipboard: { mode, paths } });
}

export async function pasteInto(dir: string) {
  const clip = get().clipboard;
  if (!clip) return;
  for (const p of clip.paths) {
    try {
      if (clip.mode === "cut") {
        if (!samePath(dirname(p), dir) && !isInside(dir, p)) await movePath(p, join(dir, basename(p)));
      } else {
        await api.copy(p, await freeName(dir, basename(p)));
      }
    } catch (e) {
      toast("error", t("{0} wasn't pasted", basename(p)), errorText(e));
    }
  }
  if (clip.mode === "cut") set({ clipboard: null });
  await loadDir(dir);
  toggleDir(dir, true);
  await reloadJavaIndex();
}

export async function duplicate(path: string) {
  try {
    const to = await freeName(dirname(path), basename(path));
    await api.copy(path, to);
    await loadDir(dirname(path));
    set({ selected: to, selection: [to] });
    await reloadJavaIndex();
  } catch (e) {
    toast("error", t("{0} wasn't duplicated", basename(path)), errorText(e));
  }
}

export function revealInExplorer(path: string) {
  revealItemInDir(path).catch((e) => toast("error", t("File Explorer couldn't be opened"), errorText(e)));
}

export async function copyPath(path: string, relativeToRoot = false) {
  const root = get().root;
  const text = relativeToRoot && root ? relative(root, path) : path;
  await navigator.clipboard.writeText(text).catch(() => {});
  toast("success", t("Path copied"), text);
}

// ----- New projects -----------------------------------------------------------------------------

export async function createProject(parent: string, name: string, template: TemplateId) {
  const tpl = TEMPLATES.find((x) => x.id === template)!;
  const root = join(parent, name);
  if (await api.exists(root)) throw new Error(t("A folder named “{0}” already exists there.", name));
  await api.createDir(root);
  for (const [file, text] of Object.entries(tpl.files)) await api.createFile(join(root, file), text);
  await openFolder(root);
  await openFile(join(root, tpl.open));
  if (template === "web") openPreview();
  if (template === "java-classes") openUml(1);
}

// ----- Views ---------------------------------------------------------------------------------------

/** Opens the class diagram, in the side group when asked (code left, diagram right). */
export function openUml(group?: Group) {
  const existing = get().tabs.find((t) => t.id === "uml");
  if (!existing) {
    const tab: Tab = { id: "uml", kind: "uml", path: null, title: t("UML class diagram"), dirty: false, group: group ?? targetGroup() };
    insertTab(tab);
  } else if (group !== undefined && existing.group !== group) {
    moveToGroup("uml", group);
    return;
  }
  activate("uml");
}

export function isPreviewable(path: string) {
  const id = languageFor(path).id;
  return id === "html" || id === "markdown";
}

export function openPreview(path?: string) {
  const active = activeTab();
  let target = path ?? (active?.path && isPreviewable(active.path) ? active.path : null);
  if (!target) {
    const root = get().root;
    const index = root ? (get().tree[root] ?? []).find((e) => /^index\.html?$/i.test(e.name)) : null;
    target = index?.path ?? get().previewPath;
  }
  if (!target) {
    toast("info", t("There's no page to preview"), t("Open an HTML or Markdown file, then show the preview."));
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

let searchNonce = 0;
/** Shows a search in the find-in-files panel. */
export function searchFor(query: string, opts: { matchCase?: boolean; wholeWord?: boolean; regex?: boolean; extensions?: string[] } = {}) {
  set({
    sidebar: "search",
    searchRequest: { query, matchCase: !!opts.matchCase, wholeWord: !!opts.wholeWord, regex: !!opts.regex, extensions: opts.extensions, nonce: ++searchNonce },
  });
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
    const own = javaIndex.file(path)?.types.find((x) => x.hasMain);
    if (own) return { name: own.qualifiedName };
  }
  const all = javaIndex.types().filter((x) => x.hasMain);
  if (!all.length) return null;
  const pick = all.find((x) => x.name === "Main") ?? all[0];
  return { name: pick.qualifiedName, note: all.length > 1 && path ? t("This file has no main method; running {0}.", pick.qualifiedName) : undefined };
}

export async function compileJava(): Promise<boolean> {
  const root = get().root;
  if (!root) return false;
  if (get().settings.saveBeforeRun && !(await saveAll(true))) return false;
  set({ run: { status: "compiling", label: t("Compiling") }, panelOpen: true, panelTab: "output" });
  clearOutput();
  const jdk = get().settings.jdkHome || get().jdks[0]?.home || null;
  const version = get().jdks.find((j) => j.home === jdk)?.version;
  appendOutput("system", (version ? t("Compiling with JDK {0}…", version) : t("Compiling with javac…")) + "\n");
  try {
    const result = await api.javaCompile(root, jdk);
    const problems = normalizeDiagnostics(result.diagnostics);
    setProblems(problems);
    const errors = problems.filter((p) => p.severity === "error").length;
    const warnings = problems.length - errors;
    if (!result.ok) {
      appendOutput("stderr", result.output.trimEnd() + "\n");
      appendOutput("error", t("Compiling failed (errors: {0}, warnings: {1}).", errors, warnings) + "\n");
      set({ run: { status: "idle" } });
      const first = problems.find((p) => p.severity === "error");
      if (first) void openFile(first.path, { line: first.line, col: first.column || 1 });
      return false;
    }
    if (result.output.trim()) appendOutput("stderr", result.output.trimEnd() + "\n");
    appendOutput("success", t("Compiled in {0} ms (files: {1}).", result.durationMs, result.files) + (warnings ? " " + t("Warnings: {0}.", warnings) : "") + "\n");
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
  const tab = activeTab();
  const path = tab?.path ?? null;
  const lang = path ? languageFor(path).id : tab?.kind === "uml" ? "java" : null;

  if (lang === "html" || lang === "markdown") {
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
  if (lang === "java" || (!lang && javaIndex.types().some((x) => x.hasMain))) {
    if (!(await compileJava())) return;
    const main = mainClassFor(path);
    if (!main) {
      appendOutput("error", t("No class has a main method. Add `public static void main(String[] args)` to run the program.") + "\n");
      return;
    }
    if (main.note) appendOutput("system", main.note + "\n");
    appendOutput("system", t("Running {0}", main.name) + "\n");
    try {
      const jdk = get().settings.jdkHome || get().jdks[0]?.home || null;
      const runId = await api.runJava(get().root!, main.name, jdk, []);
      set({ run: { status: "running", runId, label: main.name.split(".").pop()!, startedAt: Date.now() } });
    } catch (e) {
      appendOutput("error", errorText(e) + "\n");
    }
    return;
  }
  toast("info", t("Nothing to run here"), t("Open a Java class with a main method, an HTML page or a JavaScript file."));
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

// ----- Session: open files and unsaved changes across restarts ----------------------------------

interface Session {
  root: string;
  tabs: { id: string; kind: Tab["kind"]; path: string | null; group: Group; pinned?: boolean }[];
  active: [string | null, string | null];
  focusGroup: Group;
  /** Unsaved text, by path. */
  buffers: Record<string, string>;
}

const SESSION_KEY = "logiq.session";
let sessionTimer = 0;
let restoring = false;

export function scheduleSession() {
  if (restoring) return;
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(saveSession, 700);
}

export function saveSession() {
  window.clearTimeout(sessionTimer);
  const s = get();
  try {
    if (!s.root) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const buffers: Record<string, string> = {};
    if (s.settings.hotExit) {
      for (const doc of allDocs()) if (isDirty(doc)) buffers[doc.path] = doc.state.doc.toString();
    }
    const session: Session = {
      root: s.root,
      tabs: s.tabs.map((x) => ({ id: x.id, kind: x.kind, path: x.path, group: x.group, pinned: x.pinned })),
      active: s.active,
      focusGroup: s.focusGroup,
      buffers,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage full: the session is not kept, nothing else is affected.
  }
}

async function restoreSession(): Promise<boolean> {
  let session: Session | null = null;
  try {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    session = null;
  }
  if (!session?.root || !(await api.exists(session.root).catch(() => false))) return false;
  restoring = true;
  try {
    await openFolder(session.root);
    for (const tab of session.tabs) {
      if (tab.kind === "uml") openUml(tab.group);
      else if (tab.path && (await api.exists(tab.path).catch(() => false))) await openFile(tab.path, undefined, tab.group);
      else continue;
      if (tab.pinned) togglePin(tab.id);
      const unsaved = tab.path ? session.buffers[tab.path] : undefined;
      const doc = tab.path ? getDoc(tab.path) : undefined;
      if (doc && unsaved !== undefined && unsaved !== doc.state.doc.toString()) {
        const g = groupShowing(doc.path);
        const changes = { from: 0, to: doc.state.doc.length, insert: unsaved };
        if (g !== null && viewOf(g)) viewOf(g)!.dispatch({ changes });
        else {
          doc.state = doc.state.update({ changes }).state;
          onDocChanged(doc);
        }
      }
    }
    for (const g of [0, 1] as Group[]) if (session.active[g] && get().tabs.some((x) => x.id === session!.active[g])) activate(session.active[g]!, false);
    focusGroup(get().tabs.some((x) => x.group === session!.focusGroup) ? session.focusGroup : 0);
  } finally {
    restoring = false;
  }
  return true;
}

// ----- Window and start-up ----------------------------------------------------------------------

export async function requestCloseWindow() {
  const win = getCurrentWindow();
  if (get().run.status === "running") await api.runStop().catch(() => {});
  const dirty = get().tabs.filter((x) => x.dirty);
  if (dirty.length && !get().settings.hotExit) {
    const choice = await askToSave(dirty.map((x) => x.title));
    if (choice === "cancel") return;
    if (choice === "save" && !(await saveAll(true))) return;
  }
  // With hot exit the unsaved text is kept and comes back on the next start.
  saveSession();
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
          const g = groupShowing(p);
          if (g !== null && viewOf(g)) viewOf(g)!.dispatch({ changes });
          else doc.state = doc.state.update({ changes }).state;
          doc.saved = doc.state.doc;
          set((s) => ({ tabs: s.tabs.map((x) => (x.path && samePath(x.path, p) ? { ...x, dirty: false } : x)) }));
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
    if (e.code === 0) appendOutput("success", "\n" + t("Program finished in {0} s.", secs) + "\n");
    else if (e.code === null) appendOutput("system", "\n" + t("Program stopped after {0} s.", secs) + "\n");
    else appendOutput("error", "\n" + t("Program ended with exit code {0} after {1} s.", e.code, secs) + "\n");
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
  window.addEventListener("beforeunload", saveSession);
  const launch = await api.launchPaths().catch(() => [] as string[]);
  if (launch.length) await openPaths(launch);
  else await restoreSession();
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

/** Applies changed editor settings to the visible editors (others update when shown). */
export function applyEditorSettings() {
  for (const g of [0, 1] as Group[]) {
    const view = viewOf(g);
    const path = shownPath(g);
    if (!view || !path) continue;
    view.dispatch({ effects: settingsEffects(get().settings) });
    const doc = getDoc(path);
    if (doc) doc.state = view.state;
  }
}

export { activeIdOf };
