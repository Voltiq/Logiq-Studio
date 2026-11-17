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
import { t } from "../lib/i18n";
import { fuzzy } from "../lib/fuzzy";

export { fuzzy };

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
      return [{ key: "line", label: n ? t("Go to line {0}", n) : t("Type a line number"), run: () => n && goTo(n) }];
    }
    if (mode === "commands") {
      return COMMANDS.filter((c) => !c.enabled || c.enabled())
        .map((c) => ({ c, score: fuzzy(q, `${t(c.category)}: ${t(c.label)} ${c.label}`) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => (q ? b.score! - a.score! : 0))
        .map(({ c }) => ({ key: c.id, label: t(c.label).replace(/…$/, ""), detail: t(c.category), shortcut: c.shortcut, run: () => void c.run() }));
    }
    const open = get()
      .tabs.filter((x) => x.path)
      .map((x) => x.path!);
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
      <div className="palette" role="dialog" aria-label={t("Command palette")}>
        <label className="palette-field">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            spellCheck={false}
            placeholder={root ? t("Go to file, > for commands, : for a line") : t("> Type a command")}
            aria-label={t("Search files and commands")}
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
          {items.length === 0 && <p className="palette-empty">{mode === "files" && !files.length ? t("Loading files…") : t("Nothing matches.")}</p>}
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
