/*
 * Settings as a file: export them to carry to another computer (or keep a
 * copy), import them back. Only settings this version knows, with values of
 * the right kind, are taken; everything else in the file is ignored.
 */
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { DEFAULT_UML_OPTIONS } from "../uml/diagram";

const MARK = "Logiq Studio settings";

/** Things that belong to this computer, not to the person: left out of the file and kept on import. */
const LOCAL: (keyof Settings)[] = ["recent", "jdkHome", "nodePath", "sidebarWidth", "panelHeight", "previewWidth", "sideWidth"];

export function settingsToFile(s: Settings, version: string): string {
  const settings: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) if (!LOCAL.includes(k)) settings[k] = s[k];
  return JSON.stringify({ file: MARK, version, settings }, null, 2) + "\n";
}

const LIMITS: Partial<Record<keyof Settings, [number, number]>> = { fontSize: [9, 28], tabSize: [1, 8], sqlMaxRows: [100, 1_000_000] };
const CHOICES: Partial<Record<keyof Settings, string[]>> = { theme: ["system", "light", "dark"], language: ["system", "en", "de", "es", "fr"] };

function sameKind(a: unknown, b: unknown): boolean {
  return typeof a === typeof b && Array.isArray(a) === Array.isArray(b) && a !== null;
}

/** Reads a settings file: the settings it holds that are valid here. Throws when it isn't a settings file. */
export function settingsFromFile(text: string): { settings: Partial<Settings>; taken: number; ignored: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This isn't a settings file (it isn't JSON).");
  }
  const file = data as { file?: unknown; settings?: unknown };
  if (!file || typeof file !== "object" || file.file !== MARK || !file.settings || typeof file.settings !== "object") throw new Error("This isn't a Logiq Studio settings file.");
  const out: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const [k, v] of Object.entries(file.settings as Record<string, unknown>)) {
    const key = k as keyof Settings;
    if (!(key in DEFAULT_SETTINGS) || LOCAL.includes(key) || !sameKind(v, DEFAULT_SETTINGS[key])) {
      ignored.push(k);
      continue;
    }
    if (key === "uml") {
      // Only the diagram options this version has, each of the right kind.
      const uml: Record<string, unknown> = {};
      for (const [uk, uv] of Object.entries(v as Record<string, unknown>)) {
        if (uk in DEFAULT_UML_OPTIONS && sameKind(uv, (DEFAULT_UML_OPTIONS as unknown as Record<string, unknown>)[uk])) uml[uk] = uv;
      }
      out.uml = { ...DEFAULT_UML_OPTIONS, ...uml };
      continue;
    }
    const limit = LIMITS[key];
    if (limit && (typeof v !== "number" || !Number.isFinite(v) || v < limit[0] || v > limit[1])) {
      ignored.push(k);
      continue;
    }
    const choice = CHOICES[key];
    if (choice && !choice.includes(v as string)) {
      ignored.push(k);
      continue;
    }
    out[key] = v;
  }
  return { settings: out as Partial<Settings>, taken: Object.keys(out).length, ignored };
}
