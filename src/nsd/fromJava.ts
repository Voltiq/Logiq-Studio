/*
 * A Java method as a Nassi–Shneiderman diagram, read with the editor's own Java parser: if/else (else-if as
 * a nested decision), switch (with "case:" and "case ->"), while and for (testing first), do … while (testing
 * last), break / continue / return / throw (exits), try / catch / finally and synchronized (groups); calls of
 * the class's own methods are drawn as calls, every other statement as an action.
 */
import { javaLanguage } from "@codemirror/lang-java";
import type { SyntaxNode } from "@lezer/common";
import type { Block, Nsd } from "./model";

const STATEMENT = new Set([
  "ExpressionStatement",
  "LocalVariableDeclaration",
  "IfStatement",
  "WhileStatement",
  "ForStatement",
  "EnhancedForStatement",
  "DoStatement",
  "SwitchStatement",
  "BreakStatement",
  "ContinueStatement",
  "ReturnStatement",
  "ThrowStatement",
  "TryStatement",
  "TryWithResourcesStatement",
  "SynchronizedStatement",
  "LabeledStatement",
  "Block",
  "AssertStatement",
  "ExplicitConstructorInvocation",
  "ClassDeclaration",
  "RecordDeclaration",
  "EnumDeclaration",
  "InterfaceDeclaration",
]);

const METHOD = new Set(["MethodDeclaration", "ConstructorDeclaration"]);

export interface JavaMethod {
  name: string;
  /** "totalArea()", "Circle(double x, double y, double radius)". */
  signature: string;
  from: number;
  to: number;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

function children(n: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

function nameOf(method: SyntaxNode, text: string): string {
  const def = method.getChild("Definition") ?? children(method).find((c) => c.name === "Definition");
  return def ? text.slice(def.from, def.to) : "?";
}

function signatureOf(method: SyntaxNode, text: string): string {
  const params = method.getChild("FormalParameters");
  return `${nameOf(method, text)}${params ? tidy(text.slice(params.from, params.to)) : "()"}`;
}

/** The methods and constructors of a Java file, in order. */
export function javaMethods(text: string): JavaMethod[] {
  const tree = javaLanguage.parser.parse(text);
  const out: JavaMethod[] = [];
  tree.iterate({
    enter(n) {
      if (METHOD.has(n.name)) {
        out.push({ name: nameOf(n.node, text), signature: signatureOf(n.node, text), from: n.from, to: n.to });
      }
    },
  });
  return out;
}

/** The innermost method or constructor around `offset`. */
export function methodAt(text: string, offset: number): JavaMethod | null {
  const around = javaMethods(text).filter((m) => m.from <= offset && offset <= m.to);
  return around.sort((a, b) => a.to - a.from - (b.to - b.from))[0] ?? null;
}

/** The diagram of a method, found by its signature (or name), or null when it has no body. */
export function nsdOfMethod(text: string, which: string): Nsd | null {
  const tree = javaLanguage.parser.parse(text);
  let found: SyntaxNode | null = null;
  tree.iterate({
    enter(n) {
      if (found || !METHOD.has(n.name)) return;
      if (signatureOf(n.node, text) === which || nameOf(n.node, text) === which) found = n.node;
    },
  });
  if (!found) return null;
  const method = found as SyntaxNode;
  const body = method.getChild("Block") ?? method.getChild("ConstructorBody");
  if (!body) return null;
  const own = new Set(javaMethods(text).map((m) => m.name));
  const slice = (n: SyntaxNode | null | undefined) => (n ? text.slice(n.from, n.to) : "");
  const unparen = (n: SyntaxNode | null | undefined) => tidy(slice(n).replace(/^\(\s*/, "").replace(/\s*\)$/, ""));
  const stmt = (n: SyntaxNode) => tidy(slice(n).replace(/;\s*$/, ""));

  /** The blocks of a statement that is a body: a { block } gives its statements, anything else itself. */
  const bodyOf = (n: SyntaxNode | null | undefined): Block[] => {
    if (!n) return [];
    if (n.name === "Block" || n.name === "ConstructorBody") return list(n);
    return convert(n);
  };

  const list = (n: SyntaxNode): Block[] => {
    const out: Block[] = [];
    const parts = children(n).filter((c) => STATEMENT.has(c.name));
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i];
      const next = parts[i + 1];
      // Java this parser doesn't know, such as a switch expression (`String s = switch (i) { … };`), comes as
      // a statement without its ";" and a block after it: they are one statement.
      if (next?.name === "Block" && (c.name === "LocalVariableDeclaration" || c.name === "ExpressionStatement" || c.name === "ReturnStatement") && !slice(c).trimEnd().endsWith(";")) {
        out.push({ kind: c.name === "ReturnStatement" ? "exit" : "action", text: tidy(text.slice(c.from, next.to)) });
        i++;
        continue;
      }
      out.push(...convert(c));
    }
    return out;
  };

  const convert = (n: SyntaxNode): Block[] => {
    switch (n.name) {
      case "Block":
        return list(n);
      case "ExpressionStatement": {
        // A call of the class's own method (`draw()`, `this.draw()`) is a call block; `list.add(x)` an action.
        const call = n.firstChild?.name === "MethodInvocation" ? /^(?:this\s*\.\s*)?([\w$]+)\s*\(/.exec(slice(n.firstChild)) : null;
        return [{ kind: call && own.has(call[1]) ? "call" : "action", text: stmt(n) }];
      }
      case "BreakStatement":
      case "ContinueStatement":
      case "ReturnStatement":
      case "ThrowStatement":
        return [{ kind: "exit", text: stmt(n) }];
      case "IfStatement": {
        const parts = children(n);
        const cond = n.getChild("ParenthesizedExpression");
        const statements = parts.filter((c) => c !== cond && (STATEMENT.has(c.name) || c.name === ";"));
        const elseAt = parts.findIndex((c) => c.name === "else");
        const yes = statements.find((c) => elseAt < 0 || c.from < parts[elseAt].from);
        const no = elseAt >= 0 ? statements.find((c) => c.from > parts[elseAt].from) : undefined;
        return [{ kind: "if", cond: unparen(cond), yes: bodyOf(yes), no: bodyOf(no) }];
      }
      case "WhileStatement": {
        const cond = n.getChild("ParenthesizedExpression");
        const body = children(n).find((c) => c !== cond && STATEMENT.has(c.name));
        return [{ kind: "while", cond: `while ${unparen(cond)}`, body: bodyOf(body) }];
      }
      case "ForStatement":
      case "EnhancedForStatement": {
        const spec = n.getChild("ForSpec");
        const body = children(n).find((c) => c !== spec && STATEMENT.has(c.name));
        const head = unparen(spec);
        const each = n.name === "EnhancedForStatement" ? head.split(/\s*:\s*/) : null;
        return [{ kind: "while", cond: each && each.length === 2 ? `for each ${each[0]} in ${each[1]}` : `for (${head})`, body: bodyOf(body) }];
      }
      case "DoStatement": {
        const cond = n.getChild("ParenthesizedExpression");
        const body = children(n).find((c) => c !== cond && STATEMENT.has(c.name));
        return [{ kind: "repeat", cond: `while ${unparen(cond)}`, body: bodyOf(body) }];
      }
      case "SwitchStatement": {
        const block = n.getChild("SwitchBlock");
        const cases: { label: string; body: Block[] }[] = [];
        for (const c of block ? children(block) : []) {
          if (c.name === "SwitchLabel") cases.push({ label: tidy(slice(c).replace(/^case\s+/, "")), body: [] });
          else if (c.name === "SwitchRule") {
            const label = c.getChild("SwitchLabel");
            const body = children(c).find((x) => x !== label && STATEMENT.has(x.name));
            cases.push({ label: tidy(slice(label).replace(/^case\s+/, "")), body: bodyOf(body) });
          } else if (STATEMENT.has(c.name) && cases.length) cases[cases.length - 1].body.push(...convert(c));
        }
        // A case's closing "break" is how Java ends it, not a step of its own.
        for (const c of cases) {
          const last = c.body[c.body.length - 1];
          if (last?.kind === "exit" && last.text === "break") c.body.pop();
        }
        return [{ kind: "switch", expr: unparen(n.getChild("ParenthesizedExpression")), cases }];
      }
      case "TryStatement":
      case "TryWithResourcesStatement": {
        const res = n.getChild("ResourceSpecification");
        const out: Block[] = [{ kind: "group", title: res ? `try ${tidy(slice(res))}` : "try", body: bodyOf(n.getChild("Block")) }];
        for (const c of n.getChildren("CatchClause")) {
          const param = c.getChild("CatchFormalParameter");
          out.push({ kind: "group", title: `catch ${tidy(slice(param))}`, body: bodyOf(c.getChild("Block")) });
        }
        const fin = n.getChild("FinallyClause");
        if (fin) out.push({ kind: "group", title: "finally", body: bodyOf(fin.getChild("Block")) });
        return out;
      }
      case "SynchronizedStatement":
        return [{ kind: "group", title: `synchronized ${tidy(slice(n.getChild("ParenthesizedExpression")))}`, body: bodyOf(n.getChild("Block")) }];
      case "LabeledStatement": {
        const label = n.getChild("Label");
        const inner = children(n).find((c) => STATEMENT.has(c.name));
        return [{ kind: "group", title: `${slice(label)}:`, body: bodyOf(inner) }];
      }
      case "ClassDeclaration":
      case "RecordDeclaration":
      case "EnumDeclaration":
      case "InterfaceDeclaration":
        return [{ kind: "action", text: tidy(slice(n).split("{")[0]) + " { … }" }];
      default:
        return [{ kind: "action", text: stmt(n) }];
    }
  };

  return { title: signatureOf(method, text), body: list(body) };
}
