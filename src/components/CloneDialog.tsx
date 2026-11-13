import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { open as pickPath } from "@tauri-apps/plugin-dialog";
import { closeDialog, useStore } from "../lib/store";
import { api, errorText } from "../lib/api";
import { openFolder } from "../lib/actions";
import { invalidName, join } from "../lib/paths";
import { cancelJob, clone, useGit } from "../lib/git";
import { cloneFolderName } from "../lib/gitParse";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { TextField } from "./ui/Field";
import { SectionMessage } from "./ui/Feedback";
import { t } from "../lib/i18n";

/** Clone a repository into a new folder, with git's progress, then open it. */
export function CloneDialog() {
  const recent = useStore((s) => s.settings.recent);
  const gitInfo = useGit((s) => s.info);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false);
  const [parent, setParent] = useState(() => (recent[0] ? recent[0].replace(/[\\/][^\\/]+$/, "") : ""));
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const job = useRef<number | null>(null);
  const cancelled = useRef(false);

  const folder = named ? name : url ? cloneFolderName(url) : "";

  const choose = async () => {
    const picked = await pickPath({ directory: true, title: t("Where should the repository go?"), defaultPath: parent || undefined }).catch(() => null);
    if (typeof picked === "string") setParent(picked);
  };

  const start = async () => {
    setError(null);
    const u = url.trim();
    if (!u) return setError(t("Enter the repository's URL."));
    const bad = invalidName(folder);
    if (bad) return setError(t(bad));
    if (!parent) return setError(t("Choose where the repository should go."));
    const dir = join(parent, folder);
    if (await api.exists(dir).catch(() => false)) return setError(t("{0} already exists. Choose another folder name.", dir));
    setBusy(true);
    cancelled.current = false;
    setProgress(t("Connecting…"));
    try {
      const r = await clone(
        u,
        dir,
        (line) => setProgress(line),
        (id) => (job.current = id),
      );
      job.current = null;
      if (cancelled.current) return;
      if (!r.ok) {
        setBusy(false);
        setProgress(null);
        setError(r.message || t("The repository wasn't cloned."));
        return;
      }
      closeDialog();
      await openFolder(dir);
    } catch (e) {
      setBusy(false);
      setProgress(null);
      setError(errorText(e));
    }
  };

  return (
    <Modal
      title={t("Clone a repository")}
      onClose={() => {
        if (busy && job.current !== null) cancelJob(job.current);
        cancelled.current = true;
        closeDialog();
      }}
      closeOnBlanket={false}
      footer={
        <>
          <Button
            appearance="subtle"
            onClick={() => {
              cancelled.current = true;
              if (job.current !== null) cancelJob(job.current);
              closeDialog();
            }}
          >
            {t("Cancel")}
          </Button>
          <Button appearance="primary" loading={busy} disabled={gitInfo === false} onClick={() => void start()}>
            {t("Clone")}
          </Button>
        </>
      }
    >
      {gitInfo === false && (
        <SectionMessage appearance="warning" title={t("Git isn't installed")}>
          {t("Install Git for Windows from git-scm.com, then restart Logiq Studio.")}
        </SectionMessage>
      )}
      <TextField
        label={t("Repository URL")}
        placeholder="https://github.com/…/….git"
        value={url}
        spellCheck={false}
        autoFocus
        disabled={busy}
        onChange={(e) => (setUrl(e.target.value), setError(null))}
        onKeyDown={(e) => e.key === "Enter" && void start()}
      />
      <TextField label={t("Folder name")} value={folder} spellCheck={false} disabled={busy} onChange={(e) => (setName(e.target.value), setNamed(true), setError(null))} />
      <div className="field">
        <span className="field-label">{t("Location")}</span>
        <div className="path-pick">
          <span className="path-pick-value" data-tooltip={parent} data-tooltip-overflow>
            {parent ? join(parent, folder || "…") : t("No folder chosen")}
          </span>
          <Button iconBefore={FolderOpen} disabled={busy} onClick={() => void choose()}>
            {t("Choose…")}
          </Button>
        </div>
      </div>
      {progress && <p className="clone-progress">{progress}</p>}
      {error && <SectionMessage appearance="danger">{error}</SectionMessage>}
    </Modal>
  );
}
