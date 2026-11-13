import { useEffect, useMemo, useRef, useState } from "react";
import { CaseSensitive, ChevronRight, Regex, Search, WholeWord, X } from "lucide-react";
import { api, errorText } from "../lib/api";
import { useStore } from "../lib/store";
import { openFile } from "../lib/actions";
import { basename, dirname, relative } from "../lib/paths";
import type { SearchHit, SearchResult } from "../lib/types";
import { IconButton } from "./ui/Button";
import { Spinner } from "./ui/Feedback";
import { FileIcon } from "./FileIcon";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";

/* Find in files: results grouped by file, the match highlighted in its line. */
export function SearchPanel() {
  const root = useStore((s) => s.root);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [extensions, setExtensions] = useState<string[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const request = useStore((s) => s.searchRequest);

  useEffect(() => input.current?.focus(), []);

  // "Find usages" and other commands fill in the search.
  useEffect(() => {
    if (!request) return;
    setQuery(request.query);
    setMatchCase(request.matchCase);
    setWholeWord(request.wholeWord);
    setRegex(request.regex);
    setExtensions(request.extensions ?? null);
  }, [request?.nonce]);

  useEffect(() => {
    if (!root) return;
    const id = ++seq.current;
    if (!query) {
      setResult(null);
      setError(null);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(() => {
      api
        .search(root, { query, matchCase, wholeWord, regex })
        .then((r) => {
          if (seq.current !== id) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => seq.current === id && setError(errorText(e)))
        .finally(() => seq.current === id && setBusy(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [root, query, matchCase, wholeWord, regex]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of result?.hits ?? []) {
      if (extensions && !extensions.some((x) => h.path.toLowerCase().endsWith("." + x))) continue;
      const list = map.get(h.path) ?? [];
      list.push(h);
      map.set(h.path, list);
    }
    return [...map];
  }, [result, extensions]);
  const hitCount = groups.reduce((n, [, hits]) => n + hits.length, 0);

  return (
    <div className="side-section">
      <div className="side-head">
        <span className="side-title">{t("Find in files")}</span>
      </div>
      <div className="search-box">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            placeholder={t("Search")}
            aria-label={t("Search in files")}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setExtensions(null);
            }}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
          {busy && query ? <Spinner size={14} /> : query && <IconButton icon={X} label={t("Clear")} spacing="compact" onClick={() => setQuery("")} />}
        </label>
        <div className="search-toggles">
          <IconButton icon={CaseSensitive} label={t("Match case")} spacing="compact" selected={matchCase} onClick={() => setMatchCase(!matchCase)} />
          <IconButton icon={WholeWord} label={t("Whole word")} spacing="compact" selected={wholeWord} onClick={() => setWholeWord(!wholeWord)} />
          <IconButton icon={Regex} label={t("Regular expression")} spacing="compact" selected={regex} onClick={() => setRegex(!regex)} />
        </div>
      </div>
      {error && <p className="search-note is-error">{error}</p>}
      {result && !error && (
        <p className="search-note">
          {hitCount === 0
            ? t("No results.")
            : t("Results: {0}{1} in files: {2}", hitCount, result.truncated ? "+" : "", groups.length)}
          {extensions && <span className="search-scope"> · {t("only .{0} files", extensions.join(", ."))}</span>}
        </p>
      )}
      <div className="search-results">
        {groups.map(([path, hits]) => (
          <div key={path} className="search-group">
            <button type="button" className="search-file" onClick={() => setCollapsed((c) => ({ ...c, [path]: !c[path] }))}>
              <span className={cx("tree-chevron", !collapsed[path] && "is-open")} aria-hidden="true">
                <ChevronRight size={14} />
              </span>
              <FileIcon name={path} />
              <span className="search-file-name">{basename(path)}</span>
              <span className="search-file-dir">{root ? relative(root, dirname(path)) : ""}</span>
              <span className="badge">{hits.length}</span>
            </button>
            {!collapsed[path] &&
              hits.slice(0, 200).map((h, i) => {
                const at = h.column - h.previewStart;
                return (
                  <button key={i} type="button" className="search-hit" onClick={() => void openFile(h.path, { line: h.line, col: h.column + 1, length: h.length })}>
                    <span className="search-hit-line">{h.line}</span>
                    <span className="search-hit-text">
                      {h.preview.slice(0, Math.max(0, at)).trimStart()}
                      <mark>{h.preview.slice(at, at + h.length)}</mark>
                      {h.preview.slice(at + h.length)}
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
