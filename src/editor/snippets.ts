/*
 * Snippets: short words that become whole pieces of code. Type `sysout` and press Ctrl+Space or Tab, and
 * `System.out.println();` is written with the cursor between the brackets; `!` in an HTML file becomes the
 * page's skeleton. They also show in the completion list, and Edit → Insert snippet lists them all.
 *
 * In a body, `${name}` is a field to fill in (Tab goes to the next one, fields of the same name change
 * together) and `${}` is where the cursor ends up. A field's name may not be only digits.
 */
import { Facet, Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeCompletion, snippet, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree, type Language } from "@codemirror/language";
import { javaLanguage } from "@codemirror/lang-java";
import { pythonLanguage } from "@codemirror/lang-python";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { cppLanguage } from "@codemirror/lang-cpp";
import { phpLanguage } from "@codemirror/lang-php";
import { commonmarkLanguage, markdownLanguage } from "@codemirror/lang-markdown";
import { SQLite } from "@codemirror/lang-sql";
import { t } from "../lib/i18n";

export interface Snippet {
  /** The words that expand it; the first is its name. */
  prefixes: string[];
  /** What it is, in a few words (translated where shown). */
  d: string;
  body: string;
}

function s(prefixes: string, d: string, body: string): Snippet {
  return { prefixes: prefixes.split(" "), d, body };
}

export type SnippetSet = "java" | "kotlin" | "python" | "javascript" | "typescript" | "html" | "xml" | "css" | "c" | "cpp" | "php" | "sql" | "markdown";

const JAVA: Snippet[] = [
  s("sout sysout syso", "print a line", "System.out.println(${});"),
  s("soutv", "print a variable", 'System.out.println("${value} = " + ${value});'),
  s("souf printf", "print formatted", 'System.out.printf("${%s}%n", ${});'),
  s("serr syserr", "print an error", "System.err.println(${});"),
  s("main psvm", "main method", "public static void main(String[] args) {\n\t${}\n}"),
  s("app mainclass", "class with a main method", "public class ${Main} {\n\n\tpublic static void main(String[] args) {\n\t\t${}\n\t}\n}"),
  s("fori", "counting loop", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
  s("forr", "counting loop backwards", "for (int ${i} = ${n} - 1; ${i} >= 0; ${i}--) {\n\t${}\n}"),
  s("foreach iter", "loop over items", "for (${Type} ${item} : ${items}) {\n\t${}\n}"),
  s("itar", "loop over an array", "for (int ${i} = 0; ${i} < ${array}.length; ${i}++) {\n\t${}\n}"),
  s("while", "while loop", "while (${condition}) {\n\t${}\n}"),
  s("dowhile", "do / while loop", "do {\n\t${}\n} while (${condition});"),
  s("if", "if block", "if (${condition}) {\n\t${}\n}"),
  s("ifelse", "if / else", "if (${condition}) {\n\t${}\n} else {\n\t\n}"),
  s("elseif", "else if", "else if (${condition}) {\n\t${}\n}"),
  s("ifnn", "if not null", "if (${value} != null) {\n\t${}\n}"),
  s("ifn", "if null", "if (${value} == null) {\n\t${}\n}"),
  s("switch", "switch", "switch (${value}) {\n\tcase ${a} -> ${};\n\tdefault -> ${};\n}"),
  s("try", "try / catch", "try {\n\t${}\n} catch (${Exception} e) {\n\te.printStackTrace();\n}"),
  s("tryf", "try / catch / finally", "try {\n\t${}\n} catch (${Exception} e) {\n\te.printStackTrace();\n} finally {\n\t\n}"),
  s("twr tryr", "try with resources", "try (${var} ${resource} = ${value}) {\n\t${}\n} catch (${Exception} e) {\n\te.printStackTrace();\n}"),
  s("throw", "throw an exception", "throw new ${IllegalArgumentException}(${});"),
  s("class", "class", "public class ${Name} {\n\n\tpublic ${Name}() {\n\t\t${}\n\t}\n}"),
  s("abstract", "abstract class", "public abstract class ${Name} {\n\t${}\n}"),
  s("interface", "interface", "public interface ${Name} {\n\t${}\n}"),
  s("enum", "enum", "public enum ${Name} {\n\t${A}, ${B}\n}"),
  s("record", "record", "public record ${Name}(${int x}) {\n\t${}\n}"),
  s("ctor", "constructor", "public ${Name}(${}) {\n\t\n}"),
  s("method", "method", "public ${void} ${name}(${}) {\n\t\n}"),
  s("smethod", "static method", "public static ${void} ${name}(${}) {\n\t\n}"),
  s("field", "private field", "private ${Type} ${name};"),
  s("const", "constant", "private static final ${int} ${NAME} = ${value};"),
  s("getter", "get method", "public ${Type} get${Name}() {\n\treturn ${name};\n}"),
  s("setter", "set method", "public void set${Name}(${Type} ${name}) {\n\tthis.${name} = ${name};\n}"),
  s("toString tostr", "override toString", "@Override\npublic String toString() {\n\treturn ${};\n}"),
  s(
    "equals",
    "override equals and hashCode",
    "@Override\npublic boolean equals(Object o) {\n\tif (this == o) return true;\n\tif (!(o instanceof ${Type} other)) return false;\n\treturn ${};\n}\n\n@Override\npublic int hashCode() {\n\treturn Objects.hash(${fields});\n}",
  ),
  s("scanner", "read from the keyboard", "Scanner ${in} = new Scanner(System.in);"),
  s("input readline", "ask for a line", 'System.out.print("${Your name: }");\nString ${line} = ${in}.nextLine();'),
  s("readint", "ask for a number", 'System.out.print("${A number: }");\nint ${n} = ${in}.nextInt();'),
  s("list", "new list", "List<${String}> ${list} = new ArrayList<>();"),
  s("map", "new map", "Map<${String}, ${Integer}> ${map} = new HashMap<>();"),
  s("set", "new set", "Set<${String}> ${set} = new HashSet<>();"),
  s("arr", "new array", "${int}[] ${array} = new ${int}[${size}];"),
  s("lambda", "lambda", "(${x}) -> ${}"),
  s("thread", "new thread", "new Thread(() -> {\n\t${}\n}).start();"),
  s("sleep", "pause", "try {\n\tThread.sleep(${millis});\n} catch (InterruptedException e) {\n\tThread.currentThread().interrupt();\n}"),
  s("random", "random number", "int ${n} = (int) (Math.random() * ${max});"),
  s("singleton", "singleton", "private static ${Name} instance;\n\nprivate ${Name}() {}\n\npublic static ${Name} getInstance() {\n\tif (instance == null) instance = new ${Name}();\n\treturn instance;\n}"),
  s("test", "JUnit test", "@Test\nvoid ${name}() {\n\t${}\n}"),
  s("doc javadoc", "documentation comment", "/**\n * ${}\n */"),
  s("todo", "TODO comment", "// TODO: ${}"),
];

const KOTLIN: Snippet[] = [
  s("main", "main function", "fun main() {\n\t${}\n}"),
  s("sout println", "print a line", "println(${})"),
  s("fun", "function", "fun ${name}(${}): ${Unit} {\n\t\n}"),
  s("fori", "counting loop", "for (${i} in 0 until ${n}) {\n\t${}\n}"),
  s("foreach iter", "loop over items", "for (${item} in ${items}) {\n\t${}\n}"),
  s("while", "while loop", "while (${condition}) {\n\t${}\n}"),
  s("dowhile", "do / while loop", "do {\n\t${}\n} while (${condition})"),
  s("if", "if block", "if (${condition}) {\n\t${}\n}"),
  s("ifelse", "if / else", "if (${condition}) {\n\t${}\n} else {\n\t\n}"),
  s("when", "when", "when (${value}) {\n\t${a} -> ${}\n\telse -> \n}"),
  s("try", "try / catch", "try {\n\t${}\n} catch (e: ${Exception}) {\n\te.printStackTrace()\n}"),
  s("class", "class", "class ${Name}(${}) {\n\t\n}"),
  s("data", "data class", "data class ${Name}(val ${x}: ${Int})"),
  s("object", "object", "object ${Name} {\n\t${}\n}"),
  s("interface", "interface", "interface ${Name} {\n\t${}\n}"),
  s("enum", "enum", "enum class ${Name} {\n\t${A}, ${B}\n}"),
  s("let", "if not null", "${value}?.let {\n\t${}\n}"),
  s("lambda", "lambda", "{ ${x} -> ${} }"),
  s("input readline", "ask for a line", 'print("${Your name: }")\nval ${line} = readln()'),
  s("list", "new list", "val ${list} = mutableListOf<${String}>()"),
  s("map", "new map", "val ${map} = mutableMapOf<${String}, ${Int}>()"),
  s("todo", "TODO comment", "// TODO: ${}"),
];

// Python's own completion already has def, for, while, try, if, class, import and from.
const PYTHON: Snippet[] = [
  s("main ifmain", "main guard", 'if __name__ == "__main__":\n\t${main()}'),
  s("pr print", "print a line", "print(${})"),
  s("prf", "print formatted", 'print(f"${}")'),
  s("input", "ask for a line", '${name} = input("${Your name: }")'),
  s("readint", "ask for a number", '${n} = int(input("${A number: }"))'),
  s("fori", "counting loop", "for ${i} in range(${n}):\n\t${}"),
  s("fore", "loop with index", "for ${i}, ${item} in enumerate(${items}):\n\t${}"),
  s("forz", "loop over two lists", "for ${a}, ${b} in zip(${first}, ${second}):\n\t${}"),
  s("loop", "endless loop", "while True:\n\t${}"),
  s("ifelse", "if / else", "if ${condition}:\n\t${}\nelse:\n\t"),
  s("ifelif", "if / elif / else", "if ${condition}:\n\t${}\nelif ${other}:\n\t\nelse:\n\t"),
  s("elif", "else if", "elif ${condition}:\n\t${}"),
  s("tryf", "try / except / finally", "try:\n\t${}\nexcept ${Exception} as e:\n\tprint(e)\nfinally:\n\t"),
  s("with open", "open a file", 'with open("${file.txt}", encoding="utf-8") as ${f}:\n\t${}'),
  s("defd", "function with a description", 'def ${name}(${}):\n\t"""${What it does.}"""\n\t'),
  s("adef", "async function", "async def ${name}(${}):\n\t"),
  s("init", "constructor", "def __init__(self, ${x}):\n\tself.${x} = ${x}\n\t${}"),
  s("method", "method", "def ${name}(self${}):\n\t"),
  s("str", "override __str__", 'def __str__(self):\n\treturn f"${}"'),
  s("cls", "class with a constructor", "class ${Name}:\n\tdef __init__(self, ${x}):\n\t\tself.${x} = ${x}\n\t\t${}"),
  s("dataclass", "data class", "from dataclasses import dataclass\n\n\n@dataclass\nclass ${Name}:\n\t${x}: ${int}"),
  s("prop", "property", "@property\ndef ${name}(self):\n\treturn self._${name}"),
  s("lambda", "lambda", "lambda ${x}: ${}"),
  s("lc", "list comprehension", "[${x} for ${x} in ${items}]"),
  s("dc", "dict comprehension", "{${k}: ${v} for ${k}, ${v} in ${items}.items()}"),
  s("random", "random number", "import random\n\n${n} = random.randint(${low}, ${high})"),
  s("test", "unit test", "import unittest\n\n\nclass ${Test}(unittest.TestCase):\n\tdef test_${name}(self):\n\t\t${}\n\n\nif __name__ == \"__main__\":\n\tunittest.main()"),
  s("todo", "TODO comment", "# TODO: ${}"),
];

// JavaScript's own completion already has function, for, do, while, try, if, class and import.
const JAVASCRIPT: Snippet[] = [
  s("log clg cl", "print a line", "console.log(${});"),
  s("logv", "print a variable", 'console.log("${value}:", ${value});'),
  s("cle", "print an error", "console.error(${});"),
  s("clw", "print a warning", "console.warn(${});"),
  s("fn", "function", "function ${name}(${}) {\n\t\n}"),
  s("afn arrow", "arrow function", "const ${name} = (${}) => {\n\t\n};"),
  s("asyncfn", "async function", "async function ${name}(${}) {\n\t\n}"),
  s("fori", "counting loop", "for (let ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
  s("forof", "loop over items", "for (const ${item} of ${items}) {\n\t${}\n}"),
  s("forin", "loop over keys", "for (const ${key} in ${object}) {\n\t${}\n}"),
  s("foreach", "for each item", "${items}.forEach((${item}) => {\n\t${}\n});"),
  s("map", "map items", "${items}.map((${item}) => ${})"),
  s("filter", "filter items", "${items}.filter((${item}) => ${})"),
  s("reduce", "reduce items", "${items}.reduce((${sum}, ${item}) => ${}, ${start})"),
  s("ifelse", "if / else", "if (${condition}) {\n\t${}\n} else {\n\t\n}"),
  s("switch", "switch", "switch (${value}) {\n\tcase ${a}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}"),
  s("tern", "condition ? a : b", "${condition} ? ${a} : ${b}"),
  s("tryf", "try / catch / finally", "try {\n\t${}\n} catch (${error}) {\n\tconsole.error(${error});\n} finally {\n\t\n}"),
  s("ctor", "constructor", "constructor(${}) {\n\t\n}"),
  s("timeout", "run later", "setTimeout(() => {\n\t${}\n}, ${delay});"),
  s("interval", "run again and again", "setInterval(() => {\n\t${}\n}, ${delay});"),
  s("promise", "new promise", "new Promise((resolve, reject) => {\n\t${}\n})"),
  s("fetch", "fetch JSON", "const ${response} = await fetch(${url});\nconst ${data} = await ${response}.json();"),
  s("qs", "find an element", 'document.querySelector("${selector}")'),
  s("qsa", "find elements", 'document.querySelectorAll("${selector}")'),
  s("gid", "element by id", 'document.getElementById("${id}")'),
  s("ael on", "listen for an event", '${element}.addEventListener("${click}", (${event}) => {\n\t${}\n});'),
  s("ce", "new element", 'document.createElement("${div}")'),
  s("json", "to JSON", "JSON.stringify(${value}, null, 2)"),
  s("parse", "from JSON", "JSON.parse(${text})"),
  s("imp", "import", 'import ${name} from "${module}";'),
  s("req", "require", 'const ${name} = require("${module}");'),
  s("exp", "export default", "export default ${};"),
  s("expf", "exported function", "export function ${name}(${}) {\n\t\n}"),
  s("rfc", "React component", "export function ${Component}() {\n\treturn (\n\t\t<div>${}</div>\n\t);\n}"),
  s("usestate", "React state", "const [${value}, set${Value}] = useState(${initial});"),
  s("useeffect", "React effect", "useEffect(() => {\n\t${}\n}, []);"),
  s("test it", "test", 'test("${does something}", () => {\n\t${}\n});'),
  s("describe", "group of tests", 'describe("${name}", () => {\n\t${}\n});'),
  s("doc", "documentation comment", "/**\n * ${}\n */"),
  s("todo", "TODO comment", "// TODO: ${}"),
];

const TYPESCRIPT: Snippet[] = [
  ...JAVASCRIPT,
  s("afn arrow", "arrow function", "const ${name} = (${}): ${void} => {\n\t\n};"),
  s("fn", "function", "function ${name}(${}): ${void} {\n\t\n}"),
  s("iface", "interface", "interface ${Name} {\n\t${}\n}"),
  s("typeu", "union type", 'type ${Name} = "${a}" | "${b}";'),
];

const HTML: Snippet[] = [
  s(
    "! html5 doc",
    "page skeleton",
    '<!DOCTYPE html>\n<html lang="${en}">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>${Document}</title>\n</head>\n<body>\n\t${}\n</body>\n</html>',
  ),
  s("link css", "style sheet", '<link rel="stylesheet" href="${style.css}">'),
  s("script js", "script file", '<script src="${script.js}"></script>'),
  s("module", "module script", '<script type="module" src="${main.js}"></script>'),
  s("style", "style block", "<style>\n\t${}\n</style>"),
  s("viewport", "viewport tag", '<meta name="viewport" content="width=device-width, initial-scale=1.0">'),
  s("favicon", "page icon", '<link rel="icon" href="${favicon.svg}">'),
  s("a", "link", '<a href="${url}">${}</a>'),
  s("img", "image", '<img src="${image.png}" alt="${}">'),
  s("ul", "list", "<ul>\n\t<li>${}</li>\n\t<li></li>\n</ul>"),
  s("ol", "numbered list", "<ol>\n\t<li>${}</li>\n\t<li></li>\n</ol>"),
  s("table", "table", "<table>\n\t<thead>\n\t\t<tr>\n\t\t\t<th>${Name}</th>\n\t\t\t<th>${Value}</th>\n\t\t</tr>\n\t</thead>\n\t<tbody>\n\t\t<tr>\n\t\t\t<td>${}</td>\n\t\t\t<td></td>\n\t\t</tr>\n\t</tbody>\n</table>"),
  s(
    "form",
    "form",
    '<form action="${}" method="${post}">\n\t<label for="${name}">${Name}</label>\n\t<input id="${name}" name="${name}" type="text">\n\t<button type="submit">${Send}</button>\n</form>',
  ),
  s("input", "input field", '<label for="${id}">${Label}</label>\n<input id="${id}" name="${id}" type="${text}">'),
  s("button", "button", '<button type="button">${}</button>'),
  s("select", "drop-down list", '<select name="${name}">\n\t<option value="${a}">${}</option>\n\t<option value="${b}"></option>\n</select>'),
  s("nav", "navigation", '<nav>\n\t<a href="${/}">${Home}</a>\n\t<a href="${}"></a>\n</nav>'),
  s("section", "section", "<section>\n\t<h2>${Title}</h2>\n\t${}\n</section>"),
  s("video", "video", '<video src="${video.mp4}" controls></video>'),
  s("comment", "comment", "<!-- ${} -->"),
];

const XML: Snippet[] = [s("xml", "XML declaration", '<?xml version="1.0" encoding="UTF-8"?>\n${}'), s("svg", "SVG drawing", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="${0 0 100 100}">\n\t${}\n</svg>'), s("comment", "comment", "<!-- ${} -->")];

const CSS: Snippet[] = [
  s("flexc center", "centre the content", "display: flex;\nalign-items: center;\njustify-content: center;"),
  s("flex", "row of items", "display: flex;\ngap: ${8px};"),
  s("flexcol", "column of items", "display: flex;\nflex-direction: column;\ngap: ${8px};"),
  s("grid", "grid", "display: grid;\ngrid-template-columns: repeat(auto-fill, minmax(${200px}, 1fr));\ngap: ${16px};"),
  s("media", "media query", "@media (max-width: ${768px}) {\n\t${}\n}"),
  s("dark", "dark mode", "@media (prefers-color-scheme: dark) {\n\t${}\n}"),
  s("keyframes", "animation", "@keyframes ${name} {\n\tfrom {\n\t\t${}\n\t}\n\tto {\n\t\t\n\t}\n}"),
  s("root vars", "custom properties", ":root {\n\t--${color}: ${value};\n}"),
  s("reset", "reset spacing", "*,\n*::before,\n*::after {\n\tbox-sizing: border-box;\n\tmargin: 0;\n\tpadding: 0;\n}"),
  s("fontface", "web font", '@font-face {\n\tfont-family: "${Name}";\n\tsrc: url("${font.woff2}") format("woff2");\n}'),
  s("import", "import a style sheet", '@import url("${file.css}");'),
  s("trans", "transition", "transition: ${all} ${0.2s} ${ease};"),
  s("abs fill", "fill the parent", "position: absolute;\ninset: 0;"),
  s("ellipsis", "cut long text", "overflow: hidden;\ntext-overflow: ellipsis;\nwhite-space: nowrap;"),
  s("shadow", "shadow", "box-shadow: 0 ${2px} ${8px} rgba(0, 0, 0, ${0.15});"),
  s("hover", "hover state", "&:hover {\n\t${}\n}"),
  s("sronly", "hidden but read aloud", "position: absolute;\nwidth: 1px;\nheight: 1px;\noverflow: hidden;\nclip: rect(0 0 0 0);\nwhite-space: nowrap;"),
];

const C: Snippet[] = [
  s("main", "main function", "int main(void) {\n\t${}\n\treturn 0;\n}"),
  s("prog hello", "program with main", "#include <stdio.h>\n\nint main(void) {\n\t${}\n\treturn 0;\n}"),
  s("pf printf sout", "print formatted", 'printf("${%d}\\n", ${});'),
  s("sf scanf", "read input", 'scanf("${%d}", &${n});'),
  s("inc", "include a header", "#include <${stdio.h}>"),
  s("incl", "include a local header", '#include "${file.h}"'),
  s("def define", "macro", "#define ${NAME} ${value}"),
  s("guard", "include guard", "#ifndef ${NAME}_H\n#define ${NAME}_H\n\n${}\n\n#endif"),
  s("fn func", "function", "${int} ${name}(${}) {\n\t\n}"),
  s("fori", "counting loop", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"),
  s("forr", "counting loop backwards", "for (int ${i} = ${n} - 1; ${i} >= 0; ${i}--) {\n\t${}\n}"),
  s("while", "while loop", "while (${condition}) {\n\t${}\n}"),
  s("dowhile", "do / while loop", "do {\n\t${}\n} while (${condition});"),
  s("if", "if block", "if (${condition}) {\n\t${}\n}"),
  s("ifelse", "if / else", "if (${condition}) {\n\t${}\n} else {\n\t\n}"),
  s("elseif", "else if", "else if (${condition}) {\n\t${}\n}"),
  s("switch", "switch", "switch (${value}) {\n\tcase ${a}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}"),
  s("struct", "struct", "struct ${Name} {\n\t${int x};\n};"),
  s("typedef", "named struct", "typedef struct {\n\t${int x};\n} ${Name};"),
  s("malloc", "allocate memory", "${int} *${p} = malloc(${n} * sizeof(${int}));\nif (${p} == NULL) {\n\treturn 1;\n}"),
  s("arr", "array", "${int} ${values}[${size}];"),
  s("doc", "documentation comment", "/**\n * ${}\n */"),
  s("todo", "TODO comment", "// TODO: ${}"),
];

const CPP: Snippet[] = [
  ...C,
  s("main", "main function", "int main() {\n\t${}\n\treturn 0;\n}"),
  s("prog hello", "program with main", "#include <iostream>\n\nint main() {\n\t${}\n\treturn 0;\n}"),
  s("cout sout", "print a line", "std::cout << ${} << std::endl;"),
  s("cin", "read input", "std::cin >> ${x};"),
  s("cerr", "print an error", "std::cerr << ${} << std::endl;"),
  s("inc", "include a header", "#include <${iostream}>"),
  s("using", "use namespace std", "using namespace std;"),
  s("foreach forr", "loop over items", "for (${const auto&} ${item} : ${items}) {\n\t${}\n}"),
  s("class", "class", "class ${Name} {\npublic:\n\t${Name}(${});\n\nprivate:\n\t\n};"),
  s("struct", "struct", "struct ${Name} {\n\t${int x};\n};"),
  s("ns namespace", "namespace", "namespace ${name} {\n\n${}\n\n}"),
  s("vec vector", "new vector", "std::vector<${int}> ${values};"),
  s("map", "new map", "std::map<${std::string}, ${int}> ${map};"),
  s("str", "new string", "std::string ${s};"),
  s("try", "try / catch", "try {\n\t${}\n} catch (const std::exception& e) {\n\tstd::cerr << e.what() << std::endl;\n}"),
  s("lambda", "lambda", "[${&}](${}) {\n\t\n}"),
  s("uptr", "unique pointer", "auto ${p} = std::make_unique<${Type}>(${});"),
];

// `$${name}` is a PHP variable whose name is a field.
const PHP: Snippet[] = [
  s("php", "PHP block", "<?php\n\n${}\n"),
  s("pe", "print in a page", "<?= ${} ?>"),
  s("echo sout", "print a line", 'echo "${}\\n";'),
  s("pr", "print an array", "print_r(${});"),
  s("vd", "dump a value", "var_dump(${});"),
  s("fn func", "function", "function ${name}(${}) {\n\t\n}"),
  s("fori", "counting loop", "for ($${i} = 0; $${i} < $${n}; $${i}++) {\n\t${}\n}"),
  s("fore foreach", "loop over items", "foreach ($${items} as $${item}) {\n\t${}\n}"),
  s("forek", "loop over keys and values", "foreach ($${items} as $${key} => $${value}) {\n\t${}\n}"),
  s("while", "while loop", "while (${condition}) {\n\t${}\n}"),
  s("if", "if block", "if (${condition}) {\n\t${}\n}"),
  s("ifelse", "if / else", "if (${condition}) {\n\t${}\n} else {\n\t\n}"),
  s("elseif", "else if", "elseif (${condition}) {\n\t${}\n}"),
  s("switch", "switch", "switch ($${value}) {\n\tcase ${a}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}"),
  s("match", "match", "$${result} = match ($${value}) {\n\t${a} => ${},\n\tdefault => null,\n};"),
  s("try", "try / catch", "try {\n\t${}\n} catch (${Exception} $e) {\n\techo $e->getMessage();\n}"),
  s("class", "class", "class ${Name}\n{\n\tpublic function __construct(${})\n\t{\n\t\t\n\t}\n}"),
  s("ctor", "constructor", "public function __construct(${})\n{\n\t\n}"),
  s("method", "method", "public function ${name}(${}): ${void}\n{\n\t\n}"),
  s("arr", "new array", "$${items} = [${}];"),
  s("get", "read a query value", '$${value} = $_GET["${name}"] ?? null;'),
  s("post", "read a form value", '$${value} = $_POST["${name}"] ?? null;'),
  s("pdo", "open a database", '$${pdo} = new PDO("${sqlite:database.db}");'),
  s("todo", "TODO comment", "// TODO: ${}"),
];

const SQL: Snippet[] = [
  s("sel", "select", "SELECT ${*}\nFROM ${table};"),
  s("selw", "select where", "SELECT ${*}\nFROM ${table}\nWHERE ${condition};"),
  s("join", "select with a join", "SELECT ${*}\nFROM ${a}\nJOIN ${b} ON ${b}.${id} = ${a}.${b_id};"),
  s("group", "count by group", "SELECT ${column}, COUNT(*)\nFROM ${table}\nGROUP BY ${column};"),
  s("ins", "insert", "INSERT INTO ${table} (${columns})\nVALUES (${});"),
  s("upd", "update", "UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition};"),
  s("del", "delete", "DELETE FROM ${table}\nWHERE ${condition};"),
  s("ct create", "new table", "CREATE TABLE ${name} (\n\tid INTEGER PRIMARY KEY,\n\t${}\n);"),
  s("idx", "new index", "CREATE INDEX ${name} ON ${table} (${column});"),
  s("view", "new view", "CREATE VIEW ${name} AS\nSELECT ${}\nFROM ${table};"),
];

const MARKDOWN: Snippet[] = [
  s("code", "code block", "```${java}\n${}\n```"),
  s("table", "table", "| ${Name} | ${Value} |\n| --- | --- |\n| ${} |  |"),
  s("link", "link", "[${text}](${url})"),
  s("img", "image", "![${description}](${url})"),
  s("task todo", "task", "- [ ] ${}"),
  s("details", "folded section", "<details>\n<summary>${Title}</summary>\n\n${}\n\n</details>"),
];

export const SNIPPETS: Record<SnippetSet, Snippet[]> = {
  java: JAVA,
  kotlin: KOTLIN,
  python: PYTHON,
  javascript: JAVASCRIPT,
  typescript: dedupe(TYPESCRIPT),
  html: HTML,
  xml: XML,
  css: CSS,
  c: C,
  cpp: dedupe(CPP),
  php: PHP,
  sql: SQL,
  markdown: MARKDOWN,
};

/** Later snippets take their words from earlier ones (C++ over C, TypeScript over JavaScript); one left without any goes. */
function dedupe(list: Snippet[]): Snippet[] {
  let out: Snippet[] = [];
  for (const x of list) {
    out = out.map((o) => ({ ...o, prefixes: o.prefixes.filter((p) => !x.prefixes.includes(p)) })).filter((o) => o.prefixes.length);
    out.push(x);
  }
  return out;
}

/** The file's language (set per editor), which picks C or C++, JavaScript or TypeScript, HTML or XML. */
export const fileLanguage = Facet.define<string, string>({ combine: (v) => v[0] ?? "text" });

/** Which set applies at a position: the language there (a script inside HTML is JavaScript), then the file's. */
export function snippetSetAt(state: EditorState, pos: number): SnippetSet | null {
  const here = state.languageDataAt<string>("logiqSnippets", pos, -1)[0] as SnippetSet | undefined;
  if (!here) return null;
  const file = state.facet(fileLanguage);
  if (here === "c" && file === "cpp") return "cpp";
  if (here === "javascript" && file === "typescript") return "typescript";
  if (here === "html" && file === "xml") return "xml";
  return here;
}

const WORD: Partial<Record<SnippetSet, RegExp>> = { html: /(?:[\w-]+|!)$/, xml: /[\w-]+$/, css: /[\w-]+$/, markdown: /[\w-]+$/, php: /[\w$]+$/ };

/** The word before the cursor that could name a snippet, or null where none belongs (comments, strings, tags). */
function wordBefore(state: EditorState, pos: number, set: SnippetSet): { from: number; text: string } | null {
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const m = (WORD[set] ?? /[\w$]+$/).exec(before);
  const text = m ? m[0] : "";
  const from = pos - text.length;
  // A member (`list.map`) is not a snippet, nor is the middle of a word.
  if (text && /[\w$.]$/.test(before.slice(0, before.length - text.length))) return null;
  const node = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    const name = n.name;
    if (set !== "markdown" && /comment|string|regexp|charliteral|character|textblock|heredoc|nowdoc/i.test(name)) return null;
    if ((set === "html" || set === "xml") && /^(OpenTag|CloseTag|SelfClosingTag|Attribute\w*)$/.test(name)) return null;
    if (set === "markdown" && /^(FencedCode|CodeBlock|InlineCode)$/.test(name)) return null;
  }
  return { from, text };
}

/** Field names stand for themselves in the preview. */
export function previewOf(body: string) {
  return body.replace(/[#$]\{(?:\d+:)?((?:\\[{}]|[^{}])*)\}/g, "$1").replace(/\\([{}])/g, "$1");
}

function info(sn: Snippet) {
  return () => {
    const pre = document.createElement("pre");
    pre.className = "cm-snippetPreview";
    pre.textContent = previewOf(sn.body);
    return pre;
  };
}

export function snippetCompletions(set: SnippetSet) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const at = snippetSetAt(ctx.state, ctx.pos) ?? set;
    const word = wordBefore(ctx.state, ctx.pos, at);
    if (!word || (!word.text && !ctx.explicit)) return null;
    const typed = word.text.toLowerCase();
    const options: Completion[] = SNIPPETS[at].map((sn) => {
      // The name that fits what is typed: `sys` finds sysout.
      const label = sn.prefixes.find((p) => p.toLowerCase().startsWith(typed)) ?? sn.prefixes[0];
      return {
        label,
        detail: t(sn.d),
        type: "snippet",
        info: info(sn),
        boost: label.toLowerCase() === typed ? 3 : 1,
        apply: (view: EditorView, _c: Completion, from: number, to: number) => snippet(sn.body)(view, null, from, to),
      };
    });
    return { from: word.from, options };
  };
}

/** The snippet the word before the cursor names exactly, if it may expand there. */
export function snippetAtCursor(state: EditorState): { from: number; to: number; snippet: Snippet } | null {
  const sel = state.selection.main;
  if (!sel.empty || state.selection.ranges.length > 1) return null;
  const set = snippetSetAt(state, sel.head);
  if (!set) return null;
  const word = wordBefore(state, sel.head, set);
  if (!word?.text) return null;
  const typed = word.text.toLowerCase();
  const list = SNIPPETS[set];
  const found = list.find((sn) => sn.prefixes.includes(word.text)) ?? list.find((sn) => sn.prefixes.some((p) => p.toLowerCase() === typed));
  if (!found) return null;
  // A snippet of several lines starts a line: `int main` + Tab stays as it is.
  const line = state.doc.lineAt(word.from);
  if (found.body.includes("\n") && line.text.slice(0, word.from - line.from).trim()) return null;
  return { from: word.from, to: sel.head, snippet: found };
}

/** Writes the snippet the word before the cursor names; false when there is none. */
export function expandSnippet(view: EditorView): boolean {
  const hit = snippetAtCursor(view.state);
  if (!hit) return false;
  closeCompletion(view);
  snippet(hit.snippet.body)(view, null, hit.from, hit.to);
  return true;
}

/** Writes a snippet at the cursor (from the list of all of them). */
export function insertSnippet(view: EditorView, sn: Snippet) {
  const { from, to } = view.state.selection.main;
  snippet(sn.body)(view, null, from, to);
  view.focus();
}

const LANGUAGES: [Language, SnippetSet][] = [
  [javaLanguage, "java"],
  [pythonLanguage, "python"],
  [javascriptLanguage, "javascript"],
  [cssLanguage, "css"],
  [htmlLanguage, "html"],
  [cppLanguage, "c"],
  [phpLanguage, "php"],
  [SQLite.language, "sql"],
  [commonmarkLanguage, "markdown"],
  [markdownLanguage, "markdown"],
];

/** Snippets in completion and on Ctrl+Space and Tab, for every language that has them. */
export function snippetSupport(kotlin: Language): Extension {
  return [
    [...LANGUAGES, [kotlin, "kotlin"] as [Language, SnippetSet]].map(([lang, set]) => lang.data.of({ logiqSnippets: set, autocomplete: snippetCompletions(set) })),
    // Before completion's own Ctrl+Space: a whole snippet name is written out at once, anything else opens the list.
    Prec.highest(keymap.of([{ key: "Ctrl-Space", run: expandSnippet }])),
    Prec.high(
      keymap.of([
        {
          key: "Tab",
          // In HTML and CSS, Emmet expands on Tab (`!`, `ul>li*3`); Ctrl+Space writes these snippets there.
          run: (v) => {
            const set = snippetSetAt(v.state, v.state.selection.main.head);
            return set !== "html" && set !== "css" && expandSnippet(v);
          },
        },
      ]),
    ),
  ];
}
