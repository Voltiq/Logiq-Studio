/*
 * Language servers: Java through Eclipse JDT LS (a native process), JavaScript
 * and TypeScript through the TypeScript language service, HTML and CSS
 * through the VS Code language services (both in web workers). They all
 * speak LSP to one client per server, which gives the editors completion,
 * hover, signature help, go to definition, rename and references; problems
 * go into the same markers as the compiler's, and quick fixes are menus.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Text, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  findReferencesKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  LSPClient,
  LSPPlugin,
  renameKeymap,
  serverCompletion,
  signatureHelp,
  type Transport,
} from "@codemirror/lsp-client";
import { keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { api, errorText } from "../lib/api";
import { get, openMenu, set, toast } from "../lib/store";
import { t } from "../lib/i18n";
import { languageFor, type LanguageId } from "../editor/languages";
import { getDoc } from "../editor/docs";
import { javaIndex } from "../uml/javaIndex";
import { AppWorkspace } from "./workspace";
import { pathToUri, uriToPath } from "./uri";
import type { MenuItem } from "../components/ui/Menu";

export type ServerId = "java" | "ts" | "web";

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}

interface LspState {
  java: "off" | "missing" | "installing" | "starting" | "ready" | "failed";
  ts: "off" | "starting" | "ready";
  web: "off" | "starting" | "ready";
}

export const useLsp = create<LspState>(() => ({ java: "off", ts: "off", web: "off" }));

const clients: Partial<Record<ServerId, LSPClient>> = {};
const diagnostics = new Map<string, LspDiagnostic[]>();
let refreshLanguages: ((ids: LanguageId[]) => void) | null = null;

export function setLanguageRefresher(f: (ids: LanguageId[]) => void) {
  refreshLanguages = f;
}

function serverFor(lang: LanguageId): ServerId | null {
  if (lang === "java") return "java";
  if (lang === "javascript" || lang === "typescript") return "ts";
  if (lang === "html" || lang === "css") return "web";
  return null;
}

const LANGUAGE_ID: Partial<Record<LanguageId, string>> = { java: "java", javascript: "javascript", typescript: "typescript", html: "html", css: "css" };

/** Whether a file's editor gets the language server's features. */
export function hasServer(path: string): boolean {
  const id = serverFor(languageFor(path).id);
  return !!id && !!clients[id];
}

/** The language server extensions for a file's editor (none when its server isn't running). */
export function lspExtension(path: string): Extension {
  const lang = languageFor(path).id;
  const id = serverFor(lang);
  const client = id && clients[id];
  if (!client) return [];
  return client.plugin(pathToUri(path), LANGUAGE_ID[lang]);
}

/** The server's problems for a file, for the editor's lint markers. */
export function serverDiagnosticsFor(path: string): LspDiagnostic[] {
  return diagnostics.get(path.toLowerCase()) ?? [];
}

/** All server problems, for the Problems panel. */
export function allServerDiagnostics(): { path: string; diagnostics: LspDiagnostic[] }[] {
  return [...diagnostics.entries()].map(([k, d]) => ({ path: pathsByKey.get(k) ?? k, diagnostics: d }));
}
const pathsByKey = new Map<string, string>();

// ----- Applying edits from servers -------------------------------------------------------------

interface TextEdit {
  range: LspDiagnostic["range"];
  newText: string;
}

function offset(doc: Text, p: { line: number; character: number }): number {
  const line = doc.line(Math.min(doc.lines, p.line + 1));
  return Math.min(line.to, line.from + p.character);
}

/** Applies an LSP WorkspaceEdit: open files change in their editors, others on disk. */
export async function applyWorkspaceEdit(edit: { changes?: Record<string, TextEdit[]>; documentChanges?: unknown[] }): Promise<boolean> {
  const byUri = new Map<string, TextEdit[]>();
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) byUri.set(uri, edits);
  for (const dc of (edit.documentChanges ?? []) as { textDocument?: { uri: string }; edits?: TextEdit[]; kind?: string; uri?: string }[]) {
    if (dc.textDocument && dc.edits) byUri.set(dc.textDocument.uri, [...(byUri.get(dc.textDocument.uri) ?? []), ...dc.edits]);
    else if (dc.kind === "create" && dc.uri) await api.createFile(uriToPath(dc.uri), "").catch(() => {});
  }
  const { changeDoc } = await import("../lib/actions");
  for (const [uri, edits] of byUri) {
    const path = uriToPath(uri);
    const doc = getDoc(path);
    const text = doc ? doc.state.doc : Text.of((await api.readText(path)).text.split("\n"));
    const changes = edits.map((e) => ({ from: offset(text, e.range.start), to: offset(text, e.range.end), insert: e.newText.replace(/\r\n/g, "\n") })).sort((a, b) => a.from - b.from);
    if (doc) changeDoc(path, changes);
    else {
      let out = text.toString();
      for (const c of [...changes].reverse()) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
      await api.writeText(path, out);
      if (path.toLowerCase().endsWith(".java")) javaIndex.set(path, out);
    }
  }
  return true;
}

// ----- Transports --------------------------------------------------------------------------------

/** Requests the server makes of the client, answered here (the client library leaves them unanswered). */
async function answerServerRequest(method: string, params: any): Promise<unknown> {
  switch (method) {
    case "workspace/applyEdit":
      return { applied: await applyWorkspaceEdit(params.edit) };
    case "workspace/configuration":
      return (params.items ?? []).map(() => null);
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
      return null;
    case "window/showMessageRequest":
      return null;
    default:
      throw { code: -32601, message: "Method not implemented" };
  }
}

function makeTransport(send: (msg: string) => void, onMessage: (deliver: (msg: string) => void) => void): Transport {
  const handlers = new Set<(msg: string) => void>();
  onMessage((msg) => {
    let value: any;
    try {
      value = JSON.parse(msg);
    } catch {
      return;
    }
    if (value && "id" in value && "method" in value) {
      answerServerRequest(value.method, value.params).then(
        (result) => send(JSON.stringify({ jsonrpc: "2.0", id: value.id, result })),
        (error) => send(JSON.stringify({ jsonrpc: "2.0", id: value.id, error })),
      );
      return;
    }
    handlers.forEach((h) => h(msg));
  });
  return {
    send,
    subscribe: (h) => void handlers.add(h),
    unsubscribe: (h) => void handlers.delete(h),
  };
}

function workerTransport(worker: Worker): Transport {
  return makeTransport(
    (msg) => worker.postMessage(msg),
    (deliver) => worker.addEventListener("message", (e) => deliver(String(e.data))),
  );
}

let nativeListening = false;
const nativeDeliver: Partial<Record<string, (msg: string) => void>> = {};

async function nativeTransport(id: string): Promise<Transport> {
  if (!nativeListening) {
    nativeListening = true;
    await listen<{ id: string; message: string }>("lsp-message", (e) => nativeDeliver[e.payload.id]?.(e.payload.message));
    await listen<string>("lsp-exit", (e) => {
      if (e.payload === "java" && useLsp.getState().java !== "off") {
        useLsp.setState({ java: "failed" });
        stopServer("java");
      }
    });
  }
  return makeTransport(
    (msg) => void invoke("lsp_send", { id, message: msg }).catch(() => {}),
    (deliver) => {
      nativeDeliver[id] = deliver;
    },
  );
}

// ----- Clients -----------------------------------------------------------------------------------

/** Sends edits to the server half a second after typing stops, so problems update as you type. */
const autoSync = ViewPlugin.fromClass(
  class {
    pending = 0;
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.docChanged) return;
      clearTimeout(this.pending);
      this.pending = window.setTimeout(() => LSPPlugin.get(this.view)?.client.sync(), 500);
    }
    destroy() {
      clearTimeout(this.pending);
    }
  },
);

function newClient(rootUri: string | undefined, initializationOptions?: unknown, timeout = 8000): LSPClient {
  return new LSPClient({
    rootUri,
    initializationOptions,
    timeout,
    workspace: (c) => new AppWorkspace(c),
    notificationHandlers: {
      "textDocument/publishDiagnostics": (_c, params: { uri: string; diagnostics: LspDiagnostic[] }) => {
        const path = uriToPath(params.uri);
        const key = path.toLowerCase();
        pathsByKey.set(key, path);
        if (params.diagnostics.length) diagnostics.set(key, params.diagnostics);
        else diagnostics.delete(key);
        set((s) => ({ problemsVersion: s.problemsVersion + 1 }));
        return true;
      },
      // Progress and status notes from JDT LS.
      "language/status": () => true,
      "language/progressReport": () => true,
      "$/progress": () => true,
    },
    extensions: [
      serverCompletion(),
      hoverTooltips(),
      signatureHelp(),
      { clientCapabilities: { textDocument: { codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix", "refactor", "source", "source.organizeImports"] } }, resolveSupport: { properties: ["edit"] } } } } },
      Prec.high(keymap.of([...jumpToDefinitionKeymap, ...renameKeymap, ...findReferencesKeymap])),
      { editorExtension: autoSync },
    ],
  });
}

function stopServer(id: ServerId) {
  const client = clients[id];
  if (!client) return;
  delete clients[id];
  try {
    client.disconnect();
  } catch {
    // Already gone.
  }
  for (const [k, list] of [...diagnostics]) {
    if (list.length && serverFor(languageFor(pathsByKey.get(k) ?? k).id) === id) diagnostics.delete(k);
  }
  set((s) => ({ problemsVersion: s.problemsVersion + 1 }));
}

const LANGS: Record<ServerId, LanguageId[]> = { java: ["java"], ts: ["javascript", "typescript"], web: ["html", "css"] };

let workers: Partial<Record<ServerId, Worker>> = {};

async function startWorkerServer(id: "ts" | "web") {
  if (clients[id]) return;
  useLsp.setState({ [id]: "starting" } as Partial<LspState>);
  const worker = id === "ts" ? new Worker(new URL("./tsServer.ts", import.meta.url), { type: "module" }) : new Worker(new URL("./webServer.ts", import.meta.url), { type: "module" });
  workers[id] = worker;
  const root = get().root;
  const client = newClient(root ? pathToUri(root) : undefined);
  clients[id] = client;
  client.connect(workerTransport(worker));
  refreshLanguages?.(LANGS[id]);
  client.initializing.then(
    () => useLsp.setState({ [id]: "ready" } as Partial<LspState>),
    () => useLsp.setState({ [id]: "off" } as Partial<LspState>),
  );
}

/** Starts the in-app servers for the web languages. */
export function startWebServers() {
  void startWorkerServer("ts");
  void startWorkerServer("web");
}

export async function javaServerInstalled(): Promise<boolean> {
  return !!(await invoke<string | null>("jdtls_status").catch(() => null));
}

/** Starts JDT LS for the open folder when it is installed and switched on. */
export async function startJavaServer() {
  stopServer("java");
  await invoke("lsp_stop", { id: "java" }).catch(() => {});
  const root = get().root;
  if (!root || !get().settings.javaServer) {
    useLsp.setState({ java: "off" });
    refreshLanguages?.(["java"]);
    return;
  }
  if (!(await javaServerInstalled())) {
    useLsp.setState({ java: "missing" });
    refreshLanguages?.(["java"]);
    return;
  }
  useLsp.setState({ java: "starting" });
  try {
    await invoke("jdtls_start", { root, jdkHome: get().settings.jdkHome || get().jdks[0]?.home || null });
  } catch (e) {
    useLsp.setState({ java: "failed" });
    toast("error", t("The Java language server didn't start"), errorText(e));
    return;
  }
  const client = newClient(
    pathToUri(root),
    {
      settings: {
        java: {
          project: { referencedLibraries: ["lib/**/*.jar"] },
          format: { enabled: false },
          signatureHelp: { enabled: true },
          completion: {
            importOrder: ["java", "javax", "", "#"],
            // Leave the JDK's internal packages out of completion and "Import ..." fixes.
            filteredTypes: ["java.awt.List", "com.sun.*", "sun.*", "jdk.*", "org.graalvm.*", "io.micrometer.shaded.*"],
          },
        },
      },
      extendedClientCapabilities: { classFileContentsSupport: false },
    },
    // The first start indexes the JDK, which takes a while.
    60000,
  );
  clients.java = client;
  client.connect(await nativeTransport("java"));
  refreshLanguages?.(["java"]);
  client.initializing.then(
    () => useLsp.setState({ java: "ready" }),
    (e) => {
      useLsp.setState({ java: "failed" });
      toast("error", t("The Java language server didn't start"), errorText(e?.message ?? e));
    },
  );
}

export async function installJavaServer() {
  useLsp.setState({ java: "installing" });
  try {
    await invoke("jdtls_install");
    toast("success", t("Java language server installed"), t("Starting it for this folder."));
    set((s) => ({ settings: { ...s.settings, javaServer: true } }));
    await startJavaServer();
  } catch (e) {
    useLsp.setState({ java: "missing" });
    toast("error", t("The Java language server wasn't installed"), errorText(e));
  }
}

// ----- Quick fixes and source actions ----------------------------------------------------------

interface CodeAction {
  title: string;
  kind?: string;
  edit?: { changes?: Record<string, TextEdit[]>; documentChanges?: unknown[] };
  command?: { command: string; arguments?: unknown[] } | string;
  data?: unknown;
  isPreferred?: boolean;
}

async function runAction(client: LSPClient, a: CodeAction) {
  let action = a;
  if (!action.edit && !action.command && action.data !== undefined) {
    action = await client.request<CodeAction, CodeAction>("codeAction/resolve", action).catch(() => action);
  }
  if (action.edit) await applyWorkspaceEdit(action.edit);
  const cmd = typeof action.command === "string" ? { command: action.command, arguments: [] } : action.command;
  if (!cmd) return;
  if (cmd.command === "java.apply.workspaceEdit") {
    for (const e of cmd.arguments ?? []) await applyWorkspaceEdit(e as never);
    return;
  }
  await client.request("workspace/executeCommand", { command: cmd.command, arguments: cmd.arguments ?? [] }).catch((e) => toast("error", action.title, errorText(e?.message ?? e)));
}

/** Asks the server what it can fix or do at the cursor, and offers it as a menu. */
export async function quickFix(view: EditorView, path: string, only?: string[]) {
  const plugin = LSPPlugin.get(view);
  if (!plugin) {
    toast("info", t("No quick fixes here"), t("Quick fixes come from a language server; for Java, install it in Settings."));
    return;
  }
  const client = plugin.client;
  client.sync();
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const toPos = (o: number) => {
    const l = doc.lineAt(o);
    return { line: l.number - 1, character: o - l.from };
  };
  const line = doc.lineAt(sel.head).number - 1;
  const here = serverDiagnosticsFor(path).filter((d) => d.range.start.line <= line && d.range.end.line >= line);
  let actions: CodeAction[] = [];
  try {
    actions =
      (await client.request<unknown, CodeAction[] | null>("textDocument/codeAction", {
        textDocument: { uri: plugin.uri },
        range: { start: toPos(sel.from), end: toPos(sel.to) },
        context: { diagnostics: here, ...(only ? { only } : {}) },
      })) ?? [];
  } catch (e) {
    toast("error", t("No quick fixes here"), errorText((e as { message?: string })?.message ?? e));
    return;
  }
  actions = actions.filter((a) => typeof a === "object" && a.title);
  if (only && actions.length === 1) return runAction(client, actions[0]);
  const coords = view.coordsAtPos(sel.head) ?? { left: 200, bottom: 200 };
  const items: MenuItem[] = actions.length
    ? [...actions.filter((a) => a.isPreferred), ...actions.filter((a) => !a.isPreferred)].map((a) => ({ label: a.title, onSelect: () => void runAction(client, a) }))
    : [{ label: t("No quick fixes here"), disabled: true, onSelect: () => {} }];
  openMenu({ items, x: coords.left, y: coords.bottom + 4 });
}

export function organizeImports(view: EditorView, path: string) {
  return quickFix(view, path, ["source.organizeImports"]);
}

export function restartServersForFolder() {
  stopServer("ts");
  stopServer("web");
  workers.ts?.terminate();
  workers.web?.terminate();
  workers = {};
  startWebServers();
  void startJavaServer();
}
