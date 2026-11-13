/*
 * Stylelint problems in CSS, SCSS and Less files, from the project's own
 * Stylelint (when it has one in node_modules).
 */
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";
import { get } from "../lib/store";

interface Warning {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  rule: string;
  severity: "error" | "warning";
  text: string;
}

/** Stylelint's JSON report as editor problems. */
export function parseStylelint(json: string, doc: Text): Diagnostic[] {
  let results: { warnings?: Warning[]; parseErrors?: Warning[] }[];
  try {
    results = JSON.parse(json);
  } catch {
    return [];
  }
  const at = (line: number, col: number) => {
    const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
    return Math.min(l.to, l.from + Math.max(0, col - 1));
  };
  const out: Diagnostic[] = [];
  for (const r of results) {
    for (const w of [...(r.warnings ?? []), ...(r.parseErrors ?? [])]) {
      const from = at(w.line, w.column);
      const to = w.endLine ? at(w.endLine, w.endColumn ?? w.column) : from + 1;
      out.push({
        from,
        to: Math.max(to, Math.min(doc.length, from + 1)),
        severity: w.severity === "error" ? "error" : "warning",
        source: w.rule ? `stylelint(${w.rule})` : "stylelint",
        // Stylelint repeats the rule at the end of the message.
        message: w.text.replace(/\s*\([\w/@-]+\)$/, ""),
      });
    }
  }
  return out;
}

const available = new Map<string, Promise<boolean>>();

/** Whether the open folder has Stylelint; asked again when its package.json changes. */
export function hasStylelint(root: string): Promise<boolean> {
  let p = available.get(root);
  if (!p) {
    p = invoke<boolean>("stylelint_available", { root }).catch(() => false);
    available.set(root, p);
  }
  return p;
}

export function forgetStylelint() {
  available.clear();
}

export async function stylelintDiagnostics(path: string, doc: Text): Promise<Diagnostic[]> {
  const s = get();
  if (!s.root || !(await hasStylelint(s.root))) return [];
  const json = await invoke<string>("stylelint_run", { root: s.root, path, text: doc.toString(), node: s.settings.nodePath || s.node?.path || null }).catch(() => "[]");
  return parseStylelint(json, doc);
}
