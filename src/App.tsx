import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Code, FilePlus, Network } from "lucide-react";
import { set, setSettings, useStore, type Group } from "./lib/store";
import { focusGroup, init, newFile, openUml } from "./lib/actions";
import { handleShortcut } from "./lib/commands";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { previewUrl } from "./lib/api";
import { relative } from "./lib/paths";
import { t } from "./lib/i18n";
import { TitleBar } from "./components/TitleBar";
import { GuiDesigner } from "./gui/GuiDesigner";
import { NsdView } from "./nsd/NsdView";
import { Tour } from "./components/Tour";
import { TopBar } from "./components/TopBar";
import { ActivityRail } from "./components/ActivityRail";
import { Explorer } from "./components/Explorer";
import { SearchPanel } from "./components/SearchPanel";
import { OutlinePanel } from "./components/OutlinePanel";
import { Tabs } from "./components/Tabs";
import { Breadcrumbs, Editor } from "./components/Editor";
import { Preview } from "./components/Preview";
import { BottomPanel } from "./components/BottomPanel";
import { StatusBar } from "./components/StatusBar";
import { Welcome } from "./components/Welcome";
import { Dialogs } from "./components/Dialogs";
import { Palette } from "./components/Palette";
import { Toasts } from "./components/Toasts";
import { Resizer } from "./components/Resizer";
import { SplitDropArea } from "./components/SplitDrop";
import { Reveal } from "./components/Reveal";
import { UmlView } from "./uml/UmlView";
import { SourceControl } from "./components/SourceControl";
import { DiffView } from "./components/DiffView";
import { SequenceView } from "./uml/SequenceView";
import { DebugPanel } from "./components/DebugPanel";
import { initDebug } from "./lib/debug";
import { Menu } from "./components/ui/Menu";
import { TooltipLayer } from "./components/ui/Tooltip";
import { Button } from "./components/ui/Button";
import { EmptyState, Shortcut } from "./components/ui/Feedback";
import { cx } from "./lib/utils";

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
        title={t("No file open")}
        actions={
          <>
            <Button iconBefore={FilePlus} onClick={() => newFile(root)}>
              {t("New file")}
            </Button>
            <Button iconBefore={Network} onClick={() => openUml()}>
              {t("UML diagram")}
            </Button>
          </>
        }
      >
        {t("Pick a file in the explorer, or find one by name.")}
      </EmptyState>
      <div className="no-tabs-keys">
        <span>
          {t("Go to file")} <Shortcut keys="Ctrl+P" />
        </span>
        <span>
          {t("Commands")} <Shortcut keys="Ctrl+Shift+P" />
        </span>
        <span>
          {t("Run")} <Shortcut keys="F5" />
        </span>
        <span>
          {t("Split")} <Shortcut keys="Ctrl+\" />
        </span>
      </div>
    </div>
  );
}

/* One editor group: its tabs, breadcrumbs and whatever its active tab shows. */
function EditorGroup({ group }: { group: Group }) {
  const root = useStore((s) => s.root);
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.active[group]);
  const focused = useStore((s) => s.focusGroup === group);
  const mine = tabs.filter((x) => x.group === group);
  const active = mine.find((x) => x.id === activeId);
  const twoGroups = tabs.some((x) => x.group === 1);

  return (
    <section
      className={cx("stage panel", twoGroups && focused && "is-focused")}
      aria-label={group === 0 ? t("Editor") : t("Side editor")}
      onPointerDownCapture={() => focusGroup(group)}
    >
      {mine.length > 0 && <Tabs group={group} />}
      {active?.kind === "file" && active.path && <Breadcrumbs path={active.path} focused={focused} />}
      <div className="stage-body">
        <Editor group={group} visible={active?.kind === "file"} />
        {mine
          .filter((x) => x.kind === "uml")
          .map((x) => (
            <UmlView key={x.id} tabId={x.id} visible={active?.id === x.id} />
          ))}
        {mine.some((x) => x.kind === "sequence") && <SequenceView visible={active?.kind === "sequence"} />}
        {active?.kind === "image" && active.path && <ImageView path={active.path} />}
        {active?.kind === "diff" && <DiffView key={active.id} id={active.id} />}
        {active?.kind === "gui" && active.path && <GuiDesigner key={active.id} path={active.path} />}
        {active?.kind === "nsd" && <NsdView key={active.id} tab={active} />}
        {group === 0 && !root && <Welcome />}
        {group === 0 && root && mine.length === 0 && <NoTabs />}
      </div>
    </section>
  );
}

export default function App() {
  const root = useStore((s) => s.root);
  const sidebar = useStore((s) => s.sidebar);
  const hasSide = useStore((s) => s.tabs.some((x) => x.group === 1));
  const panelOpen = useStore((s) => s.panelOpen);
  const previewOpen = useStore((s) => s.previewOpen);
  const settings = useStore((s) => s.settings);
  const menu = useStore((s) => s.menu);
  const paletteOpen = useStore((s) => s.dialog?.kind === "palette");
  const theme = settings.theme;

  useEffect(() => {
    void init();
    void initDebug();
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
      const target = e.target as HTMLElement | null;
      const inEditor = !!target?.closest?.(".cm-editor");
      if (handleShortcut(e, inEditor, !!target?.closest?.(".xterm"))) return;
      // Rows that act on a click do the same on Enter or Space when they have the focus.
      if ((e.key === "Enter" || e.key === " ") && target?.matches?.("[data-key-click]") && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        target.click();
      }
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
  // While the side bar slides shut, it keeps showing the view it had.
  const lastView = useRef(sidebar);
  if (sidebar) lastView.current = sidebar;
  const view = sidebar ?? lastView.current;

  return (
    <div className="app">
      <TitleBar />
      <TopBar />
      <div className="workbench">
        <ActivityRail />
        <Reveal open={showSidebar} axis="x" from="start">
          <aside className="sidebar panel" style={{ width: settings.sidebarWidth }} aria-label={t("Side bar")}>
            {view === "explorer" && <Explorer />}
            {view === "search" && <SearchPanel />}
            {view === "outline" && <OutlinePanel />}
            {view === "debug" && <DebugPanel />}
            {view === "git" && <SourceControl />}
          </aside>
          <Resizer axis="x" size={settings.sidebarWidth} min={190} max={560} label={t("Side bar width")} onResize={(w) => setSettings({ sidebarWidth: w })} />
        </Reveal>
        <div className="center">
          <SplitDropArea>
            <EditorGroup group={0} />
            {hasSide && root && (
              <>
                <Resizer axis="x" size={settings.sideWidth} min={300} max={1400} invert label={t("Side editor width")} onResize={(w) => setSettings({ sideWidth: w })} />
                <div className="side-group" style={{ width: settings.sideWidth }}>
                  <EditorGroup group={1} />
                </div>
              </>
            )}
          </SplitDropArea>
          <Reveal open={panelOpen} axis="y" from="end">
            <Resizer axis="y" size={settings.panelHeight} min={110} max={720} invert label={t("Panel height")} onResize={(h) => setSettings({ panelHeight: h })} />
            <div className="bottom-wrap" style={{ height: settings.panelHeight }}>
              <BottomPanel />
            </div>
          </Reveal>
        </div>
        <Reveal open={previewOpen && !!root} axis="x" from="end">
          <Resizer axis="x" size={settings.previewWidth} min={280} max={1200} invert label={t("Preview width")} onResize={(w) => setSettings({ previewWidth: w })} />
          <div className="preview-wrap" style={{ width: settings.previewWidth }}>
            <Preview />
          </div>
        </Reveal>
      </div>
      <StatusBar />
      <Dialogs />
      <Tour />
      {paletteOpen && <Palette />}
      {menu && <Menu request={menu} onClose={() => set({ menu: null })} />}
      <TooltipLayer />
      <Toasts />
    </div>
  );
}
