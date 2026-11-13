/*
 * A stand-in for the native side, so the interface can be worked on in a
 * plain browser (`npm run dev`, http://localhost:1430). It keeps a sample
 * project in memory and pretends to compile and run it.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { TEMPLATES } from "./templates";
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
