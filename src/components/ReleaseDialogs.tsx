import { useState } from "react";
import { CloudDownload, Download, FolderOpen, RefreshCw, TriangleAlert, Upload } from "lucide-react";
import { open as pickPath, save as pickSavePath } from "@tauri-apps/plugin-dialog";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Checkbox, Toggle } from "./ui/Field";
import { ProgressBar } from "./ui/Feedback";
import { api, errorText } from "../lib/api";
import { closeDialog, get, openDialog, setSettings, toast, useStore, type Dialog } from "../lib/store";
import { findUpdate, installUpdate, skipVersion } from "../lib/updates";
import { showLog } from "../lib/log";
import { settingsFromFile, settingsToFile } from "../lib/settingsFile";
import { APP_VERSION } from "../lib/version";
import { applyEditorSettings } from "../lib/actions";
import { applyTheme } from "../lib/theme";
import { t } from "../lib/i18n";

/* A newer version: what's new, and the choice to install it now, later, or not at all. */
export function UpdateDialog({ d }: { d: Extract<Dialog, { kind: "update" }> }) {
  const update = d.update;
  const unsaved = useStore((s) => s.tabs.filter((x) => x.dirty).length);
  const [quiet, setQuiet] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leave = (skip: boolean) => {
    if (skip) skipVersion(update.version);
    if (quiet) setSettings({ checkUpdates: false });
    closeDialog();
  };
  const install = async () => {
    if (quiet) setSettings({ checkUpdates: false });
    setInstalling(true);
    setError(null);
    try {
      await installUpdate(update, setProgress);
    } catch (e) {
      setInstalling(false);
      setError(errorText(e));
    }
  };
  return (
    <Modal
      title={t("Logiq Studio {0} is available", update.version)}
      titleIcon={<CloudDownload size={18} aria-hidden="true" />}
      width="medium"
      closeOnBlanket={false}
      onClose={() => !installing && leave(false)}
      footer={
        <>
          <Button appearance="subtle" disabled={installing} onClick={() => leave(true)}>
            {t("Skip this version")}
          </Button>
          <Button disabled={installing} onClick={() => leave(false)}>
            {t("Later")}
          </Button>
          <Button appearance="primary" iconBefore={CloudDownload} loading={installing} onClick={() => void install()}>
            {t("Update now")}
          </Button>
        </>
      }
    >
      <p className="dialog-text">{t("You have version {0}. The update downloads, installs on its own, and Logiq Studio starts again.", update.currentVersion)}</p>
      {unsaved > 0 && (
        <p className="update-warning">
          <TriangleAlert size={15} aria-hidden="true" />
          {t("Save your files first: with “Keep unsaved changes when closing” off, changes that are not saved are lost when Logiq Studio restarts.")}
        </p>
      )}
      {update.body?.trim() && <pre className="update-notes">{update.body.trim()}</pre>}
      <Checkbox checked={quiet} onChange={setQuiet} disabled={installing} label={t("Don’t look for updates at start")} />
      {installing && <ProgressBar value={progress ?? 0} indeterminate={progress === null} label={t("Downloading the update")} />}
      {error && (
        <p className="update-warning">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}
    </Modal>
  );
}

/** Looks for a newer version now and says what it found. */
export async function checkForUpdates() {
  toast("info", t("Looking for updates…"));
  try {
    const update = await findUpdate();
    if (update) openDialog({ kind: "update", update });
    else toast("success", t("Logiq Studio is up to date"), t("Version {0} is the newest.", APP_VERSION));
  } catch (e) {
    toast("error", t("Updates couldn't be checked"), errorText(e));
  }
}

/* Settings → Updates. */
export function UpdatesSetting() {
  const on = useStore((s) => s.settings.checkUpdates);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Toggle label={t("Look for updates at start")} description={t("Asks GitHub for the newest version; nothing about you or your files is sent. Updates are signed and install only when the signature fits.")} checked={on} onChange={(v) => setSettings({ checkUpdates: v })} />
      <div className="settings-row is-end">
        <p className="dialog-text">{t("This is version {0}.", APP_VERSION)}</p>
        <Button
          iconBefore={RefreshCw}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await checkForUpdates();
            setBusy(false);
          }}
        >
          {t("Look for updates now")}
        </Button>
      </div>
    </>
  );
}

async function exportSettings() {
  const target = await pickSavePath({ defaultPath: "logiq-studio-settings.json", filters: [{ name: "JSON", extensions: ["json"] }] }).catch(() => null);
  if (!target) return;
  try {
    await api.writeText(target, settingsToFile(get().settings, APP_VERSION));
    toast("success", t("Settings exported"), target);
  } catch (e) {
    toast("error", t("The settings weren't exported"), errorText(e));
  }
}

async function importSettings() {
  const picked = await pickPath({ multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] }).catch(() => null);
  if (typeof picked !== "string") return;
  try {
    const r = settingsFromFile((await api.readText(picked)).text);
    const languageChanged = r.settings.language !== undefined && r.settings.language !== get().settings.language;
    setSettings(r.settings);
    applyEditorSettings();
    if (r.settings.theme) void applyTheme(r.settings.theme);
    toast(
      "success",
      t("Settings imported: {0}", r.taken),
      [r.ignored.length ? t("Not taken (unknown or not valid here): {0}.", r.ignored.join(", ")) : "", languageChanged ? t("The language applies the next time Logiq Studio starts.") : ""].filter(Boolean).join(" ") || undefined,
    );
  } catch (e) {
    toast("error", t("The settings weren't imported"), t(errorText(e)));
  }
}

/* Settings → Settings file and log. */
export function MaintenanceSetting() {
  return (
    <>
      <div className="settings-buttons">
        <Button iconBefore={Upload} onClick={() => void exportSettings()}>
          {t("Export settings…")}
        </Button>
        <Button iconBefore={Download} onClick={() => void importSettings()}>
          {t("Import settings…")}
        </Button>
        <Button iconBefore={FolderOpen} onClick={() => void showLog()}>
          {t("Show the log file")}
        </Button>
      </div>
      <p className="dialog-text">{t("The settings file leaves out what belongs to this computer (recent folders, the JDK's place, panel sizes). The log records what went wrong, never the text of your files, and stays on this computer.")}</p>
    </>
  );
}
