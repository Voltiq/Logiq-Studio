import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CircleCheck, CircleMinus, CircleX, CornerDownLeft, Play, RotateCcw, Square } from "lucide-react";
import { openFile } from "../lib/actions";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";
import { runTests, shellSend, startShell, stopShell, useShell, useTests, type TestCase } from "../lib/tools";
import { javaIndex } from "../uml/javaIndex";
import { Button, IconButton } from "./ui/Button";
import { Spinner } from "./ui/Feedback";

function openTest(c: TestCase) {
  const type = javaIndex.types().find((x) => x.qualifiedName === c.cls);
  if (!type) return;
  const m = type.methods.find((x) => x.name === c.name);
  void openFile(type.path, { line: m?.line ?? type.line });
}

/* JUnit results: classes with their tests, failures with the message and where. */
export function TestsPanel() {
  const { status, cases, ranAt } = useTests();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const m = new Map<string, TestCase[]>();
    for (const c of cases) m.set(c.cls, [...(m.get(c.cls) ?? []), c]);
    return [...m];
  }, [cases]);
  const failed = cases.filter((c) => c.status === "failed" || c.status === "error").length;
  const passed = cases.filter((c) => c.status === "passed").length;

  return (
    <div className="tests">
      <div className="tests-bar">
        <Button spacing="compact" appearance="primary" iconBefore={Play} loading={status === "running"} onClick={() => void runTests()}>
          {t("Run all tests")}
        </Button>
        {failed > 0 && (
          <Button spacing="compact" iconBefore={RotateCcw} disabled={status === "running"} onClick={() => void runTests(cases.find((c) => c.status === "failed" || c.status === "error")?.cls)}>
            {t("Run failed class again")}
          </Button>
        )}
        {ranAt && (
          <span className={cx("tests-summary", failed ? "is-failed" : "is-passed")}>
            {failed ? t("{0} failed, {1} passed", failed, passed) : t("{0} passed", passed)}
          </span>
        )}
        {status === "running" && <Spinner size={14} label={t("Running")} />}
      </div>
      <div className="tests-list">
        {!ranAt && <p className="output-empty">{t("Write test classes with JUnit 5 (@Test methods), then run them here. The UML diagram's class menu creates one for a class.")}</p>}
        {groups.map(([cls, list]) => {
          const bad = list.some((c) => c.status === "failed" || c.status === "error");
          const isOpen = open[cls] ?? bad;
          return (
            <div key={cls}>
              <button type="button" className="test-row is-class" onClick={() => setOpen((o) => ({ ...o, [cls]: !isOpen }))}>
                <span className={cx("tree-chevron", isOpen && "is-open")} aria-hidden="true">
                  <ChevronRight size={13} />
                </span>
                {bad ? <CircleX size={14} className="test-icon is-failed" aria-hidden="true" /> : <CircleCheck size={14} className="test-icon is-passed" aria-hidden="true" />}
                <span>{cls.replace(/^.*\./, "")}</span>
                <span className="test-time">{list.reduce((n, c) => n + c.time, 0).toFixed(3)} s</span>
                <IconButton
                  icon={Play}
                  label={t("Run this class")}
                  spacing="compact"
                  onClick={(e) => {
                    e.stopPropagation();
                    void runTests(cls);
                  }}
                />
              </button>
              {isOpen &&
                list.map((c) => (
                  <div key={c.name} className="test-case">
                    <button type="button" className="test-row" onClick={() => openTest(c)}>
                      {c.status === "passed" ? (
                        <CircleCheck size={14} className="test-icon is-passed" aria-label={t("passed")} />
                      ) : c.status === "skipped" ? (
                        <CircleMinus size={14} className="test-icon" aria-label={t("skipped")} />
                      ) : (
                        <CircleX size={14} className="test-icon is-failed" aria-label={t("failed")} />
                      )}
                      <span>{c.name}</span>
                      <span className="test-time">{c.time.toFixed(3)} s</span>
                    </button>
                    {c.message && c.status !== "passed" && <p className="test-message">{c.message}</p>}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* JShell: try Java statements and the project's classes line by line. */
export function ShellPanel() {
  const { running, text, history } = useShell();
  const [input, setInput] = useState("");
  const [pos, setPos] = useState(-1);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [text]);
  useEffect(() => {
    if (running) field.current?.focus();
  }, [running]);

  return (
    <div className="output">
      <div className="output-log" ref={log} role="log" aria-label={t("JShell")} onClick={() => running && !window.getSelection()?.toString() && field.current?.focus()}>
        {text ? (
          <span className="out-stdout">{text}</span>
        ) : (
          <div className="output-empty">
            {t("JShell runs Java one line at a time: declarations, expressions and your own classes (they are compiled first).")}
            <div style={{ marginTop: 10 }}>
              <Button spacing="compact" appearance="primary" iconBefore={Play} onClick={() => void startShell()}>
                {t("Start JShell")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <form
        className={cx("output-input", !running && "is-disabled")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!running) return;
          void shellSend(input);
          setInput("");
          setPos(-1);
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
          aria-label={t("JShell input")}
          placeholder={running ? t("A Java expression or statement, or /help") : t("JShell isn't running")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && history.length) {
              const p = Math.min(history.length - 1, pos + 1);
              setPos(p);
              setInput(history[p]);
              e.preventDefault();
            } else if (e.key === "ArrowDown" && pos >= 0) {
              const p = pos - 1;
              setPos(p);
              setInput(p >= 0 ? history[p] : "");
              e.preventDefault();
            }
          }}
        />
        <IconButton icon={CornerDownLeft} label={t("Send")} spacing="compact" type="submit" disabled={!running} />
        {running ? (
          <IconButton icon={Square} label={t("Stop JShell")} spacing="compact" onClick={() => void stopShell()} />
        ) : (
          text && <IconButton icon={RotateCcw} label={t("Start JShell again")} spacing="compact" onClick={() => void startShell()} />
        )}
      </form>
    </div>
  );
}
