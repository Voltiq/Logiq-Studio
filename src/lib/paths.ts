/* Path helpers that work with Windows (`C:\a\b`) and POSIX paths alike. */

export function sep(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

export function join(dir: string, ...parts: string[]): string {
  const s = sep(dir);
  let out = dir.replace(/[\\/]+$/, "");
  for (const p of parts) {
    const clean = p.replace(/[\\/]+/g, s).replace(/^[\\/]+|[\\/]+$/g, "");
    if (clean) out += s + clean;
  }
  return out;
}

export function basename(path: string): string {
  const m = path.replace(/[\\/]+$/, "").match(/[^\\/]*$/);
  return m ? m[0] : path;
}

export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (i < 0) return "";
  // Keep "C:\" and "/" as roots.
  if (i === 2 && trimmed[1] === ":") return trimmed.slice(0, 3);
  if (i === 0) return trimmed[0];
  return trimmed.slice(0, i);
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

export function stem(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

function norm(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

/** Whether `path` is `dir` or lies inside it. */
export function isInside(path: string, dir: string): boolean {
  const p = norm(path);
  const d = norm(dir);
  return p === d || p.startsWith(d + "/");
}

/** `path` relative to `root`, with forward slashes. */
export function relative(root: string, path: string): string {
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = path.replace(/\\/g, "/");
  if (p.toLowerCase().startsWith(r.toLowerCase() + "/")) return p.slice(r.length + 1);
  return p;
}

/** Replaces the `from` prefix of `path` with `to` (after a rename or move). */
export function rebase(path: string, from: string, to: string): string {
  if (samePath(path, from)) return to;
  return to + path.slice(from.length);
}

const INVALID = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** An error message for a file name Windows would refuse, or null. */
export function invalidName(name: string): string | null {
  if (!name.trim()) return "Enter a name.";
  if (INVALID.test(name)) return "A name can't contain any of these characters: < > : \" / \\ | ? *";
  if (RESERVED.test(name)) return "Windows reserves this name.";
  if (/[. ]$/.test(name)) return "A name can't end with a dot or a space.";
  return null;
}
