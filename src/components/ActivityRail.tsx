import { Bug, Files, ListTree, Network, Search, Settings, SquareTerminal, type LucideIcon } from "lucide-react";
import { activeIdOf, openDialog, set, useStore, type SidebarView } from "../lib/store";
import { openUml, togglePanel } from "../lib/actions";
import { cx } from "../lib/utils";
import { useDebug } from "../lib/debug";
import { t } from "../lib/i18n";

function RailButton({ icon: Icon, label, shortcut, on, disabled, badge, onClick }: { icon: LucideIcon; label: string; shortcut?: string; on?: boolean; disabled?: boolean; badge?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cx("rail-tool", on && "is-on")}
      aria-label={label}
      aria-pressed={on}
      data-tooltip={label}
      data-tooltip-kbd={shortcut}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
      {!!badge && <span className="rail-badge">{badge > 99 ? "99+" : badge}</span>}
    </button>
  );
}

export function ActivityRail() {
  const sidebar = useStore((s) => s.sidebar);
  const root = useStore((s) => s.root);
  const umlOn = useStore((s) => activeIdOf(s) === "uml");
  const panelOpen = useStore((s) => s.panelOpen);
  const errors = useStore((s) => s.problems.filter((p) => p.severity === "error").length);
  const debugPaused = useDebug((s) => s.status === "paused");
  const pick = (v: SidebarView) => set((s) => ({ sidebar: s.sidebar === v ? null : v }));

  return (
    <aside className="rail" aria-label={t("Views")}>
      <RailButton icon={Files} label={t("Explorer")} shortcut="Ctrl+Shift+E" on={sidebar === "explorer"} onClick={() => pick("explorer")} />
      <RailButton icon={Search} label={t("Find in files")} shortcut="Ctrl+Shift+F" on={sidebar === "search"} disabled={!root} onClick={() => pick("search")} />
      <RailButton icon={ListTree} label={t("Outline")} on={sidebar === "outline"} disabled={!root} onClick={() => pick("outline")} />
      <RailButton icon={Bug} label={t("Debugger")} shortcut="Ctrl+Shift+D" on={sidebar === "debug"} disabled={!root} badge={debugPaused ? 1 : 0} onClick={() => pick("debug")} />
      <span className="rail-sep" />
      <RailButton icon={Network} label={t("UML class diagram")} shortcut="Ctrl+Shift+U" on={umlOn} disabled={!root} onClick={openUml} />
      <RailButton icon={SquareTerminal} label={t("Output and problems")} shortcut="Ctrl+J" on={panelOpen} badge={errors} onClick={() => togglePanel()} />
      <span className="rail-spacer" />
      <RailButton icon={Settings} label={t("Settings")} shortcut="Ctrl+," onClick={() => openDialog({ kind: "settings" })} />
    </aside>
  );
}
