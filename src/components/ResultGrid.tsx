import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { SqlColumn, SqlValue } from "../languages/sql";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";

/*
 * Atomiq Studio's result grid, read-only: only the rows in view are drawn,
 * columns size to their content and can be dragged wider, a header click
 * sorts (Shift+click adds a column), arrows move, Shift extends the
 * selection, Ctrl+C copies cells or rows as tab-separated text.
 */

const ROW_H = 28;
const HEADER_H = 34;
const GUTTER_W = 56;
const OVERSCAN = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A cell as one line of text, the way the grid shows it. */
export function cellText(v: SqlValue): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.length > 400 ? v.slice(0, 400) : v.replace(/\r?\n/g, " ↵ ");
  return `0x${v.hex}${v.blob > 32 ? "…" : ""} (${v.blob} B)`;
}

function copyText(v: SqlValue): string {
  if (v === null) return "";
  if (typeof v === "object") return `0x${v.hex}`;
  return String(v);
}

function estimateWidth(col: SqlColumn, rows: SqlValue[][], index: number): number {
  let longest = col.name.length + col.declType.length * 0.8 + 4;
  for (let r = 0; r < Math.min(rows.length, 60); r++) longest = Math.max(longest, Math.min(cellText(rows[r][index]).length, 48));
  return clamp(Math.round(longest * 7.4 + 28), 72, 380);
}

function compare(a: SqlValue, b: SqlValue): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return copyText(a).localeCompare(copyText(b), undefined, { numeric: true });
}

interface Cell {
  row: number;
  col: number;
}

export function ResultGrid({ columns, rows }: { columns: SqlColumn[]; rows: SqlValue[][] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [active, setActive] = useState<Cell | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 }[]>([]);

  const columnKey = columns.map((c) => c.name).join("\u0001");
  useEffect(() => {
    setWidths(columns.map((c, i) => estimateWidth(c, rows, i)));
    setActive(null);
    setSelected(new Set());
    setSort([]);
    // Only when the columns change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!sort.length) return idx;
    return idx.sort((a, b) => {
      for (const s of sort) {
        const c = compare(rows[a][s.col], rows[b][s.col]);
        if (c) return c * s.dir;
      }
      return a - b;
    });
  }, [rows, sort]);

  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = GUTTER_W;
    for (let i = 0; i < columns.length; i++) {
      out.push(x);
      x += widths[i] ?? 120;
    }
    out.push(x);
    return out;
  }, [columns.length, widths]);
  const totalWidth = lefts[lefts.length - 1] ?? GUTTER_W;
  const numeric = useMemo(() => columns.map((_, c) => rows.slice(0, 50).some((r) => typeof r[c] === "number") && rows.slice(0, 50).every((r) => r[c] === null || typeof r[c] === "number")), [columns, rows]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);
  const valueAt = (r: number, c: number) => rows[order[r]]?.[c] ?? null;

  function scrollIntoView(cell: Cell) {
    const el = scroller.current;
    if (!el) return;
    const top = cell.row * ROW_H;
    const bodyH = el.clientHeight - HEADER_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + bodyH) el.scrollTop = top + ROW_H - bodyH;
    const left = lefts[cell.col] - GUTTER_W;
    const right = lefts[cell.col + 1];
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }

  function moveTo(cell: Cell, extend = false) {
    if (!rows.length || !columns.length) return;
    const next = { row: clamp(cell.row, 0, rows.length - 1), col: clamp(cell.col, 0, columns.length - 1) };
    setActive(next);
    if (extend && anchor !== null) {
      const [a, b] = [Math.min(anchor, next.row), Math.max(anchor, next.row)];
      setSelected(new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i)));
    } else {
      setAnchor(next.row);
      setSelected(new Set([next.row]));
    }
    scrollIntoView(next);
  }

  function copy() {
    const list = selected.size ? [...selected].sort((a, b) => a - b) : active ? [active.row] : [];
    if (!list.length) return;
    const text =
      list.length === 1 && active
        ? copyText(valueAt(active.row, active.col))
        : [columns.map((c) => c.name).join("\t"), ...list.map((r) => columns.map((_, c) => copyText(valueAt(r, c)).replace(/[\t\n\r]/g, " ")).join("\t"))].join("\n");
    void navigator.clipboard.writeText(text);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const cur = active ?? { row: 0, col: 0 };
    const page = Math.max(1, Math.floor((viewport - HEADER_H) / ROW_H) - 1);
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo({ ...cur, row: active ? cur.row + 1 : 0 }, e.shiftKey),
      ArrowUp: () => moveTo({ ...cur, row: cur.row - 1 }, e.shiftKey),
      ArrowRight: () => moveTo({ ...cur, col: cur.col + 1 }),
      ArrowLeft: () => moveTo({ ...cur, col: cur.col - 1 }),
      PageDown: () => moveTo({ ...cur, row: cur.row + page }, e.shiftKey),
      PageUp: () => moveTo({ ...cur, row: cur.row - page }, e.shiftKey),
      Home: () => moveTo(mod ? { row: 0, col: 0 } : { ...cur, col: 0 }),
      End: () => moveTo(mod ? { row: rows.length - 1, col: columns.length - 1 } : { ...cur, col: columns.length - 1 }),
    };
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copy();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(rows.map((_, i) => i)));
      return;
    }
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  }

  function onRowPointerDown(e: React.MouseEvent, row: number, col: number | null) {
    if (col !== null) setActive({ row, col });
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, row), Math.max(anchor, row)];
      setSelected(new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i)));
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      setSelected(next);
      setAnchor(row);
    } else {
      setSelected(new Set([row]));
      setAnchor(row);
    }
  }

  function startResize(e: React.PointerEvent, col: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[col] ?? 120;
    const move = (ev: PointerEvent) => setWidths((all) => all.map((x, i) => (i === col ? clamp(startW + ev.clientX - startX, 48, 1200) : x)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function toggleSort(col: number, additive: boolean) {
    setSort((s) => {
      const i = s.findIndex((x) => x.col === col);
      const next: { col: number; dir: 1 | -1 } | null = i < 0 ? { col, dir: 1 } : s[i].dir === 1 ? { col, dir: -1 } : null;
      const rest = additive ? s.filter((x) => x.col !== col) : [];
      return next ? [...rest, next] : rest;
    });
  }

  const visible: React.ReactNode[] = [];
  for (let r = first; r < last; r++) {
    const isSelected = selected.has(r);
    visible.push(
      <div
        key={r}
        className={cx("grid-row", isSelected && "is-selected", r % 2 === 1 && "is-odd")}
        style={{ transform: `translateY(${HEADER_H + r * ROW_H}px)`, width: totalWidth }}
        role="row"
        aria-rowindex={r + 2}
      >
        <div className="grid-gutter" role="rowheader" onPointerDown={(e) => onRowPointerDown(e, r, null)}>
          {(order[r] + 1).toLocaleString()}
        </div>
        {columns.map((_, c) => {
          const v = valueAt(r, c);
          return (
            <div
              key={c}
              role="gridcell"
              className={cx("grid-cell", v === null && "is-null", numeric[c] && "is-number", v !== null && typeof v === "object" && "is-special", active?.row === r && active.col === c && "is-active")}
              style={{ left: lefts[c], width: widths[c] }}
              onPointerDown={(e) => onRowPointerDown(e, r, c)}
            >
              <span className="grid-text">{cellText(v)}</span>
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div ref={scroller} className="grid" tabIndex={0} role="grid" aria-rowcount={rows.length + 1} aria-colcount={columns.length} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
      <div className="grid-inner" style={{ width: totalWidth, height: HEADER_H + rows.length * ROW_H }}>
        <div className="grid-header" style={{ width: totalWidth, height: HEADER_H }} role="row">
          <div className="grid-gutter grid-corner" aria-hidden="true" />
          {columns.map((col, c) => {
            const i = sort.findIndex((s) => s.col === c);
            const s = i < 0 ? null : sort[i];
            return (
              <div
                key={c}
                role="columnheader"
                aria-sort={s ? (s.dir === 1 ? "ascending" : "descending") : undefined}
                className={cx("grid-head", "is-sortable", numeric[c] && "is-number")}
                style={{ left: lefts[c], width: widths[c] }}
                onClick={(e) => toggleSort(c, e.shiftKey)}
                data-tooltip={`${col.name}${col.declType ? ` · ${col.declType}` : ""} — ${t("click to sort")}`}
              >
                <span className="grid-head-name">{col.name}</span>
                {col.declType && <span className="grid-head-type">{col.declType.toLowerCase()}</span>}
                {s && (
                  <span className="grid-sort">
                    {s.dir === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}
                    {sort.length > 1 ? i + 1 : null}
                  </span>
                )}
                <span className="grid-resize" onPointerDown={(e) => startResize(e, c)} onClick={(e) => e.stopPropagation()} />
              </div>
            );
          })}
        </div>
        {visible}
      </div>
      {rows.length === 0 && <div className="grid-empty">{t("No rows")}</div>}
    </div>
  );
}
