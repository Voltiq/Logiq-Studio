import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Box,
  FlaskConical,
  ClipboardCopy,
  Download,
  FileText,
  MousePointer2,
  Pencil,
  Play,
  Printer,
  StickyNote,
  Trash2,
  Undo2,
  FilePlus2,
  ListChecks,
  Triangle,
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
import { flushSync } from "react-dom";
import { save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "../lib/api";
import { get, openDialog, openMenu, setSettings, toast, useStore } from "../lib/store";
import { loadDir as refreshTree, openDiagram, openFile } from "../lib/actions";
import { dirname, invalidName, join, relative } from "../lib/paths";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/Feedback";
import { Select } from "../components/ui/Select";
import type { MenuItem } from "../components/ui/Menu";
import { allTypes as everyType, useStructureVersion } from "./javaIndex";
import { autoLayout, BOX, buildDiagram, placeNew, route, ROUTE_LOCALLY_ABOVE, routingRegion, type Diagram, type Point, type Positions, type Rect, type UmlEdge, type UmlNode, type UmlOptions } from "./diagram";
import { CULL_ABOVE, lineInView, visibleNodes } from "./visible";
import { exportPng, exportSvgString } from "./exportDiagram";
import { simpleType } from "./javaParser";
import { toMermaid, toPlantUml } from "./exportText";
import { loadRelations, relationKey, setWhole, useRelations } from "./relations";
import { addInheritance, askAssociation, deleteClass, deleteMember, newClassDir, removeAssociation, removeInheritance } from "./edit";
import { BenchPanel } from "./BenchPanel";
import { createTestFor, runTests } from "../lib/tools";
import { benchCall, describeMethod, useBench } from "./bench";
import { cx } from "../lib/utils";
import { t } from "../lib/i18n";
import { describeNode, neighbour, panIntoView, type Direction } from "./describe";

interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
}

interface Layout {
  version: 1;
  positions: Positions;
  hidden: string[];
  notes: Note[];
  /** Bend points the user placed, by relation. */
  bends: Record<string, Point[]>;
  /** How far the user moved a relation's role and multiplicity labels. */
  labels: Record<string, { role?: Point; mult?: Point }>;
  /** The classes of a diagram that shows a choice of them; every class when absent. */
  classes?: string[];
}

const EMPTY_LAYOUT: Layout = { version: 1, positions: {}, hidden: [], notes: [], bends: {}, labels: {} };

type Tool = "select" | "inherit" | "associate" | "note";

/** The size of a note from its text. */
function noteSize(n: Note) {
  const lines = n.text.split("\n");
  return { w: Math.max(120, Math.max(...lines.map((l) => l.length)) * 6.8 + 30), h: lines.length * 16 + 22 };
}

function NoteBox({ note, onPointerDown, onEdit, onMenu }: { note: Note; onPointerDown: (e: React.PointerEvent) => void; onEdit: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const { w, h } = noteSize(note);
  return (
    <g className="uml-note" transform={`translate(${note.x} ${note.y})`} onPointerDown={onPointerDown} onDoubleClick={onEdit} onContextMenu={onMenu}>
      <path className="uml-note-shape" d={`M0 0h${w - 12}l12 12v${h - 12}h${-w}z`} />
      <path className="uml-note-fold" d={`M${w - 12} 0v12h12`} />
      {note.text.split("\n").map((l, i) => (
        <text key={i} className="uml-note-text" x={10} y={18 + i * 16}>
          {l}
        </text>
      ))}
    </g>
  );
}

interface View {
  x: number;
  y: number;
  k: number;
}

const ALL = "*";
const PROJECT = "";

function layoutPath(root: string, diagram: string | null) {
  return diagram ?? join(root, ".logiq", "uml.json");
}

/* ----- Drawing ------------------------------------------------------------------- */

function NodeBox({
  node,
  at,
  selected,
  dim,
  domId,
  description,
  onPointerDown,
  onOpen,
  onMenu,
  onMemberMenu,
  onHover,
}: {
  onMemberMenu: (e: React.MouseEvent, line: number, kind: "field" | "method") => void;
  /** For the stage's aria-activedescendant. */
  domId: string;
  /** The class in words, for screen readers. */
  description: string;
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
  const section = (key: string, lines: { text: string; line: number; isStatic?: boolean; isAbstract?: boolean; constant?: boolean }[]) => {
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
            onContextMenu={(e) => {
              if (l.constant) return;
              e.preventDefault();
              e.stopPropagation();
              onMemberMenu(e, l.line, key === "a" ? "field" : "method");
            }}
          >
            {l.text}
          </text>
        ))}
      </g>,
    );
    y += h;
  };
  if (node.showAttributes) section("a", [...node.constants.map((c) => ({ text: c, line: node.type.line, constant: true })), ...node.attributes]);
  if (node.showOperations) section("o", node.operations);

  return (
    <g
      className={cx("uml-node", selected && "is-selected", dim && "is-dim", `is-${node.type.kind}`, node.library && "is-library")}
      transform={`translate(${at.x} ${at.y})`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onOpen(node.type.line)}
      onContextMenu={onMenu}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      data-id={node.id}
      id={domId}
      role="img"
      aria-label={description}
    >
      <rect className="uml-shadow" x={0} y={2} width={node.w} height={node.h} rx={10} />
      <rect className="uml-box" width={node.w} height={node.h} rx={10} />
      {!node.library && <path className="uml-head" d={`M0 10a10 10 0 0 1 10-10h${node.w - 20}a10 10 0 0 1 10 10v${head - 10}h${-node.w}z`} />}
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

interface EdgeProps {
  edge: UmlEdge;
  points: Point[];
  hot: boolean;
  dim: boolean;
  selected: boolean;
  labelOffset?: { role?: Point; mult?: Point };
  onMenu: (e: React.MouseEvent) => void;
  onSelect: (e: React.PointerEvent) => void;
  /** Dragging bend point `index` (1-based in `points`), or a new one before it when `insert`. */
  onHandleDown: (index: number, insert: boolean) => (e: React.PointerEvent) => void;
  onBendRemove: (index: number) => void;
  onLabelDown: (which: "role" | "mult") => (e: React.PointerEvent) => void;
}

function EdgeLine({ edge, points, hot, dim, selected, labelOffset, onMenu, onSelect, onHandleDown, onBendRemove, onLabelDown }: EdgeProps) {
  const tip = points[points.length - 1];
  const prev = points[points.length - 2];
  const head = arrowHead(edge.kind, tip, prev);
  // Aggregation and composition: a diamond where the line leaves the whole, the line starting behind it.
  let diamond: React.ReactNode = null;
  let start = points[0];
  if (edge.whole && points.length > 1) {
    const a = points[0];
    const b = points[1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const L = 18;
    const W = 6.5;
    const mid = { x: a.x + (ux * L) / 2, y: a.y + (uy * L) / 2 };
    start = { x: a.x + ux * L, y: a.y + uy * L };
    diamond = (
      <path
        className={edge.whole === "composition" ? "uml-diamond is-filled" : "uml-diamond"}
        d={`M${a.x},${a.y}L${mid.x - uy * W},${mid.y + ux * W}L${start.x},${start.y}L${mid.x + uy * W},${mid.y - ux * W}Z`}
      />
    );
  }
  const d = [start, ...points.slice(1)]
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
    const ro = labelOffset?.role ?? { x: 0, y: 0 };
    const mo = labelOffset?.mult ?? { x: 0, y: 0 };
    labels = (
      <>
        <text className="uml-label is-draggable" x={r.x + ro.x} y={r.y + ro.y} textAnchor={r.anchor} onPointerDown={onLabelDown("role")} onContextMenu={onMenu}>
          {roles}
        </text>
        <text className="uml-label is-mult is-draggable" x={m.x + mo.x} y={m.y + mo.y} textAnchor={m.anchor} onPointerDown={onLabelDown("mult")} onContextMenu={onMenu}>
          {mults}
        </text>
      </>
    );
  }
  const bendable = edge.from !== edge.to;
  return (
    <g className={cx("uml-relation", `is-${edge.kind}`, (hot || selected) && "is-hot", dim && !selected && "is-dim", selected && "is-selected")}>
      <path className="uml-hit" d={d} onContextMenu={onMenu} onPointerDown={onSelect} />
      <path className={cx("uml-edge", dashed && "is-dashed")} d={d} />
      {diamond}
      {head.shape}
      {labels}
      {selected && bendable && (
        <g className="uml-handles">
          {points.slice(1).map((p, i) => {
            const q = points[i];
            return <circle key={`m${i}`} className="uml-handle is-mid" cx={(p.x + q.x) / 2} cy={(p.y + q.y) / 2} r={4} onPointerDown={onHandleDown(i + 1, true)} />;
          })}
          {points.slice(1, -1).map((p, i) => (
            <rect
              key={`b${i}`}
              className="uml-handle is-bend"
              x={p.x - 4.5}
              y={p.y - 4.5}
              width={9}
              height={9}
              rx={2}
              onPointerDown={onHandleDown(i + 1, false)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onBendRemove(i + 1);
              }}
            />
          ))}
        </g>
      )}
    </g>
  );
}

/* ----- The view -------------------------------------------------------------------- */

export function UmlView({ tabId, visible }: { tabId: string; visible: boolean }) {
  const version = useStructureVersion();
  const root = useStore((s) => s.root);
  const opts = useStore((s) => s.settings.uml);
  const layoutNonce = useStore((s) => s.umlLayoutNonce);
  /** The .uml file shown, or null for the project's diagram of every class. */
  const diagramPath = useStore((s) => s.tabs.find((x) => x.id === tabId)?.path ?? null);
  const [diagramFiles, setDiagramFiles] = useState<string[]>([]);
  const [scope, setScope] = useState<string>(ALL);
  const [layout, setLayout] = useState<Layout | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  layoutRef.current = layout;
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 1 });
  /** Draw every class even when it is out of view (while exporting or printing). */
  const [drawAll, setDrawAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [link, setLink] = useState<{ from: string; to: Point } | null>(null);
  const benchCount = useBench((s) => s.objects.length);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const saveTimer = useRef(0);

  // Load the saved layout of this diagram.
  useEffect(() => {
    fitted.current = false;
    setLayout(null);
    setSelected(null);
    setSelectedEdge(null);
    if (!root) return;
    api
      .readText(layoutPath(root, diagramPath))
      .then((f) => {
        const data = JSON.parse(f.text) as Layout;
        setLayout({
          ...EMPTY_LAYOUT,
          positions: data.positions ?? {},
          hidden: data.hidden ?? [],
          notes: data.notes ?? [],
          bends: data.bends ?? {},
          labels: data.labels ?? {},
          ...(Array.isArray(data.classes) ? { classes: data.classes } : {}),
        });
      })
      .catch(() => setLayout(diagramPath ? { ...EMPTY_LAYOUT, classes: [] } : EMPTY_LAYOUT));
  }, [root, diagramPath]);

  // The project's .uml files, for the diagram picker.
  const loadDiagramFiles = useCallback(() => {
    if (!root) return;
    api
      .listFiles(root)
      .then((files) => setDiagramFiles(files.filter((f) => f.toLowerCase().endsWith(".uml")).map((f) => join(root, f)).sort()))
      .catch(() => setDiagramFiles([]));
  }, [root]);
  useEffect(() => loadDiagramFiles(), [loadDiagramFiles, diagramPath, visible]);

  const persist = useCallback(
    (next: Layout) => {
      setLayout(next);
      if (!root) return;
      window.clearTimeout(saveTimer.current);
      const target = layoutPath(root, diagramPath);
      saveTimer.current = window.setTimeout(() => {
        api.writeText(target, JSON.stringify(next, null, 2) + "\n").catch(() => {});
      }, 500);
    },
    [root, diagramPath],
  );

  const allTypes = useMemo(() => everyType(), [version]);
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const x of allTypes) set.add(dirname(x.path));
    return [...set].sort();
  }, [allTypes]);
  useEffect(() => {
    if (scope !== ALL && !folders.includes(scope)) setScope(ALL);
  }, [folders, scope]);

  const chosen = layout?.classes;
  const types = useMemo(() => {
    if (chosen) {
      const set = new Set(chosen);
      return allTypes.filter((x) => set.has(x.qualifiedName));
    }
    const hidden = new Set(layout?.hidden ?? []);
    return allTypes.filter((x) => !hidden.has(x.qualifiedName) && (scope === ALL || dirname(x.path) === scope));
  }, [allTypes, layout?.hidden, scope, chosen]);

  const wholes = useRelations((s) => s.wholes);
  useEffect(() => {
    if (root) void loadRelations(root);
  }, [root]);
  const diagram: Diagram = useMemo(() => {
    const d = buildDiagram(types, opts);
    return { ...d, edges: d.edges.map((e) => (e.kind === "association" && wholes[relationKey(e.from, e.to)] ? { ...e, whole: wholes[relationKey(e.from, e.to)] } : e)) };
  }, [types, opts, wholes]);

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
    persist({ ...layout, positions: { ...layout.positions, ...auto }, bends: {}, labels: {} });
    requestAnimationFrame(() => fit(auto));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, layout, persist]);

  const lastNonce = useRef(layoutNonce);
  useEffect(() => {
    if (layoutNonce !== lastNonce.current) {
      lastNonce.current = layoutNonce;
      // Only the diagram in view is arranged, not the others open in tabs.
      if (visible) relayout();
    }
  }, [layoutNonce, relayout, visible]);

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

  /** Shows the whole diagram; false while the canvas has no size yet (it is tried again when it has). */
  const fit = useCallback(
    (pos?: Positions): boolean => {
      const b = bounds(pos);
      const el = stageRef.current;
      if (!b || !el) return false;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return false;
      const k = Math.min(1.25, Math.max(0.2, Math.min((w - 64) / (b.x1 - b.x0), (h - 64) / (b.y1 - b.y0))));
      setView({ k, x: (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k });
      return true;
    },
    [bounds],
  );

  // The first look shows it all. A timer, not the next frame: a window in the background draws no frames.
  useEffect(() => {
    if (!visible || !layout || fitted.current || !diagram.nodes.length) return;
    const id = window.setTimeout(() => {
      if (!fitted.current && fit()) fitted.current = true;
    }, 0);
    return () => window.clearTimeout(id);
  }, [visible, layout, diagram.nodes.length, fit]);

  // Classes that appear while you write (or in a new file) are brought into view: new boxes are placed beside
  // the others, often out of sight. A diagram in a tab behind does it when it is shown.
  const seen = useRef<Set<string> | null>(null);
  const toReveal = useRef<string[]>([]);
  useEffect(() => {
    if (!layout) {
      seen.current = null;
      toReveal.current = [];
      return;
    }
    const ids = diagram.nodes.map((n) => n.id);
    const before = seen.current;
    seen.current = new Set(ids);
    if (!before) return;
    const added = ids.filter((id) => !before.has(id));
    toReveal.current = [...toReveal.current.filter((id) => seen.current!.has(id)), ...added];
  }, [diagram, layout]);
  useEffect(() => {
    if (!visible || !fitted.current || !toReveal.current.length) return;
    const ids = toReveal.current;
    toReveal.current = [];
    window.setTimeout(() => {
      const el = stageRef.current;
      if (!el || !el.clientWidth) return;
      const out = ids.some((id) => {
        const p = positions[id];
        const n = diagram.nodes.find((x) => x.id === id);
        if (!p || !n) return false;
        const x = p.x * view.k + view.x;
        const y = p.y * view.k + view.y;
        return x < 0 || y < 0 || x + n.w * view.k > el.clientWidth || y + n.h * view.k > el.clientHeight;
      });
      if (out) fit();
    }, 0);
  }, [visible, diagram, positions, view, fit]);

  // ----- Pointer: drag boxes, pan the canvas ---------------------------------------
  const drag = useRef<
    | { kind: "node"; id: string; start: Point; origin: Point; moved: boolean }
    | { kind: "note"; id: string; start: Point; origin: Point; moved: boolean }
    | { kind: "pan"; start: Point; origin: View }
    | { kind: "link"; from: string }
    | { kind: "bend"; edge: string; index: number; insert: boolean; start: Point; points: Point[]; moved: boolean }
    | { kind: "label"; edge: string; which: "role" | "mult"; start: Point; origin: Point; moved: boolean }
    | null
  >(null);

  /** A point in diagram coordinates. */
  const toDiagram = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  const nodeAt = (p: Point): UmlNode | null => {
    for (const n of [...diagram.nodes].reverse()) {
      const at = positions[n.id];
      if (at && p.x >= at.x && p.x <= at.x + n.w && p.y >= at.y && p.y <= at.y + n.h) return n;
    }
    return null;
  };

  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(id);
    svgRef.current?.setPointerCapture(e.pointerId);
    if (tool === "inherit" || tool === "associate") {
      if (nodesById.get(id)?.library) return;
      drag.current = { kind: "link", from: id };
      setLink({ from: id, to: toDiagram(e) });
      return;
    }
    drag.current = { kind: "node", id, start: { x: e.clientX, y: e.clientY }, origin: positions[id], moved: false };
  };

  const onNoteDown = (n: Note) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "note", id: n.id, start: { x: e.clientX, y: e.clientY }, origin: { x: n.x, y: n.y }, moved: false };
  };

  const editNote = (note: Note | null, at?: Point) => {
    openDialog({
      kind: "prompt",
      title: note ? t("Edit note") : t("New note"),
      label: t("Text"),
      value: note?.text ?? "",
      confirmLabel: note ? t("Change") : t("Add"),
      multiline: true,
      onSubmit: (text) => {
        if (!layout) return;
        const notes = note
          ? layout.notes.map((x) => (x.id === note.id ? { ...x, text } : x))
          : [...layout.notes, { id: `n${Date.now()}`, x: Math.round(at!.x), y: Math.round(at!.y), text }];
        persist({ ...layout, notes: notes.filter((x) => x.text.trim()) });
      },
    });
  };

  const noteMenu = (n: Note) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t("Edit note…"), icon: Pencil, onSelect: () => editNote(n) },
        { label: t("Delete note"), icon: Trash2, danger: true, onSelect: () => layout && persist({ ...layout, notes: layout.notes.filter((x) => x.id !== n.id) }) },
      ],
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !layout) return;
    const dx = "start" in d ? e.clientX - d.start.x : 0;
    const dy = "start" in d ? e.clientY - d.start.y : 0;
    if (d.kind === "pan") {
      setView({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy });
    } else if (d.kind === "link") {
      setLink({ from: d.from, to: toDiagram(e) });
    } else if (d.kind === "bend") {
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      // `points` is the whole line when the drag started; its ends stay on the boxes.
      const pts = d.insert ? [...d.points.slice(0, d.index), { ...d.points[d.index - 1] }, ...d.points.slice(d.index)] : d.points.map((p) => ({ ...p }));
      const origin = d.insert ? { x: (d.points[d.index - 1].x + d.points[d.index].x) / 2, y: (d.points[d.index - 1].y + d.points[d.index].y) / 2 } : d.points[d.index];
      let p = { x: origin.x + dx / view.k, y: origin.y + dy / view.k };
      if (!e.altKey) {
        // Snap into line with the neighbouring points, so right angles are easy.
        const near = 7 / view.k;
        for (const q of [pts[d.index - 1], pts[d.index + 1]]) {
          if (!q) continue;
          if (Math.abs(p.x - q.x) < near) p = { ...p, x: q.x };
          if (Math.abs(p.y - q.y) < near) p = { ...p, y: q.y };
        }
      }
      pts[d.index] = { x: Math.round(p.x), y: Math.round(p.y) };
      setLayout({ ...layout, bends: { ...layout.bends, [d.edge]: pts.slice(1, -1) } });
    } else if (d.kind === "label") {
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      const was = layout.labels[d.edge] ?? {};
      setLayout({ ...layout, labels: { ...layout.labels, [d.edge]: { ...was, [d.which]: { x: Math.round(d.origin.x + dx / view.k), y: Math.round(d.origin.y + dy / view.k) } } } });
    } else if (d.kind === "note") {
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      setLayout({ ...layout, notes: layout.notes.map((n) => (n.id === d.id ? { ...n, x: Math.round(d.origin.x + dx / view.k), y: Math.round(d.origin.y + dy / view.k) } : n)) });
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

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if ((d?.kind === "node" || d?.kind === "note" || d?.kind === "bend" || d?.kind === "label") && d.moved && layout) persist(layout);
    if (d?.kind === "link") {
      setLink(null);
      const target = nodeAt(toDiagram(e));
      const from = nodesById.get(d.from);
      if (from && target && !target.library && target.id !== d.from && !from.type.language && !target.type.language) {
        if (tool === "inherit") void addInheritance(from.type, target.type);
        else askAssociation(from.type, target.type);
      }
    }
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

  const hide = (id: string) => {
    if (!layout) return;
    if (layout.classes) persist({ ...layout, classes: layout.classes.filter((c) => c !== id) });
    else persist({ ...layout, hidden: [...layout.hidden, id] });
  };

  /** The classes a class is related to, in the whole project. */
  const relatedTo = (id: string) => {
    const full = buildDiagram(allTypes, { ...opts, showLibrary: false });
    return full.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []));
  };

  const addClasses = (ids: string[]) => {
    if (!layout?.classes) return;
    persist({ ...layout, classes: [...new Set([...layout.classes, ...ids])] });
  };

  const pickClasses = () => {
    if (!layout?.classes) return;
    openDialog({
      kind: "pickClasses",
      title: t("Classes in this diagram"),
      options: [...allTypes].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ value: x.qualifiedName, label: x.name, detail: x.package || undefined })),
      selected: layout.classes,
      confirmLabel: t("Show these"),
      onSubmit: (values) => {
        const current = layoutRef.current;
        if (current) persist({ ...current, classes: values });
      },
    });
  };

  const newDiagram = () => {
    if (!root) return;
    const start = selected && !nodesById.get(selected)?.library ? [selected, ...relatedTo(selected)] : [];
    openDialog({
      kind: "prompt",
      title: t("New class diagram"),
      label: t("Name"),
      value: start.length ? `${nodesById.get(selected!)!.type.name}` : t("Diagram"),
      confirmLabel: t("Create"),
      validate: (v) => {
        const problem = invalidName(v);
        return problem ? t(problem) : null;
      },
      onSubmit: async (name) => {
        const path = join(root, `${name}.uml`);
        if (await api.exists(path).catch(() => false)) throw new Error(t("{0} already exists.", `${name}.uml`));
        const data: Layout = { ...EMPTY_LAYOUT, classes: [...new Set(start)], positions: {} };
        await api.writeText(path, JSON.stringify(data, null, 2) + "\n");
        void refreshTree(root);
        openDiagram(path);
      },
    });
  };

  const nodeMenu = (node: UmlNode) => (e: React.MouseEvent) => {
    e.preventDefault();
    setSelected(node.id);
    if (node.library) {
      openMenu({ x: e.clientX, y: e.clientY, items: [{ label: t("Hide from diagram"), icon: EyeOff, onSelect: () => hide(node.id) }] });
      return;
    }
    const type = node.type;
    const q = type.qualifiedName;
    if (type.language) {
      // Classes of other languages (Python) are shown from their code; the diagram edits Java only.
      openMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: t("Go to source"), icon: FileCode, onSelect: () => openAt(node, type.line) },
          layout?.classes ? { label: t("Remove from diagram"), icon: EyeOff, onSelect: () => hide(node.id) } : { label: t("Hide from diagram"), icon: EyeOff, onSelect: () => hide(node.id) },
          { label: t("Copy name"), icon: ClipboardCopy, onSelect: () => void navigator.clipboard.writeText(q) },
        ],
      });
      return;
    }
    const ctors = type.methods.filter((m) => m.isConstructor);
    const canCreate = (type.kind === "class" && !type.isAbstract) || type.kind === "record";
    const statics = type.methods.filter((m) => m.isStatic && !m.isConstructor);
    const items: MenuItem[] = [];
    if (canCreate) {
      items.push({ type: "heading", label: t("Object bench") });
      if (ctors.length) {
        for (const c of ctors) {
          items.push({
            label: `new ${type.name}(${c.params.map((p) => simpleType(p.type)).join(", ")})`,
            icon: Box,
            onSelect: () => openDialog({ kind: "benchNew", cls: q, ctorLine: c.line }),
          });
        }
      } else items.push({ label: `new ${type.name}()`, icon: Box, onSelect: () => openDialog({ kind: "benchNew", cls: q, ctorLine: null }) });
    }
    for (const m of statics) {
      items.push({
        label: `${type.name}.${describeMethod(m)}`,
        icon: Play,
        onSelect: () => (m.params.length && !(m.name === "main" && m.params.length === 1) ? openDialog({ kind: "benchCall", owner: q, methodLine: m.line, target: null }) : void benchCall(null, type, m, m.name === "main" ? ["{}"] : [])),
      });
    }
    if (items.length) items.push({ type: "separator" });
    items.push(
      { label: t("Create JUnit test"), icon: FlaskConical, onSelect: () => void createTestFor(type) },
      ...(type.name.endsWith("Test") ? [{ label: t("Run these tests"), icon: Play, onSelect: () => void runTests(q) }] : []),
      { type: "separator" },
      { label: t("Add attribute…"), icon: Plus, onSelect: () => openDialog({ kind: "member", owner: q, member: "field" }) },
      { label: t("Add method…"), icon: Plus, onSelect: () => openDialog({ kind: "member", owner: q, member: "method" }) },
    );
    if (type.kind === "class" || type.kind === "enum") items.push({ label: t("Add constructor…"), icon: Plus, onSelect: () => openDialog({ kind: "member", owner: q, member: "ctor" }) });
    items.push(
      { label: t("Edit class…"), icon: Pencil, onSelect: () => openDialog({ kind: "editClass", owner: q }) },
      { type: "separator" },
      { label: t("Go to source"), icon: FileCode, onSelect: () => openAt(node, type.line) },
      ...(layout?.classes
        ? [
            { label: t("Add related classes"), icon: Network, onSelect: () => addClasses(relatedTo(node.id)) },
            { label: t("Remove from diagram"), icon: EyeOff, onSelect: () => hide(node.id) },
          ]
        : [{ label: t("Hide from diagram"), icon: EyeOff, onSelect: () => hide(node.id) }]),
      { label: t("Copy name"), icon: ClipboardCopy, onSelect: () => void navigator.clipboard.writeText(q) },
      { type: "separator" },
      { label: t("Delete class…"), icon: Trash2, danger: true, onSelect: () => void deleteClass(type) },
    );
    openMenu({ x: e.clientX, y: e.clientY, items });
  };

  const memberMenu = (node: UmlNode) => (e: React.MouseEvent, line: number, kind: "field" | "method") => {
    const type = node.type;
    const field = kind === "field" ? type.fields.find((f) => f.line === line) : undefined;
    const method = kind === "method" ? type.methods.find((m) => m.line === line) : undefined;
    const member = field ?? method;
    if (!member) return;
    const label = field ? field.name : method!.isConstructor ? t("constructor") : method!.name;
    if (type.language) {
      openMenu({ x: e.clientX, y: e.clientY, items: [{ type: "heading", label }, { label: t("Go to code"), icon: FileCode, onSelect: () => openAt(node, line) }] });
      return;
    }
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { type: "heading", label },
        {
          label: field ? t("Edit attribute…") : method!.isConstructor ? t("Edit constructor…") : t("Edit method…"),
          icon: Pencil,
          onSelect: () => openDialog({ kind: "member", owner: type.qualifiedName, member: field ? "field" : method!.isConstructor ? "ctor" : "method", line }),
        },
        { label: t("Go to code"), icon: FileCode, onSelect: () => openAt(node, line) },
        { type: "separator" },
        { label: t("Delete"), icon: Trash2, danger: true, onSelect: () => void deleteMember(type.qualifiedName, member) },
      ],
    });
  };

  const resetEdge = (id: string, what: "bends" | "labels") => {
    if (!layout) return;
    const rest = { ...layout[what] };
    delete rest[id];
    persist({ ...layout, [what]: rest });
  };

  const edgeMenu = (edge: UmlEdge) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const a = nodesById.get(edge.from);
    const b = nodesById.get(edge.to);
    if (!a || !b) return;
    const removable = (edge.kind === "extends" || edge.kind === "implements" || edge.kind === "association") && !a.library && !a.type.language;
    const what = edge.kind === "association" ? t("association") : edge.kind === "dependency" ? t("dependency") : edge.kind === "nesting" ? t("nesting") : t("inheritance");
    openMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { type: "heading", label: `${a.type.name} → ${b.type.name} (${edge.whole === "aggregation" ? t("aggregation") : edge.whole === "composition" ? t("composition") : what})` },
        { label: t("Go to code"), icon: FileCode, onSelect: () => openAt(a, a.type.line) },
        ...(edge.kind === "association"
          ? [
              { type: "separator" as const },
              { label: t("Association"), checked: !edge.whole, onSelect: () => setWhole(edge.from, edge.to, null) },
              { label: t("Aggregation: {0} has {1} as a part", a.type.name, b.type.name), checked: edge.whole === "aggregation", onSelect: () => setWhole(edge.from, edge.to, "aggregation") },
              { label: t("Composition: {0} owns {1}", a.type.name, b.type.name), checked: edge.whole === "composition", onSelect: () => setWhole(edge.from, edge.to, "composition") },
            ]
          : []),
        ...(layout?.bends[edge.id] || layout?.labels[edge.id]
          ? [
              { type: "separator" as const },
              ...(layout.bends[edge.id] ? [{ label: t("Reset the line"), icon: Undo2, onSelect: () => resetEdge(edge.id, "bends") }] : []),
              ...(layout.labels[edge.id] ? [{ label: t("Reset the labels"), icon: Undo2, onSelect: () => resetEdge(edge.id, "labels") }] : []),
            ]
          : []),
        ...(removable
          ? [
              { type: "separator" as const },
              {
                label: t("Delete relation"),
                icon: Trash2,
                danger: true,
                onSelect: () => {
                  if (edge.kind === "association") setWhole(edge.from, edge.to, null);
                  void (edge.kind === "association" ? removeAssociation(a.type, b.type) : removeInheritance(a.type, b.type));
                },
              },
            ]
          : []),
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
        toggle("showLibrary", t("Library classes")),
        { type: "heading", label: t("Lines") },
        toggle("orthogonal", t("Right-angled lines")),
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
        { type: "separator" },
        { label: t("Export as PlantUML…"), icon: FileText, onSelect: () => void exportText("puml") },
        { label: t("Export as Mermaid…"), icon: FileText, onSelect: () => void exportText("mmd") },
        { label: t("Copy as PlantUML"), onSelect: () => void copyText(toPlantUml(diagram, opts.showTypes), "PlantUML") },
        { label: t("Copy as Mermaid"), onSelect: () => void copyText(toMermaid(diagram, opts.showTypes), "Mermaid") },
        { type: "separator" },
        { label: t("Print…"), icon: Printer, onSelect: () => void printDiagram() },
      ],
    });
  };

  async function copyText(text: string, what: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    toast("success", t("Copied as {0}", what), t("Paste it into a {0} editor or a Markdown file.", what));
  }

  async function exportText(kind: "puml" | "mmd") {
    const text = kind === "puml" ? toPlantUml(diagram, opts.showTypes) : toMermaid(diagram, opts.showTypes);
    const target = await pickSavePath({
      title: kind === "puml" ? t("Export as PlantUML") : t("Export as Mermaid"),
      defaultPath: root ? join(root, `class-diagram.${kind}`) : `class-diagram.${kind}`,
      filters: [{ name: kind === "puml" ? "PlantUML" : "Mermaid", extensions: [kind] }],
    }).catch(() => null);
    if (!target) return;
    try {
      await api.writeText(target, text);
      toast("success", t("Diagram exported"), target);
    } catch (err) {
      toast("error", t("The diagram wasn't exported"), errorText(err));
    }
  }

  /** The drawn diagram with every class in it: a large diagram, which draws only what is in view, is drawn whole for the moment. */
  function wholeDiagram(): SVGGElement | null {
    if (diagram.nodes.length > CULL_ABOVE) flushSync(() => setDrawAll(true));
    return svgRef.current?.querySelector<SVGGElement>(".uml-content") ?? null;
  }

  /** Prints the diagram in print colours, scaled to the page. */
  async function printDiagram() {
    const g = wholeDiagram();
    const b = bounds();
    if (!g || !b) return setDrawAll(false);
    const svg = await exportSvgString(g, b).finally(() => setDrawAll(false));
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><title>${t("UML class diagram")}</title><style>@page{margin:12mm}body{margin:0}svg{width:100%;height:auto;max-height:100vh}</style>${svg}`);
    doc.close();
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    }, 200);
  }

  async function doExport(kind: "svg" | "png" | "copy") {
    const g = wholeDiagram();
    const b = bounds();
    if (!g || !b) return setDrawAll(false);
    try {
      const svg = await exportSvgString(g, b).finally(() => setDrawAll(false));
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

  // Where each line runs; right-angled lines go around every box. A line is worked out again
  // only when something it depends on moved: its two boxes, or (in a large diagram) a box near it.
  const routeCache = useRef(new Map<string, { key: string; points: Point[] }>());
  const routes = useMemo(() => {
    const out = new Map<string, Point[]>();
    const cache = routeCache.current;
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    const rect = (id: string) => {
      const n = byId.get(id);
      const p = positions[id];
      return n && p ? { x: p.x, y: p.y, w: n.w, h: n.h } : null;
    };
    const obstacles = diagram.nodes.map((n) => rect(n.id)).filter((r): r is NonNullable<typeof r> => !!r);
    const sig = (r: Rect) => `${r.x},${r.y},${r.w},${r.h}`;
    const local = obstacles.length > ROUTE_LOCALLY_ABOVE;
    const everything = local ? "" : obstacles.map(sig).join(";");
    const assoc = new Set(diagram.edges.filter((e) => e.kind === "association").map((e) => `${e.from}->${e.to}`));
    const seen = new Set<string>();
    for (const edge of diagram.edges) {
      const a = rect(edge.from);
      const b = rect(edge.to);
      if (!a || !b) continue;
      const offset = edge.kind === "association" && edge.from !== edge.to && assoc.has(`${edge.to}->${edge.from}`) ? 7 : 0;
      const bends = layout?.bends[edge.id];
      const around = !opts.orthogonal || bends?.length ? "" : local ? routingRegion(a, b, obstacles).blockers.map(sig).join(";") : everything;
      const key = `${sig(a)}|${sig(b)}|${offset}|${opts.orthogonal}|${bends ? JSON.stringify(bends) : ""}|${around}`;
      seen.add(edge.id);
      const hit = cache.get(edge.id);
      if (hit?.key === key) {
        out.set(edge.id, hit.points);
        continue;
      }
      const points = route(edge, a, b, offset, { orthogonal: opts.orthogonal, obstacles, bends });
      cache.set(edge.id, { key, points });
      out.set(edge.id, points);
    }
    for (const id of [...cache.keys()]) if (!seen.has(id)) cache.delete(id);
    return out;
  }, [diagram, positions, opts.orthogonal, layout?.bends]);

  // A large diagram draws only what is in view (and the selected class, which the keyboard and screen readers point at).
  const [stageSize, setStageSize] = useState({ w: 1600, h: 1000 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => el.clientWidth && setStageSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [root]);
  // A diagram first shown before its canvas had a size (a pane that was closed) is fitted once it has one.
  useEffect(() => {
    if (visible && layout && !fitted.current && diagram.nodes.length && fit()) fitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize]);
  const shown = useMemo(() => (diagram.nodes.length > CULL_ABOVE && !drawAll ? visibleNodes(diagram.nodes, positions, view, stageSize) : null), [diagram, positions, view, stageSize, drawAll]);

  if (!root) return null;

  const hiddenCount = layout?.hidden.length ?? 0;
  const nodesById = new Map(diagram.nodes.map((n) => [n.id, n]));
  const domIdOf = (id: string) => `uml-node-${diagram.nodes.findIndex((n) => n.id === id)}`;
  const selectedNode = selected ? nodesById.get(selected) : undefined;
  const spoken = selectedNode ? describeNode(selectedNode, diagram.edges, nodesById) : "";
  /** Selects a class from the keyboard and brings it into view. */
  const selectByKey = (id: string) => {
    setSelected(id);
    setSelectedEdge(null);
    const n = nodesById.get(id);
    const p = positions[id];
    const el = stageRef.current;
    if (!n || !p || !el) return;
    const pan = panIntoView({ x: p.x, y: p.y, w: n.w, h: n.h }, view, { w: el.clientWidth, h: el.clientHeight });
    if (pan.dx || pan.dy) setView({ ...view, x: view.x + pan.dx, y: view.y + pan.dy });
  };
  const focus = hover ?? selected;
  // A frame around each package when the diagram shows more than one.
  const packages = new Map<string, UmlNode[]>();
  for (const n of diagram.nodes) if (!n.library) packages.set(n.type.package, [...(packages.get(n.type.package) ?? []), n]);
  const frames =
    packages.size > 1
      ? [...packages].flatMap(([pkg, ns]) => {
          const ps = ns.map((n) => ({ n, p: positions[n.id] })).filter((x) => x.p);
          if (!ps.length) return [];
          const x0 = Math.min(...ps.map((x) => x.p.x)) - 16;
          const y0 = Math.min(...ps.map((x) => x.p.y)) - 34;
          const x1 = Math.max(...ps.map((x) => x.p.x + x.n.w)) + 16;
          const y1 = Math.max(...ps.map((x) => x.p.y + x.n.h)) + 16;
          return [{ pkg: pkg || t("(default package)"), x0, y0, x1, y1 }];
        })
      : [];
  const related = new Set<string>();
  if (focus) {
    related.add(focus);
    for (const e of diagram.edges) if (e.from === focus || e.to === focus) related.add(e.from === focus ? e.to : e.from);
  }

  return (
    <div className="uml" hidden={!visible}>
      <div className="uml-toolbar">
        <Select
          value={diagramPath ?? PROJECT}
          onChange={(v) => openDiagram(v === PROJECT ? null : v)}
          options={[{ value: PROJECT, label: t("Project diagram") }, ...diagramFiles.map((f) => ({ value: f, label: relative(root, f).replace(/\.uml$/i, "") }))]}
          label={t("Diagram")}
          compact
        />
        <IconButton icon={FilePlus2} label={t("New class diagram…")} spacing="compact" onClick={newDiagram} />
        <span className="toolbar-divider" />
        {layout?.classes ? (
          <Button spacing="compact" iconBefore={ListChecks} onClick={pickClasses}>
            {t("Classes…")}
          </Button>
        ) : (
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
        )}
        <Button spacing="compact" iconBefore={SlidersHorizontal} onClick={optionMenu}>
          {t("View")}
        </Button>
        {hiddenCount > 0 && !layout?.classes && (
          <Button spacing="compact" iconBefore={Eye} onClick={() => layout && persist({ ...layout, hidden: [] })} tooltip={t("Show the classes you hid")}>
            {t("Show {0} hidden", hiddenCount)}
          </Button>
        )}
        <div className="segmented uml-tools" role="radiogroup" aria-label={t("Tool")}>
          {(
            [
              ["select", MousePointer2, t("Select and move")],
              ["inherit", Triangle, t("Draw inheritance: drag from the subclass to the superclass or interface")],
              ["associate", ArrowRight, t("Draw an association: drag from the class that holds the other")],
              ["note", StickyNote, t("Add a note: click where it goes")],
            ] as const
          ).map(([k, Icon, label]) => (
            <button key={k} type="button" role="radio" aria-checked={tool === k} aria-label={label} data-tooltip={label} className={cx("segment", tool === k && "is-selected")} onClick={() => setTool(k)}>
              <Icon size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
        <span className="spacer" />
        <Button spacing="compact" iconBefore={Plus} onClick={() => openDialog({ kind: "classWizard", dir: newClassDir(scope === ALL ? null : scope) })}>
          {t("New class")}
        </Button>
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
        role="application"
        aria-roledescription={t("class diagram")}
        aria-label={t("UML class diagram, classes: {0}. Arrow keys go from class to class, Enter opens the code, the menu key opens the class's menu, Alt and the arrow keys move the box.", diagram.nodes.length)}
        aria-activedescendant={selected ? domIdOf(selected) : undefined}
        onFocus={(e) => {
          // Coming in with the keyboard: start at the first class.
          if (e.target === e.currentTarget && !selected && diagram.nodes.length && e.currentTarget.matches(":focus-visible")) selectByKey(diagram.nodes[0].id);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const arrow = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as Record<string, Direction>)[e.key];
          if (arrow && !e.altKey && !e.ctrlKey) {
            // From class to class; the first one when none is selected.
            const next = selected ? neighbour(diagram.nodes, positions, selected, arrow) : (diagram.nodes[0]?.id ?? null);
            if (next) selectByKey(next);
            e.preventDefault();
            return;
          }
          if ((e.key === "Home" || e.key === "End") && diagram.nodes.length) {
            selectByKey(diagram.nodes[e.key === "Home" ? 0 : diagram.nodes.length - 1].id);
            e.preventDefault();
            return;
          }
          if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && selected) {
            // The class's menu, where the class is.
            const n = nodesById.get(selected);
            const el = document.getElementById(domIdOf(selected));
            const r = el?.getBoundingClientRect();
            if (n && r) nodeMenu(n)({ preventDefault() {}, clientX: r.left + 12, clientY: r.top + 28 } as unknown as React.MouseEvent);
            e.preventDefault();
            return;
          }
          if (e.key === "f" || e.key === "F") fit();
          else if (e.key === "+" || e.key === "=") zoomBy(1.2);
          else if (e.key === "-") zoomBy(1 / 1.2);
          else if (e.key === "Escape") {
            setSelected(null);
            setSelectedEdge(null);
          }
          else if (selected && layout && e.key.startsWith("Arrow") && (e.altKey || e.ctrlKey)) {
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
        {diagram.nodes.length === 0 && layout?.classes ? (
          <div className="uml-empty">
            <EmptyState
              icon={Network}
              title={t("No classes in this diagram yet")}
              actions={
                <Button appearance="primary" iconBefore={ListChecks} onClick={pickClasses}>
                  {t("Choose classes…")}
                </Button>
              }
            >
              {t("A diagram of its own shows the classes you choose, for one part of the project.")}
            </EmptyState>
          </div>
        ) : diagram.nodes.length === 0 ? (
          <div className="uml-empty">
            <EmptyState
              icon={Network}
              title={allTypes.length ? t("Every class is hidden") : t("No Java classes yet")}
              actions={
                allTypes.length ? (
                  <Button onClick={() => layout && persist({ ...layout, hidden: [] })}>{t("Show all classes")}</Button>
                ) : (
                  <Button appearance="primary" iconBefore={Plus} onClick={() => openDialog({ kind: "classWizard", dir: root })}>
                    {t("New class")}
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
            className={cx("uml-svg", tool !== "select" && `is-tool-${tool}`)}
            onPointerDown={(e) => {
              if (e.button !== 0 && e.button !== 1) return;
              if (tool === "note" && e.button === 0) {
                editNote(null, toDiagram(e));
                setTool("select");
                return;
              }
              setSelected(null);
              setSelectedEdge(null);
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
              <g className="uml-frames">
                {frames.map((f) => (
                  <g key={f.pkg}>
                    <rect className="uml-frame" x={f.x0} y={f.y0} width={f.x1 - f.x0} height={f.y1 - f.y0} rx={14} />
                    <text className="uml-frame-label" x={f.x0 + 12} y={f.y0 + 18}>
                      {f.pkg}
                    </text>
                  </g>
                ))}
              </g>
              <g className="uml-notes">
                {(layout?.notes ?? []).map((n) => (
                  <NoteBox key={n.id} note={n} onPointerDown={onNoteDown(n)} onEdit={() => editNote(n)} onMenu={noteMenu(n)} />
                ))}
              </g>
              <g className="uml-edges">
                {diagram.edges.map((edge) => {
                  const pts = routes.get(edge.id);
                  if (!pts) return null;
                  if (shown && selectedEdge !== edge.id && !lineInView(pts, edge.from, edge.to, shown, view, stageSize)) return null;
                  const hot = !!focus && (edge.from === focus || edge.to === focus);
                  return (
                    <EdgeLine
                      key={edge.id}
                      edge={edge}
                      points={pts}
                      hot={hot}
                      dim={!!focus && !hot}
                      selected={selectedEdge === edge.id}
                      labelOffset={layout?.labels[edge.id]}
                      onMenu={(e) => {
                        setSelectedEdge(edge.id);
                        edgeMenu(edge)(e);
                      }}
                      onSelect={(e) => {
                        if (e.button !== 0 || tool !== "select") return;
                        e.stopPropagation();
                        setSelected(null);
                        setSelectedEdge(edge.id);
                        stageRef.current?.focus();
                      }}
                      onHandleDown={(index, insert) => (e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        svgRef.current?.setPointerCapture(e.pointerId);
                        drag.current = { kind: "bend", edge: edge.id, index, insert, start: { x: e.clientX, y: e.clientY }, points: pts, moved: false };
                      }}
                      onBendRemove={(index) => {
                        if (!layout) return;
                        const bends = pts.slice(1, -1).filter((_, i) => i !== index - 1);
                        if (bends.length) persist({ ...layout, bends: { ...layout.bends, [edge.id]: bends } });
                        else resetEdge(edge.id, "bends");
                      }}
                      onLabelDown={(which) => (e) => {
                        if (e.button !== 0 || tool !== "select") return;
                        e.stopPropagation();
                        setSelectedEdge(edge.id);
                        svgRef.current?.setPointerCapture(e.pointerId);
                        drag.current = { kind: "label", edge: edge.id, which, start: { x: e.clientX, y: e.clientY }, origin: layout?.labels[edge.id]?.[which] ?? { x: 0, y: 0 }, moved: false };
                      }}
                    />
                  );
                })}
              </g>
              <g className="uml-nodes">
                {diagram.nodes.map((n) =>
                  positions[n.id] && (!shown || shown.has(n.id) || selected === n.id) ? (
                    <NodeBox
                      key={n.id}
                      node={n}
                      at={positions[n.id]}
                      selected={selected === n.id}
                      dim={!!focus && !related.has(n.id)}
                      domId={domIdOf(n.id)}
                      description={selected === n.id ? spoken : n.type.name}
                      onPointerDown={onNodeDown(n.id)}
                      onOpen={(line) => openAt(n, line)}
                      onMenu={nodeMenu(n)}
                      onMemberMenu={memberMenu(n)}
                      onHover={(on) => setHover(on ? n.id : null)}
                    />
                  ) : null,
                )}
              </g>
              {link && positions[link.from] && nodesById.get(link.from) && (
                <line
                  className={cx("uml-link", tool === "inherit" && "is-inherit")}
                  x1={positions[link.from].x + nodesById.get(link.from)!.w / 2}
                  y1={positions[link.from].y + nodesById.get(link.from)!.h / 2}
                  x2={link.to.x}
                  y2={link.to.y}
                />
              )}
            </g>
          </svg>
        )}
        {/* What the selected class is, said aloud when the selection moves. */}
        <div className="visually-hidden" aria-live="polite" aria-atomic="true">
          {spoken}
        </div>
        <div className="uml-legend" aria-hidden="true">
          {tool === "select" ? (
            <>
              <span>{t("Drag boxes to arrange")}</span>
              <span>{t("Click a line to bend it")}</span>
              <span>{t("Right-click a class to edit it or create objects")}</span>
              <span>{t("Ctrl + wheel to zoom")}</span>
            </>
          ) : (
            <span>{tool === "note" ? t("Click where the note goes") : t("Drag from one class to another")}</span>
          )}
        </div>
      </div>
      {benchCount >= 0 && <BenchPanel />}
    </div>
  );
}
