import { CircleStop, Columns2, Hammer, Network, Play, Search } from "lucide-react";
import { COMMANDS, runCommand } from "../lib/commands";
import { get, openDialog, openMenu, useStore } from "../lib/store";
import type { MenuItem } from "./ui/Menu";
import { Button, IconButton } from "./ui/Button";
import { Spinner, Shortcut } from "./ui/Feedback";
import { languageFor } from "../editor/languages";

/** Menus are lists of command ids; "-" draws a separator. */
const MENUS: Record<string, string[]> = {
  File: ["file.newProject", "file.newFile", "file.newClass", "-", "file.openFolder", "file.openFile", "file.quickOpen", "-", "file.save", "file.saveAs", "file.saveAll", "-", "file.close", "file.closeAll", "file.closeFolder", "-", "file.settings"],
  Edit: ["edit.undo", "edit.redo", "-", "edit.find", "edit.findInFiles", "edit.gotoLine", "-", "edit.comment", "edit.format"],
  View: ["view.palette", "-", "view.explorer", "view.outline", "view.sidebar", "view.panel", "view.problems", "view.preview", "-", "uml.open", "uml.layout", "-", "view.zoomIn", "view.zoomOut", "view.zoomReset"],
  Run: ["run.run", "run.compile", "run.stop", "-", "run.output"],
  Help: ["help.shortcuts", "help.about"],
};

export function menuItems(ids: string[]): MenuItem[] {
  return ids.map((id) => {
    if (id === "-") return { type: "separator" as const };
    const c = COMMANDS.find((x) => x.id === id)!;
    return {
      label: c.label,
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
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const umlActive = activeTab?.kind === "uml";
  const lang = activeTab?.path ? languageFor(activeTab.path).id : null;
  const runLabel = lang === "html" ? "Preview" : "Run";

  return (
    <header className="topbar">
      <nav className="menubar" aria-label="Main menu">
        {Object.keys(MENUS).map((name) => (
          <button
            key={name}
            type="button"
            className="menubar-item"
            onClick={(e) => openMenu({ items: menuItems(MENUS[name]), anchor: e.currentTarget })}
          >
            {name}
          </button>
        ))}
      </nav>

      <button type="button" className="command-field" onClick={() => openDialog({ kind: "palette", mode: root ? "files" : "commands" })}>
        <Search size={15} aria-hidden="true" />
        <span>{root ? "Search files and commands" : "Search commands"}</span>
        <Shortcut keys="Ctrl+P" />
      </button>

      <div className="topbar-end">
        {run.status === "compiling" && (
          <span className="run-chip" role="status">
            <Spinner size={14} /> Compiling…
          </span>
        )}
        {run.status === "running" && (
          <span className="run-chip is-running" role="status">
            <span className="status-dot status-dot-online" aria-hidden="true" />
            {run.label}
          </span>
        )}
        <IconButton icon={Network} label="UML class diagram" shortcut="Ctrl+Shift+U" selected={umlActive} disabled={!root} onClick={() => runCommand("uml.open")} />
        <IconButton icon={Columns2} label="Web preview" shortcut="Ctrl+Shift+V" selected={previewOpen} disabled={!root} onClick={() => runCommand("view.preview")} />
        <span className="toolbar-divider" />
        <IconButton icon={Hammer} label="Compile Java" shortcut="Ctrl+F9" disabled={!root || run.status !== "idle"} onClick={() => runCommand("run.compile")} />
        {run.status === "running" ? (
          <Button appearance="danger" iconBefore={CircleStop} shortcut="Shift+F5" tooltip="Stop the program" onClick={() => runCommand("run.stop")}>
            Stop
          </Button>
        ) : (
          <Button
            appearance="primary"
            iconBefore={Play}
            shortcut="F5"
            tooltip={lang === "html" ? "Show this page in the preview" : "Compile and run"}
            disabled={!root || run.status !== "idle"}
            onClick={() => {
              if (get().run.status === "idle") runCommand("run.run");
            }}
          >
            {runLabel}
          </Button>
        )}
      </div>
    </header>
  );
}
