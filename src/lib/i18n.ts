/*
 * Translation. English is the language the interface is written in; the
 * English text is also the key. `t("Open folder")` gives the text in the
 * language in use, or the English when a translation is missing.
 * Placeholders are numbered: t("Line {0}, column {1}", 3, 7).
 *
 * The language is fixed when the app starts (from Settings, or from
 * Windows), because some labels are built once when modules load. Changing
 * it in Settings applies at the next start.
 */
import { de } from "./de";

export type Language = "en" | "de";

function detect(): Language {
  let preference = "system";
  try {
    preference = (JSON.parse(localStorage.getItem("logiq.settings") ?? "{}") as { language?: string }).language ?? "system";
  } catch {
    // No settings yet: follow the system.
  }
  if (preference === "en" || preference === "de") return preference;
  const system = (typeof navigator === "undefined" ? "en" : navigator.language).slice(0, 2).toLowerCase();
  return system === "de" ? "de" : "en";
}

export const language: Language = detect();
const table: Record<string, string> | null = language === "de" ? de : null;

export function t(text: string, ...args: (string | number)[]): string {
  const s = table?.[text] ?? text;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m)) : s;
}
