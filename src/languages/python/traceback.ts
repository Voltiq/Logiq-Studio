/*
 * Python's error report, read into a problem at the line in your own code
 * where it happened: the last frame of a traceback inside the project (or
 * the file a SyntaxError names) with the exception's message.
 */
import type { Diagnostic } from "../../lib/types";

export function parseTraceback(stderr: string, inProject: (path: string) => boolean): Diagnostic | null {
  const lines = stderr.replace(/\r\n/g, "\n").split("\n");
  const frame = /^\s*File "(.+?)", line (\d+)(?:, in (.+))?$/;
  // The last report wins when a program printed several (a chained exception ends with the one that stopped it).
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (/^Traceback \(most recent call last\):/.test(lines[i]) || (frame.test(lines[i]) && !/^\s/.test(lines[i - 1] ?? "x"))) start = i;
  if (start < 0) {
    const first = lines.findIndex((l) => frame.test(l));
    if (first < 0) return null;
    start = first;
  }
  let where: { path: string; line: number } | null = null;
  let message = "";
  let column = 0;
  for (let i = start; i < lines.length; i++) {
    const m = frame.exec(lines[i]);
    if (m) {
      if (inProject(m[1]) || !where) where = { path: m[1], line: Number(m[2]) };
      // A caret line right under the source line marks the column (SyntaxError).
      const src = lines[i + 1];
      const caret = lines[i + 2];
      column = 0;
      if (src && caret && /^\s*\^+\s*$/.test(caret) && !m[3]) {
        const stripped = src.trimStart();
        const offset = src.length - stripped.length;
        column = Math.max(1, caret.indexOf("^") - offset + 1);
      }
      continue;
    }
    const err = /^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit)|[A-Za-z_][\w.]*Error)(?::\s?(.*))?$/.exec(lines[i]);
    if (err) message = err[2] ? `${err[1]}: ${err[2]}` : err[1];
  }
  if (!where || !message) return null;
  return { path: where.path, line: where.line, column, severity: "error", message };
}
