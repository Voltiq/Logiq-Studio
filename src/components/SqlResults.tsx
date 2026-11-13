import { CircleAlert, CircleCheck, Database, Play, Rows3 } from "lucide-react";
import { useSql, runSql, type SqlResult } from "../languages/sql";
import { ResultGrid } from "./ResultGrid";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/Feedback";
import { openFile } from "../lib/actions";
import { basename } from "../lib/paths";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";
import { getDoc } from "../editor/docs";

function summary(r: SqlResult): string {
  if (r.error) return t("Error");
  if (r.columns.length) return r.truncated ? t("{0}+ rows", r.rows.length.toLocaleString()) : r.rows.length === 1 ? t("1 row") : t("{0} rows", r.rows.length.toLocaleString());
  return r.changes === 1 ? t("1 row changed") : r.changes ? t("{0} rows changed", r.changes.toLocaleString()) : t("Done");
}

function firstWords(sql: string): string {
  const clean = sql
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 42 ? clean.slice(0, 40) + "…" : clean;
}

/* The Results panel: each statement of the last SQL run, and the rows of the one picked. */
export function SqlResults() {
  const { path, db, results, selected, running, sqliteVersion } = useSql();
  if (!path) {
    return (
      <div className="results-empty">
        <EmptyState icon={Database} title={t("No results yet")} compact>
          {t("Open a .sql file and run it with F5, or the statement at the cursor with Ctrl+Enter.")}
        </EmptyState>
      </div>
    );
  }
  const r = results[selected];
  const goTo = (x: SqlResult) => {
    const doc = getDoc(path);
    if (!doc) return void openFile(path);
    const line = doc.state.doc.lineAt(Math.min(x.from, doc.state.doc.length));
    void openFile(path, { line: line.number, col: x.from - line.from + 1 });
  };
  const total = results.reduce((n, x) => n + x.durationMs, 0);
  return (
    <div className="results">
      <div className="results-head">
        <Database size={14} aria-hidden="true" />
        <span className="results-db" data-tooltip={db ?? t("A fresh database in memory for each run")}>
          {db ? basename(db) : t("In memory")}
        </span>
        <span className="results-meta">
          {basename(path)} · {results.length === 1 ? t("1 statement") : t("{0} statements", results.length)} · {total} ms{sqliteVersion ? ` · SQLite ${sqliteVersion}` : ""}
        </span>
        <span className="spacer" />
        <Button spacing="compact" iconBefore={Play} onClick={() => void runSql(path)} disabled={running}>
          {running ? t("Running…") : t("Run again")}
        </Button>
      </div>
      <div className="results-body">
        {results.length > 1 && (
          <div className="results-list" role="listbox" aria-label={t("Statements")}>
            {results.map((x, i) => (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={i === selected}
                className={cx("results-item", i === selected && "is-selected", x.error && "is-error")}
                onClick={() => useSql.setState({ selected: i })}
                onDoubleClick={() => goTo(x)}
              >
                {x.error ? <CircleAlert size={13} aria-hidden="true" /> : x.columns.length ? <Rows3 size={13} aria-hidden="true" /> : <CircleCheck size={13} aria-hidden="true" />}
                <span className="results-item-sql">{firstWords(x.sql)}</span>
                <span className="results-item-count">{summary(x)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="results-main">
          {!r ? (
            <p className="output-empty">{running ? t("Running…") : t("Nothing ran.")}</p>
          ) : r.error ? (
            <div className="results-message is-error">
              <CircleAlert size={16} aria-hidden="true" />
              <div>
                <p className="results-message-title">{r.error}</p>
                <code className="results-sql">{firstWords(r.sql)}</code>
                <Button spacing="compact" appearance="subtle" onClick={() => goTo(r)}>
                  {t("Go to the statement")}
                </Button>
              </div>
            </div>
          ) : r.columns.length ? (
            <>
              <ResultGrid columns={r.columns} rows={r.rows} />
              {r.truncated && <p className="results-note">{t("Only the first {0} rows are shown.", r.rows.length.toLocaleString())}</p>}
            </>
          ) : (
            <div className="results-message">
              <CircleCheck size={16} aria-hidden="true" />
              <div>
                <p className="results-message-title">{summary(r)}</p>
                <code className="results-sql">{firstWords(r.sql)}</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
