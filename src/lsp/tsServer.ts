/*
 * A small language server for JavaScript and TypeScript, run in a web worker
 * around TypeScript's own language service: completion, hover, signature
 * help, go to definition, references, rename and problems.
 */
import ts from "typescript";

type Pos = { line: number; character: number };

const libLoaders = import.meta.glob("../../node_modules/typescript/lib/lib.*.d.ts", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const libs = new Map<string, string>();
const files = new Map<string, { text: string; version: number }>();
const timers = new Map<string, number>();

const LIB_DIR = "/__lib__/";

async function loadLibs() {
  await Promise.all(
    Object.entries(libLoaders).map(async ([path, load]) => {
      libs.set(LIB_DIR + path.slice(path.lastIndexOf("/") + 1), await load());
    }),
  );
}

const nameOf = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));
const uriOf = (name: string) => "file://" + name.split("/").map(encodeURIComponent).join("/").replace(/%3A/g, ":");

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => String(files.get(f)?.version ?? 0),
  getScriptSnapshot: (f) => {
    const text = files.get(f)?.text ?? libs.get(f);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => "/",
  getCompilationSettings: () => ({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  }),
  getDefaultLibFileName: () => LIB_DIR + "lib.d.ts",
  fileExists: (f) => files.has(f) || libs.has(f),
  readFile: (f) => files.get(f)?.text ?? libs.get(f),
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function offsetAt(text: string, p: Pos): number {
  let line = 0;
  let i = 0;
  while (line < p.line && i < text.length) {
    if (text[i] === "\n") line++;
    i++;
  }
  return Math.min(text.length, i + p.character);
}

function posAt(text: string, offset: number): Pos {
  let line = 0;
  let start = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      start = i + 1;
    }
  }
  return { line, character: offset - start };
}

function range(file: string, span: ts.TextSpan) {
  const text = files.get(file)?.text ?? libs.get(file) ?? "";
  return { start: posAt(text, span.start), end: posAt(text, span.start + span.length) };
}

function send(msg: unknown) {
  postMessage(JSON.stringify(msg));
}

function publish(uri: string) {
  const file = nameOf(uri);
  if (!files.has(file)) {
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
    return;
  }
  const isJs = /\.(m|c)?jsx?$/i.test(file);
  const list = [...service.getSyntacticDiagnostics(file), ...(isJs ? [] : service.getSemanticDiagnostics(file))];
  const diagnostics = list.map((d) => ({
    range: range(file, { start: d.start ?? 0, length: d.length ?? 1 }),
    severity: d.category === ts.DiagnosticCategory.Error ? 1 : d.category === ts.DiagnosticCategory.Warning ? 2 : 3,
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    source: "ts",
    code: d.code,
  }));
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
}

function schedule(uri: string) {
  clearTimeout(timers.get(uri));
  timers.set(uri, setTimeout(() => publish(uri), 300) as unknown as number);
}

const KIND: Record<string, number> = {
  [ts.ScriptElementKind.functionElement]: 3,
  [ts.ScriptElementKind.memberFunctionElement]: 2,
  [ts.ScriptElementKind.constructorImplementationElement]: 4,
  [ts.ScriptElementKind.memberVariableElement]: 5,
  [ts.ScriptElementKind.memberGetAccessorElement]: 10,
  [ts.ScriptElementKind.memberSetAccessorElement]: 10,
  [ts.ScriptElementKind.variableElement]: 6,
  [ts.ScriptElementKind.localVariableElement]: 6,
  [ts.ScriptElementKind.letElement]: 6,
  [ts.ScriptElementKind.constElement]: 21,
  [ts.ScriptElementKind.classElement]: 7,
  [ts.ScriptElementKind.interfaceElement]: 8,
  [ts.ScriptElementKind.moduleElement]: 9,
  [ts.ScriptElementKind.enumElement]: 13,
  [ts.ScriptElementKind.keyword]: 14,
  [ts.ScriptElementKind.typeElement]: 7,
  [ts.ScriptElementKind.parameterElement]: 6,
};

function md(parts: ts.SymbolDisplayPart[] | undefined, doc?: ts.SymbolDisplayPart[]) {
  const sig = ts.displayPartsToString(parts);
  const text = ts.displayPartsToString(doc);
  return { kind: "markdown", value: (sig ? "```typescript\n" + sig + "\n```" : "") + (text ? "\n\n" + text : "") };
}

async function handle(msg: any): Promise<unknown> {
  const p = msg.params ?? {};
  const file = p.textDocument ? nameOf(p.textDocument.uri) : "";
  const text = files.get(file)?.text ?? "";
  const at = p.position ? offsetAt(text, p.position) : 0;
  switch (msg.method) {
    case "initialize":
      await loadLibs();
      return {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { triggerCharacters: [".", '"', "'", "/"] },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          renameProvider: true,
          signatureHelpProvider: { triggerCharacters: ["(", ","] },
        },
      };
    case "textDocument/completion": {
      const r = service.getCompletionsAtPosition(file, at, { includeCompletionsWithInsertText: true, includeCompletionsForModuleExports: false });
      return {
        isIncomplete: false,
        items: (r?.entries ?? []).slice(0, 400).map((e) => ({ label: e.name, kind: KIND[e.kind] ?? 1, sortText: e.sortText, insertText: e.insertText })),
      };
    }
    case "textDocument/hover": {
      const q = service.getQuickInfoAtPosition(file, at);
      return q ? { contents: md(q.displayParts, q.documentation), range: range(file, q.textSpan) } : null;
    }
    case "textDocument/definition": {
      const defs = service.getDefinitionAtPosition(file, at) ?? [];
      return defs.filter((d) => files.has(d.fileName)).map((d) => ({ uri: uriOf(d.fileName), range: range(d.fileName, d.textSpan) }));
    }
    case "textDocument/references": {
      const refs = service.getReferencesAtPosition(file, at) ?? [];
      return refs.filter((d) => files.has(d.fileName)).map((d) => ({ uri: uriOf(d.fileName), range: range(d.fileName, d.textSpan) }));
    }
    case "textDocument/rename": {
      const locs = service.findRenameLocations(file, at, false, false, { providePrefixAndSuffixTextForRename: true }) ?? [];
      const changes: Record<string, unknown[]> = {};
      for (const l of locs) (changes[uriOf(l.fileName)] ??= []).push({ range: range(l.fileName, l.textSpan), newText: (l.prefixText ?? "") + p.newName + (l.suffixText ?? "") });
      return { changes };
    }
    case "textDocument/signatureHelp": {
      const h = service.getSignatureHelpItems(file, at, undefined);
      if (!h) return null;
      return {
        activeSignature: h.selectedItemIndex,
        activeParameter: h.argumentIndex,
        signatures: h.items.map((it) => ({
          label: ts.displayPartsToString(it.prefixDisplayParts) + it.parameters.map((x) => ts.displayPartsToString(x.displayParts)).join(ts.displayPartsToString(it.separatorDisplayParts)) + ts.displayPartsToString(it.suffixDisplayParts),
          documentation: ts.displayPartsToString(it.documentation),
          parameters: it.parameters.map((x) => ({ label: ts.displayPartsToString(x.displayParts), documentation: ts.displayPartsToString(x.documentation) })),
        })),
      };
    }
    case "shutdown":
      return null;
    default:
      return null;
  }
}

function notify(msg: any) {
  const p = msg.params ?? {};
  switch (msg.method) {
    case "textDocument/didOpen":
      files.set(nameOf(p.textDocument.uri), { text: p.textDocument.text, version: p.textDocument.version });
      schedule(p.textDocument.uri);
      break;
    case "textDocument/didChange": {
      const f = nameOf(p.textDocument.uri);
      const last = p.contentChanges[p.contentChanges.length - 1];
      if (last && !("range" in last)) files.set(f, { text: last.text, version: p.textDocument.version });
      schedule(p.textDocument.uri);
      break;
    }
    case "textDocument/didClose":
      files.delete(nameOf(p.textDocument.uri));
      publish(p.textDocument.uri);
      break;
  }
}

self.addEventListener("message", (e: MessageEvent) => {
  const msg = JSON.parse(String(e.data));
  if ("id" in msg && msg.method) {
    handle(msg).then(
      (result) => send({ jsonrpc: "2.0", id: msg.id, result: result ?? null }),
      (error) => send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(error?.message ?? error) } }),
    );
  } else if (msg.method) notify(msg);
});
