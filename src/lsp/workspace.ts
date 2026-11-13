/*
 * The LSP client's view of the app's files. Each group's editor shows one
 * file at a time, so a file opens for the server when its tab is shown and
 * closes when another takes its place; the server always gets the full text
 * on opening, so edits made meanwhile are never lost.
 */
import { LSPPlugin, Workspace, type WorkspaceFile } from "@codemirror/lsp-client";
import type { ChangeSet, Text, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { openFile } from "../lib/actions";
import { groupShowing, viewOf } from "../editor/docs";
import { sameUri, uriToPath } from "./uri";

class File implements WorkspaceFile {
  constructor(
    public uri: string,
    public languageId: string,
    public version: number,
    public doc: Text,
    public view: EditorView,
  ) {}
  getView() {
    return this.view;
  }
}

export class AppWorkspace extends Workspace {
  files: File[] = [];
  private versions: Record<string, number> = Object.create(null);

  /** Servers may write the same file's URI differently (drive letter case, escapes). */
  getFile(uri: string): WorkspaceFile | null {
    return this.files.find((f) => f.uri === uri) ?? this.files.find((f) => sameUri(f.uri, uri)) ?? null;
  }

  private nextVersion(uri: string) {
    return (this.versions[uri] = (this.versions[uri] ?? -1) + 1);
  }

  syncFiles() {
    const out: { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        out.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.nextVersion(file.uri);
        plugin.clear();
      }
    }
    return out;
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    const old = this.getFile(uri) as File | null;
    if (old) {
      // Shown again (in the other group, or after a reload of the state): reopen with the current text.
      this.files = this.files.filter((f) => f !== old);
      this.client.didClose(uri);
    }
    const file = new File(uri, languageId, this.nextVersion(uri), view.state.doc, view);
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string, view: EditorView) {
    const file = this.getFile(uri) as File | null;
    if (file && file.view === view) {
      this.files = this.files.filter((f) => f !== file);
      this.client.didClose(uri);
    }
  }

  updateFile(uri: string, update: TransactionSpec) {
    const file = this.getFile(uri) as File | null;
    if (file) file.view.dispatch(update);
  }

  /** Go to definition and the like open the file in the app's own tabs. */
  async displayFile(uri: string): Promise<EditorView | null> {
    const path = uriToPath(uri);
    await openFile(path);
    const g = groupShowing(path);
    return g === null ? null : viewOf(g);
  }
}
