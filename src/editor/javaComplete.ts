/*
 * Java completion: keywords, the project's own classes, and members after a dot — of project classes
 * (including inherited ones) and of the library classes used in class. Snippets (sout, fori …) are in snippets.ts.
 */
import { snippetCompletion as snip, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { javaIndex } from "../uml/javaIndex";
import { baseName } from "../uml/javaParser";
import type { JType } from "../uml/model";

const KEYWORDS =
  "abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch synchronized this throw throws true false try var void volatile while record yield sealed permits".split(
    " ",
  );


/** Members of library classes students use most. */
const LIBRARY: Record<string, string[]> = {
  String: "length() charAt(int) substring(int,int) indexOf(String) contains(CharSequence) equals(Object) equalsIgnoreCase(String) compareTo(String) toUpperCase() toLowerCase() trim() strip() isEmpty() isBlank() split(String) replace(CharSequence,CharSequence) startsWith(String) endsWith(String) toCharArray() chars() repeat(int) format(String,Object...) valueOf(Object) join(CharSequence,CharSequence...)".split(" "),
  Math: "abs(double) max(double,double) min(double,double) pow(double,double) sqrt(double) round(double) floor(double) ceil(double) random() sin(double) cos(double) tan(double) log(double) PI E".split(" "),
  System: "out err in currentTimeMillis() nanoTime() exit(int) arraycopy(Object,int,Object,int,int) lineSeparator()".split(" "),
  PrintStream: "println(Object) print(Object) printf(String,Object...) flush()".split(" "),
  Scanner: "nextLine() next() nextInt() nextDouble() nextBoolean() hasNext() hasNextLine() hasNextInt() close()".split(" "),
  List: "add(E) add(int,E) get(int) set(int,E) remove(int) remove(Object) size() isEmpty() contains(Object) indexOf(Object) clear() forEach(Consumer) sort(Comparator) stream() iterator() addAll(Collection) toArray()".split(" "),
  Map: "put(K,V) get(Object) getOrDefault(Object,V) containsKey(Object) containsValue(Object) remove(Object) size() isEmpty() keySet() values() entrySet() putIfAbsent(K,V) merge(K,V,BiFunction) forEach(BiConsumer) clear()".split(" "),
  Set: "add(E) remove(Object) contains(Object) size() isEmpty() clear() stream() iterator() addAll(Collection)".split(" "),
  StringBuilder: "append(Object) insert(int,Object) reverse() toString() length() charAt(int) deleteCharAt(int) setLength(int) indexOf(String)".split(" "),
  Integer: "parseInt(String) valueOf(int) MAX_VALUE MIN_VALUE toString(int) toBinaryString(int) compare(int,int) intValue()".split(" "),
  Double: "parseDouble(String) valueOf(double) MAX_VALUE MIN_VALUE isNaN(double) compare(double,double) doubleValue()".split(" "),
  Character: "isDigit(char) isLetter(char) isLetterOrDigit(char) isUpperCase(char) isLowerCase(char) isWhitespace(char) toUpperCase(char) toLowerCase(char) getNumericValue(char)".split(" "),
  Arrays: "toString(Object[]) sort(Object[]) fill(Object[],Object) asList(T...) copyOf(T[],int) stream(T[]) equals(Object[],Object[]) binarySearch(Object[],Object)".split(" "),
  Collections: "sort(List) reverse(List) shuffle(List) max(Collection) min(Collection) unmodifiableList(List) emptyList() swap(List,int,int)".split(" "),
  Random: "nextInt(int) nextInt(int,int) nextDouble() nextBoolean() nextLong()".split(" "),
  Object: "equals(Object) hashCode() toString() getClass()".split(" "),
};
const ALIASES: Record<string, string> = {
  ArrayList: "List",
  LinkedList: "List",
  HashMap: "Map",
  TreeMap: "Map",
  LinkedHashMap: "Map",
  HashSet: "Set",
  TreeSet: "Set",
  LinkedHashSet: "Set",
};

function libraryMembers(cls: string): Completion[] {
  const list = LIBRARY[ALIASES[cls] ?? cls];
  if (!list) return [];
  return list.map((m) => {
    const call = m.indexOf("(");
    if (call < 0) return { label: m, type: /^[A-Z_]+$/.test(m) ? "constant" : "property", detail: cls };
    const name = m.slice(0, call);
    const params = m.slice(call + 1, -1);
    return params
      ? snip(`${name}(\${})`, { label: name, type: "method", detail: `(${params})` })
      : { label: name, type: "method", detail: "()", apply: `${name}()` };
  });
}

function typeMembers(t: JType, staticOnly: boolean, seen = new Set<string>()): Completion[] {
  if (seen.has(t.qualifiedName)) return [];
  seen.add(t.qualifiedName);
  const out: Completion[] = [];
  for (const f of t.fields) {
    if (staticOnly && !f.isStatic) continue;
    out.push({ label: f.name, type: f.isStatic && f.isFinal ? "constant" : "property", detail: baseName(f.type) === f.type ? f.type : f.type });
  }
  for (const c of t.constants) out.push({ label: c, type: "enum", detail: t.name });
  for (const m of t.methods) {
    if (m.isConstructor || (staticOnly && !m.isStatic)) continue;
    const params = m.params.map((p) => `${p.type} ${p.name}`).join(", ");
    out.push(
      m.params.length
        ? snip(`${m.name}(\${})`, { label: m.name, type: "method", detail: `(${params})${m.returnType ? " → " + m.returnType : ""}` })
        : { label: m.name, type: "method", detail: `()${m.returnType ? " → " + m.returnType : ""}`, apply: `${m.name}()` },
    );
  }
  const types = javaIndex.types();
  for (const sup of [...t.extends, ...t.implements]) {
    const parent = types.find((x) => x.name === baseName(sup));
    if (parent) out.push(...typeMembers(parent, staticOnly, seen).map((c) => ({ ...c, boost: -1 })));
  }
  if (!staticOnly) out.push(...libraryMembers("Object").map((c) => ({ ...c, boost: -2 })));
  return out;
}

/** The declared type of `name` in the text before the cursor: `List<Shape> shapes` → List<Shape>. */
export function declaredType(text: string, name: string): string | null {
  const re = new RegExp(`([A-Za-z_$][\\w$.]*(?:<[^;(){}=]*>)?(?:\\[\\])*)\\s+${name.replace(/\$/g, "\\$")}\\s*[=;,):]`, "g");
  let found: string | null = null;
  for (const m of text.matchAll(re)) {
    if (!["return", "new", "else", "throw", "case"].includes(m[1])) found = m[1];
  }
  return found;
}

function enclosingType(path: string, line: number): JType | null {
  const file = javaIndex.file(path);
  if (!file) return null;
  let best: JType | null = null;
  for (const t of file.types) if (t.line <= line && t.endLine >= line && (!best || t.line >= best.line)) best = t;
  return best;
}

export function javaCompletions(getPath: () => string) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (/Comment|String/.test(node.name)) return null;

    const member = ctx.matchBefore(/([A-Za-z_$][\w$]*(?:\(\))?)\.\s*[\w$]*$/);
    if (member) {
      const dot = member.text.lastIndexOf(".");
      const target = member.text.slice(0, dot).replace(/\(\)$/, "");
      const from = member.from + dot + 1 + (member.text.slice(dot + 1).length - member.text.slice(dot + 1).trimStart().length);
      const line = ctx.state.doc.lineAt(ctx.pos).number;
      const types = javaIndex.types();
      let options: Completion[] = [];
      if (target === "this") {
        const t = enclosingType(getPath(), line);
        if (t) options = typeMembers(t, false);
      } else if (target === "out" || target === "err") {
        options = libraryMembers("PrintStream");
      } else if (/^[A-Z]/.test(target)) {
        const t = types.find((x) => x.name === target);
        options = t ? typeMembers(t, true) : libraryMembers(target);
      } else {
        const declared = declaredType(ctx.state.sliceDoc(0, member.from), target);
        if (declared) {
          if (declared.endsWith("[]")) options = [{ label: "length", type: "property", detail: "int" }];
          else {
            const t = types.find((x) => x.name === baseName(declared));
            options = t ? typeMembers(t, false) : libraryMembers(baseName(declared));
          }
        }
      }
      if (!options.length) return null;
      return { from, options, validFor: /^[\w$]*$/ };
    }

    const word = ctx.matchBefore(/[A-Za-z_$][\w$]*/);
    if (!word && !ctx.explicit) return null;
    const from = word ? word.from : ctx.pos;
    const options: Completion[] = [
      ...KEYWORDS.map((k) => ({ label: k, type: "keyword" })),
      ...Object.keys(LIBRARY).map((c) => ({ label: c, type: "class", boost: -1 })),
      ...javaIndex.types().map((t) => ({ label: t.name, type: t.kind === "interface" ? "interface" : t.kind === "enum" ? "enum" : "class", detail: t.package || undefined })),
    ];
    // Members of the class the cursor is in, without `this.`.
    const t = enclosingType(getPath(), ctx.state.doc.lineAt(ctx.pos).number);
    if (t) options.push(...typeMembers(t, false).map((c) => ({ ...c, boost: 1 })));
    return { from, options, validFor: /^[\w$]*$/ };
  };
}
