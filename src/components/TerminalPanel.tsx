import { useEffect, useRef } from "react";
import { SquareTerminal, X } from "lucide-react";
import { attach, closeTerminal, detach, fitNow, newTerminal, showTerminal, useTerminals } from "../lib/terminals";
import { useStore } from "../lib/store";
import { Button } from "./ui/Button";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";

/** The terminal tab of the bottom panel: the active terminal, and a list when there are several. */
export function TerminalPanel() {
  const tabs = useTerminals((s) => s.tabs);
  const active = useTerminals((s) => s.active);
  const panelHeight = useStore((s) => s.settings.panelHeight);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active === null || !host.current) return;
    attach(active, host.current);
    return () => detach(active);
  }, [active]);

  // The terminal follows the panel's size.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitNow(useTerminals.getState().active));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length > 0]);

  useEffect(() => fitNow(active), [panelHeight, active]);

  if (!tabs.length) {
    return (
      <div className="terminal-empty">
        <p className="output-empty">{t("A terminal runs a shell in the project folder, with the JDK Logiq Studio uses on the path.")}</p>
        <Button iconBefore={SquareTerminal} onClick={() => void newTerminal()}>
          {t("New terminal")}
        </Button>
      </div>
    );
  }
  return (
    <div className="terminal">
      <div ref={host} className="terminal-host" />
      {tabs.length > 1 && (
        <div className="terminal-list" role="tablist" aria-label={t("Terminals")} aria-orientation="vertical">
          {tabs.map((x) => (
            <div key={x.id} className={cx("terminal-item", x.id === active && "is-active", x.exited && "is-exited")}>
              <button type="button" role="tab" aria-selected={x.id === active} className="terminal-item-name" onClick={() => showTerminal(x.id)}>
                <SquareTerminal size={13} aria-hidden="true" />
                <span>{x.title}</span>
              </button>
              <button type="button" className="terminal-item-close" aria-label={t("Close terminal")} data-tooltip={t("Close terminal")} onClick={() => closeTerminal(x.id)}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
