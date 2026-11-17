/*
 * Java problems while you write: a moment after typing stops (and after saving, and when files change on
 * disk), the project is compiled in the background with the editors' unsaved text, into a temporary folder.
 * The compiler's problems then replace the earlier ones, so a fixed error goes away without building or
 * running, and a new one shows with the compiler's own message.
 */
import { api } from "./api";
import { get, set } from "./store";
import { allDocs } from "../editor/docs";
import { extname } from "./paths";

const DELAY = 1200;
let timer = 0;
let running = false;
let again = false;

const key = (p: string) => p.replace(/\//g, "\\").toLowerCase();

/** The text each open Java file had when it was last checked; while it is unchanged the compiler's word stands. */
const checked = new Map<string, string>();

/** Whether the compiler has seen exactly this text of the file. */
export function compilerSawText(path: string, text: string): boolean {
  return checked.get(key(path)) === text;
}

/** Checks the Java code a moment from now (again if one is under way). */
export function scheduleJavaCheck(delay = DELAY) {
  if (!get().root) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void check(), delay);
}

async function check() {
  if (running) {
    again = true;
    return;
  }
  const s = get();
  const root = s.root;
  if (!root || !s.jdks.length) return;
  // Building or running reports its own problems.
  if (s.run.status === "compiling") {
    scheduleJavaCheck();
    return;
  }
  running = true;
  const buffers = allDocs()
    .filter((d) => extname(d.path) === "java")
    .map((d) => ({ path: d.path, text: d.state.doc.toString() }));
  try {
    const found = await api.javaCheck(root, s.settings.jdkHome || s.jdks[0]?.home || null, buffers);
    if (found && get().root === root) {
      checked.clear();
      for (const b of buffers) checked.set(key(b.path), b.text);
      const windows = root.includes("\\");
      const java = found.map((d) => ({ ...d, path: windows ? d.path.replace(/\//g, "\\") : d.path }));
      // The other languages' problems stay; Java's are replaced by what the compiler says now.
      set((st) => ({ problems: [...st.problems.filter((p) => extname(p.path) !== "java"), ...java], problemsVersion: st.problemsVersion + 1 }));
    }
  } catch {
    // No JDK, or the check failed: the problems stay as they are.
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleJavaCheck(300);
    }
  }
}
