import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCopy,
  Code,
  Download,
  Eye,
  EyeOff,
  FileCode,
  Image as ImageIcon,
  LayoutDashboard,
  Maximize,
  Minus,
  Network,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "../lib/api";
import { get, openDialog, openMenu, setSettings, toast, useStore } from "../lib/store";
import { openFile } from "../lib/actions";
import { dirname, join, relative } from "../lib/paths";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/Feedback";
import { Select } from "../components/ui/Select";
import type { MenuItem } from "../components/ui/Menu";
import { javaIndex, useJavaIndexVersion } from "./javaIndex";
import { autoLayout, BOX, buildDiagram, placeNew, route, type Diagram, type Point, type Positions, type UmlEdge, type UmlNode, type UmlOptions } from "./diagram";
import { exportPng, exportSvgString } from "./exportDiagram";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";

interface Layout {
  version: 1;
  positions: Positions;
  hidden: string[];
}

interface View {
  x: number;
  y: number;
  k: number;
}

const ALL = "*";

function layoutPath(root: string) {
  return join(root, ".logiq", "uml.json");
}

/* ----- Drawing ------------------------------------------------------------------- */

function NodeBox({
  node,
  at,
  selected,
  dim,
  onPointerDown,
  onOpen,
  onMenu,
  onHover,
}: {
  node: UmlNode;
  at: Point;
  selected: boolean;
  dim: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onOpen: (line: number) => void;
  onMenu: (e: React.MouseEvent) => void;
  onHover: (on: boolean) => void;
}) {
  const head = BOX.headPadY * 2 + BOX.titleH + (node.stereotype ? BOX.stereoH : 0);
  const cx_ = node.w / 2;
  let y = head;
  const sections: React.ReactNode[] = [];
  const section = (key: string, lines: { text: string; line: number; isStatic?: boolean; isAbstract?: boolean }[]) => {
    const top = y;
    const h = lines.length ? lines.length * BOX.lineH + BOX.sectionPadY * 2 : BOX.emptySection;
    sections.push(
      <g key={key}>
        <line className="uml-sep" x1={0} x2={node.w} y1={top} y2={top} />
        {lines.map((l, i) => (
          <text
            key={i}
            className={cx("uml-member", l.isStatic && "is-static", l.isAbstract && "is-abstract")}
            x={BOX.padX}
            y={top + BOX.sectionPadY + i * BOX.lineH + 13}
            data-line={l.line}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onOpen(l.line);
            }}
          >
            {l.text}
          </text>
        ))}
      </g>,
    );
    y += h;
  };
  if (node.showAttributes) section("a", [...node.constants.map((c) => ({ text: c, line: node.type.line })), ...node.attributes]);
  if (node.showOperations) section("o", node.operations);

  return (
    <g
      className={cx("uml-node", selected && "is-selected", dim && "is-dim", `is-${node.type.kind}`)}
      transform={`translate(${at.x} ${at.y})`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onOpen(node.type.line)}
      onContextMenu={onMenu}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      data-id={node.id}
    >
      <rect className="uml-shadow" x={0} y={2} width={node.w} height={node.h} rx={10} />
      <rect className="uml-box" width={node.w} height={node.h} rx={10} />
      <path className="uml-head" d={`M0 10a10 10 0 0 1 10-10h${node.w - 20}a10 10 0 0 1 10 10v${head - 10}h${-node.w}z`} />
      {node.stereotype && (
        <text className="uml-stereo" x={cx_} y={BOX.headPadY + 11} textAnchor="middle">
          {node.stereotype}
        </text>
      )}
      <text className={cx("uml-title", node.italic && "is-abstract")} x={cx_} y={BOX.headPadY + (node.stereotype ? BOX.stereoH : 0) + 14} textAnchor="middle">
        {node.title}
      </text>
      {sections}
      <rect className="uml-outline" width={node.w} height={node.h} rx={10} />
    </g>
  );
}

function arrowHead(kind: UmlEdge["kind"], tip: Point, from: Point): { line: Point; shape: React.ReactNode; dir: Point } {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const dx = (tip.x - from.x) / len;
  const dy = (tip.y - from.y) / len;
  const at = (back: number, side: number) => `${tip.x - dx * back - dy * side},${tip.y - dy * back + dx * side}`;
  if (kind === "extends" || kind === "implements") {
    return {
      line: { x: tip.x - dx * 13, y: tip.y - dy * 13 },
      shape: <polygon className="uml-arrow-hollow" points={`${tip.x},${tip.y} ${at(13, 7)} ${at(13, -7)}`} />,
      dir: { x: dx, y: dy },
    };
  }
  if (kind === "nesting") {
    const c = { x: tip.x - dx * 6, y: tip.y - dy * 6 };
    return {
      line: { x: tip.x - dx * 12, y: tip.y - dy * 12 },
      shape: (
        <g>
          <circle className="uml-arrow-hollow" cx={c.x} cy={c.y} r={6} />
          <path className="uml-edge" d={`M${c.x - 4} ${c.y}h8M${c.x} ${c.y - 4}v8`} />
        </g>
      ),
      dir: { x: dx, y: dy },
    };
  }
  return {
    line: tip,
    shape: <path className="uml-arrow-open" d={`M${at(11, 6)}L${tip.x},${tip.y}L${at(11, -6)}`} />,
    dir: { x: dx, y: dy },
  };
}

function EdgeLine({ edge, points, hot, dim }: { edge: UmlEdge; points: Point[]; hot: boolean; dim: boolean }) {
  const tip = points[points.length - 1];
  const prev = points[points.length - 2];
  const head = arrowHead(edge.kind, tip, prev);
  const d = points
    .slice(0, -1)
    .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
    .concat(`L${head.line.x},${head.line.y}`)
    .join(" ");
  const dashed = edge.kind === "implements" || edge.kind === "dependency";
  let labels: React.ReactNode = null;
  if (edge.kind === "association" && edge.labels.length) {
    const { x: dx, y: dy } = head.dir;
    const base = { x: tip.x - dx * 26, y: tip.y - dy * 26 };
    // A label on each side of the line, anchored so it grows away from it.
    const side = (s: number) => {
      const sx = -dy * s;
      const sy = dx * s;
      return {
        x: base.x + sx,
        y: base.y + sy + (sy > 4 ? 8 : sy < -4 ? -1 : 4),
        anchor: (sx > 4 ? "start" : sx < -4 ? "end" : "middle") as "start" | "end" | "middle",
      };
    };
    const roles = edge.labels.map((l) => l.role).join(", ");
    const mults = [...new Set(edge.labels.map((l) => l.multiplicity))].join(", ");
    const r = side(10);
    const m = side(-10);
    labels = (
      <>
        <text className="uml-label" x={r.x} y={r.y} textAnchor={r.anchor}>
          {roles}
        </text>
        <text className="uml-label is-mult" x={m.x} y={m.y} textAnchor={m.anchor}>
          {mults}
        </text>
      </>
    );
  }
  return (
    <g className={cx("uml-relation", `is-${edge.kind}`, hot && "is-hot", dim && "is-dim")}>
      <path className="uml-hit" d={d} />
      <path className={cx("uml-edge", dashed && "is-dashed")} d={d} />
      {head.shape}
      {labels}
    </g>
  );
}

/* ----- The view -------------------------------------------------------------------- */

export function UmlView({ visible }: { visible: boolean }) {
  const version = useJavaIndexVersion();
  const root = useStore((s) => s.root);
  const opts = useStore((s) => s.settings.uml);
  const layoutNonce = useStore((s) => s.umlLayoutNonce);
  const [scope, setScope] = useState<string>(ALL);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const saveTimer = useRef(0);

  // Load the saved layout of this folder.
  useEffect(() => {
    fitted.current = false;
    setLayout(null);
    if (!root) return;
    api
      .readText(layoutPath(root))
      .then((f) => {
        const data = JSON.parse(f.text) as Layout;
        setLayout({ version: 1, positions: data.positions ?? {}, hidden: data.hidden ?? [] });
      })
      .catch(() => setLayout({ version: 1, positions: {}, hidden: [] }));
  }, [root]);

  const persist = useCallback(
    (next: Layout) => {
      setLayout(next);
      if (!root) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.writeText(layoutPath(root), JSON.stringify(next, null, 2) + "\n").catch(() => {});
      }, 500);
    },
    [root],
  );

  const allTypes = useMemo(() => javaIndex.types(), [version]);
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const x of allTypes) set.add(dirname(x.path));
    return [...set].sort();
  }, [allTypes]);
  useEffect(() => {
    if (scope !== ALL && !folders.includes(scope)) setScope(ALL);
  }, [folders, scope]);

  const types = useMemo(() => {
    const hidden = new Set(layout?.hidden ?? []);
    return allTypes.filter((x) => !hidden.has(x.qualifiedName) && (scope === ALL || dirname(x.path) === scope));
  }, [allTypes, layout?.hidden, scope]);

  const diagram: Diagram = useMemo(() => buildDiagram(types, opts), [types, opts]);

  const known = useMemo(() => new Set(allTypes.map((x) => x.qualifiedName)), [allTypes]);
  const positions = useMemo(() => (layout ? placeNew(diagram, layout.positions, known) : {}), [diagram, layout, known]);

  // Keep the positions of new boxes, so they don't move when the next class appears.
  useEffect(() => {
    if (!layout) return;
    const missing = diagram.nodes.filter((n) => !layout.positions[n.id]);
    if (missing.length) {
      // Forget classes that no longer exist; keep those only filtered out.
      const next = Object.fromEntries(Object.entries(layout.positions).filter(([id]) => known.has(id)));
      for (const n of missing) next[n.id] = positions[n.id];
      persist({ ...layout, positions: next });
    }
  }, [diagram, layout, positions, persist, known]);

  const relayout = useCallback(() => {
    if (!layout) return;
    const auto = autoLayout(diagram);
    persist({ ...layout, positions: { ...layout.positions, ...auto } });
    requestAnimationFrame(() => fit(auto));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, layout, persist]);

  const lastNonce = useRef(layoutNonce);
  useEffect(() => {
    if (layoutNonce !== lastNonce.current) {
      lastNonce.current = layoutNonce;
      relayout();
    }
  }, [layoutNonce, relayout]);

  const bounds = useCallback(
    (pos: Positions = positions) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const n of diagram.nodes) {
        const p = pos[n.id];
        if (!p) continue;
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y - 30);
        x1 = Math.max(x1, p.x + n.w + 30);
        y1 = Math.max(y1, p.y + n.h);
      }
      return x0 === Infinity ? null : { x0, y0, x1, y1 };
    },
    [diagram, positions],
  );

  const fit = useCallback(
    (pos?: Positions) => {
      const b = bounds(pos);
      const el = stageRef.current;
      if (!b || !el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const k = Math.min(1.25, Math.max(0.2, Math.min((w - 64) / (b.x1 - b.x0), (h - 64) / (b.y1 - b.y0))));
      setView({ k, x: (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k });
    },
    [bounds],
  );

  useEffect(() => {
    if (visible && layout && !fitted.current && diagram.nodes.length) {
      fitted.current = true;
      requestAnimationFrame(() => fit());
    }
  }, [visible, layout, diagram.nodes.length, fit]);

  // ----- Pointer: drag boxes, pan the canvas ---------------------------------------
  const drag = useRef<{ kind: "node"; id: string; start: Point; origin: Point; moved: boolean } | { kind: "pan"; start: Point; origin: View } | null>(null);

  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(id);
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "node", id, start: { x: e.clientX, y: e.clientY }, origin: positions[id], moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !layout) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (d.kind === "pan") {
      setView({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy });
    } else {
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      const snap = (v: number) => (e.altKey ? v : Math.round(v / 4) * 4);
      setLayout({
        ...layout,
        positions: { ...layout.positions, [d.id]: { x: snap(d.origin.x + dx / view.k), y: snap(d.origin.y + dy / view.k) } },
      });
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "node" && d.moved && layout) persist(layout);
    document.body.classList.remove("is-dragging");
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      const rect = stageRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const k = Math.max(0.15, Math.min(3, view.k * Math.exp(-e.deltaY * 0.0018)));
      setView({ k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k });
    } else {
      setView({ ...view, x: view.x - (e.shiftKey ? e.deltaY : e.deltaX), y: view.y - (e.shiftKey ? 0 : e.deltaY) });
    }
  };

  const zoomBy = (f: number) => {
    const el = stageRef.current!;
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    const k = Math.max(0.15, Math.min(3, view.k * f));
    setView({ k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k });
  };

  const openAt = (node: UmlNode, line: number) => void openFile(node.type.path, { line });

  const hide = (id: string) => layout && persist({ ...layout, hidden: [...layout.hidden, id] });

  const nodeMenu = (node: UmlNode) => (e: React.MouseEvent) => {
    e.preventDefault();
    setSelected(node.id);
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t("Go to source"), icon: FileCode, onSelect: () => openAt(node, node.type.line) },
        { label: t("Hide from diagram"), icon: EyeOff, onSelect: () => hide(node.id) },
        { label: t("Copy name"), icon: ClipboardCopy, onSelect: () => void navigator.clipboard.writeText(node.type.qualifiedName) },
      ],
    });
  };

  const optionMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const toggle = (key: keyof UmlOptions, label: string): MenuItem => ({
      label,
      checked: opts[key],
      onSelect: () => setSettings({ uml: { ...get().settings.uml, [key]: !opts[key] } }),
    });
    openMenu({
      anchor: e.currentTarget,
      items: [
        { type: "heading", label: t("Compartments") },
        toggle("showAttributes", t("Attributes")),
        toggle("showMethods", t("Methods")),
        toggle("showConstructors", t("Constructors")),
        toggle("showPrivate", t("Private members")),
        { type: "heading", label: t("Details") },
        toggle("showParams", t("Parameters")),
        toggle("showTypes", t("Types")),
        toggle("visibilitySymbols", t("Visibility symbols (+ − # ~)")),
        { type: "heading", label: t("Relations") },
        toggle("showAssociations", t("Associations")),
        toggle("showDependencies", t("Dependencies")),
        toggle("showNesting", t("Nested classes")),
      ],
    });
  };

  const exportMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    openMenu({
      anchor: e.currentTarget,
      align: "end",
      items: [
        { label: t("Export as SVG…"), icon: Download, onSelect: () => void doExport("svg") },
        { label: t("Export as PNG…"), icon: ImageIcon, onSelect: () => void doExport("png") },
        { label: t("Copy as image"), icon: ClipboardCopy, onSelect: () => void doExport("copy") },
      ],
    });
  };

  async function doExport(kind: "svg" | "png" | "copy") {
    const g = svgRef.current?.querySelector<SVGGElement>(".uml-content");
    const b = bounds();
    if (!g || !b) return;
    try {
      const svg = await exportSvgString(g, b);
      if (kind === "copy") {
        const blob = await exportPng(svg, 2);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("success", t("Diagram copied"), t("Paste it into a document or an image editor."));
        return;
      }
      const target = await pickSavePath({
        title: kind === "svg" ? t("Export as SVG") : t("Export as PNG"),
        defaultPath: root ? join(root, `class-diagram.${kind}`) : `class-diagram.${kind}`,
        filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
      });
      if (!target) return;
      if (kind === "svg") await api.writeText(target, svg);
      else await api.writeBytes(target, new Uint8Array(await (await exportPng(svg, 2)).arrayBuffer()));
      toast("success", t("Diagram exported"), target);
    } catch (err) {
      toast("error", t("The diagram wasn't exported"), errorText(err));
    }
  }

  if (!root) return null;

  const hiddenCount = layout?.hidden.length ?? 0;
  const nodesById = new Map(diagram.nodes.map((n) => [n.id, n]));
  const pairs = new Set(diagram.edges.filter((e) => e.kind === "association").map((e) => `${e.from}->${e.to}`));
  const focus = hover ?? selected;
  const related = new Set<string>();
  if (focus) {
    related.add(focus);
    for (const e of diagram.edges) if (e.from === focus || e.to === focus) related.add(e.from === focus ? e.to : e.from);
  }

  return (
    <div className="uml" hidden={!visible}>
      <div className="uml-toolbar">
        <Select
          value={scope}
          onChange={(v) => {
            setScope(v);
            fitted.current = false;
            requestAnimationFrame(() => fit());
          }}
          options={[{ value: ALL, label: t("All classes") }, ...folders.map((f) => ({ value: f, label: relative(root, f) === f || !relative(root, f) || f.toLowerCase() === root.toLowerCase() ? t("Project folder") : relative(root, f) }))]}
          label={t("Show classes from")}
          compact
        />
        <Button spacing="compact" iconBefore={SlidersHorizontal} onClick={optionMenu}>
          {t("View")}
        </Button>
        {hiddenCount > 0 && (
          <Button spacing="compact" iconBefore={Eye} onClick={() => layout && persist({ ...layout, hidden: [] })} tooltip={t("Show the classes you hid")}>
            {t("Show {0} hidden", hiddenCount)}
          </Button>
        )}
        <span className="spacer" />
        <IconButton icon={Code} label={t("New Java class")} spacing="compact" onClick={() => openDialog({ kind: "newJavaFile", dir: scope === ALL ? root : scope })} />
        <IconButton icon={LayoutDashboard} label={t("Arrange automatically")} spacing="compact" onClick={relayout} />
        <span className="toolbar-divider" />
        <IconButton icon={Minus} label={t("Zoom out")} spacing="compact" onClick={() => zoomBy(1 / 1.2)} />
        <button type="button" className="uml-zoom" onClick={() => setView({ ...view, k: 1 })} data-tooltip={t("Actual size")}>
          {Math.round(view.k * 100)}%
        </button>
        <IconButton icon={Plus} label={t("Zoom in")} spacing="compact" onClick={() => zoomBy(1.2)} />
        <IconButton icon={Maximize} label={t("Fit to window")} spacing="compact" onClick={() => fit()} />
        <span className="toolbar-divider" />
        <Button spacing="compact" iconBefore={Download} onClick={exportMenu} disabled={!diagram.nodes.length}>
          {t("Export")}
        </Button>
      </div>
      <div
        ref={stageRef}
        className="uml-stage"
        tabIndex={0}
        aria-label={t("UML class diagram")}
        onKeyDown={(e) => {
          if (e.key === "f" || e.key === "F") fit();
          else if (e.key === "+" || e.key === "=") zoomBy(1.2);
          else if (e.key === "-") zoomBy(1 / 1.2);
          else if (e.key === "Escape") setSelected(null);
          else if (selected && layout && e.key.startsWith("Arrow")) {
            const step = e.shiftKey ? 32 : 8;
            const p = positions[selected];
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
            persist({ ...layout, positions: { ...layout.positions, [selected]: { x: p.x + d[0], y: p.y + d[1] } } });
          } else if (selected && e.key === "Enter") {
            const n = nodesById.get(selected);
            if (n) openAt(n, n.type.line);
          } else return;
          e.preventDefault();
        }}
      >
        {diagram.nodes.length === 0 ? (
          <div className="uml-empty">
            <EmptyState
              icon={Network}
              title={allTypes.length ? t("Every class is hidden") : t("No Java classes yet")}
              actions={
                allTypes.length ? (
                  <Button onClick={() => layout && persist({ ...layout, hidden: [] })}>{t("Show all classes")}</Button>
                ) : (
                  <Button appearance="primary" iconBefore={Code} onClick={() => openDialog({ kind: "newJavaFile", dir: root })}>
                    {t("New Java class")}
                  </Button>
                )
              }
            >
              {allTypes.length ? t("Show them again to draw the diagram.") : t("The class diagram draws itself from the Java code in this folder, and changes as you type.")}
            </EmptyState>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="uml-svg"
            onPointerDown={(e) => {
              if (e.button !== 0 && e.button !== 1) return;
              setSelected(null);
              stageRef.current?.focus();
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, origin: view };
              document.body.classList.add("is-dragging");
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            <g className="uml-content" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <g className="uml-edges">
                {diagram.edges.map((edge) => {
                  const a = nodesById.get(edge.from)!;
                  const b = nodesById.get(edge.to)!;
                  const pa = positions[edge.from];
                  const pb = positions[edge.to];
                  if (!a || !b || !pa || !pb) return null;
                  const offset = edge.kind === "association" && edge.from !== edge.to && pairs.has(`${edge.to}->${edge.from}`) ? 7 : 0;
                  const pts = route(edge, { ...pa, w: a.w, h: a.h }, { ...pb, w: b.w, h: b.h }, offset);
                  const hot = !!focus && (edge.from === focus || edge.to === focus);
                  return <EdgeLine key={edge.id} edge={edge} points={pts} hot={hot} dim={!!focus && !hot} />;
                })}
              </g>
              <g className="uml-nodes">
                {diagram.nodes.map((n) =>
                  positions[n.id] ? (
                    <NodeBox
                      key={n.id}
                      node={n}
                      at={positions[n.id]}
                      selected={selected === n.id}
                      dim={!!focus && !related.has(n.id)}
                      onPointerDown={onNodeDown(n.id)}
                      onOpen={(line) => openAt(n, line)}
                      onMenu={nodeMenu(n)}
                      onHover={(on) => setHover(on ? n.id : null)}
                    />
                  ) : null,
                )}
              </g>
            </g>
          </svg>
        )}
        <div className="uml-legend" aria-hidden="true">
          <span>{t("Drag boxes to arrange")}</span>
          <span>{t("Double-click to open the code")}</span>
          <span>{t("Ctrl + wheel to zoom")}</span>
        </div>
      </div>
    </div>
  );
}
