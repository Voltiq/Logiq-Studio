import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { forceLinting } from "@codemirror/lint";
import { activeView, getDoc, setShownPath, setView } from "../editor/docs";
import { get, useStore } from "../lib/store";
import { activate, applyEditorSettings } from "../lib/actions";

/*
 * The one editor view. Switching tabs swaps the file's state into it, so
 * each file keeps its own undo history, selection and scroll position.
 */
export function Editor({ visible }: { visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const problemsVersion = useStore((s) => s.problemsVersion);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    const view = new EditorView({ parent: host.current! });
    setView(view);
    // A file may already be active (opened before the view existed).
    const id = get().activeId;
    if (id) activate(id);
    return () => {
      setView(null);
      setShownPath(null);
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = activeView();
    if (view) forceLinting(view);
  }, [problemsVersion]);

  useEffect(() => {
    applyEditorSettings();
  }, [settings.tabSize, settings.insertSpaces, settings.wordWrap, settings.lineNumbers, settings.autoCloseBrackets]);

  useEffect(() => {
    if (visible) {
      const tab = get().tabs.find((t) => t.id === get().activeId);
      if (tab?.path && getDoc(tab.path)) requestAnimationFrame(() => activeView()?.focus());
    }
  }, [visible]);

  return <div ref={host} className="editor-host" hidden={!visible} style={{ ["--editor-font-size" as string]: `${settings.fontSize}px` }} />;
}
