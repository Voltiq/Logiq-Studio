/*
 * The language plug-ins. Java, HTML, CSS and JavaScript are built into the
 * app (lib/actions.ts runs them); the plug-ins here add Python, C, C++, PHP,
 * Kotlin and SQL. A new language is a grammar in editor/languages.ts, a
 * plug-in here and, for the outline and the diagram, a parser in
 * uml/javaIndex.ts.
 */
import { languageFor, type LanguageId } from "../editor/languages";
import { pythonPlugin } from "./python";
import { cPlugin, cppPlugin } from "./cfamily";
import { phpPlugin } from "./php";
import { kotlinPlugin } from "./kotlin";
import { sqlPlugin } from "./sql";
import type { LanguagePlugin } from "./plugin";

export const PLUGINS: LanguagePlugin[] = [pythonPlugin, cPlugin, cppPlugin, phpPlugin, kotlinPlugin, sqlPlugin];

const BY_LANGUAGE = new Map<LanguageId, LanguagePlugin>();
for (const p of PLUGINS) for (const l of p.languages) BY_LANGUAGE.set(l, p);

export function pluginById(id: LanguageId): LanguagePlugin | undefined {
  return BY_LANGUAGE.get(id);
}

export function pluginFor(path: string): LanguagePlugin | undefined {
  return BY_LANGUAGE.get(languageFor(path).id);
}

/** The environment new terminals start with: every plug-in's (a Python virtual environment). */
export async function terminalEnvironment(): Promise<{ env: Record<string, string>; pathPrepend: string[] }> {
  const env: Record<string, string> = {};
  const pathPrepend: string[] = [];
  for (const p of PLUGINS) {
    const e = await p.terminalEnv?.().catch(() => null);
    if (!e) continue;
    Object.assign(env, e.env);
    pathPrepend.push(...e.pathPrepend);
  }
  return { env, pathPrepend };
}

export type { LanguagePlugin } from "./plugin";
