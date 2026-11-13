/*
 * A language server for HTML and CSS in a web worker, around the language
 * services VS Code uses: completion of tags, attributes, properties and
 * values; hover documentation; CSS validation; go to definition and rename
 * for CSS variables and selectors.
 */
import { getLanguageService as htmlService } from "vscode-html-languageservice";
import { getCSSLanguageService } from "vscode-css-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";

const html = htmlService();
const css = getCSSLanguageService();
css.configure({ validate: true, lint: { emptyRules: "warning", duplicateProperties: "warning", zeroUnits: "ignore", unknownProperties: "warning", important: "ignore" } });
const docs = new Map<string, TextDocument>();
const timers = new Map<string, number>();

function send(msg: unknown) {
  postMessage(JSON.stringify(msg));
}

const isCss = (d: TextDocument) => d.languageId === "css" || /\.css$/i.test(d.uri);

function publish(uri: string) {
  const doc = docs.get(uri);
  const diagnostics = doc && isCss(doc) ? css.doValidation(doc, css.parseStylesheet(doc)) : [];
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
}

function schedule(uri: string) {
  clearTimeout(timers.get(uri));
  timers.set(uri, setTimeout(() => publish(uri), 300) as unknown as number);
}

async function handle(msg: any): Promise<unknown> {
  const p = msg.params ?? {};
  const doc = p.textDocument ? docs.get(p.textDocument.uri) : undefined;
  switch (msg.method) {
    case "initialize":
      return {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { triggerCharacters: ["<", " ", '"', "=", "/", ":", "-", "."] },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          renameProvider: true,
        },
      };
    case "textDocument/completion":
      if (!doc) return null;
      return isCss(doc) ? css.doComplete(doc, p.position, css.parseStylesheet(doc)) : html.doComplete(doc, p.position, html.parseHTMLDocument(doc));
    case "textDocument/hover":
      if (!doc) return null;
      return isCss(doc) ? css.doHover(doc, p.position, css.parseStylesheet(doc)) : html.doHover(doc, p.position, html.parseHTMLDocument(doc));
    case "textDocument/definition":
      return doc && isCss(doc) ? css.findDefinition(doc, p.position, css.parseStylesheet(doc)) : null;
    case "textDocument/references":
      return doc && isCss(doc) ? css.findReferences(doc, p.position, css.parseStylesheet(doc)) : [];
    case "textDocument/rename":
      if (!doc) return null;
      if (isCss(doc)) return css.doRename(doc, p.position, p.newName, css.parseStylesheet(doc));
      // In HTML, renaming a tag renames its closing tag too.
      return html.doRename(doc, p.position, p.newName, html.parseHTMLDocument(doc));
    default:
      return null;
  }
}

function notify(msg: any) {
  const p = msg.params ?? {};
  switch (msg.method) {
    case "textDocument/didOpen":
      docs.set(p.textDocument.uri, TextDocument.create(p.textDocument.uri, p.textDocument.languageId, p.textDocument.version, p.textDocument.text));
      schedule(p.textDocument.uri);
      break;
    case "textDocument/didChange": {
      const old = docs.get(p.textDocument.uri);
      if (old) docs.set(p.textDocument.uri, TextDocument.update(old, p.contentChanges, p.textDocument.version));
      schedule(p.textDocument.uri);
      break;
    }
    case "textDocument/didClose":
      docs.delete(p.textDocument.uri);
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
