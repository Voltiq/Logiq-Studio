/*
 * The log file: errors from the window and failed actions are written to it
 * (never the text of your files), and a crash report from the last run is
 * offered at the next start. Everything stays on this computer.
 */
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { errorText } from "./api";
import { toast, useStore } from "./store";
import { t } from "./i18n";

export interface LogInfo {
  folder: string;
  file: string;
  newCrashes: string[];
}

export function log(level: "info" | "warn" | "error", message: string) {
  void invoke("log_write", { level, message }).catch(() => {});
}

export function logInfo(): Promise<LogInfo | null> {
  return invoke<LogInfo | null>("log_info").catch(() => null);
}

/** Shows the log file in its folder. */
export async function showLog() {
  const info = await logInfo();
  if (!info) return toast("info", t("The log isn't available"), t("It is written by the installed app."));
  revealItemInDir(info.file).catch(() => toast("error", t("The log folder couldn't be opened"), info.folder));
}

let started = false;

/** Once at start: catches errors in the window, logs error messages shown, and tells about a crash last time. */
export function initLog() {
  if (started) return;
  started = true;
  window.addEventListener("error", (e) => log("error", `window: ${e.message} (${(e.filename ?? "").replace(/^.*\//, "")}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => log("error", `unhandled: ${errorText(e.reason)}`));
  // What the user was told went wrong is what a bug report needs.
  let seen = 0;
  useStore.subscribe((s) => {
    for (const x of s.toasts) {
      if (x.id <= seen) continue;
      seen = x.id;
      if (x.appearance === "error") log("error", `shown: ${x.title}${x.description ? " — " + x.description : ""}`);
    }
  });
  void logInfo().then((l) => {
    if (!l?.newCrashes.length) return;
    toast("warning", t("Logiq Studio closed unexpectedly last time"), t("A crash report was saved; it opens in its folder now. Sending it along with a bug report helps to fix the cause."));
    revealItemInDir(l.newCrashes[l.newCrashes.length - 1]).catch(() => {});
    void invoke("crashes_seen").catch(() => {});
  });
}
