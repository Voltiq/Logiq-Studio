/*
 * PHP: a script runs with the PHP command line and its output in the
 * panel; a page (HTML in it, or reading $_GET and friends) opens in the
 * preview, served by PHP's own web server from the project folder, and
 * reloads when saved. Every save is checked with `php -l`. Intelephense or
 * phpactor give completion when they are installed.
 */
import { invoke } from "@tauri-apps/api/core";
import { get, set, toast } from "../lib/store";
import { errorText } from "../lib/api";
import { basename, dirname, isInside } from "../lib/paths";
import type { Diagnostic } from "../lib/types";
import { t } from "../lib/i18n";
import { beginRun, missingTool, programArgs, startProgram } from "./run";
import { currentTool, findTools, toolFor, toolLabel, toolMenu } from "./toolchain";
import type { LanguagePlugin } from "./plugin";

const how = () => t("Install PHP from windows.php.net (unpack it to C:\\php) or with `winget install PHP.PHP.8.4`, then choose it in the status bar.");

/** Whether a PHP file is a web page rather than a script. */
export function isPage(text: string): boolean {
  return /<(!doctype|html|head|body|div|p|h[1-6]|form|table|ul|section|main)\b/i.test(text) || /\$_(GET|POST|REQUEST|SERVER|SESSION|COOKIE|FILES)\b/.test(text) || /\?>\s*<\w/.test(text);
}

/** Reads `php -l`: "PHP Parse error:  syntax error, unexpected … in C:\x\a.php on line 5". */
export function parsePhpLint(output: string, path: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const m of output.matchAll(/(?:PHP )?(Parse|Fatal|Compile) error:\s+(.+?) in (.+?) on line (\d+)/g)) {
    out.push({ path: m[3].trim() || path, line: Number(m[4]), column: 0, severity: "error", message: m[2].trim() });
  }
  for (const m of output.matchAll(/(?:PHP )?(Deprecated|Warning):\s+(.+?) in (.+?) on line (\d+)/g)) {
    out.push({ path: m[3].trim() || path, line: Number(m[4]), column: 0, severity: "warning", message: m[2].trim() });
  }
  return out;
}

/** Serves the folder with PHP's web server and shows the page in the preview. */
export async function previewPhp(path: string) {
  const php = await toolFor("php");
  if (!php) return missingTool(t("PHP wasn't found"), how());
  const root = get().root && isInside(path, get().root!) ? get().root! : dirname(path);
  try {
    const port = await invoke<number>("php_serve", { root, php: php.path });
    set((s) => ({ phpServer: { port, root }, previewOpen: true, previewPath: path, previewNonce: s.previewNonce + 1 }));
  } catch (e) {
    toast("error", t("PHP's web server didn't start"), errorText(e));
  }
}

export const phpPlugin: LanguagePlugin = {
  languages: ["php"],
  previews: (_path, text) => isPage(text),
  async run(path) {
    if (!(await beginRun(basename(path)))) return;
    const php = await toolFor("php");
    if (!php) return missingTool(t("PHP wasn't found"), how());
    await startProgram(php.path, ["-d", "display_errors=stderr", "-f", path, "--", ...programArgs()], { cwd: dirname(path), label: basename(path), echo: `php ${basename(path)}` });
  },
  async build(path) {
    const php = await toolFor("php");
    if (!php) {
      missingTool(t("PHP wasn't found"), how());
      return false;
    }
    const r = await invoke<{ code: number; stdout: string; stderr: string }>("tool_exec", { program: php.path, args: ["-l", path], cwd: dirname(path), input: null, env: null, timeoutMs: 20000 });
    const problems = parsePhpLint(r.stdout + "\n" + r.stderr, path);
    const { setFileProblems } = await import("../lib/actions");
    setFileProblems([path], problems);
    if (!problems.some((p) => p.severity === "error")) toast("success", t("No syntax errors"), basename(path));
    return r.code === 0;
  },
  afterSave(path) {
    void toolFor("php").then(async (php) => {
      if (!php) return;
      const r = await invoke<{ code: number; stdout: string; stderr: string }>("tool_exec", { program: php.path, args: ["-l", path], cwd: dirname(path), input: null, env: null, timeoutMs: 20000 }).catch(() => null);
      if (!r) return;
      const { setFileProblems } = await import("../lib/actions");
      setFileProblems([path], parsePhpLint(r.stdout + "\n" + r.stderr, path));
    });
  },
  status() {
    const php = currentTool("php");
    if (php === undefined) {
      void findTools("php");
      return { label: "PHP", onClick: (a) => void toolMenu("php", a) };
    }
    if (!php) return { label: t("No PHP"), warn: true, tooltip: how(), onClick: (a) => void toolMenu("php", a) };
    return { label: toolLabel("php", php), tooltip: php.path, onClick: (a) => void toolMenu("php", a) };
  },
  server: {
    id: "php",
    name: () => (currentTool("php-lsp") ? basename(currentTool("php-lsp")!.path).replace(/\.(exe|cmd|bat)$/i, "") : "PHP"),
    async find() {
      const s = await toolFor("php-lsp");
      if (!s) return null;
      const name = basename(s.path).replace(/\.(exe|cmd|bat)$/i, "");
      return { program: s.path, args: name === "phpactor" ? ["language-server"] : ["--stdio"], name };
    },
    initializationOptions: () => ({ storagePath: undefined, clearCache: false }),
  },
};
