import { CircleAlert, Coffee, Hexagon, TriangleAlert } from "lucide-react";
import { openDialog, set, useStore } from "../lib/store";
import { languageFor } from "../editor/languages";
import { getDoc } from "../editor/docs";

export function StatusBar() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const cursor = useStore((s) => s.cursor);
  const settings = useStore((s) => s.settings);
  const jdks = useStore((s) => s.jdks);
  const node = useStore((s) => s.node);
  const problems = useStore((s) => s.problems);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.length - errors;
  const jdk = jdks.find((j) => j.home === settings.jdkHome) ?? jdks[0];
  const isFile = tab?.kind === "file" && tab.path;
  const lang = isFile ? languageFor(tab.path!) : null;
  const doc = isFile ? getDoc(tab.path!) : undefined;

  return (
    <footer className="statusbar">
      <button type="button" className="status-item" onClick={() => set({ panelOpen: true, panelTab: "problems" })} aria-label={`${errors} errors, ${warnings} warnings`}>
        <CircleAlert size={13} className={errors ? "is-error" : undefined} aria-hidden="true" />
        <span className="is-mono">{errors}</span>
        <TriangleAlert size={13} className={warnings ? "is-warning" : undefined} aria-hidden="true" />
        <span className="is-mono">{warnings}</span>
      </button>
      <span className="spacer" />
      {isFile && (
        <>
          <span className="status-item is-mono">
            Ln {cursor.line}, Col {cursor.col}
            {cursor.selected > 0 && ` (${cursor.selected} selected)`}
          </span>
          <button type="button" className="status-item" onClick={() => openDialog({ kind: "settings" })}>
            {settings.insertSpaces ? `Spaces: ${settings.tabSize}` : `Tab size: ${settings.tabSize}`}
          </button>
          <span className="status-item">UTF-8</span>
          <span className="status-item">{doc?.eol === "crlf" ? "CRLF" : "LF"}</span>
          <span className="status-item">{lang?.name}</span>
        </>
      )}
      <button type="button" className="status-item" onClick={() => openDialog({ kind: "settings" })} data-tooltip={jdk ? jdk.home : "No JDK found"}>
        <Coffee size={13} aria-hidden="true" />
        {jdk ? `Java ${jdk.version}` : "No JDK"}
      </button>
      {node && (
        <span className="status-item" data-tooltip={node.path}>
          <Hexagon size={13} aria-hidden="true" />
          Node {node.version.replace(/^v/, "")}
        </span>
      )}
    </footer>
  );
}
