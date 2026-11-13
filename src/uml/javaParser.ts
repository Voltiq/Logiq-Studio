/*
 * A tolerant parser for the declarations of a Java file. It reads packages,
 * imports, (nested) classes, interfaces, enums, records and annotation
 * types with their fields, constructors and methods, and skips method
 * bodies. Code that is half typed never throws: the parser notes what it
 * understood and resynchronises at the next `;` or `}`.
 */

import type { JField, JFile, JMethod, JParam, JType, TypeKind, Visibility } from "./model";

type Kind = "id" | "num" | "str" | "op";

interface Tok {
  k: Kind;
  v: string;
  line: number;
}

const ID_START = /[\p{L}_$]/u;
const ID_PART = /[\p{L}\p{N}_$]/u;

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' && src.startsWith('"""', i)) {
      const start = line;
      i += 3;
      while (i < n && !src.startsWith('"""', i)) {
        if (src[i] === "\\") i++;
        else if (src[i] === "\n") line++;
        i++;
      }
      i += 3;
      out.push({ k: "str", v: '""', line: start });
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      out.push({ k: "str", v: src.slice(i, j + 1), line });
      i = j + 1;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(src[j])) j++;
      out.push({ k: "id", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      out.push({ k: "num", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (src.startsWith("...", i)) {
      out.push({ k: "op", v: "...", line });
      i += 3;
      continue;
    }
    if (src.startsWith("::", i) || src.startsWith("->", i)) {
      out.push({ k: "op", v: src.slice(i, i + 2), line });
      i += 2;
      continue;
    }
    out.push({ k: "op", v: c, line });
    i++;
  }
  return out;
}

const MODIFIERS = new Set([
  "public",
  "protected",
  "private",
  "static",
  "final",
  "abstract",
  "native",
  "synchronized",
  "transient",
  "volatile",
  "strictfp",
  "default",
  "sealed",
]);

interface Mods {
  visibility: Visibility | null;
  isStatic: boolean;
  isFinal: boolean;
  isAbstract: boolean;
  isDefault: boolean;
}

const CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

class Parser {
  i = 0;
  pkg = "";
  imports: string[] = [];
  types: JType[] = [];

  constructor(
    private t: Tok[],
    private path: string,
  ) {}

  peek(o = 0): Tok | undefined {
    return this.t[this.i + o];
  }
  is(v: string, o = 0): boolean {
    const tok = this.t[this.i + o];
    return !!tok && tok.v === v && tok.k !== "str";
  }
  isId(o = 0): boolean {
    return this.t[this.i + o]?.k === "id";
  }
  eat(v: string): boolean {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  done(): boolean {
    return this.i >= this.t.length;
  }

  /** Skips a bracketed group starting at the current token; returns the closing line. */
  skipGroup(creates?: Set<string>): number {
    const open = this.peek()!.v;
    const close = CLOSE[open];
    let depth = 0;
    while (!this.done()) {
      const tok = this.t[this.i];
      if (tok.k === "op") {
        if (tok.v === "(" || tok.v === "[" || tok.v === "{") depth++;
        else if (tok.v === ")" || tok.v === "]" || tok.v === "}") {
          depth--;
          if (depth === 0) {
            this.i++;
            return tok.line;
          }
        }
      } else if (creates && tok.k === "id" && tok.v === "new" && this.isId(1)) {
        creates.add(this.qualifiedAt(this.i + 1));
      }
      this.i++;
    }
    void close;
    return this.t[this.t.length - 1]?.line ?? 1;
  }

  qualifiedAt(at: number): string {
    let name = this.t[at].v;
    while (this.t[at + 1]?.v === "." && this.t[at + 2]?.k === "id") {
      at += 2;
      name += "." + this.t[at].v;
    }
    return name;
  }

  /** Captures `<…>` as normalised text. */
  typeArgs(): string {
    let depth = 0;
    let s = "";
    while (!this.done()) {
      const tok = this.t[this.i];
      if (tok.v === "<") depth++;
      if (tok.v === ">") depth--;
      if (tok.v === ",") s += ", ";
      else if (tok.v === "extends" || tok.v === "super" || tok.v === "&") s += ` ${tok.v} `;
      else if (tok.v === "@") {
        this.i++;
        this.qualifiedName();
        if (this.is("(")) this.skipGroup();
        continue;
      } else s += tok.v;
      this.i++;
      if (depth === 0) break;
      // A stray `;` or `{` means this was a comparison, not type arguments.
      if (tok.v === ";" || tok.v === "{" || tok.v === "}") break;
    }
    return s;
  }

  qualifiedName(): string {
    if (!this.isId()) return "";
    let name = this.peek()!.v;
    this.i++;
    while (this.is(".") && this.isId(1)) {
      name += "." + this.t[this.i + 1].v;
      this.i += 2;
    }
    return name;
  }

  skipAnnotation() {
    this.i++; // @
    this.qualifiedName();
    if (this.is("(")) this.skipGroup();
  }

  modifiers(): Mods {
    const m: Mods = { visibility: null, isStatic: false, isFinal: false, isAbstract: false, isDefault: false };
    for (;;) {
      if (this.is("@") && !this.is("interface", 1)) {
        this.skipAnnotation();
        continue;
      }
      if (this.is("non") && this.is("-", 1) && this.is("sealed", 2)) {
        this.i += 3;
        continue;
      }
      const tok = this.peek();
      if (!tok || tok.k !== "id" || !MODIFIERS.has(tok.v)) return m;
      // `sealed` and `default` are only modifiers when a declaration follows.
      if (tok.v === "default" && (this.is(":", 1) || this.is("-", 1))) return m;
      if (tok.v === "public" || tok.v === "protected" || tok.v === "private") m.visibility = tok.v;
      if (tok.v === "static") m.isStatic = true;
      if (tok.v === "final") m.isFinal = true;
      if (tok.v === "abstract") m.isAbstract = true;
      if (tok.v === "default") m.isDefault = true;
      this.i++;
    }
  }

  /** A type such as `java.util.Map<String, List<Integer>>[]` or `int...`. */
  type(): string {
    while (this.is("@")) this.skipAnnotation();
    if (!this.isId() && !this.is("?")) return "";
    let s = "";
    for (;;) {
      if (this.is("?")) {
        s += "?";
        this.i++;
      } else {
        s += this.peek()!.v;
        this.i++;
      }
      if (this.is("<")) s += this.typeArgs();
      if (this.is(".") && this.isId(1)) {
        s += ".";
        this.i++;
        continue;
      }
      break;
    }
    for (;;) {
      while (this.is("@")) this.skipAnnotation();
      if (this.is("[") && this.is("]", 1)) {
        s += "[]";
        this.i += 2;
      } else if (this.is("...")) {
        s += "...";
        this.i++;
      } else break;
    }
    return s;
  }

  typeList(): string[] {
    const list: string[] = [];
    for (;;) {
      const ty = this.type();
      if (!ty) break;
      list.push(ty);
      if (!this.eat(",")) break;
    }
    return list;
  }

  params(): JParam[] {
    const out: JParam[] = [];
    if (!this.eat("(")) return out;
    while (!this.done() && !this.is(")")) {
      this.modifiers();
      let ty = this.type();
      // Receiver parameter `Foo this`.
      if (this.is("this")) {
        this.i++;
      } else if (this.isId()) {
        const name = this.peek()!.v;
        this.i++;
        while (this.is("[") && this.is("]", 1)) {
          ty += "[]";
          this.i += 2;
        }
        if (ty) out.push({ name, type: ty });
      }
      if (!this.eat(",")) {
        // Something we don't understand: skip to the closing parenthesis.
        while (!this.done() && !this.is(")")) {
          if (this.is("(") || this.is("[") || this.is("{")) this.skipGroup();
          else this.i++;
        }
      }
    }
    this.eat(")");
    return out;
  }

  /** Skips to the end of a statement at this depth: `;` (eaten) or `}` (kept). */
  skipStatement(creates?: Set<string>) {
    while (!this.done()) {
      if (this.is(";")) {
        this.i++;
        return;
      }
      if (this.is("}")) return;
      if (this.is("(") || this.is("[") || this.is("{")) {
        this.skipGroup(creates);
        continue;
      }
      if (creates && this.is("new") && this.isId(1)) creates.add(this.qualifiedAt(this.i + 1));
      this.i++;
    }
  }

  file(): JFile {
    while (!this.done()) {
      if (this.eat(";")) continue;
      if (this.is("package")) {
        this.i++;
        this.pkg = this.qualifiedName();
        this.skipStatement();
        continue;
      }
      if (this.is("import")) {
        this.i++;
        const isStatic = this.eat("static");
        let name = this.qualifiedName();
        if (this.is(".") && this.is("*", 1)) {
          name += ".*";
          this.i += 2;
        }
        if (!isStatic && name) this.imports.push(name);
        this.skipStatement();
        continue;
      }
      const start = this.i;
      const mods = this.modifiers();
      if (this.atTypeKeyword()) {
        this.typeDecl(mods, null);
      } else {
        if (this.i === start) this.i++;
        this.skipStatement();
        if (this.is("}")) this.i++;
      }
    }
    return { path: this.path, package: this.pkg, imports: this.imports, types: this.types };
  }

  atTypeKeyword(): boolean {
    if (this.is("class") || this.is("interface") || this.is("enum")) return this.isId(1);
    if (this.is("@") && this.is("interface", 1)) return true;
    // `record` is a contextual keyword: `record Point(int x, int y)`.
    if (this.is("record") && this.isId(1) && (this.is("(", 2) || this.is("<", 2))) return true;
    return false;
  }

  typeDecl(mods: Mods, outer: JType | null): JType {
    let kind: TypeKind;
    if (this.is("@")) {
      this.i += 2;
      kind = "annotation";
    } else {
      kind = this.peek()!.v as TypeKind;
      this.i++;
    }
    const nameTok = this.peek()!;
    this.i++;
    const name = nameTok.v;
    const qualifiedName = outer ? `${outer.qualifiedName}.${name}` : this.pkg ? `${this.pkg}.${name}` : name;
    const inInterface = outer?.kind === "interface" || outer?.kind === "annotation";
    const type: JType = {
      name,
      qualifiedName,
      kind,
      visibility: mods.visibility ?? (inInterface ? "public" : "package"),
      isAbstract: mods.isAbstract || kind === "interface",
      isStatic: mods.isStatic || (!!outer && kind !== "class") || inInterface,
      isFinal: mods.isFinal || kind === "record" || kind === "enum",
      typeParams: "",
      extends: [],
      implements: [],
      fields: [],
      methods: [],
      constants: [],
      creates: [],
      outer: outer?.qualifiedName ?? null,
      path: this.path,
      package: this.pkg,
      line: nameTok.line,
      endLine: nameTok.line,
      hasMain: false,
    };
    this.types.push(type);
    if (this.is("<")) type.typeParams = this.typeArgs();
    if (kind === "record" && this.is("(")) {
      for (const p of this.params()) {
        type.fields.push({ name: p.name, type: p.type, visibility: "private", isStatic: false, isFinal: true, line: nameTok.line });
      }
    }
    while (!this.done() && !this.is("{")) {
      if (this.eat("extends")) {
        const list = this.typeList();
        if (kind === "interface") type.extends.push(...list);
        else type.extends.push(...list.slice(0, 1));
      } else if (this.eat("implements")) {
        type.implements.push(...this.typeList());
      } else if (this.eat("permits")) {
        this.typeList();
      } else if (this.is(";") || this.is("}")) {
        return type;
      } else {
        this.i++;
      }
    }
    if (!this.eat("{")) return type;
    const creates = new Set<string>();
    if (kind === "enum") this.enumConstants(type, creates);
    this.members(type, creates);
    type.creates = [...creates];
    return type;
  }

  enumConstants(type: JType, creates: Set<string>) {
    while (!this.done()) {
      while (this.is("@")) this.skipAnnotation();
      if (this.eat(";")) return;
      if (this.is("}")) return;
      if (!this.isId()) {
        this.i++;
        continue;
      }
      type.constants.push(this.peek()!.v);
      this.i++;
      if (this.is("(")) this.skipGroup(creates);
      if (this.is("{")) this.skipGroup(creates);
      if (this.eat(",")) continue;
      if (this.eat(";")) return;
      if (this.is("}")) return;
    }
  }

  members(type: JType, creates: Set<string>) {
    const inInterface = type.kind === "interface" || type.kind === "annotation";
    while (!this.done()) {
      if (this.is("}")) {
        type.endLine = this.peek()!.line;
        this.i++;
        return;
      }
      if (this.eat(";")) continue;
      const start = this.i;
      const mods = this.modifiers();
      if (this.is("{")) {
        // Instance or static initialiser.
        this.skipGroup(creates);
        continue;
      }
      if (this.atTypeKeyword()) {
        this.typeDecl(mods, type);
        continue;
      }
      let typeParams = "";
      if (this.is("<")) typeParams = this.typeArgs();
      const visibility: Visibility = mods.visibility ?? (inInterface ? "public" : "package");

      // Constructor (also the compact constructor of a record).
      if (this.isId() && this.peek()!.v === type.name && (this.is("(", 1) || (type.kind === "record" && this.is("{", 1)))) {
        const line = this.peek()!.line;
        this.i++;
        const params = this.is("(") ? this.params() : type.fields.map((f) => ({ name: f.name, type: f.type }));
        const end = this.methodTail(creates);
        type.methods.push({
          name: type.name,
          returnType: null,
          params,
          visibility,
          isStatic: false,
          isAbstract: false,
          isConstructor: true,
          typeParams,
          line,
          endLine: end ?? line,
        });
        continue;
      }

      const ty = this.type();
      if (!ty || !this.isId()) {
        // Not a declaration we understand: resynchronise.
        if (this.i === start) this.i++;
        this.skipStatement(creates);
        continue;
      }
      const nameTok = this.peek()!;
      this.i++;
      if (this.is("(")) {
        const params = this.params();
        let returnType = ty;
        while (this.is("[") && this.is("]", 1)) {
          returnType += "[]";
          this.i += 2;
        }
        const end = this.methodTail(creates);
        const hasBody = end !== null;
        const method: JMethod = {
          name: nameTok.v,
          returnType,
          params,
          visibility,
          isStatic: mods.isStatic,
          isAbstract: mods.isAbstract || (inInterface && !hasBody && !mods.isStatic && !mods.isDefault),
          isConstructor: false,
          typeParams,
          line: nameTok.line,
          endLine: end ?? nameTok.line,
        };
        type.methods.push(method);
        if (
          method.name === "main" &&
          method.isStatic &&
          method.params.length === 1 &&
          /^String(\[\]|\.\.\.)$/.test(method.params[0].type.replace(/^java\.lang\./, ""))
        ) {
          type.hasMain = true;
        }
        continue;
      }
      // One or more fields: `int a, b[] = {1}, c = f(x, y);`
      let name = nameTok;
      for (;;) {
        let fieldType = ty;
        while (this.is("[") && this.is("]", 1)) {
          fieldType += "[]";
          this.i += 2;
        }
        const field: JField = {
          name: name.v,
          type: fieldType,
          visibility,
          isStatic: mods.isStatic || inInterface,
          isFinal: mods.isFinal || inInterface,
          line: name.line,
        };
        type.fields.push(field);
        if (this.eat("=")) this.initializer(creates);
        if (this.eat(",") && this.isId()) {
          name = this.peek()!;
          this.i++;
          continue;
        }
        break;
      }
      if (!this.eat(";")) this.skipStatement(creates);
    }
  }

  /** Skips a field initialiser up to the `,` that starts the next declarator or the `;`. */
  initializer(creates: Set<string>) {
    while (!this.done()) {
      if (this.is(";") || this.is("}")) return;
      if (this.is(",")) {
        // `new HashMap<String, Integer>()` has a comma that is not a declarator separator.
        if (this.isId(1) && (this.is("=", 2) || this.is(",", 2) || this.is(";", 2) || (this.is("[", 2) && this.is("]", 3)))) return;
      }
      if (this.is("(") || this.is("[") || this.is("{")) {
        this.skipGroup(creates);
        continue;
      }
      if (this.is("new") && this.isId(1)) creates.add(this.qualifiedAt(this.i + 1));
      this.i++;
    }
  }

  /** After a parameter list: `throws …`, then a body or `;` (or `default …;`). Returns the body's last line, or null. */
  methodTail(creates: Set<string>): number | null {
    if (this.eat("throws")) this.typeList();
    if (this.is("{")) return this.skipGroup(creates);
    if (this.eat("default")) {
      this.skipStatement();
      return null;
    }
    if (!this.eat(";")) this.skipStatement(creates);
    return null;
  }
}

export function parseJava(source: string, path = ""): JFile {
  return new Parser(tokenize(source), path).file();
}

/** The type name without generics, arrays or package: `java.util.List<X>[]` → `List`. */
export function baseName(type: string): string {
  const noArgs = type.replace(/<.*$/, "").replace(/(\[\]|\.\.\.)+$/, "");
  const dot = noArgs.lastIndexOf(".");
  return dot >= 0 ? noArgs.slice(dot + 1) : noArgs;
}

/** Shortens qualified names inside a type for display: `java.util.List<java.lang.String>` → `List<String>`. */
export function simpleType(type: string): string {
  return type.replace(/\b(?:[a-z_$][\w$]*\.)+(?=[A-Z_$])/g, "");
}

/** Every identifier in a type that could name a class: `Map<String, List<Shape>>` → Map, String, List, Shape. */
export function typeNames(type: string): string[] {
  return type.match(/[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*/gu)?.filter((n) => n !== "extends" && n !== "super") ?? [];
}
