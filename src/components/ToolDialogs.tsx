import { useEffect, useState } from "react";
import { Copy, ExternalLink, FileArchive, Plus, RefreshCw, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { closeDialog, set, toast, useStore, type Dialog } from "../lib/store";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { basename } from "../lib/paths";
import { saveRunConfig, useRunConfig } from "../lib/runConfig";
import { addLibraries, listLibraries, removeLibrary } from "../lib/tools";
import { javaIndex } from "../uml/javaIndex";
import { Modal } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import { Select, TextField } from "./ui/Field";
import { EmptyState, SectionMessage } from "./ui/Feedback";

const AUTO = "*auto*";

function RunConfigDialog() {
  const config = useRunConfig((s) => s.config);
  const mains = javaIndex.types().filter((x) => x.hasMain);
  const [main, setMain] = useState(config.mainClass ?? AUTO);
  const [args, setArgs] = useState(config.args);
  const [vm, setVm] = useState(config.vmOptions);
  const save = () => {
    saveRunConfig({ mainClass: main === AUTO ? null : main, args, vmOptions: vm });
    closeDialog();
  };
  return (
    <Modal
      title={t("Run configuration")}
      width="medium"
      onClose={closeDialog}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" onClick={save}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <Select
        label={t("Main class")}
        value={main}
        onChange={setMain}
        options={[{ value: AUTO, label: t("The active file's, or the only one") }, ...mains.map((m) => ({ value: m.qualifiedName, label: m.qualifiedName }))]}
        helper={mains.length ? undefined : t("No class has a main method yet.")}
      />
      <TextField label={t("Program arguments")} value={args} mono spellCheck={false} placeholder={'input.txt 42 "two words"'} helper={t("What main gets in args. Quotes keep words together.")} onChange={(e) => setArgs(e.target.value)} />
      <TextField label={t("JVM options")} value={vm} mono spellCheck={false} placeholder="-Xmx512m -ea" helper={t("For example -ea to turn on assert statements.")} onChange={(e) => setVm(e.target.value)} />
    </Modal>
  );
}

function LibrariesDialog() {
  const [libs, setLibs] = useState<string[] | null>(null);
  const refresh = () => listLibraries().then(setLibs);
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Modal
      title={t("Libraries")}
      width="medium"
      onClose={closeDialog}
      footer={
        <>
          <Button appearance="primary" iconBefore={Plus} onClick={() => void addLibraries().then(refresh)}>
            {t("Add JAR files…")}
          </Button>
        </>
      }
    >
      <p className="dialog-text">{t("JAR files in the project's lib folder are on the class path when compiling, running, debugging and testing, and are copied beside an exported JAR.")}</p>
      {libs && libs.length === 0 ? (
        <EmptyState icon={FileArchive} title={t("No libraries yet")} compact />
      ) : (
        <ul className="lib-list">
          {(libs ?? []).map((l) => (
            <li key={l} className="lib-row">
              <FileArchive size={15} aria-hidden="true" />
              <span className="lib-name">{basename(l)}</span>
              <IconButton icon={Trash2} label={t("Remove {0}", basename(l))} spacing="compact" onClick={() => void removeLibrary(l).then(refresh)} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

const WINGET = "winget install EclipseAdoptium.Temurin.25.JDK";

function InstallJdkDialog() {
  const jdks = useStore((s) => s.jdks);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    const found = await api.detectJdks().catch(() => []);
    set({ jdks: found });
    setBusy(false);
    if (found.length) {
      toast("success", t("Java {0} found", found[0].version), found[0].home);
      closeDialog();
    } else toast("warning", t("Still no JDK found"), t("If you just installed one, its folder can also be chosen in Settings."));
  };
  return (
    <Modal
      title={t("Install a JDK")}
      width="medium"
      onClose={closeDialog}
      footer={
        <Button appearance="primary" iconBefore={RefreshCw} loading={busy} onClick={() => void search()}>
          {t("Search again")}
        </Button>
      }
    >
      {jdks.length > 0 && <SectionMessage appearance="success">{t("Java {0} is installed.", jdks[0].version)}</SectionMessage>}
      <p className="dialog-text">{t("Compiling and running Java needs a JDK (the Java Development Kit). Eclipse Temurin is free and works well:")}</p>
      <ol className="jdk-steps">
        <li>
          {t("Download the installer (choose the latest LTS for Windows, .msi):")}
          <Button spacing="compact" iconBefore={ExternalLink} onClick={() => void openUrl("https://adoptium.net/temurin/releases/").catch(() => {})}>
            adoptium.net
          </Button>
        </li>
        <li>
          {t("Or install it from a terminal with winget:")}
          <span className="jdk-cmd">
            <code>{WINGET}</code>
            <IconButton icon={Copy} label={t("Copy command")} spacing="compact" onClick={() => void navigator.clipboard.writeText(WINGET).then(() => toast("success", t("Command copied")))} />
          </span>
        </li>
        <li>{t("Then search again here. Logiq Studio finds JDKs in JAVA_HOME, on the PATH and in the usual install folders.")}</li>
      </ol>
    </Modal>
  );
}

export function ToolDialogs({ d }: { d: Dialog }) {
  switch (d.kind) {
    case "runConfig":
      return <RunConfigDialog />;
    case "libraries":
      return <LibrariesDialog />;
    case "installJdk":
      return <InstallJdkDialog />;
    default:
      return null;
  }
}
