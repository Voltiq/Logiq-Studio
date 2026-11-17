import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  CornerDownLeft,
  FileDown,
  FilePlus2,
  GitBranch,
  ImageDown,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Repeat,
  RotateCcw,
  SquareFunction,
  Rows3,
  Split,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { get, openDialog, toast, type Tab } from "../lib/store";
import { api, errorText } from "../lib/api";
import { getDoc } from "../editor/docs";
import { watchDoc } from "../lib/actions";
import { dirname, join, stem } from "../lib/paths";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/Feedback";
import { Select } from "../components/ui/Select";
import { exportPng } from "../uml/exportDiagram";
import { javaMethods, nsdOfMethod } from "./fromJava";
import { blockAt, fromFile, insertAfter, moveBlock, newBlock, removeBlock, replaceBlock, samePlace, textOf, toFile, withText, type BlockKind, type ListPath, type Nsd, type Place } from "./model";
import { layoutNsd, toSvg, type Item } from "./layout";
import { newNsd, openNsdOfMethod, parseNsdId } from "./open";

const CODE_FONT = '12.5px "Geist Mono Variable", "Geist Mono", Consolas, monospace';
let canvas: CanvasRenderingContext2D | null = null;
function measure(s: string): number {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return s.length * 7.5;
  canvas.font = CODE_FONT;
  return canvas.measureText(s).width;
}

const INSERT: { kind: BlockKind; icon: typeof Plus; label: () => string }[] = [
  { kind: "action", icon: Rows3, label: () => t("Statement") },
  { kind: "if", icon: Split, label: () => t("Decision (if)") },
  { kind: "switch", icon: GitBranch, label: () => t("Multiple choice (switch)") },
  { kind: "while", icon: Repeat, label: () => t("Loop, tested first (while, for)") },
  { kind: "repeat", icon: RotateCcw, label: () => t("Loop, tested last (do … while)") },
  { kind: "call", icon: SquareFunction, label: () => t("Call") },
  { kind: "exit", icon: CornerDownLeft, label: () => t("Exit (return, break)") },
];

type Selection = { place: Place } | { slot: ListPath } | null;

/* A Nassi–Shneiderman diagram: of a Java method (following its code), or of a .nsd file (drawn here). */
export function NsdView({ tab }: { tab: Tab }) {
  const source = useMemo(() => parseNsdId(tab.id), [tab.id]);
  const editable = !!source && "file" in source;
  const [nsd, setNsd] = useState<Nsd | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [zoom, setZoom] = useState(1);
  const history = useRef<{ back: Nsd[]; forward: Nsd[] }>({ back: [], forward: [] });
  const saveTimer = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const [methods, setMethods] = useState<{ signature: string }[]>([]);

  // Loading: from the file, or drawn again from the method whenever its code changes.
  useEffect(() => {
    if (!source) return;
    if ("file" in source) {
      api
        .readText(source.file)
        .then((f) => {
          setNsd(fromFile(f.text, stem(source.file)));
          setProblem(null);
        })
        .catch((e) => setProblem(errorText(e)));
      return;
    }
    let timer = 0;
    const draw = async () => {
      const text = getDoc(source.code)?.state.doc.toString() ?? (await api.readText(source.code).catch(() => ({ text: "" }))).text;
      setMethods(javaMethods(text));
      const d = nsdOfMethod(text, source.signature);
      if (d) {
        setNsd(d);
        setProblem(null);
      } else setProblem(t("{0} isn't in {1} any more, or has no body.", source.signature, stem(source.code)));
    };
    void draw();
    const stop = watchDoc(source.code, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), 250);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [source]);

  const layout = useMemo(() => (nsd ? layoutNsd(nsd, measure, { yes: t("true"), no: t("false") }) : null), [nsd]);

  // ----- Changing a diagram drawn by hand ------------------------------------------------------
  const change = useCallback(
    (next: Nsd, select?: Selection) => {
      if (!editable || !nsd || !source || !("file" in source)) return;
      history.current.back.push(nsd);
      if (history.current.back.length > 200) history.current.back.shift();
      history.current.forward = [];
      setNsd(next);
      if (select !== undefined) setSel(select);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void api.writeText(source.file, toFile(next)).catch((e) => toast("error", t("The diagram wasn't saved"), errorText(e))), 300);
    },
    [editable, nsd, source],
  );

  const undo = (redo = false) => {
    const h = history.current;
    const from = redo ? h.forward : h.back;
    const prev = from.pop();
    if (!prev || !nsd || !source || !("file" in source)) return;
    (redo ? h.back : h.forward).push(nsd);
    setNsd(prev);
    setSel(null);
    void api.writeText(source.file, toFile(prev)).catch(() => {});
  };

  const selectedPlace = sel && "place" in sel ? sel.place : null;
  const selected = nsd && selectedPlace ? blockAt(nsd, selectedPlace) : null;

  const insert = (kind: BlockKind) => {
    if (!nsd) return;
    const where = sel && "slot" in sel ? { list: sel.slot, index: 0 } : selectedPlace;
    const r = insertAfter(nsd, where, newBlock(kind));
    change(r.nsd, { place: r.at });
    // Type its text right away.
    window.setTimeout(() => editText(r.nsd, r.at), 0);
  };

  const editText = (d: Nsd | null = nsd, p: Place | null = selectedPlace) => {
    if (!d || !p) return;
    const b = blockAt(d, p);
    if (!b) return;
    openDialog({
      kind: "prompt",
      title: b.kind === "if" || b.kind === "while" || b.kind === "repeat" ? t("Condition") : b.kind === "switch" ? t("Value to choose by") : t("Text"),
      label: t("Text"),
      value: textOf(b),
      confirmLabel: t("OK"),
      multiline: b.kind === "action",
      onSubmit: (v) => change(replaceBlock(d, p, withText(b, v.trim() || textOf(b))), { place: p }),
    });
  };

  const editCases = () => {
    if (!nsd || !selectedPlace || selected?.kind !== "switch") return;
    const b = selected;
    openDialog({
      kind: "prompt",
      title: t("Cases"),
      label: t("The values, separated by |"),
      value: b.cases.map((c) => c.label).join(" | "),
      confirmLabel: t("OK"),
      onSubmit: (v) => {
        const labels = v.split("|").map((s) => s.trim()).filter(Boolean);
        if (!labels.length) return;
        // Cases keep their blocks by position; new ones start empty.
        const cases = labels.map((label, i) => ({ label, body: b.cases[i]?.body ?? [] }));
        change(replaceBlock(nsd, selectedPlace, { ...b, cases }), { place: selectedPlace });
      },
    });
  };

  const editTitle = () => {
    if (!nsd || !editable) return;
    openDialog({ kind: "prompt", title: t("Title"), label: t("Title"), value: nsd.title, confirmLabel: t("OK"), onSubmit: (v) => change({ ...nsd, title: v.trim() || nsd.title }) });
  };

  const remove = () => {
    if (!nsd || !selectedPlace) return;
    change(removeBlock(nsd, selectedPlace), null);
  };

  const move = (by: -1 | 1) => {
    if (!nsd || !selectedPlace) return;
    const r = moveBlock(nsd, selectedPlace, by);
    change(r.nsd, { place: r.at });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!editable) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z") (e.shiftKey ? undo(true) : undo(), e.preventDefault());
    else if (ctrl && e.key.toLowerCase() === "y") (undo(true), e.preventDefault());
    else if (e.key === "Delete" && selectedPlace) (remove(), e.preventDefault());
    else if ((e.key === "Enter" || e.key === "F2") && selectedPlace) (editText(), e.preventDefault());
    else if (e.altKey && e.key === "ArrowUp" && selectedPlace) (move(-1), e.preventDefault());
    else if (e.altKey && e.key === "ArrowDown" && selectedPlace) (move(1), e.preventDefault());
    else if (e.key === "Escape") setSel(null);
  };

  // ----- Export ---------------------------------------------------------------------------------
  const exportAs = async (kind: "svg" | "png" | "copy") => {
    if (!layout || !nsd) return;
    const svg = toSvg(layout);
    try {
      if (kind === "copy") {
        const blob = await exportPng(svg, 2);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("success", t("Diagram copied"), t("Paste it into a document or an image editor."));
        return;
      }
      const name = nsd.title.replace(/\(.*$/, "").replace(/[<>:"/\\|?*]/g, "") || "structogram";
      const target = await pickSavePath({
        title: kind === "svg" ? t("Export as SVG") : t("Export as PNG"),
        defaultPath: join(get().root ?? dirname(tab.path ?? ""), `${name}.${kind}`),
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      if (!target) return;
      if (kind === "svg") await api.writeText(target, svg);
      else await api.writeBytes(target, new Uint8Array(await (await exportPng(svg, 2)).arrayBuffer()));
      toast("success", t("Diagram exported"), target);
    } catch (err) {
      toast("error", t("The diagram wasn't exported"), errorText(err));
    }
  };

  // ----- Drawing --------------------------------------------------------------------------------
  const clickItem = (it: Item) => (e: React.MouseEvent) => {
    e.stopPropagation();
    box.current?.focus();
    if (!editable) return;
    if (it.t === "rect" && it.place) setSel({ place: it.place });
    else if (it.t === "slot") setSel({ slot: it.list });
  };
  const doubleItem = (it: Item) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable || !nsd) return;
    if (it.t === "rect" && it.cls === "title") return editTitle();
    if (it.t === "rect" && it.place) editText(nsd, it.place);
  };

  if (!source) return null;

  return (
    <div className="nsd">
      <div className="nsd-toolbar">
        {!editable && methods.length > 0 && "code" in source && (
          <Select
            label={t("Method")}
            compact
            value={source.signature}
            onChange={(v) => void openNsdOfMethod(source.code, v, tab.group)}
            options={methods.map((m) => ({ value: m.signature, label: m.signature }))}
          />
        )}
        {!editable && nsd && (
          <Button spacing="compact" iconBefore={FilePlus2} onClick={() => newNsd(get().root ?? dirname(tab.path ?? ""), nsd)}>
            {t("Edit a copy…")}
          </Button>
        )}
        {editable && (
          <>
            <span className="nsd-toolbar-label">{selected || (sel && "slot" in sel) ? t("Add after:") : t("Add:")}</span>
            {INSERT.map((x) => (
              <IconButton key={x.kind} icon={x.icon} label={x.label()} spacing="compact" onClick={() => insert(x.kind)} />
            ))}
            <span className="toolbar-divider" />
            <IconButton icon={Pencil} label={t("Edit text")} shortcut="Enter" spacing="compact" disabled={!selected} onClick={() => editText()} />
            {selected?.kind === "switch" && <IconButton icon={Type} label={t("Edit the cases")} spacing="compact" onClick={editCases} />}
            <IconButton icon={ArrowUp} label={t("Move up")} shortcut="Alt+Up" spacing="compact" disabled={!selected} onClick={() => move(-1)} />
            <IconButton icon={ArrowDown} label={t("Move down")} shortcut="Alt+Down" spacing="compact" disabled={!selected} onClick={() => move(1)} />
            <IconButton icon={Trash2} label={t("Delete")} shortcut="Delete" spacing="compact" disabled={!selected} onClick={remove} />
            <span className="toolbar-divider" />
            <IconButton icon={Undo2} label={t("Undo")} shortcut="Ctrl+Z" spacing="compact" onClick={() => undo()} />
            <IconButton icon={Redo2} label={t("Redo")} shortcut="Ctrl+Y" spacing="compact" onClick={() => undo(true)} />
          </>
        )}
        <span className="spacer" />
        <IconButton icon={Minus} label={t("Zoom out")} spacing="compact" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} />
        <button type="button" className="nsd-zoom" onClick={() => setZoom(1)} data-tooltip={t("Actual size")}>
          {Math.round(zoom * 100)} %
        </button>
        <IconButton icon={Plus} label={t("Zoom in")} spacing="compact" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))} />
        <span className="toolbar-divider" />
        <IconButton icon={Copy} label={t("Copy as image")} spacing="compact" disabled={!layout} onClick={() => void exportAs("copy")} />
        <IconButton icon={ImageDown} label={t("Export as PNG")} spacing="compact" disabled={!layout} onClick={() => void exportAs("png")} />
        <IconButton icon={FileDown} label={t("Export as SVG")} spacing="compact" disabled={!layout} onClick={() => void exportAs("svg")} />
      </div>
      <div ref={box} className={cx("nsd-stage", editable && "is-editable")} tabIndex={0} onKeyDown={onKey} onClick={() => setSel(null)} aria-label={t("Nassi–Shneiderman diagram")}>
        {problem && <EmptyState icon={Rows3} title={t("Nothing to draw")}>{problem}</EmptyState>}
        {!problem && layout && (
          <svg className="nsd-svg" width={(layout.width + 2) * zoom} height={(layout.height + 2) * zoom} viewBox={`-1 -1 ${layout.width + 2} ${layout.height + 2}`} role="img" aria-label={nsd?.title}>
            {layout.items.map((it, i) =>
              it.t === "rect" ? (
                <rect key={i} className={cx("nsd-box", `is-${it.cls}`)} x={it.x} y={it.y} width={it.w} height={it.h} onClick={clickItem(it)} onDoubleClick={doubleItem(it)} />
              ) : it.t === "slot" ? (
                <g key={i} className={cx("nsd-slot", sel && "slot" in sel && sel.slot.join("/") === it.list.join("/") && "is-selected")} onClick={clickItem(it)}>
                  <rect x={it.x} y={it.y} width={it.w} height={it.h} />
                  <text x={it.x + it.w / 2} y={it.y + it.h / 2 + 4} textAnchor="middle">
                    ∅
                  </text>
                </g>
              ) : it.t === "line" ? (
                <line key={i} className="nsd-line" x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} />
              ) : (
                <text key={i} className={cx("nsd-text", ...it.cls.split(" ").map((c) => `is-${c.replace(/^is-/, "")}`))} x={it.x} y={it.y} textAnchor={it.anchor}>
                  {it.s}
                </text>
              ),
            )}
            {selectedPlace &&
              layout.items
                .filter((it): it is Extract<Item, { t: "rect" }> => it.t === "rect" && samePlace(it.place ?? null, selectedPlace))
                .map((it, i) => <rect key={`sel${i}`} className="nsd-selection" x={it.x + 1} y={it.y + 1} width={it.w - 2} height={it.h - 2} />)}
          </svg>
        )}
      </div>
      {editable && <div className="nsd-hint">{t("Click a block to select it, double-click to change its text. Click ∅ to fill an empty branch.")}</div>}
    </div>
  );
}
