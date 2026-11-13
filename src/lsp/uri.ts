/* File paths and the file:// URIs language servers use, for Windows and POSIX paths. */

export function pathToUri(path: string): string {
  const p = path.replace(/\\/g, "/");
  const withSlash = /^[A-Za-z]:/.test(p) ? "/" + p : p;
  return "file://" + withSlash.split("/").map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg.toUpperCase() : encodeURIComponent(seg))).join("/");
}

export function uriToPath(uri: string): string {
  let p = decodeURIComponent(uri.replace(/^file:\/\//, ""));
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1).replace(/\//g, "\\");
  // Drive letters come back as the server wrote them; keep them upper case like Windows does.
  return p.replace(/^([a-z]):/, (_m, d: string) => d.toUpperCase() + ":");
}

export function sameUri(a: string, b: string): boolean {
  return uriToPath(a).toLowerCase() === uriToPath(b).toLowerCase();
}
