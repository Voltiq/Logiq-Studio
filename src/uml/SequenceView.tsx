import { useMemo, useRef } from "react";
import { ClipboardCopy, Download, ListVideo, Play } from "lucide-react";
import { save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { api, errorText } from "../lib/api";
import { toast, useStore } from "../lib/store";
import { join } from "../lib/paths";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";
import { startDebug, useDebug, type Trace } from "../lib/debug";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/Feedback";
import { exportSvgString } from "./exportDiagram";

const COL = 170;
const TOP = 58;
const ROW = 30;

interface Layout {
  participants: string[];
  rows: { kind: "call" | "return"; from: number; to: number; label: string; y: number; depth: number }[];
  activations: { col: number; y0: number; y1: number; level: number }[];
  height: number;
}

/** Places participants in columns and messages in rows, with activation bars for each call. */
export function layoutTrace(trace: Trace, hideReturns = false): Layout {
  const participants = trace.participants.length ? trace.participants : ["actor"];
  const col = (p: string) => Math.max(0, participants.indexOf(p));
  const rows: Layout["rows"] = [];
  const activations: Layout["activations"] = [];
  const open: { col: number; y0: number; level: number }[] = [];
  let y = TOP + 34;
  for (const c of trace.calls) {
    if (c.kind === "call") {
      rows.push({ kind: "call", from: col(c.from), to: col(c.to), label: `${c.method === "new" ? "«create»" : c.method}(${c.args ?? ""})`, y, depth: c.depth });
      const level = open.filter((o) => o.col === col(c.to)).length;
      open.push({ col: col(c.to), y0: y, level });
      y += ROW;
    } else {
      const a = open.pop();
      if (!hideReturns && c.method !== "new") {
        rows.push({ kind: "return", from: col(c.from), to: col(c.to), label: c.value ?? "", y, depth: c.depth });
      }
      if (a) activations.push({ col: a.col, y0: a.y0, y1: y - (hideReturns || c.method === "new" ? ROW / 2 : 0), level: a.level });
      y += hideReturns || c.method === "new" ? 6 : ROW;
    }
  }
  for (const a of open) activations.push({ col: a.col, y0: a.y0, y1: y, level: a.level });
  return { participants, rows, activations, height: y + 30 };
}

export function traceToPlantUml(trace: Trace): string {
  const name = (p: string) => (p === "actor" ? "User" : `"${p}"`);
  const out = ["@startuml", "actor User"];
  for (const p of trace.participants) if (p !== "actor") out.push(`participant ${name(p)}`);
  for (const c of trace.calls) {
    if (c.kind === "call") out.push(`${name(c.from)} -> ${name(c.to)} : ${c.method === "new" ? "<<create>>" : c.method}(${c.args ?? ""})`, `activate ${name(c.to)}`);
    else {
      if (c.method !== "new" && c.value) out.push(`${name(c.from)} --> ${name(c.to)} : ${c.value}`);
      out.push(`deactivate ${name(c.from)}`);
    }
  }
  out.push("@enduml", "");
  return out.join("\n");
}

/* The sequence diagram of the last recorded run: who called whom, in order. */
export function SequenceView({ visible }: { visible: boolean }) {
  const trace = useDebug((s) => s.trace);
  const tracing = useDebug((s) => s.tracing && s.status !== "off");
  const root = useStore((s) => s.root);
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = useMemo(() => (trace ? layoutTrace(trace) : null), [trace]);

  const exportSvg = async () => {
    const g = svgRef.current?.querySelector<SVGGElement>(".uml-content");
    if (!g || !layout) return;
    try {
      const svg = await exportSvgString(g, { x0: 0, y0: 0, x1: layout.participants.length * COL, y1: layout.height });
      const target = await pickSavePath({ title: t("Export as SVG"), defaultPath: root ? join(root, "sequence-diagram.svg") : "sequence-diagram.svg", filters: [{ name: "SVG", extensions: ["svg"] }] });
      if (!target) return;
      await api.writeText(target, svg);
      toast("success", t("Diagram exported"), target);
    } catch (e) {
      toast("error", t("The diagram wasn't exported"), errorText(e));
    }
  };

  return (
    <div className="uml sequence" hidden={!visible}>
      <div className="uml-toolbar">
        <Button spacing="compact" appearance="primary" iconBefore={Play} disabled={tracing || !root} loading={tracing} onClick={() => void startDebug(true)}>
          {t("Record a run")}
        </Button>
        {trace?.truncated && <span className="debug-note">{t("Only the first 2000 calls were recorded.")}</span>}
        <span className="spacer" />
        <Button spacing="compact" iconBefore={ClipboardCopy} disabled={!trace} onClick={() => trace && void navigator.clipboard.writeText(traceToPlantUml(trace)).then(() => toast("success", t("Copied as {0}", "PlantUML")))}>
          {t("Copy as PlantUML")}
        </Button>
        <Button spacing="compact" iconBefore={Download} disabled={!trace} onClick={() => void exportSvg()}>
          {t("Export")}
        </Button>
      </div>
      <div className="uml-stage seq-stage">
        {!trace || !layout ? (
          <div className="uml-empty">
            <EmptyState icon={ListVideo} title={t("No run recorded yet")}>
              {t("Record a run: the program runs, and every call between your classes is drawn as a sequence diagram.")}
            </EmptyState>
          </div>
        ) : (
          <svg ref={svgRef} className="uml-svg seq-svg" width={layout.participants.length * COL + 20} height={layout.height}>
            <g className="uml-content">
              {layout.participants.map((p, i) => {
                const x = i * COL + COL / 2;
                const [name, cls] = p.includes(":") ? p.split(":") : [p, ""];
                return (
                  <g key={p}>
                    <line className="seq-lifeline" x1={x} x2={x} y1={TOP} y2={layout.height - 10} />
                    <rect className="uml-box" x={x - COL / 2 + 10} y={10} width={COL - 20} height={TOP - 18} rx={8} />
                    <rect className="uml-outline" x={x - COL / 2 + 10} y={10} width={COL - 20} height={TOP - 18} rx={8} />
                    <text className={cx("uml-title", cls && "is-object")} x={x} y={10 + (TOP - 18) / 2 + 5} textAnchor="middle">
                      {p === "actor" ? t("User") : cls ? `${name} : ${cls}` : name.replace(/^.*\./, "")}
                    </text>
                  </g>
                );
              })}
              {layout.activations.map((a, i) => (
                <rect key={i} className="seq-activation" x={a.col * COL + COL / 2 - 5 + a.level * 6} y={a.y0} width={10} height={Math.max(8, a.y1 - a.y0)} />
              ))}
              {layout.rows.map((r, i) => {
                const x1 = r.from * COL + COL / 2;
                const x2 = r.to * COL + COL / 2;
                const self = r.from === r.to;
                const dir = x2 >= x1 ? 1 : -1;
                const ret = r.kind === "return";
                if (self) {
                  return (
                    <g key={i} className={cx("uml-relation", ret && "is-return")}>
                      <path className={cx("uml-edge", ret && "is-dashed")} d={`M${x1 + 5},${r.y - 8} h28 v14 h-24`} />
                      <path className="uml-arrow-open" d={`M${x1 + 17},${r.y + 1} l-8,5 l8,5`} transform={`translate(0,-5)`} />
                      <text className="uml-label" x={x1 + 38} y={r.y}>
                        {r.label}
                      </text>
                    </g>
                  );
                }
                const end = x2 - dir * 6;
                return (
                  <g key={i} className={cx("uml-relation", ret && "is-return")}>
                    <line className={cx("uml-edge", ret && "is-dashed")} x1={x1 + dir * 6} x2={end} y1={r.y} y2={r.y} />
                    {ret ? (
                      <path className="uml-arrow-open" d={`M${end - dir * 9},${r.y - 5} L${end},${r.y} L${end - dir * 9},${r.y + 5}`} />
                    ) : (
                      <path className="seq-arrow-filled" d={`M${end - dir * 10},${r.y - 5} L${end},${r.y} L${end - dir * 10},${r.y + 5} z`} />
                    )}
                    <text className="uml-label" x={(x1 + x2) / 2} y={r.y - 5} textAnchor="middle">
                      {r.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
