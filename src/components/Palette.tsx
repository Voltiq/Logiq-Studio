import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search } from "lucide-react";
import { api } from "../lib/api";
import { closeDialog, get, useStore } from "../lib/store";
import { COMMANDS } from "../lib/commands";
import { goTo, openFile } from "../lib/actions";
import { basename, join } from "../lib/paths";
import { FileIcon } from "./FileIcon";
import { Shortcut } from "./ui/Feedback";
import { cx } from "../lib/utils";

/** Subsequence match with a score that prefers starts of words and the file name. */
export function fuzzy(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  let score = 0;
  let at = 0;
  let last = -2;
  for (const ch of q) {
    const i = s.indexOf(ch, at);
    if (i < 0) return null;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || /[\s/._-]/.test(s[i - 1]) || (text[i] >= "A" && text[i] <= "Z")) score += 2;
    last = i;
    at = i + 1;
  }
  return score - s.length * 0.01;
}

interface Item {
  key: string;
  label: string;
  detail?: string;
  shortcut?: string;
  file?: string;
  run: () => void;
}

/*
 * One field for everything: file names by default, `>` for commands and `:`
 * for a line number, as in other editors.
 */
export function Palette() {
  const d = useStore((s) => s.dialog);
  const root = useStore((s) => s.root);
  const initial = d?.kind === "palette" ? (d.mode === "commands" ? ">" : d.mode === "line" ? ":" : "") : "";
  const [query, setQuery] = useState(initial);
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    if (root) api.listFiles(root).then(setFiles).catch(() => setFiles([]));
  }, [root]);

  const mode = query.startsWith(">") ? "commands" : query.startsWith(":") ? "line" : "files";
  const q = mode === "files" ? query.trim() : query.slice(1).trim();

  const items: Item[] = useMemo(() => {
    if (mode === "line") {
      const n = parseInt(q, 10);
      return [{ key: "line", label: n ? `Go to line ${n}` : "Type a line number", run: () => n && goTo(n) }];
    }
    if (mode === "commands") {
      return COMMANDS.filter((c) => !c.enabled || c.enabled())
        .map((c) => ({ c, score: fuzzy(q, `${c.category}: ${c.label}`) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => (q ? b.score! - a.score! : 0))
        .map(({ c }) => ({ key: c.id, label: c.label.replace(/…$/, ""), detail: c.category, shortcut: c.shortcut, run: () => void c.run() }));
    }
    const open = get()
      .tabs.filter((t) => t.path)
      .map((t) => t.path!);
    return files
      .map((f) => ({ f, score: fuzzy(q, f) }))
      .filter((x) => x.score !== null)
      .map((x) => ({ ...x, score: x.score! + (fuzzy(q, basename(x.f)) ?? -5) * 2 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map(({ f }) => {
        const path = join(root!, f);
        return {
          key: f,
          label: basename(f),
          detail: f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "",
          file: f,
          run: () => void openFile(path),
          open: open.includes(path),
        };
      });
  }, [mode, q, files, root]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (d?.kind !== "palette") return null;

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    closeDialog();
    requestAnimationFrame(() => item.run());
  };

  return createPortal(
    <div className="palette-blanket" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <label className="palette-field">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            spellCheck={false}
            placeholder={root ? "Go to file, > for commands, : for a line" : "> Type a command"}
            aria-label="Search files and commands"
            onChange={(e) => setQuery(!root && !e.target.value.startsWith(">") && !e.target.value.startsWith(":") ? ">" + e.target.value : e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(items.length - 1, a + 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
              else if (e.key === "Enter") choose(active);
              else if (e.key === "Escape") closeDialog();
              else return;
              e.preventDefault();
            }}
          />
        </label>
        <div ref={list} className="palette-list" role="listbox">
          {items.length === 0 && <p className="palette-empty">{mode === "files" && !files.length ? "Loading files…" : "Nothing matches."}</p>}
          {items.map((item, i) => (
            <div
              key={item.key}
              role="option"
              aria-selected={i === active}
              className={cx("palette-item", i === active && "is-active")}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {item.file ? <FileIcon name={item.file} /> : <ChevronRight size={14} className="palette-chevron" aria-hidden="true" />}
              <span className="palette-label">{item.label}</span>
              {item.detail && <span className="palette-detail">{item.detail}</span>}
              {item.shortcut && <Shortcut keys={item.shortcut} />}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
