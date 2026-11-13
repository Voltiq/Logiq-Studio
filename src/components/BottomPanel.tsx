import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, CornerDownLeft, Eraser, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { clearOutput, openMenu, set, useStore } from "../lib/store";
import { TerminalPanel } from "./TerminalPanel";
import { clearTerminal, closeTerminal, loadShells, newTerminal, useTerminals } from "../lib/terminals";
import { openFile, sendInput } from "../lib/actions";
import { basename, relative } from "../lib/paths";
import { IconButton } from "./ui/Button";
import { Badge } from "./ui/Feedback";
import { cx } from "../lib/utils";
import { ShellPanel, TestsPanel } from "./ToolPanels";
import { useTests } from "../lib/tools";
import { t } from "../lib/i18n";

function Output() {
  const output = useStore((s) => s.output);
  const run = useStore((s) => s.run);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histPos, setHistPos] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const field = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [output]);

  useEffect(() => {
    // A program that starts gets the keyboard, so Scanner input can be typed right away.
    if (run.status === "running") field.current?.focus();
  }, [run.status]);

  const running = run.status === "running";
  return (
    <div className="output">
      <div
        ref={scroller}
        className="output-log"
        role="log"
        aria-label={t("Program output")}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        onClick={() => running && !window.getSelection()?.toString() && field.current?.focus()}
      >
        {output.length === 0 ? (
          <p className="output-empty">{t("Output of the programs you run appears here. Press F5 to compile and run.")}</p>
        ) : (
          output.map((c) => (
            <span key={c.id} className={`out-${c.kind}`}>
              {c.text}
            </span>
          ))
        )}
      </div>
      <form
        className={cx("output-input", !running && "is-disabled")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!running) return;
          void sendInput(input);
          if (input) setHistory((h) => [input, ...h.filter((x) => x !== input)].slice(0, 50));
          setHistPos(-1);
          setInput("");
        }}
      >
        <span className="output-prompt" aria-hidden="true">
          ›
        </span>
        <input
          ref={field}
          value={input}
          disabled={!running}
          spellCheck={false}
          aria-label={t("Input for the running program")}
          placeholder={running ? t("Type input for the program and press Enter") : t("Input is available while a program runs")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && history.length) {
              const p = Math.min(history.length - 1, histPos + 1);
              setHistPos(p);
              setInput(history[p]);
              e.preventDefault();
            } else if (e.key === "ArrowDown" && histPos >= 0) {
              const p = histPos - 1;
              setHistPos(p);
              setInput(p >= 0 ? history[p] : "");
              e.preventDefault();
            }
          }}
        />
        <IconButton icon={CornerDownLeft} label={t("Send")} spacing="compact" type="submit" disabled={!running} />
      </form>
    </div>
  );
}

function Problems() {
  const problems = useStore((s) => s.problems);
  const root = useStore((s) => s.root);
  if (!problems.length) return <p className="output-empty">{t("No problems. Compile Java with Ctrl+F9 or run with F5 to check your code.")}</p>;
  return (
    <div className="problems" role="list">
      {problems.map((p, i) => {
        const [first, ...rest] = p.message.split("\n");
        const Icon = p.severity === "error" ? CircleAlert : TriangleAlert;
        return (
          <button key={i} type="button" role="listitem" className="problem" onClick={() => void openFile(p.path, { line: p.line, col: p.column || 1 })}>
            <Icon size={15} className={`problem-icon is-${p.severity}`} aria-label={p.severity} />
            <span className="problem-text">
              <span className="problem-message">{first}</span>
              {rest.length > 0 && <span className="problem-detail">{rest.join(" · ")}</span>}
            </span>
            <span className="problem-where" data-tooltip={root ? relative(root, p.path) : p.path}>
              {basename(p.path)}:{p.line}
              {p.column ? `:${p.column}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function BottomPanel() {
  const tab = useStore((s) => s.panelTab);
  const problems = useStore((s) => s.problems);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.length - errors;
  const failedTests = useTests((s) => s.cases.filter((c) => c.status === "failed" || c.status === "error").length);
  const terminals = useTerminals((s) => s.tabs.length);
  const activeTerminal = useTerminals((s) => s.active);

  return (
    <section className="bottom panel" aria-label={t("Output and problems")}>
      <div className="bottom-head">
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "output"} className={cx("segment", tab === "output" && "is-selected")} onClick={() => set({ panelTab: "output" })}>
            {t("Output")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "problems"} className={cx("segment", tab === "problems" && "is-selected")} onClick={() => set({ panelTab: "problems" })}>
            {t("Problems")}
            {errors > 0 && <Badge appearance="danger">{errors}</Badge>}
            {warnings > 0 && <Badge>{warnings}</Badge>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "tests"} className={cx("segment", tab === "tests" && "is-selected")} onClick={() => set({ panelTab: "tests" })}>
            {t("Tests")}
            {failedTests > 0 && <Badge appearance="danger">{failedTests}</Badge>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "jshell"} className={cx("segment", tab === "jshell" && "is-selected")} onClick={() => set({ panelTab: "jshell" })}>
            JShell
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "terminal"}
            className={cx("segment", tab === "terminal" && "is-selected")}
            onClick={() => (useTerminals.getState().tabs.length ? set({ panelTab: "terminal" }) : void newTerminal())}
          >
            {t("Terminal")}
            {terminals > 1 && <Badge>{terminals}</Badge>}
          </button>
        </div>
        <span className="spacer" />
        {tab === "output" && <IconButton icon={Eraser} label={t("Clear output")} spacing="compact" onClick={clearOutput} />}
        {tab === "terminal" && (
          <>
            <IconButton icon={Plus} label={t("New terminal")} shortcut="Ctrl+Shift+`" spacing="compact" onClick={() => void newTerminal()} />
            <IconButton
              icon={ChevronDown}
              label={t("New terminal with…")}
              spacing="compact"
              onClick={async (e) => {
                const anchor = e.currentTarget;
                const shells = await loadShells();
                openMenu({ anchor, align: "end", items: shells.map((sh) => ({ label: sh.name, onSelect: () => void newTerminal(sh.id) })) });
              }}
            />
            <IconButton icon={Eraser} label={t("Clear terminal")} spacing="compact" disabled={activeTerminal === null} onClick={clearTerminal} />
            <IconButton icon={Trash2} label={t("Close terminal")} spacing="compact" disabled={activeTerminal === null} onClick={() => activeTerminal !== null && closeTerminal(activeTerminal)} />
          </>
        )}
        <IconButton icon={X} label={t("Close panel")} shortcut="Ctrl+J" spacing="compact" onClick={() => set({ panelOpen: false })} />
      </div>
      <div className="bottom-body">{tab === "output" ? <Output /> : tab === "problems" ? <Problems /> : tab === "tests" ? <TestsPanel /> : tab === "terminal" ? <TerminalPanel /> : <ShellPanel />}</div>
    </section>
  );
}
