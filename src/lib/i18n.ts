/*
 * Translation hook. English is the language the interface is written in and
 * the English text is the key, as in the other Studio apps. Translations are
 * on the roadmap; until then `t` fills in numbered placeholders:
 * t("Line {0}, column {1}", 3, 7).
 */
export function t(text: string, ...args: (string | number)[]): string {
  return args.length ? text.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m)) : text;
}
