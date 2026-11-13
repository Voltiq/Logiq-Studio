import { Box, Braces, CircleDot, Component, Diamond, Layers, ListTree, Play, SquareFunction, Variable } from "lucide-react";
import { useStore } from "../lib/store";
import { goTo } from "../lib/actions";
import { javaIndex, useJavaIndexVersion } from "../uml/javaIndex";
import { simpleType } from "../uml/javaParser";
import { VISIBILITY_SYMBOL, type JType } from "../uml/model";
import { EmptyState } from "./ui/Feedback";
import { languageFor } from "../editor/languages";
import { basename } from "../lib/paths";

const KIND_ICON = { class: Box, interface: Component, enum: Layers, record: Braces, annotation: CircleDot };

/* The structure of the active Java file: its types and their members. */
export function OutlinePanel() {
  useJavaIndexVersion();
  const path = useStore((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null);
  const line = useStore((s) => s.cursor.line);
  const file = path && languageFor(path).id === "java" ? javaIndex.file(path) : null;

  if (!file) {
    return (
      <div className="side-section">
        <div className="side-head">
          <span className="side-title">Outline</span>
        </div>
        <div className="side-empty">
          <EmptyState icon={ListTree} title="No outline" compact>
            Open a Java file to see its classes, fields and methods here.
          </EmptyState>
        </div>
      </div>
    );
  }

  const depth = (t: JType) => {
    let d = 0;
    for (let o = t.outer; o; o = file.types.find((x) => x.qualifiedName === o)?.outer ?? null) d++;
    return d;
  };
  // The innermost member whose declaration starts at or before the cursor.
  const members = file.types.flatMap((t) => [...t.fields.map((f) => f.line), ...t.methods.map((m) => m.line), t.line]);
  const current = Math.max(...members.filter((l) => l <= line), -1);

  return (
    <div className="side-section">
      <div className="side-head">
        <span className="side-title">Outline · {basename(path!)}</span>
      </div>
      <div className="outline" role="tree" aria-label="Outline">
        {file.types.map((t) => {
          const Icon = KIND_ICON[t.kind];
          const pad = 8 + depth(t) * 14;
          return (
            <div key={t.qualifiedName} role="group">
              <button type="button" role="treeitem" className={`outline-row is-type${current === t.line ? " is-current" : ""}`} style={{ paddingLeft: pad }} onClick={() => goTo(t.line)}>
                <Icon size={14} className="outline-icon is-type" aria-hidden="true" />
                <span className={t.isAbstract && t.kind === "class" ? "is-italic" : undefined}>{t.name}</span>
                {t.typeParams && <span className="outline-detail">{simpleType(t.typeParams)}</span>}
                {t.hasMain && <Play size={12} className="outline-main" aria-label="Has a main method" />}
              </button>
              {t.constants.map((c) => (
                <div key={c} className="outline-row is-constant" style={{ paddingLeft: pad + 18 }}>
                  <Diamond size={12} className="outline-icon" aria-hidden="true" />
                  <span>{c}</span>
                </div>
              ))}
              {t.fields.map((f) => (
                <button key={`f${f.name}`} type="button" role="treeitem" className={`outline-row${current === f.line ? " is-current" : ""}`} style={{ paddingLeft: pad + 18 }} onClick={() => goTo(f.line)}>
                  <Variable size={13} className="outline-icon is-field" aria-hidden="true" />
                  <span className="outline-vis">{VISIBILITY_SYMBOL[f.visibility]}</span>
                  <span className={f.isStatic ? "is-static" : undefined}>{f.name}</span>
                  <span className="outline-detail">{simpleType(f.type)}</span>
                </button>
              ))}
              {t.methods.map((m, i) => (
                <button key={`m${i}`} type="button" role="treeitem" className={`outline-row${current === m.line ? " is-current" : ""}`} style={{ paddingLeft: pad + 18 }} onClick={() => goTo(m.line)}>
                  <SquareFunction size={13} className={`outline-icon ${m.isConstructor ? "is-ctor" : "is-method"}`} aria-hidden="true" />
                  <span className="outline-vis">{VISIBILITY_SYMBOL[m.visibility]}</span>
                  <span className={[m.isStatic && "is-static", m.isAbstract && "is-italic"].filter(Boolean).join(" ") || undefined}>{m.name}</span>
                  <span className="outline-detail">
                    ({m.params.map((p) => simpleType(p.type)).join(", ")}){m.returnType && m.returnType !== "void" ? `: ${simpleType(m.returnType)}` : ""}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
