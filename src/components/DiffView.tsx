import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileCode } from "lucide-react";
import { MergeView, goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { diffSource, useDiffs, type DiffSides } from "../lib/diffTabs";
import { useGit } from "../lib/git";
import { useStore } from "../lib/store";
import { openFile } from "../lib/actions";
import { languageFor } from "../editor/languages";
import { graphiqHighlight, graphiqTheme } from "../editor/theme";
import { IconButton } from "./ui/Button";
import { t } from "../lib/i18n";

/** Two read-only sides of a file with the changes marked; unchanged stretches fold away. */
export function DiffView({ id }: { id: string }) {
  const src = diffSource(id);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MergeView | null>(null);
  const [sides, setSides] = useState<DiffSides | null>(null);
  const [chunks, setChunks] = useState(0);
  const nonce = useDiffs((s) => s.nonce);
  const gitVersion = useGit((s) => s.version);
  const fontSize = useStore((s) => s.settings.fontSize);

  // Load (again when the tab is reopened, or the file changed for a live diff).
  useEffect(() => {
    if (!src) return;
    let stale = false;
    void src.load().then((s) => !stale && setSides((was) => (was && was.left === s.left && was.right === s.right ? was : s)));
    return () => {
      stale = true;
    };
  }, [src, nonce, src?.live ? gitVersion : 0]);

  useEffect(() => {
    if (!sides || !host.current || !src) return;
    const lang = languageFor(src.path);
    const ext = [
      lineNumbers(),
      lang.support(),
      graphiqTheme,
      graphiqHighlight,
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.theme({ "&": { fontSize: `${fontSize}px` } }),
    ];
    const mv = new MergeView({
      a: { doc: sides.left, extensions: ext },
      b: { doc: sides.right, extensions: ext },
      parent: host.current,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    view.current = mv;
    setChunks(mv.chunks.length);
    return () => {
      mv.destroy();
      view.current = null;
    };
  }, [sides, src, fontSize]);

  if (!src) return <div className="diff-empty">{t("This comparison is no longer available.")}</div>;

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-label">{src.leftLabel}</span>
        <span className="diff-label">{src.rightLabel}</span>
        <span className="diff-tools">
          <span className="diff-count">{sides ? (chunks === 1 ? t("1 change") : t("{0} changes", chunks)) : t("Loading…")}</span>
          <IconButton icon={ArrowUp} label={t("Previous change")} spacing="compact" disabled={!chunks} onClick={() => view.current && goToPreviousChunk(view.current.b)} />
          <IconButton icon={ArrowDown} label={t("Next change")} spacing="compact" disabled={!chunks} onClick={() => view.current && goToNextChunk(view.current.b)} />
          <IconButton icon={FileCode} label={t("Open file")} spacing="compact" onClick={() => void openFile(src.path)} />
        </span>
      </div>
      <div ref={host} className="diff-body" />
    </div>
  );
}
