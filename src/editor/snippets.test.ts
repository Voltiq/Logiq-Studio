import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { ensureSyntaxTree, indentUnit } from "@codemirror/language";
import { snippet } from "@codemirror/autocomplete";
import { java } from "@codemirror/lang-java";
import { html } from "@codemirror/lang-html";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { kotlinLanguage } from "./languages";
import { SNIPPETS, fileLanguage, previewOf, snippetAtCursor, snippetSupport, type SnippetSet } from "./snippets";

const SUPPORT = { java, html: () => html(), cpp, php: () => php({ plain: false }), python, javascript: () => javascript({ typescript: false }), typescript: () => javascript({ typescript: true }), css, markdown, kotlin: () => kotlinLanguage };

/** Expands the word before `|` as Ctrl+Space would; null when nothing expands. */
function expand(lang: keyof typeof SUPPORT, text: string, file: string = lang) {
  const at = text.indexOf("|");
  let state = EditorState.create({ doc: text.replace("|", ""), selection: { anchor: at }, extensions: [SUPPORT[lang](), indentUnit.of("    "), fileLanguage.of(file), snippetSupport(kotlinLanguage)] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const hit = snippetAtCursor(state);
  if (!hit) return null;
  const view = { state, dispatch: (tr: Transaction) => (state = tr.state) };
  snippet(hit.snippet.body)(view, null, hit.from, hit.to);
  return state.doc.toString();
}

describe("snippet library", () => {
  it("has no field named only with digits (they would be read as tab stops)", () => {
    for (const [set, list] of Object.entries(SNIPPETS)) for (const sn of list) expect(sn.body, `${set} ${sn.prefixes[0]}`).not.toMatch(/[#$]\{\d+\}/);
  });

  it("gives every name to one snippet per language", () => {
    for (const [set, list] of Object.entries(SNIPPETS)) {
      const names = list.flatMap((sn) => sn.prefixes);
      expect(names.filter((n, i) => names.indexOf(n) !== i), set).toEqual([]);
    }
  });

  it("has many for each language", () => {
    const sizes = Object.fromEntries(Object.entries(SNIPPETS).map(([k, v]) => [k, v.length])) as Record<SnippetSet, number>;
    expect(sizes.java).toBeGreaterThan(40);
    expect(Object.values(SNIPPETS).flat().length).toBeGreaterThan(250);
  });

  it("previews fields by their names", () => {
    expect(previewOf("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}")).toBe("for (int i = 0; i < n; i++) {\n\t\n}");
  });
});

describe("expanding", () => {
  it("writes Java's print line from sysout, sout and syso", () => {
    for (const w of ["sysout", "sout", "syso"]) expect(expand("java", `class A {\n  void f() {\n    ${w}|\n  }\n}`)).toContain("    System.out.println();\n");
  });

  it("indents the lines of a snippet like the line it starts on", () => {
    expect(expand("java", "class A {\n    main|\n}")).toBe("class A {\n    public static void main(String[] args) {\n        \n    }\n}");
  });

  it("writes the HTML page skeleton from !", () => {
    const out = expand("html", "!|")!;
    expect(out).toMatch(/^<!DOCTYPE html>\n<html lang="en">/);
    expect(out).toContain('<meta name="viewport"');
    expect(out).toContain("<title>Document</title>");
  });

  it("uses JavaScript snippets in a script inside HTML", () => {
    expect(expand("html", "<script>\nlog|\n</script>")).toBe("<script>\nconsole.log();\n</script>");
  });

  it("tells C from C++ by the file", () => {
    expect(expand("cpp", "main|", "c")).toContain("int main(void)");
    expect(expand("cpp", "main|", "cpp")).toContain("int main() {");
    expect(expand("cpp", "cout|", "cpp")).toBe("std::cout <<  << std::endl;");
    expect(expand("cpp", "cout|", "c")).toBeNull();
  });

  it("writes PHP variables", () => {
    expect(expand("php", "<?php\nfore|")).toBe("<?php\nforeach ($items as $item) {\n    \n}");
  });

  it("knows Python, TypeScript, CSS, Markdown and Kotlin", () => {
    expect(expand("python", "main|")).toBe('if __name__ == "__main__":\n    main()');
    expect(expand("typescript", "iface|", "typescript")).toBe("interface Name {\n    \n}");
    expect(expand("javascript", "iface|")).toBeNull();
    expect(expand("css", "a {\n  flexc|\n}")).toContain("justify-content: center;");
    expect(expand("markdown", "code|")).toBe("```java\n\n```");
    expect(expand("kotlin", "main|")).toBe("fun main() {\n    \n}");
  });

  it("leaves words alone in strings, comments, after a dot and inside other words", () => {
    expect(expand("java", 'class A { String s = "sout|"; }')).toBeNull();
    expect(expand("java", "// sout|")).toBeNull();
    expect(expand("java", "class A { void f() { x.sout| } }")).toBeNull();
    expect(expand("java", "class A { void f() { mysout| } }")).toBeNull();
    expect(expand("html", '<a href="link|">')).toBeNull();
  });

  it("expands a snippet of several lines only at the start of a line", () => {
    expect(expand("cpp", "int main|", "c")).toBeNull();
    expect(expand("java", "class A { void f() { int x = 1; sout| } }")).toContain("int x = 1; System.out.println();");
  });
});

describe("completion sources", () => {
  it("stay the same function between calls, or completion drops their answers", async () => {
    const { createState } = await import("./setup");
    const { DEFAULT_SETTINGS } = await import("../lib/settings");
    const state = createState("C:/p/Main.java", "class Main {\n  void f() {\n    fo\n  }\n}", DEFAULT_SETTINGS, []);
    const pos = state.doc.toString().indexOf("fo") + 2;
    const a = state.languageDataAt("autocomplete", pos);
    const b = state.languageDataAt("autocomplete", pos);
    expect(a.length).toBeGreaterThanOrEqual(2);
    a.forEach((f, i) => expect(f).toBe(b[i]));
  });
});
