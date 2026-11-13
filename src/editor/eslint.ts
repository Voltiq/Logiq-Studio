/*
 * ESLint for JavaScript files, with rules that catch real mistakes rather
 * than style: unused variables, `==`, unreachable code, duplicate keys and
 * cases, assignments in conditions and the like. ESLint is loaded the first
 * time a JavaScript file is checked.
 */
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";

type LinterLike = { verify(code: string, config: unknown): { line: number; column: number; endLine?: number; endColumn?: number; message: string; severity: number; ruleId: string | null }[] };

let linter: Promise<LinterLike> | null = null;

const RULES = {
  "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
  "no-unreachable": "warn",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-dupe-args": "error",
  "no-const-assign": "error",
  "no-redeclare": "error",
  "no-self-assign": "warn",
  "no-self-compare": "warn",
  "no-cond-assign": "warn",
  "no-constant-condition": ["warn", { checkLoops: false }],
  "no-fallthrough": "warn",
  "no-empty": "warn",
  "no-debugger": "warn",
  "no-unsafe-negation": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "no-loss-of-precision": "warn",
  "no-func-assign": "error",
  "no-import-assign": "error",
  "no-sparse-arrays": "warn",
  "no-unsafe-finally": "warn",
  eqeqeq: ["warn", "smart"],
};

function load(): Promise<LinterLike> {
  linter ??= import("eslint-linter-browserify").then((m) => new m.Linter({ configType: "flat" }) as unknown as LinterLike);
  return linter;
}

export async function eslintDiagnostics(code: string, doc: Text, module: boolean): Promise<Diagnostic[]> {
  const l = await load();
  const messages = l.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: module ? "module" : "script" }, rules: RULES }]);
  const at = (line: number, col: number) => {
    const ln = doc.line(Math.max(1, Math.min(doc.lines, line)));
    return Math.min(ln.to, ln.from + Math.max(0, col - 1));
  };
  return messages
    // Syntax errors come from the language server already.
    .filter((m) => m.ruleId)
    .map((m) => {
      const from = at(m.line, m.column);
      const to = m.endLine ? at(m.endLine, m.endColumn ?? m.column) : from + 1;
      return { from, to: Math.max(to, from + 1), severity: m.severity === 2 ? "error" : "warning", source: `eslint(${m.ruleId})`, message: m.message } as Diagnostic;
    });
}
