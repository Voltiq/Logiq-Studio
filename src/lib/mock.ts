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

const ROOT = "C:\\Users\\Demo\\Projects\\Shapes";
const files = new Map<string, string>();
const dirs = new Set<string>([ROOT, ROOT + "\\web"]);

for (const [name, text] of Object.entries(TEMPLATES[0].files)) files.set(`${ROOT}\\${name}`, text);
for (const [name, text] of Object.entries(TEMPLATES[2].files)) files.set(`${ROOT}\\web\\${name}`, text);
files.set(`${ROOT}\\README.md`, "# Shapes\n\nA sample project for Logiq Studio.\n");

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
        case "junit_find":
          return "C:\\lib\\junit-platform-console-standalone-1.12.2.jar";
        case "junit_run":
          return {
            ok: false,
            output: "",
            report: '<testsuite><testcase name="area()" classname="CircleTest" time="0.012"/><testcase name="moveBy()" classname="CircleTest" time="0.003"><failure message="expected: &lt;2.0&gt; but was: &lt;1.0&gt;" type="org.opentest4j.AssertionFailedError">stack</failure></testcase></testsuite>',
          };
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
