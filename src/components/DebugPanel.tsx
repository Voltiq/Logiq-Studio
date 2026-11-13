import { useState } from "react";
import { ArrowDownToDot, ArrowRightToLine, ArrowUpFromDot, Bug, ChevronRight, CircleDot, Pause, Play, Plus, Square, Trash2, X } from "lucide-react";
import { useStore } from "../lib/store";
import { openFile } from "../lib/actions";
import { basename } from "../lib/paths";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";
import {
  addWatch,
  clearBreakpoints,
  pathOfClass,
  pause,
  removeBreakpoint,
  removeWatch,
  resume,
  selectFrame,
  startDebug,
  stepInto,
  stepOut,
  stepOver,
  stopDebug,
  toggleExpand,
  useDebug,
  type DebugVar,
} from "../lib/debug";
import { Button, IconButton } from "./ui/Button";
import { EmptyState } from "./ui/Feedback";

function VarRow({ v, depth }: { v: DebugVar; depth: number }) {
  const expanded = useDebug((s) => (v.id !== undefined ? !!s.expanded[v.id] : false));
  const children = useDebug((s) => (v.id !== undefined ? s.children[v.id] : undefined));
  const expandable = v.id !== undefined;
  return (
    <>
      <div className={cx("var-row", v.error && "is-error")} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => expandable && toggleExpand(v)} role={expandable ? "button" : undefined}>
        <span className={cx("tree-chevron", expanded && "is-open", !expandable && "is-hidden")} aria-hidden="true">
          <ChevronRight size={13} />
        </span>
        <span className="var-name">{v.name}</span>
        {v.type && <span className="var-type">{v.type}</span>}
        <span className="var-eq">=</span>
        <span className="var-value" title={v.value}>
          {v.value.replace(/ #\d+$/, "")}
        </span>
      </div>
      {expanded && children?.map((c, i) => <VarRow key={i} v={c} depth={depth + 1} />)}
      {expanded && !children && (
        <div className="var-row is-loading" style={{ paddingLeft: 26 + depth * 14 }}>
          …
        </div>
      )}
    </>
  );
}

/* The debugger's side bar: controls, call stack, variables, watches and breakpoints. */
export function DebugPanel() {
  const d = useDebug();
  const root = useStore((s) => s.root);
  const [watch, setWatch] = useState("");
  const paused = d.status === "paused";
  const running = d.status !== "off";
  const bps = Object.values(d.breakpoints).flatMap((b) => b.lines.map((l) => ({ path: b.path, line: l })));

  return (
    <div className="side-section debug-panel">
      <div className="side-head">
        <span className="side-title">{t("Debug")}</span>
      </div>
      <div className="debug-controls">
        {!running ? (
          <Button appearance="primary" spacing="compact" iconBefore={Bug} disabled={!root} onClick={() => void startDebug()}>
            {t("Start debugging")}
          </Button>
        ) : (
          <>
            {paused ? (
              <IconButton icon={Play} label={t("Continue")} shortcut="F8" spacing="compact" onClick={resume} />
            ) : (
              <IconButton icon={Pause} label={t("Pause")} spacing="compact" disabled={d.status !== "running"} onClick={pause} />
            )}
            <IconButton icon={ArrowRightToLine} label={t("Step over")} shortcut="F10" spacing="compact" disabled={!paused} onClick={stepOver} />
            <IconButton icon={ArrowDownToDot} label={t("Step into")} shortcut="F11" spacing="compact" disabled={!paused} onClick={stepInto} />
            <IconButton icon={ArrowUpFromDot} label={t("Step out")} shortcut="Shift+F11" spacing="compact" disabled={!paused} onClick={stepOut} />
            <IconButton icon={Square} label={t("Stop")} shortcut="Shift+F5" spacing="compact" onClick={() => void stopDebug()} />
            <span className="debug-status">{d.status === "starting" ? t("Starting…") : paused ? (d.reason === "exception" ? t("Stopped at an exception") : t("Paused")) : t("Running")}</span>
          </>
        )}
      </div>
      {d.exception && paused && <p className="debug-exception">{d.exception}</p>}

      <div className="debug-scroll">
        <h3 className="debug-heading">{t("Call stack")}</h3>
        {d.frames.length === 0 ? (
          <p className="debug-note">{running ? t("Running. Execution stops at breakpoints.") : t("Set breakpoints with F9 or a click left of the line numbers, then start debugging (F6).")}</p>
        ) : (
          d.frames.map((f, i) => {
            const path = pathOfClass(f.cls);
            return (
              <button key={i} type="button" className={cx("frame-row", i === d.frame && "is-current", !path && "is-library")} onClick={() => selectFrame(i)}>
                <span className="frame-method">
                  {f.cls.replace(/^.*\./, "")}.{f.method}
                </span>
                <span className="frame-where">
                  {f.source || "?"}:{f.line}
                </span>
              </button>
            );
          })
        )}

        {paused && (
          <>
            <h3 className="debug-heading">{t("Variables")}</h3>
            {d.variables.length === 0 && <p className="debug-note">{t("No variables here.")}</p>}
            {d.variables.map((v, i) => (
              <VarRow key={i} v={v} depth={0} />
            ))}
          </>
        )}

        <h3 className="debug-heading">{t("Watches")}</h3>
        <form
          className="watch-add"
          onSubmit={(e) => {
            e.preventDefault();
            addWatch(watch);
            setWatch("");
          }}
        >
          <input className="attr-input" value={watch} placeholder={t("Expression, like shapes[0].x")} aria-label={t("Add watch")} spellCheck={false} onChange={(e) => setWatch(e.target.value)} />
          <IconButton icon={Plus} label={t("Add watch")} spacing="compact" type="submit" />
        </form>
        {d.watches.map((w) => {
          const v = d.watchValues[w];
          return (
            <div key={w} className="watch-row">
              {v && paused ? <VarRow v={{ ...v, name: w }} depth={0} /> : <div className="var-row"><span className="var-name">{w}</span></div>}
              <IconButton icon={X} label={t("Remove watch")} spacing="compact" onClick={() => removeWatch(w)} />
            </div>
          );
        })}

        <h3 className="debug-heading">
          {t("Breakpoints")}
          {bps.length > 0 && <IconButton icon={Trash2} label={t("Remove all breakpoints")} spacing="compact" onClick={clearBreakpoints} />}
        </h3>
        {bps.length === 0 && <p className="debug-note">{t("None yet.")}</p>}
        {bps.map((b) => (
          <div key={`${b.path}:${b.line}`} className="bp-row">
            <CircleDot size={13} className="bp-dot" aria-hidden="true" />
            <button type="button" className="bp-where" onClick={() => void openFile(b.path, { line: b.line })}>
              {basename(b.path)}:{b.line}
            </button>
            <IconButton icon={X} label={t("Remove breakpoint")} spacing="compact" onClick={() => removeBreakpoint(b.path, b.line)} />
          </div>
        ))}
      </div>
      {!root && (
        <div className="side-empty">
          <EmptyState icon={Bug} title={t("No folder open")} compact />
        </div>
      )}
    </div>
  );
}
