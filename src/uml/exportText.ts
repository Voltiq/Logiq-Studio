/*
 * The class diagram as text for other tools: PlantUML and Mermaid. Both are
 * written from the same model the diagram draws, with the same options.
 */
import { simpleType } from "./javaParser";
import type { Diagram } from "./diagram";
import type { JType, Visibility } from "./model";

const VIS: Record<Visibility, string> = { public: "+", protected: "#", package: "~", private: "-" };

function shortName(id: string, diagram: Diagram) {
  const n = diagram.nodes.find((x) => x.id === id);
  return n ? n.type.name : id;
}

function headPlant(t: JType, library: boolean): string {
  if (library) return `class ${t.name} #EEEEEE`;
  if (t.kind === "interface") return `interface ${t.name}`;
  if (t.kind === "enum") return `enum ${t.name}`;
  if (t.kind === "record") return `class ${t.name} <<record>>`;
  if (t.kind === "annotation") return `annotation ${t.name}`;
  return `${t.isAbstract ? "abstract class" : "class"} ${t.name}`;
}

export function toPlantUml(d: Diagram, showTypes = true): string {
  const out = ["@startuml", "hide empty members", "skinparam classAttributeIconSize 0", ""];
  for (const n of d.nodes) {
    const t = n.type;
    const members: string[] = [];
    for (const c of n.constants) members.push(`  ${c}`);
    if (n.showAttributes)
      for (const f of t.fields.filter((x) => n.attributes.some((a) => a.line === x.line))) {
        members.push(`  ${f.isStatic ? "{static} " : ""}${VIS[f.visibility]}${f.name}${showTypes ? ` : ${simpleType(f.type)}` : ""}`);
      }
    if (n.showOperations)
      for (const m of t.methods.filter((x) => n.operations.some((o) => o.line === x.line))) {
        const ps = m.params.map((p) => (showTypes ? `${p.name} : ${simpleType(p.type)}` : p.name)).join(", ");
        const ret = !m.isConstructor && m.returnType && m.returnType !== "void" && showTypes ? ` : ${simpleType(m.returnType)}` : "";
        members.push(`  ${m.isStatic ? "{static} " : ""}${m.isAbstract ? "{abstract} " : ""}${VIS[m.visibility]}${m.name}(${ps})${ret}`);
      }
    out.push(`${headPlant(t, !!n.library)}${members.length ? " {" : ""}`, ...members, ...(members.length ? ["}"] : []));
  }
  out.push("");
  for (const e of d.edges) {
    const a = shortName(e.from, d);
    const b = shortName(e.to, d);
    if (e.kind === "extends") out.push(`${b} <|-- ${a}`);
    else if (e.kind === "implements") out.push(`${b} <|.. ${a}`);
    else if (e.kind === "dependency") out.push(`${a} ..> ${b}`);
    else if (e.kind === "nesting") out.push(`${b} +-- ${a}`);
    else {
      const mult = [...new Set(e.labels.map((l) => l.multiplicity))].join(", ");
      const role = e.labels.map((l) => l.role).join(", ");
      out.push(`${a} --> ${mult ? `"${mult}" ` : ""}${b}${role ? ` : ${role}` : ""}`);
    }
  }
  out.push("@enduml", "");
  return out.join("\n");
}

const mer = (s: string) => simpleType(s).replace(/</g, "~").replace(/>/g, "~");

export function toMermaid(d: Diagram, showTypes = true): string {
  const out = ["classDiagram"];
  for (const n of d.nodes) {
    const t = n.type;
    out.push(`  class ${t.name} {`);
    if (n.library) out.push("    <<library>>");
    else if (t.kind === "interface") out.push("    <<interface>>");
    else if (t.kind === "enum") out.push("    <<enumeration>>");
    else if (t.kind === "record") out.push("    <<record>>");
    else if (t.isAbstract) out.push("    <<abstract>>");
    for (const c of n.constants) out.push(`    ${c}`);
    if (n.showAttributes)
      for (const f of t.fields.filter((x) => n.attributes.some((a) => a.line === x.line))) out.push(`    ${VIS[f.visibility]}${showTypes ? mer(f.type) + " " : ""}${f.name}${f.isStatic ? "$" : ""}`);
    if (n.showOperations)
      for (const m of t.methods.filter((x) => n.operations.some((o) => o.line === x.line))) {
        const ps = m.params.map((p) => (showTypes ? `${mer(p.type)} ${p.name}` : p.name)).join(", ");
        const ret = !m.isConstructor && m.returnType && m.returnType !== "void" && showTypes ? ` ${mer(m.returnType)}` : "";
        out.push(`    ${VIS[m.visibility]}${m.name}(${ps})${m.isAbstract ? "*" : m.isStatic ? "$" : ""}${ret}`);
      }
    out.push("  }");
  }
  for (const e of d.edges) {
    const a = shortName(e.from, d);
    const b = shortName(e.to, d);
    if (e.kind === "extends") out.push(`  ${b} <|-- ${a}`);
    else if (e.kind === "implements") out.push(`  ${b} <|.. ${a}`);
    else if (e.kind === "dependency") out.push(`  ${a} ..> ${b}`);
    else if (e.kind === "nesting") out.push(`  ${b} +-- ${a}`);
    else {
      const mult = [...new Set(e.labels.map((l) => l.multiplicity))].join(", ");
      const role = e.labels.map((l) => l.role.replace(/^[-+#~]/, "")).join(", ");
      out.push(`  ${a} --> ${mult ? `"${mult}" ` : ""}${b}${role ? ` : ${role}` : ""}`);
    }
  }
  return out.join("\n") + "\n";
}
