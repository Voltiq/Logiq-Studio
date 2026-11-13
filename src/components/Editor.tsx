import { useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { forceLinting } from "@codemirror/lint";
import { AppWindow, ChevronRight } from "lucide-react";
import { getDoc, setShownPath, setView, shownPath, type Group } from "../editor/docs";
import { get, useStore } from "../lib/store";
import { activate, applyEditorSettings, goTo, openDesigner, revealInTree } from "../lib/actions";
import { scopeAt } from "../editor/javaNav";
import { relint } from "../editor/setup";
import { useJavaIndexVersion } from "../uml/javaIndex";
import { languageFor } from "../editor/languages";
import { relative } from "../lib/paths";
import { FileIcon } from "./FileIcon";
import { t } from "../lib/i18n";

interface StickyLine {
  line: number;
  text: string;
}

/*
 * The editor view of one group. Switching tabs swaps the file's state into
 * it, so each file keeps its own undo history, selection and scroll. The
 * class and method the top line belongs to stay pinned at the top while
 * scrolling through them.
 */
export function Editor({ group, visible }: { group: Group; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const problemsVersion = useStore((s) => s.problemsVersion);
  const settings = useStore((s) => s.settings);
  const [sticky, setSticky] = useState<StickyLine[]>([]);
  const javaVersion = useJavaIndexVersion();

  useEffect(() => {
    const view = new EditorView({ parent: host.current! });
    viewRef.current = view;
    setView(group, view);
    // A file may already be active in this group (opened before the view existed).
    const id = get().active[group];
    if (id) activate(id, false);
    return () => {
      setView(group, null);
      setShownPath(group, null);
      view.destroy();
      viewRef.current = null;
    };
  }, [group]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: relint.of(null) });
    forceLinting(view);
  }, [problemsVersion]);

  useEffect(() => {
    applyEditorSettings();
  }, [settings.tabSize, settings.insertSpaces, settings.wordWrap, settings.lineNumbers, settings.autoCloseBrackets]);

  // Sticky scroll: the declarations that enclose the first visible line.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !visible) return;
    const update = () => {
      const path = shownPath(group);
      if (!path || languageFor(path).id !== "java") return setSticky((s) => (s.length ? [] : s));
      const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 4);
      const topLine = view.state.doc.lineAt(top.from).number;
      const { types, method } = scopeAt(path, topLine);
      const lines: StickyLine[] = [];
      for (const x of types) if (x.line < topLine + lines.length) lines.push({ line: x.line, text: view.state.doc.line(Math.min(x.line, view.state.doc.lines)).text });
      if (method && method.line < topLine + lines.length) lines.push({ line: method.line, text: view.state.doc.line(Math.min(method.line, view.state.doc.lines)).text });
      setSticky((old) => (old.length === lines.length && old.every((o, i) => o.line === lines[i].line && o.text === lines[i].text) ? old : lines));
    };
    update();
    view.scrollDOM.addEventListener("scroll", update, { passive: true });
    return () => view.scrollDOM.removeEventListener("scroll", update);
  }, [visible, group, javaVersion]);

  return (
    <div className="editor-host" hidden={!visible} style={{ ["--editor-font-size" as string]: `${settings.fontSize}px` }}>
      <div ref={host} className="editor-mount" />
      {visible && sticky.length > 0 && (
        <div className="sticky-lines" aria-hidden="true">
          {sticky.map((s) => (
            <div key={s.line} className="sticky-line" onClick={() => goTo(s.line)}>
              <span className="sticky-no">{s.line}</span>
              <span className="sticky-text">{s.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* The path of the file and, in Java, the class and method at the cursor. */
export function Breadcrumbs({ path, focused }: { path: string; focused: boolean }) {
  const root = useStore((s) => s.root);
  const line = useStore((s) => s.cursor.line);
  useJavaIndexVersion();
  const parts = (root ? relative(root, path) : path).split("/");
  const scope = focused && languageFor(path).id === "java" ? scopeAt(path, line) : { types: [], method: null };
  // A Swing window the designer made: a way back to the designer.
  const designable = languageFor(path).id === "java" && !!getDoc(path)?.state.doc.toString().includes("// GUI-BEGIN fields");
  return (
    <nav className="breadcrumbs" aria-label={t("Breadcrumbs")}>
      {parts.map((p, i) => (
        <span key={i} className="crumb">
          {i > 0 && <ChevronRight size={12} className="crumb-sep" aria-hidden="true" />}
          {i === parts.length - 1 && <FileIcon name={p} size={14} />}
          <button type="button" className="crumb-button" onClick={() => void revealInTree(path)}>
            {p}
          </button>
        </span>
      ))}
      {scope.types.map((x) => (
        <span key={x.qualifiedName} className="crumb">
          <ChevronRight size={12} className="crumb-sep" aria-hidden="true" />
          <button type="button" className="crumb-button is-symbol" onClick={() => goTo(x.line)}>
            {x.name}
          </button>
        </span>
      ))}
      {scope.method && (
        <span className="crumb">
          <ChevronRight size={12} className="crumb-sep" aria-hidden="true" />
          <button type="button" className="crumb-button is-method" onClick={() => goTo(scope.method!.line)}>
            {scope.method.name}()
          </button>
        </span>
      )}
      {designable && (
        <button type="button" className="crumb-design" onClick={() => void openDesigner(path)} data-tooltip={t("Open in the GUI designer")}>
          <AppWindow size={13} aria-hidden="true" />
          {t("Design")}
        </button>
      )}
    </nav>
  );
}

