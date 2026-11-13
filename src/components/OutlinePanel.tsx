import { Box, Braces, CircleDot, Component, Diamond, Layers, ListTree, Play, SquareFunction, Variable } from "lucide-react";
import { activeTab, useStore } from "../lib/store";
import { goTo } from "../lib/actions";
import { structureOf, useStructureVersion } from "../uml/javaIndex";
import { simpleType } from "../uml/javaParser";
import { VISIBILITY_SYMBOL, type JType } from "../uml/model";
import { EmptyState } from "./ui/Feedback";
import { basename } from "../lib/paths";
import { t } from "../lib/i18n";

const KIND_ICON = { class: Box, interface: Component, enum: Layers, record: Braces, annotation: CircleDot };

/* The structure of the active file (Java or Python): its types and their members, and its functions. */
export function OutlinePanel() {
  useStructureVersion();
  const path = useStore((s) => activeTab(s)?.path ?? null);
  const line = useStore((s) => s.cursor.line);
  const file = path ? structureOf(path) : null;

  if (!file) {
    return (
      <div className="side-section">
        <div className="side-head">
          <span className="side-title">{t("Outline")}</span>
        </div>
        <div className="side-empty">
          <EmptyState icon={ListTree} title={t("No outline")} compact>
            {t("Open a Java or Python file to see its classes, fields and methods here.")}
          </EmptyState>
        </div>
      </div>
    );
  }

  const depth = (x: JType) => {
    let d = 0;
    for (let o = x.outer; o; o = file.types.find((x) => x.qualifiedName === o)?.outer ?? null) d++;
    return d;
  };
  // The innermost member whose declaration starts at or before the cursor.
  const members = [...file.types.flatMap((x) => [...x.fields.map((f) => f.line), ...x.methods.map((m) => m.line), x.line]), ...(file.functions ?? []).map((f) => f.line)];
  const current = Math.max(...members.filter((l) => l <= line), -1);

  return (
    <div className="side-section">
      <div className="side-head">
        <span className="side-title">Outline · {basename(path!)}</span>
      </div>
      <div className="outline" role="tree" aria-label={t("Outline")}>
        {file.types.map((x) => {
          const Icon = KIND_ICON[x.kind];
          const pad = 8 + depth(x) * 14;
          return (
            <div key={x.qualifiedName} role="group">
              <button type="button" role="treeitem" className={`outline-row is-type${current === x.line ? " is-current" : ""}`} style={{ paddingLeft: pad }} onClick={() => goTo(x.line)}>
                <Icon size={14} className="outline-icon is-type" aria-hidden="true" />
                <span className={x.isAbstract && x.kind === "class" ? "is-italic" : undefined}>{x.name}</span>
                {x.typeParams && <span className="outline-detail">{simpleType(x.typeParams)}</span>}
                {x.hasMain && <Play size={12} className="outline-main" aria-label={t("Has a main method")} />}
              </button>
              {x.constants.map((c) => (
                <div key={c} className="outline-row is-constant" style={{ paddingLeft: pad + 18 }}>
                  <Diamond size={12} className="outline-icon" aria-hidden="true" />
                  <span>{c}</span>
                </div>
              ))}
              {x.fields.map((f) => (
                <button key={`f${f.name}`} type="button" role="treeitem" className={`outline-row${current === f.line ? " is-current" : ""}`} style={{ paddingLeft: pad + 18 }} onClick={() => goTo(f.line)}>
                  <Variable size={13} className="outline-icon is-field" aria-hidden="true" />
                  <span className="outline-vis">{VISIBILITY_SYMBOL[f.visibility]}</span>
                  <span className={f.isStatic ? "is-static" : undefined}>{f.name}</span>
                  {f.type && <span className="outline-detail">{simpleType(f.type)}</span>}
                </button>
              ))}
              {x.methods.map((m, i) => (
                <button key={`m${i}`} type="button" role="treeitem" className={`outline-row${current === m.line ? " is-current" : ""}`} style={{ paddingLeft: pad + 18 }} onClick={() => goTo(m.line)}>
                  <SquareFunction size={13} className={`outline-icon ${m.isConstructor ? "is-ctor" : "is-method"}`} aria-hidden="true" />
                  <span className="outline-vis">{VISIBILITY_SYMBOL[m.visibility]}</span>
                  <span className={[m.isStatic && "is-static", m.isAbstract && "is-italic"].filter(Boolean).join(" ") || undefined}>{m.name}</span>
                  <span className="outline-detail">
                    ({m.params.map((p) => (x.language ? (p.type ? `${p.name}: ${simpleType(p.type)}` : p.name) : simpleType(p.type))).join(", ")}){m.returnType && m.returnType !== "void" ? `: ${simpleType(m.returnType)}` : ""}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
        {(file.functions ?? []).map((m, i) => (
          <button key={`fn${i}`} type="button" role="treeitem" className={`outline-row${current === m.line ? " is-current" : ""}`} style={{ paddingLeft: 8 }} onClick={() => goTo(m.line)}>
            <SquareFunction size={13} className="outline-icon is-method" aria-hidden="true" />
            <span>{m.name}</span>
            <span className="outline-detail">
              ({m.params.map((p) => (p.type ? `${p.name}: ${simpleType(p.type)}` : p.name)).join(", ")}){m.returnType && m.returnType !== "void" ? `: ${simpleType(m.returnType)}` : ""}
            </span>
          </button>
        ))}
        {file.types.length === 0 && !file.functions?.length && <p className="side-empty-note">{t("No classes or functions in this file.")}</p>}
      </div>
    </div>
  );
}
