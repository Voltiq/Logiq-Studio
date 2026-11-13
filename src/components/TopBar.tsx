import { ArrowDownToDot, ArrowRightToLine, ArrowUpFromDot, Bug, ChevronDown, CircleStop, Columns2, Hammer, Network, Pause, Play, Search, StepForward } from "lucide-react";
import { pause as pauseDebug, useDebug } from "../lib/debug";
import { COMMANDS, runCommand } from "../lib/commands";
import { activeTab, get, openDialog, openMenu, useStore } from "../lib/store";
import type { MenuItem } from "./ui/Menu";
import { Button, IconButton } from "./ui/Button";
import { Spinner, Shortcut } from "./ui/Feedback";
import { languageFor } from "../editor/languages";
import { t } from "../lib/i18n";

/** Menus are lists of command ids; "-" draws a separator. */
const MENUS: Record<string, string[]> = {
  File: ["file.newProject", "file.newFile", "file.newClass", "-", "file.openFolder", "file.openFile", "file.quickOpen", "-", "file.save", "file.saveAs", "file.saveAll", "-", "file.close", "file.closeAll", "file.closeFolder", "-", "file.settings"],
  Edit: ["edit.undo", "edit.redo", "-", "edit.find", "edit.findInFiles", "edit.gotoLine", "-", "edit.definition", "edit.usages", "edit.rename", "edit.quickfix", "edit.organizeImports", "-", "edit.comment", "edit.format", "edit.emmet"],
  View: ["view.palette", "-", "view.explorer", "view.outline", "view.sidebar", "view.panel", "view.problems", "view.preview", "-", "view.split", "view.focusOther", "-", "uml.open", "uml.side", "uml.layout", "-", "view.zoomIn", "view.zoomOut", "view.zoomReset"],
  Run: ["run.run", "run.debug", "run.trace", "run.compile", "run.stop", "-", "debug.continue", "debug.over", "debug.into", "debug.out", "debug.breakpoint", "-", "run.tests", "run.jshell", "-", "run.config", "project.libraries", "-", "build.jar", "build.javadoc", "-", "run.output"],
  Help: ["help.shortcuts", "help.jdk", "help.about"],
};

export function menuItems(ids: string[]): MenuItem[] {
  return ids.map((id) => {
    if (id === "-") return { type: "separator" as const };
    const c = COMMANDS.find((x) => x.id === id)!;
    return {
      label: t(c.label),
      icon: c.icon,
      shortcut: c.shortcut,
      disabled: c.enabled ? !c.enabled() : false,
      onSelect: () => runCommand(id),
    };
  });
}

export function TopBar() {
  const root = useStore((s) => s.root);
  const run = useStore((s) => s.run);
  const previewOpen = useStore((s) => s.previewOpen);
  const current = useStore((s) => activeTab(s));
  const umlActive = current?.kind === "uml";
  const lang = current?.path ? languageFor(current.path).id : null;
  const debugStatus = useDebug((s) => s.status);
  const debugging = debugStatus !== "off" && !useDebug.getState().tracing;
  const runLabel = lang === "html" || lang === "markdown" ? t("Preview") : t("Run");

  return (
    <header className="topbar">
      <nav className="menubar" aria-label={t("Main menu")}>
        {Object.keys(MENUS).map((name) => (
          <button
            key={name}
            type="button"
            className="menubar-item"
            onClick={(e) => openMenu({ items: menuItems(MENUS[name]), anchor: e.currentTarget })}
          >
            {t(name)}
          </button>
        ))}
      </nav>

      <button type="button" className="command-field" onClick={() => openDialog({ kind: "palette", mode: root ? "files" : "commands" })}>
        <Search size={15} aria-hidden="true" />
        <span>{root ? t("Search files and commands") : t("Search commands")}</span>
        <Shortcut keys="Ctrl+P" />
      </button>

      <div className="topbar-end">
        {run.status === "compiling" && (
          <span className="run-chip" role="status">
            <Spinner size={14} /> Compiling…
          </span>
        )}
        {run.status === "running" && !debugging && (
          <span className="run-chip is-running" role="status">
            <span className="status-dot status-dot-online" aria-hidden="true" />
            {run.label}
          </span>
        )}
        <IconButton icon={Network} label={t("UML class diagram")} shortcut="Ctrl+Shift+U" selected={umlActive} disabled={!root} onClick={() => runCommand("uml.open")} />
        <IconButton icon={Columns2} label={t("Web preview")} shortcut="Ctrl+Shift+V" selected={previewOpen} disabled={!root} onClick={() => runCommand("view.preview")} />
        <span className="toolbar-divider" />
        {debugging ? (
          <div className="debug-bar" role="toolbar" aria-label={t("Debugger")}>
            {debugStatus === "paused" ? (
              <IconButton icon={StepForward} label={t("Continue")} shortcut="F8" spacing="compact" onClick={() => runCommand("debug.continue")} />
            ) : (
              <IconButton icon={Pause} label={t("Pause")} spacing="compact" onClick={() => void pauseDebug()} />
            )}
            <IconButton icon={ArrowRightToLine} label={t("Step over")} shortcut="F10" spacing="compact" disabled={debugStatus !== "paused"} onClick={() => runCommand("debug.over")} />
            <IconButton icon={ArrowDownToDot} label={t("Step into")} shortcut="F11" spacing="compact" disabled={debugStatus !== "paused"} onClick={() => runCommand("debug.into")} />
            <IconButton icon={ArrowUpFromDot} label={t("Step out")} shortcut="Shift+F11" spacing="compact" disabled={debugStatus !== "paused"} onClick={() => runCommand("debug.out")} />
          </div>
        ) : (
          <IconButton icon={Bug} label={t("Start debugging")} shortcut="F6" disabled={!root || run.status !== "idle"} onClick={() => runCommand("run.debug")} />
        )}
        <IconButton icon={Hammer} label={t("Compile Java")} shortcut="Ctrl+F9" disabled={!root || run.status !== "idle"} onClick={() => runCommand("run.compile")} />
        {run.status === "running" ? (
          <Button appearance="danger" iconBefore={CircleStop} shortcut="Shift+F5" tooltip={t("Stop the program")} onClick={() => runCommand("run.stop")}>
            {t("Stop")}
          </Button>
        ) : (
          <Button
            appearance="primary"
            iconBefore={Play}
            shortcut="F5"
            tooltip={lang === "html" || lang === "markdown" ? t("Show this page in the preview") : t("Compile and run")}
            disabled={!root || run.status !== "idle"}
            onClick={() => {
              if (get().run.status === "idle") runCommand("run.run");
            }}
          >
            {runLabel}
          </Button>
        )}
        <IconButton icon={ChevronDown} label={t("Run options")} spacing="compact" disabled={!root} onClick={(e) => openMenu({ items: menuItems(["run.config", "run.trace", "run.tests", "run.jshell", "-", "build.jar", "build.javadoc", "project.libraries"]), anchor: e.currentTarget, align: "end" })} />
      </div>
    </header>
  );
}
