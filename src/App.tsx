import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Code, FilePlus, Network } from "lucide-react";
import { set, setSettings, useStore } from "./lib/store";
import { init, newFile, openUml } from "./lib/actions";
import { handleShortcut } from "./lib/commands";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { previewUrl } from "./lib/api";
import { relative } from "./lib/paths";
import { TitleBar } from "./components/TitleBar";
import { TopBar } from "./components/TopBar";
import { ActivityRail } from "./components/ActivityRail";
import { Explorer } from "./components/Explorer";
import { SearchPanel } from "./components/SearchPanel";
import { OutlinePanel } from "./components/OutlinePanel";
import { Tabs } from "./components/Tabs";
import { Editor } from "./components/Editor";
import { Preview } from "./components/Preview";
import { BottomPanel } from "./components/BottomPanel";
import { StatusBar } from "./components/StatusBar";
import { Welcome } from "./components/Welcome";
import { Dialogs } from "./components/Dialogs";
import { Palette } from "./components/Palette";
import { Toasts } from "./components/Toasts";
import { Resizer } from "./components/Resizer";
import { UmlView } from "./uml/UmlView";
import { Menu } from "./components/ui/Menu";
import { TooltipLayer } from "./components/ui/Tooltip";
import { Button } from "./components/ui/Button";
import { EmptyState, Shortcut } from "./components/ui/Feedback";

function ImageView({ path }: { path: string }) {
  const root = useStore((s) => s.root);
  return (
    <div className="image-view">
      <img src={previewUrl(root ? relative(root, path) : path)} alt={path} />
    </div>
  );
}

function NoTabs() {
  const root = useStore((s) => s.root)!;
  return (
    <div className="no-tabs">
      <EmptyState
        icon={Code}
        title="No file open"
        actions={
          <>
            <Button iconBefore={FilePlus} onClick={() => newFile(root)}>
              New file
            </Button>
            <Button iconBefore={Network} onClick={openUml}>
              UML diagram
            </Button>
          </>
        }
      >
        Pick a file in the explorer, or find one by name.
      </EmptyState>
      <div className="no-tabs-keys">
        <span>
          Go to file <Shortcut keys="Ctrl+P" />
        </span>
        <span>
          Commands <Shortcut keys="Ctrl+Shift+P" />
        </span>
        <span>
          Run <Shortcut keys="F5" />
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const root = useStore((s) => s.root);
  const sidebar = useStore((s) => s.sidebar);
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeId);
  const panelOpen = useStore((s) => s.panelOpen);
  const previewOpen = useStore((s) => s.previewOpen);
  const settings = useStore((s) => s.settings);
  const menu = useStore((s) => s.menu);
  const paletteOpen = useStore((s) => s.dialog?.kind === "palette");
  const theme = settings.theme;

  const active = tabs.find((t) => t.id === activeId);
  const umlOpen = tabs.some((t) => t.kind === "uml");

  useEffect(() => {
    void init();
  }, []);

  // Theme: apply, then show the window (it starts hidden to avoid a white flash).
  useEffect(() => {
    applyTheme(theme).finally(() => getCurrentWindow().show().catch(() => {}));
    if (theme !== "system") return;
    return watchSystemTheme(() => void applyTheme("system"));
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().dialog) return;
      const inEditor = !!(e.target as HTMLElement | null)?.closest?.(".cm-editor");
      handleShortcut(e, inEditor);
    };
    // Capture, so the editor doesn't eat Ctrl+P, F5 and the like first.
    window.addEventListener("keydown", onKey, true);
    const noMenu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, .cm-editor")) e.preventDefault();
    };
    window.addEventListener("contextmenu", noMenu);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  const showSidebar = !!root && !!sidebar;

  return (
    <div className="app">
      <TitleBar />
      <TopBar />
      <div className="workbench">
        <ActivityRail />
        {showSidebar && (
          <>
            <aside className="sidebar panel" style={{ width: settings.sidebarWidth }} aria-label="Side bar">
              {sidebar === "explorer" && <Explorer />}
              {sidebar === "search" && <SearchPanel />}
              {sidebar === "outline" && <OutlinePanel />}
            </aside>
            <Resizer axis="x" size={settings.sidebarWidth} min={190} max={560} label="Side bar width" onResize={(w) => setSettings({ sidebarWidth: w })} />
          </>
        )}
        <div className="center">
          <section className="stage panel" aria-label="Editor">
            {tabs.length > 0 && <Tabs />}
            <div className="stage-body">
              <Editor visible={active?.kind === "file"} />
              {umlOpen && <UmlView visible={active?.kind === "uml"} />}
              {active?.kind === "image" && active.path && <ImageView path={active.path} />}
              {!root && <Welcome />}
              {root && tabs.length === 0 && <NoTabs />}
            </div>
          </section>
          {panelOpen && (
            <>
              <Resizer axis="y" size={settings.panelHeight} min={110} max={720} invert label="Panel height" onResize={(h) => setSettings({ panelHeight: h })} />
              <div className="bottom-wrap" style={{ height: settings.panelHeight }}>
                <BottomPanel />
              </div>
            </>
          )}
        </div>
        {previewOpen && root && (
          <>
            <Resizer axis="x" size={settings.previewWidth} min={280} max={1200} invert label="Preview width" onResize={(w) => setSettings({ previewWidth: w })} />
            <div className="preview-wrap" style={{ width: settings.previewWidth }}>
              <Preview />
            </div>
          </>
        )}
      </div>
      <StatusBar />
      <Dialogs />
      {paletteOpen && <Palette />}
      {menu && <Menu request={menu} onClose={() => set({ menu: null })} />}
      <TooltipLayer />
      <Toasts />
    </div>
  );
}
