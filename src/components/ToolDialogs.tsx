import { useEffect, useState } from "react";
import { CircleCheck, Copy, Download, ExternalLink, FileArchive, Plus, RefreshCw, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { closeDialog, toast, type Dialog } from "../lib/store";
import { t } from "../lib/i18n";
import { basename } from "../lib/paths";
import { saveRunConfig, useRunConfig } from "../lib/runConfig";
import { addLibraries, listLibraries, removeLibrary } from "../lib/tools";
import { javaIndex } from "../uml/javaIndex";
import { Modal } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import { Select, TextField } from "./ui/Field";
import { EmptyState, Lozenge, Spinner } from "./ui/Feedback";
import { checkAll, install, installCommand, LANGUAGES, useSetup, type SetupId } from "../languages/setup";
import { cx } from "../lib/utils";

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

/** What each language needs, whether it is here, and a way to install it. */
function LanguagesDialog({ focus }: { focus?: SetupId }) {
  const found = useSetup((s) => s.found);
  const installing = useSetup((s) => s.installing);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    await checkAll();
    setBusy(false);
  };
  useEffect(() => void check(), []);
  const list = focus ? [...LANGUAGES.filter((l) => l.id === focus), ...LANGUAGES.filter((l) => l.id !== focus)] : LANGUAGES;
  return (
    <Modal
      title={t("Languages and tools")}
      width="large"
      onClose={closeDialog}
      footer={
        <Button iconBefore={RefreshCw} loading={busy} onClick={() => void check()}>
          {t("Look again")}
        </Button>
      }
    >
      <p className="dialog-text">
        {t("What each language needs on this computer. Install sets it up with winget in a terminal, where you answer its questions; Logiq Studio notices when it is ready.")}
      </p>
      <div className="lang-list">
        {list.map((l) => {
          const f = found[l.id];
          const state = installing.includes(l.id) ? "installing" : f === undefined ? "checking" : f ? "ready" : "missing";
          const command = installCommand(l);
          const needs = l.needs && found[l.needs] === null ? LANGUAGES.find((x) => x.id === l.needs) : undefined;
          return (
            <div key={l.id} className={cx("lang-row", `is-${state}`, focus === l.id && "is-focus")}>
              <div className="lang-main">
                <div className="lang-name">
                  {l.name}
                  <span className="lang-tool">{l.tool}</span>
                </div>
                <p className="lang-why">{l.why()}</p>
                {f && (
                  <p className="lang-found">
                    <span className="lang-found-label">{f.label}</span>
                    <span className="lang-path">{f.path}</span>
                  </p>
                )}
                {state === "missing" && needs && <p className="lang-needs">{t("Needs {0} first.", needs.tool)}</p>}
              </div>
              <div className="lang-actions">
                {state === "checking" && <Spinner size={16} label={t("Looking…")} />}
                {state === "ready" && (
                  <Lozenge appearance="success" icon={CircleCheck}>
                    {t("Ready")}
                  </Lozenge>
                )}
                {state === "installing" && (
                  <span className="lang-installing">
                    <Spinner size={14} /> {t("Installing…")}
                  </span>
                )}
                {state === "missing" && command && (
                  <Button
                    appearance="primary"
                    spacing="compact"
                    iconBefore={Download}
                    onClick={() => {
                      closeDialog();
                      void install(l);
                    }}
                  >
                    {t("Install")}
                  </Button>
                )}
                {state === "missing" && command && (
                  <IconButton
                    icon={Copy}
                    label={t("Copy the install command")}
                    spacing="compact"
                    onClick={() => void navigator.clipboard.writeText(command).then(() => toast("success", t("Command copied"), command))}
                  />
                )}
                {state !== "ready" && (
                  <Button spacing="compact" appearance={command ? "subtle" : "default"} iconBefore={ExternalLink} onClick={() => void openUrl(l.page).catch(() => {})}>
                    {t("Download page")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export function ToolDialogs({ d }: { d: Dialog }) {
  switch (d.kind) {
    case "runConfig":
      return <RunConfigDialog />;
    case "libraries":
      return <LibrariesDialog />;
    case "languages":
      return <LanguagesDialog focus={d.focus} />;
    default:
      return null;
  }
}
