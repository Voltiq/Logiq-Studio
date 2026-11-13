/*
 * A stand-in for the native side, so the interface can be worked on in a
 * plain browser (`npm run dev`, http://localhost:1430). It keeps a sample
 * project in memory and pretends to compile and run it.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { TEMPLATES } from "./templates";
import { parseJava } from "../uml/javaParser";
import type { Entry, SearchHit } from "./types";
import { createMockGit } from "./mockGit";

const ROOT = "C:\\Users\\Demo\\Projects\\Shapes";
const files = new Map<string, string>();
const dirs = new Set<string>([ROOT, ROOT + "\\web"]);

for (const [name, text] of Object.entries(TEMPLATES.find((x) => x.id === "java-classes")!.files)) files.set(`${ROOT}\\${name}`, text);
for (const [name, text] of Object.entries(TEMPLATES.find((x) => x.id === "web")!.files)) files.set(`${ROOT}\\web\\${name}`, text);
files.set(`${ROOT}\\README.md`, "# Shapes\n\nA sample project for Logiq Studio.\n");
// Other languages, to try their plug-ins.
for (const [id, dir] of [["python", "py"], ["sql", "db"], ["c", "c"], ["php", "php"]] as const) {
  dirs.add(`${ROOT}\\${dir}`);
  for (const [name, text] of Object.entries(TEMPLATES.find((x) => x.id === id)!.files)) if (!name.startsWith(".")) files.set(`${ROOT}\\${dir}\\${name}`, text);
}

const TOOLS: Record<string, { path: string; version: string; source: string }[]> = {
  python: [
    { path: `${ROOT}\\.venv\\Scripts\\python.exe`, version: "3.14.7", source: ".venv" },
    { path: "C:\\Users\\Demo\\AppData\\Local\\Programs\\Python\\Python314\\python.exe", version: "3.14.7", source: "Python" },
  ],
  cc: [{ path: "C:\\Program Files\\LLVM\\bin\\clang.exe", version: "23.1.3", source: "LLVM" }],
  cxx: [{ path: "C:\\Program Files\\LLVM\\bin\\clang++.exe", version: "23.1.3", source: "LLVM" }],
  php: [{ path: "C:\\php\\php.exe", version: "8.5.11", source: "PHP" }],
  "clang-format": [{ path: "C:\\Program Files\\LLVM\\bin\\clang-format.exe", version: "", source: "LLVM" }],
};

/** A pretend SQLite: CREATE/INSERT change rows, SELECT gives the shop's customers. */
function mockSql(script: string, at: number | null) {
  const parts: { from: number; to: number; sql: string }[] = [];
  let start = 0;
  for (let i = 0; i <= script.length; i++) {
    if (i === script.length || script[i] === ";") {
      const raw = script.slice(start, i + 1);
      const body = raw.replace(/--[^\n]*/g, "").trim();
      if (body && body !== ";") {
        const lead = raw.length - raw.trimStart().length;
        parts.push({ from: start + lead, to: Math.min(script.length, i + 1), sql: raw.trim() });
      }
      start = i + 1;
    }
  }
  const chosen = at === null ? parts : [parts.find((p) => p.from <= at && at <= p.to + 1) ?? parts.filter((p) => p.from <= at).pop() ?? parts[0]].filter(Boolean);
  const results = [];
  for (const p of chosen) {
    const sql = p.sql.replace(/--[^\n]*/g, "").trim();
    if (/^select/i.test(sql)) {
      if (/nope/i.test(sql)) {
        results.push({ ...p, columns: [], rows: [], truncated: false, changes: 0, durationMs: 1, error: "no such column: nope" });
        break;
      }
      const grouped = /group by/i.test(sql);
      results.push({
        ...p,
        columns: grouped
          ? [{ name: "city", declType: "TEXT" }, { name: "orders", declType: "" }, { name: "revenue", declType: "" }]
          : [{ name: "id", declType: "INTEGER" }, { name: "name", declType: "TEXT" }, { name: "city", declType: "TEXT" }],
        rows: grouped
          ? [["London", 2, 10.6], ["Köln", 1, 0.9], ["Taipei", 1, 17.5]]
          : [[1, "Ada", "London"], [2, "Jürgen", "Köln"], [3, "Mei", null]],
        truncated: false,
        changes: 0,
        durationMs: 2,
        error: null,
      });
    } else results.push({ ...p, columns: [], rows: [], truncated: false, changes: /^insert/i.test(sql) ? 3 : 0, durationMs: 1, error: null });
  }
  return { results, sqliteVersion: "3.50.4" };
}

const parent = (p: string) => p.slice(0, p.lastIndexOf("\\"));
const name = (p: string) => p.slice(p.lastIndexOf("\\") + 1);

function list(dir: string): Entry[] {
  const out: Entry[] = [];
  for (const d of dirs) if (d !== dir && parent(d) === dir) out.push({ name: name(d), path: d, isDir: true, size: 0, modified: 0 });
  for (const [p, t] of files) if (parent(p) === dir) out.push({ name: name(p), path: p, isDir: false, size: t.length, modified: 0 });
  return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

let runId = 0;
let mockLine = 4;

function mockStop(reason: string) {
  return {
    event: "stopped",
    reason,
    thread: "main",
    frame: 0,
    frames: [
      { cls: "Main", method: "main", line: mockLine, source: "Main.java" },
    ],
    variables: [
      { name: "args", type: "String[]", value: "String[0] #10", id: 10 },
      { name: "drawing", type: "Drawing", value: "Drawing #11", id: 11 },
    ],
  };
}

// The bench: objects with fields taken from the classes' source, constructor arguments assigned by name.
interface MockObject {
  cls: string;
  fields: { name: string; type: string; value: string; static: boolean; owner: string }[];
}
const bench = new Map<string, MockObject>();

function typeOf(cls: string) {
  for (const [p, text] of files) {
    if (!p.endsWith(".java")) continue;
    const t = parseJava(text, p).types.find((x) => x.qualifiedName === cls || x.name === cls);
    if (t) return t;
  }
  return null;
}

function benchState() {
  return [...bench].map(([name, o]) => ({ name, cls: o.cls, simple: o.cls.split(".").pop(), fields: o.fields }));
}

function benchAnswer(f: string[]): string {
  const op = f[0];
  if (op === "new") {
    const t = typeOf(f[2]);
    const fields: MockObject["fields"] = [];
    // Inherited fields first, as the JVM reports them.
    const chain = [];
    for (let c = t; c; c = c.extends[0] ? typeOf(c.extends[0]) : null) chain.unshift(c);
    const ctor = t?.methods.find((m) => m.isConstructor && m.params.map((p) => p.type).join(",") === f[3]);
    for (const c of chain) for (const x of c.fields) fields.push({ name: x.name, type: x.type, value: x.type === "String" ? "null" : /int|double|long/.test(x.type) ? "0" : "null", static: x.isStatic, owner: c.name });
    ctor?.params.forEach((p, i) => {
      const fld = fields.find((x) => x.name === p.name);
      if (fld) fld.value = f[4 + i] ?? "";
    });
    bench.set(f[1], { cls: f[2], fields });
    return JSON.stringify({ ok: true, out: "", objects: benchState() });
  }
  if (op === "call") {
    const o = bench.get(f[1]);
    const ret = f[3] === "area" ? { text: "12.566370614359172", type: "double" } : f[3].startsWith("get") ? { text: o?.fields.find((x) => x.name.toLowerCase() === f[3].slice(3).toLowerCase())?.value ?? "null", type: "String" } : undefined;
    return JSON.stringify({ ok: true, value: ret, out: f[3] === "draw" ? `${o?.cls} at (0.0, 0.0)
` : "", objects: benchState() });
  }
  if (op === "remove") bench.delete(f[1]);
  return JSON.stringify({ ok: true, out: "", objects: benchState() });
}

const terms = new Map<number, { line: string; prompt: string }>();
const mockGit = createMockGit(ROOT, files, (event, payload) => void emit(event, payload));

export function installMock() {
  mockWindows("main");
  mockIPC(
    async (cmd, raw) => {
      const a = (raw ?? {}) as Record<string, any>;
      switch (cmd) {
        case "launch_paths":
          return [];
        case "fs_list_dir":
          return list(a.path);
        case "fs_read_text":
          if (!files.has(a.path)) throw "The file was not found.";
          return { text: files.get(a.path), eol: "lf", modified: 1 };
        case "fs_write_text":
          files.set(a.path, a.text);
          return Date.now();
        case "fs_write_bytes":
          return null;
        case "fs_create_file":
          if (files.has(a.path)) throw `“${name(a.path)}” already exists.`;
          files.set(a.path, a.text ?? "");
          // Like the native side, the folders it needs come with it.
          for (let d = parent(a.path); d.includes("\\") && !dirs.has(d); d = parent(d)) dirs.add(d);
          return null;
        case "fs_create_dir":
          dirs.add(a.path);
          return null;
        case "fs_rename": {
          for (const [p, t] of [...files]) {
            if (p === a.from || p.startsWith(a.from + "\\")) {
              files.delete(p);
              files.set(a.to + p.slice(a.from.length), t);
            }
          }
          for (const d of [...dirs]) {
            if (d === a.from || d.startsWith(a.from + "\\")) {
              dirs.delete(d);
              dirs.add(a.to + d.slice(a.from.length));
            }
          }
          return null;
        }
        case "fs_copy": {
          if (files.has(a.to) || dirs.has(a.to)) throw `“${name(a.to)}” already exists.`;
          for (const [p, t] of [...files]) if (p === a.from || p.startsWith(a.from + "\\")) files.set(a.to + p.slice(a.from.length), t);
          for (const d of [...dirs]) if (d === a.from || d.startsWith(a.from + "\\")) dirs.add(a.to + d.slice(a.from.length));
          return null;
        }
        case "fs_delete":
          files.delete(a.path);
          for (const p of [...files.keys()]) if (p.startsWith(a.path + "\\")) files.delete(p);
          for (const d of [...dirs]) if (d === a.path || d.startsWith(a.path + "\\")) dirs.delete(d);
          return null;
        case "fs_exists":
          return files.has(a.path) || dirs.has(a.path);
        case "fs_list_files":
          return [...files.keys()].filter((p) => p.startsWith(a.root)).map((p) => p.slice(a.root.length + 1).replace(/\\/g, "/"));
        case "fs_read_sources":
          return [...files].filter(([p]) => p.startsWith(a.root) && p.endsWith("." + a.extension)).map(([path, text]) => ({ path, text }));
        case "search_workspace": {
          const q: string = a.options.query;
          const hits: SearchHit[] = [];
          if (q) {
            for (const [path, text] of files) {
              text.split("\n").forEach((line, i) => {
                const col = a.options.matchCase ? line.indexOf(q) : line.toLowerCase().indexOf(q.toLowerCase());
                if (col >= 0) hits.push({ path, line: i + 1, column: col, length: q.length, preview: line.trim(), previewStart: line.length - line.trimStart().length });
              });
            }
          }
          return { hits, filesSearched: files.size, truncated: false };
        }
        case "watch_folder":
        case "set_preview_root":
          return null;
        case "detect_jdks":
          return [{ home: "C:\\Program Files\\Java\\jdk-27", version: "27", major: 27, vendor: "Oracle Corporation" }];
        case "detect_node":
          return { path: "C:\\Program Files\\nodejs\\node.exe", version: "v26.9.0" };
        case "java_compile":
          await new Promise((r) => setTimeout(r, 400));
          return { ok: true, diagnostics: [], output: "", files: [...files.keys()].filter((p) => p.endsWith(".java")).length, durationMs: 412 };
        case "run_java":
        case "run_node": {
          const id = ++runId;
          const lines = ["== My first drawing ==\n", "Circle at (0.0, 0.0), area 12.57\n", "Rectangle at (4.0, 1.0), area 6.00\n", "Square at (-3.0, 2.0), area 2.25\n", "Total area: 20.82\n"];
          lines.forEach((text, i) => setTimeout(() => emit("run-output", { runId: id, stream: "stdout", text }), 150 + i * 120));
          setTimeout(() => emit("run-exit", { runId: id, code: 0, durationMs: 840 }), 150 + lines.length * 120);
          return id;
        }
        case "run_stdin":
        case "run_stop":
          return null;
        case "bench_start":
          bench.clear();
          return JSON.stringify({ ok: true, ready: true, objects: [] });
        case "bench_stop":
          bench.clear();
          return null;
        case "bench_send":
          return benchAnswer(String(a.request).split(""));
        case "debug_start": {
          const ev = (o: unknown, ms: number) => setTimeout(() => emit("debug-event", JSON.stringify(o)), ms);
          ev({ event: "started" }, 100);
          if (a.trace) {
            ev({ event: "output", stream: "stdout", text: "== My first drawing ==\n" }, 200);
            ev({
              event: "trace",
              participants: ["actor", "Main", "drawing1:Drawing", "circle1:Circle", "rectangle1:Rectangle"],
              calls: [
                { kind: "call", from: "actor", to: "Main", method: "main", args: "String[0]", depth: 0 },
                { kind: "call", from: "Main", to: "drawing1:Drawing", method: "new", args: '"My first drawing"', depth: 1 },
                { kind: "return", from: "drawing1:Drawing", to: "Main", method: "new", value: "", depth: 1 },
                { kind: "call", from: "Main", to: "circle1:Circle", method: "new", args: "0.0, 0.0, 2.0", depth: 1 },
                { kind: "return", from: "circle1:Circle", to: "Main", method: "new", value: "", depth: 1 },
                { kind: "call", from: "Main", to: "drawing1:Drawing", method: "add", args: "circle1", depth: 1 },
                { kind: "return", from: "drawing1:Drawing", to: "Main", method: "add", value: "", depth: 1 },
                { kind: "call", from: "Main", to: "drawing1:Drawing", method: "totalArea", args: "", depth: 1 },
                { kind: "call", from: "drawing1:Drawing", to: "circle1:Circle", method: "area", args: "", depth: 2 },
                { kind: "return", from: "circle1:Circle", to: "drawing1:Drawing", method: "area", value: "12.566", depth: 2 },
                { kind: "call", from: "drawing1:Drawing", to: "rectangle1:Rectangle", method: "area", args: "", depth: 2 },
                { kind: "return", from: "rectangle1:Rectangle", to: "drawing1:Drawing", method: "area", value: "6.0", depth: 2 },
                { kind: "return", from: "drawing1:Drawing", to: "Main", method: "totalArea", value: "18.566", depth: 1 },
                { kind: "return", from: "Main", to: "actor", method: "main", value: "", depth: 0 },
              ],
              truncated: false,
            }, 400);
            ev({ event: "exited", code: 0 }, 500);
          } else {
            mockLine = 4;
            ev(mockStop("breakpoint"), 300);
          }
          return null;
        }
        case "debug_send": {
          const op = a.fields[0];
          const ev = (o: unknown, ms: number) => setTimeout(() => emit("debug-event", JSON.stringify(o)), ms);
          if (op === "over" || op === "into") {
            mockLine++;
            ev({ event: "resumed" }, 10);
            ev(mockStop("step"), 120);
          } else if (op === "resume") {
            ev({ event: "resumed" }, 10);
            ev({ event: "output", stream: "stdout", text: "Total area: 20.82\n" }, 100);
            ev({ event: "exited", code: 0 }, 200);
          } else if (op === "expand") {
            ev({ event: "children", id: Number(a.fields[1]), children: [{ name: "shapes", type: "List", value: "ArrayList (0) #12", id: 12 }, { name: "title", type: "String", value: '"My first drawing"' }] }, 50);
          } else if (op === "eval") {
            ev({ event: "watch", value: { name: a.fields[2], type: "int", value: "3" } }, 50);
          }
          return null;
        }
        case "debug_stop":
          return null;
        case "jshell_start":
          setTimeout(() => emit("jshell-output", "|  Welcome to JShell -- Version 27\n\njshell> "), 100);
          return null;
        case "jshell_send":
          setTimeout(() => emit("jshell-output", `$1 ==> ${a.text.trim()}\n\njshell> `), 100);
          return null;
        case "jshell_stop":
          return null;
        case "git_info":
          return { version: "2.55.0.windows.1", name: "Ada Lovelace", email: "ada@example.invalid" };
        case "git_exec":
          return mockGit.exec(a.args, a.input ?? null);
        case "git_show_file":
          return mockGit.show(a.spec);
        case "git_stream":
          mockGit.stream(a.id, a.args);
          return null;
        case "git_cancel":
          return null;
        case "term_shells":
          return [
            { id: "pwsh", name: "PowerShell", path: "pwsh.exe", args: ["-NoLogo"] },
            { id: "cmd", name: "Command Prompt", path: "cmd.exe", args: [] },
            { id: "bash", name: "Git Bash", path: "bash.exe", args: ["--login", "-i"] },
          ];
        case "term_open": {
          const prompt = `PS ${a.cwd}> `;
          terms.set(a.id, { line: "", prompt });
          setTimeout(() => emit("term-data", { id: a.id, data: `\x1b[2mPowerShell (stand-in)\x1b[0m\r\n${prompt}` }), 60);
          return null;
        }
        case "term_write": {
          const term = terms.get(a.id);
          if (!term) throw "The terminal has closed.";
          let out = "";
          for (const ch of a.data as string) {
            if (ch === "\r") {
              const cmd = term.line.trim();
              term.line = "";
              if (cmd === "exit") {
                setTimeout(() => emit("term-exit", { id: a.id, code: 0 }), 30);
                terms.delete(a.id);
                out += "\r\n";
                break;
              }
              out += "\r\n" + (cmd.startsWith("echo ") ? cmd.slice(5) + "\r\n" : cmd ? `\x1b[33m${cmd}\x1b[0m: ran (stand-in)\r\n` : "") + term.prompt;
            } else if (ch === "\x7f") {
              if (term.line) {
                term.line = term.line.slice(0, -1);
                out += "\b \b";
              }
            } else if (ch >= " ") {
              term.line += ch;
              out += ch;
            }
          }
          if (out) setTimeout(() => emit("term-data", { id: a.id, data: out }), 10);
          return null;
        }
        case "term_resize":
          return null;
        case "term_close":
          terms.delete(a.id);
          return null;
        case "junit_find":
          return "C:\\lib\\junit-platform-console-standalone-1.12.2.jar";
        case "junit_run":
          return {
            ok: false,
            output: "",
            report: '<testsuite><testcase name="area()" classname="CircleTest" time="0.012"/><testcase name="moveBy()" classname="CircleTest" time="0.003"><failure message="expected: &lt;2.0&gt; but was: &lt;1.0&gt;" type="org.opentest4j.AssertionFailedError">stack</failure></testcase></testsuite>',
          };
        case "tools_find":
          return TOOLS[a.kind as string] ?? [];
        case "tool_exec": {
          const x = a as { program: string; args: string[]; input: string | null };
          // clang-format: tidies the braces of the pretend C file.
          if (/clang-format/.test(x.program)) return { code: 0, stdout: (x.input ?? "").replace(/\)\s*\{/g, ") {").replace(/[ \t]+\n/g, "\n"), stderr: "" };
          if (x.args.includes("-l")) return { code: 0, stdout: "No syntax errors detected\n", stderr: "" };
          return { code: 0, stdout: "", stderr: "" };
        }
        case "native_compile":
          await new Promise((r) => setTimeout(r, 300));
          return { ok: true, diagnostics: [], output: "", files: a.files as number, durationMs: 287 };
        case "run_program": {
          const id = ++runId;
          const py = /python/i.test(a.program as string);
          const out = py ? ["What's your name? "] : ["First number: "];
          out.forEach((text, i) => setTimeout(() => emit("run-output", { runId: id, stream: "stdout", text }), 120 + i * 100));
          if (py) {
            const shop = `${ROOT}\\py\\shop.py`;
            setTimeout(
              () =>
                emit("run-output", {
                  runId: id,
                  stream: "stderr",
                  text: `Traceback (most recent call last):\n  File "${ROOT}\\py\\main.py", line 19, in <module>\n    main()\n  File "${shop}", line 33, in total\n    return sum(line.total() for line in self.lines)\nTypeError: unsupported operand type(s) for +: 'int' and 'str'\n`,
                }),
              500,
            );
            setTimeout(() => emit("run-exit", { runId: id, code: 1, durationMs: 610 }), 650);
          } else setTimeout(() => emit("run-exit", { runId: id, code: 0, durationMs: 420 }), 700);
          return id;
        }
        case "sql_run": {
          await new Promise((r) => setTimeout(r, 120));
          return mockSql(a.script as string, (a.at as number | null) ?? null);
        }
        case "sql_schema":
          return [
            { name: "customer", kind: "table", columns: [{ name: "id", declType: "INTEGER" }, { name: "name", declType: "TEXT" }, { name: "city", declType: "TEXT" }] },
            { name: "product", kind: "table", columns: [{ name: "id", declType: "INTEGER" }, { name: "title", declType: "TEXT" }, { name: "price", declType: "REAL" }] },
          ];
        case "php_serve":
          return 8123;
        case "php_serve_stop":
        case "lsp_start_program":
          return null;
        case "jar_export":
        case "javadoc_generate":
          return { ok: true, output: "", path: "C:\\out.jar" };
        case "plugin:dialog|open":
          return ROOT;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}

export const MOCK_ROOT = ROOT;
