import { CircleAlert, Coffee, GitBranch, Hammer, Hexagon, TriangleAlert } from "lucide-react";
import { toolName, useBuild } from "../lib/build";
import { buildMenu } from "../lib/commands";
import { useGit } from "../lib/git";
import { branchMenu } from "./SourceControl";
import { activeTab, openDialog, set, useStore } from "../lib/store";
import { languageFor } from "../editor/languages";
import { getDoc } from "../editor/docs";
import { t } from "../lib/i18n";
import { useLsp } from "../lsp/clients";

export function StatusBar() {
  const tab = useStore((s) => activeTab(s));
  const cursor = useStore((s) => s.cursor);
  const settings = useStore((s) => s.settings);
  const jdks = useStore((s) => s.jdks);
  const node = useStore((s) => s.node);
  const javaServer = useLsp((s) => s.java);
  const gitStatus = useGit((s) => s.status);
  const build = useBuild((s) => s.info);
  const problems = useStore((s) => s.problems);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.length - errors;
  const jdk = jdks.find((j) => j.home === settings.jdkHome) ?? jdks[0];
  const isFile = tab?.kind === "file" && tab.path;
  const lang = isFile ? languageFor(tab.path!) : null;
  const doc = isFile ? getDoc(tab.path!) : undefined;

  return (
    <footer className="statusbar">
      <button type="button" className="status-item" onClick={() => set({ panelOpen: true, panelTab: "problems" })} aria-label={t("Errors: {0}, warnings: {1}", errors, warnings)}>
        <CircleAlert size={13} className={errors ? "is-error" : undefined} aria-hidden="true" />
        <span className="is-mono">{errors}</span>
        <TriangleAlert size={13} className={warnings ? "is-warning" : undefined} aria-hidden="true" />
        <span className="is-mono">{warnings}</span>
      </button>
      {gitStatus && (
        <button type="button" className="status-item" onClick={(e) => void branchMenu(e.currentTarget)} data-tooltip={t("Switch branch")}>
          <GitBranch size={13} aria-hidden="true" />
          {gitStatus.detached ? t("(detached)") : gitStatus.branch}
          {gitStatus.unborn ? "" : gitStatus.upstream ? (gitStatus.ahead || gitStatus.behind ? ` ${gitStatus.behind}↓ ${gitStatus.ahead}↑` : "") : ""}
          {gitStatus.files.length > 0 && "*"}
        </button>
      )}
      {build && (
        <button type="button" className="status-item" onClick={(e) => buildMenu(e.currentTarget)} data-tooltip={build.program ? t("{0} tasks", toolName(build)) : t("{0} wasn't found", toolName(build))}>
          <Hammer size={13} className={build.program ? undefined : "is-warning"} aria-hidden="true" />
          {toolName(build)}
        </button>
      )}
      <span className="spacer" />
      {isFile && (
        <>
          <span className="status-item is-mono">
            {t("Ln {0}, Col {1}", cursor.line, cursor.col)}
            {cursor.selected > 0 && " " + t("({0} selected)", cursor.selected)}
          </span>
          <button type="button" className="status-item" onClick={() => openDialog({ kind: "settings" })}>
            {settings.insertSpaces ? t("Spaces: {0}", settings.tabSize) : t("Tab size: {0}", settings.tabSize)}
          </button>
          <span className="status-item">UTF-8</span>
          <span className="status-item">{doc?.eol === "crlf" ? "CRLF" : "LF"}</span>
          <span className="status-item">{lang?.name}</span>
        </>
      )}
      <button type="button" className="status-item" onClick={() => openDialog(jdk ? { kind: "settings" } : { kind: "installJdk" })} data-tooltip={jdk ? jdk.home : t("No JDK found")}>
        <Coffee size={13} aria-hidden="true" />
        {jdk ? `Java ${jdk.version}` : t("No JDK")}
      </button>
      {javaServer !== "off" && javaServer !== "missing" && (
        <button type="button" className="status-item" onClick={() => openDialog({ kind: "settings" })} data-tooltip={t("Java language server")}>
          <span className={`status-dot ${javaServer === "ready" ? "status-dot-online" : javaServer === "failed" ? "status-dot-warning" : "status-dot-busy"}`} aria-hidden="true" />
          {javaServer === "ready" ? "JDT LS" : javaServer === "failed" ? t("JDT LS stopped") : t("JDT LS starting…")}
        </button>
      )}
      {node && (
        <span className="status-item" data-tooltip={node.path}>
          <Hexagon size={13} aria-hidden="true" />
          Node {node.version.replace(/^v/, "")}
        </span>
      )}
    </footer>
  );
}
