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
import { es } from "./es";
import { fr } from "./fr";

export type Language = "en" | "de" | "es" | "fr";
const LANGUAGES: Language[] = ["en", "de", "es", "fr"];

function detect(): Language {
  // Tests read the interface in English, whatever the computer's language.
  if (import.meta.env?.MODE === "test") return "en";
  let preference = "system";
  try {
    preference = (JSON.parse(localStorage.getItem("logiq.settings") ?? "{}") as { language?: string }).language ?? "system";
  } catch {
    // No settings yet: follow the system.
  }
  if (LANGUAGES.includes(preference as Language)) return preference as Language;
  const system = (typeof navigator === "undefined" ? "en" : navigator.language).slice(0, 2).toLowerCase();
  return LANGUAGES.includes(system as Language) ? (system as Language) : "en";
}

export const language: Language = detect();
const tables: Record<Language, Record<string, string> | null> = { en: null, de, es, fr };
const table = tables[language];

// Screen readers pronounce the interface in its language.
if (typeof document !== "undefined") document.documentElement.lang = language;

export function t(text: string, ...args: (string | number)[]): string {
  const s = table?.[text] ?? text;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m)) : s;
}
