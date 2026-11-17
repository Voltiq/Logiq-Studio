import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { open as pickPath } from "@tauri-apps/plugin-dialog";
import { closeDialog, useStore, type Dialog } from "../lib/store";
import { createProject, newJavaFile } from "../lib/actions";
import { errorText } from "../lib/api";
import { invalidName, join, relative } from "../lib/paths";
import { TEMPLATES, type TemplateId } from "../lib/templates";
import { SettingsDialog } from "./SettingsDialog";
import { UpdateDialog } from "./ReleaseDialogs";
import { ManualDialog } from "./Manual";
import { APP_VERSION } from "../lib/version";
import { COMMANDS } from "../lib/commands";
import { UmlDialogs } from "../uml/ClassDialogs";
import { ToolDialogs } from "./ToolDialogs";
import { CloneDialog } from "./CloneDialog";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { RadioList, Select, TextField } from "./ui/Field";
import { SectionMessage, Shortcut } from "./ui/Feedback";
import { t } from "../lib/i18n";

function PromptDialog({ d }: { d: Extract<Dialog, { kind: "prompt" }> }) {
  const [value, setValue] = useState(d.value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const dot = d.value.lastIndexOf(".");
    if (d.selectStem && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [d]);

  const submit = async () => {
    const v = d.multiline ? value.replace(/\s+$/, "") : value.trim();
    const problem = d.validate?.(v) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await d.onSubmit(v);
      closeDialog();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={d.title}
      width="small"
      onClose={closeDialog}
      closeOnBlanket={false}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" loading={busy} onClick={() => void submit()}>
            {d.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {d.multiline ? (
          <label className="field">
            <span className="field-label">{d.label}</span>
            <textarea
              className="textarea"
              autoFocus
              rows={5}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) void submit();
              }}
            />
          </label>
        ) : (
          <TextField
            ref={input}
            label={d.label}
            value={value}
            spellCheck={false}
            error={error ?? undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
        )}
      </form>
    </Modal>
  );
}

function ConfirmDialog({ d }: { d: Extract<Dialog, { kind: "confirm" }> }) {
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const finish = async (f?: () => Promise<void> | void) => {
    done.current = true;
    setBusy(true);
    closeDialog();
    await f?.();
  };
  useEffect(
    () => () => {
      if (!done.current) d.onCancel?.();
    },
    [d],
  );
  return (
    <Modal
      title={d.title}
      width="small"
      onClose={closeDialog}
      footer={
        <>
          {d.secondaryLabel && (
            <div className="modal-footer-start">
              <Button appearance="subtle" onClick={() => void finish(d.onSecondary)}>
                {d.secondaryLabel}
              </Button>
            </div>
          )}
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance={d.danger ? "danger" : "primary"} loading={busy} data-autofocus onClick={() => void finish(d.onConfirm)}>
            {d.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="dialog-text">{d.body}</p>
    </Modal>
  );
}

function NewProjectDialog({ d }: { d: Extract<Dialog, { kind: "newProject" }> }) {
  const recent = useStore((s) => s.settings.recent);
  const [template, setTemplate] = useState<TemplateId>(d.template ?? "java-classes");
  const [name, setName] = useState(TEMPLATES.find((x) => x.id === (d.template ?? "java-classes"))!.id === "web" ? "my-page" : "MyProject");
  const [parent, setParent] = useState(() => {
    const last = recent[0];
    return last ? last.replace(/[\\/][^\\/]+$/, "") : "";
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    const picked = await pickPath({ directory: true, title: t("Where should the project go?"), defaultPath: parent || undefined }).catch(() => null);
    if (typeof picked === "string") setParent(picked);
  };

  const create = async () => {
    const bad = invalidName(name.trim());
    if (bad) return setError(bad);
    if (!parent) return setError(t("Choose where the project folder should go."));
    setBusy(true);
    try {
      closeDialog();
      await createProject(parent, name.trim(), template);
    } catch (e) {
      setBusy(false);
      setError(errorText(e));
    }
  };

  return (
    <Modal
      title={t("New project")}
      onClose={closeDialog}
      closeOnBlanket={false}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" loading={busy} onClick={() => void create()}>
            {t("Create project")}
          </Button>
        </>
      }
    >
      <RadioList
        label={t("Template")}
        value={template}
        onChange={(v) => setTemplate(v)}
        options={TEMPLATES.map((x) => ({ value: x.id, label: t(x.title), description: t(x.description) }))}
      />
      <TextField label={t("Project name")} value={name} spellCheck={false} onChange={(e) => (setName(e.target.value), setError(null))} />
      <div className="field">
        <span className="field-label">{t("Location")}</span>
        <div className="path-pick">
          <span className="path-pick-value" data-tooltip={parent} data-tooltip-overflow>
            {parent ? join(parent, name || "…") : t("No folder chosen")}
          </span>
          <Button iconBefore={FolderOpen} onClick={() => void choose()}>
            {t("Choose…")}
          </Button>
        </div>
      </div>
      {error && <SectionMessage appearance="danger">{error}</SectionMessage>}
    </Modal>
  );
}

function NewJavaFileDialog({ d }: { d: Extract<Dialog, { kind: "newJavaFile" }> }) {
  const root = useStore((s) => s.root);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"class" | "abstract" | "interface" | "enum" | "record" | "main">("class");
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    const n = name.trim().replace(/\.java$/i, "");
    if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(n)) return setError(t("A class name starts with a letter and has only letters, digits and _."));
    try {
      closeDialog();
      await newJavaFile(d.dir, n, kind);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal
      title={t("New Java class")}
      width="small"
      onClose={closeDialog}
      closeOnBlanket={false}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" onClick={() => void create()}>
            {t("Create")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <TextField label={t("Name")} value={name} placeholder={t("Account")} autoFocus spellCheck={false} error={error ?? undefined} onChange={(e) => (setName(e.target.value), setError(null))} />
      </form>
      <Select
        label={t("Kind")}
        value={kind}
        onChange={setKind}
        options={[
          { value: "class", label: t("Class") },
          { value: "main", label: t("Class with a main method") },
          { value: "abstract", label: t("Abstract class") },
          { value: "interface", label: t("Interface") },
          { value: "enum", label: t("Enum") },
          { value: "record", label: t("Record") },
        ]}
      />
      <p className="dialog-text">In {root ? relative(root, d.dir) || "the project folder" : d.dir}</p>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title={t("About Logiq Studio")} width="small" onClose={closeDialog}>
      <div className="about">
        <img src="/app-icon.svg" alt="" width={64} height={64} />
        <div>
          <p className="about-name">Logiq Studio {APP_VERSION}</p>
          <p className="dialog-text">{t("An IDE for Java, Python, C, C++, Kotlin, PHP, SQL and the web that draws UML class diagrams from your code. Built with Tauri, Rust and React in the Graphiq design language.")}</p>
        </div>
      </div>
    </Modal>
  );
}

function ShortcutsDialog() {
  const list = COMMANDS.filter((c) => c.shortcut);
  const extra = [
    ["Duplicate line", "Shift+Alt+Down"],
    ["Move line up / down", "Alt+Up"],
    ["Select next match", "Ctrl+D"],
    ["Add cursor", "Ctrl+Alt+Down"],
    ["Fold / unfold", "Ctrl+Shift+["],
    ["Show completions", "Ctrl+Space"],
  ];
  return (
    <Modal title={t("Keyboard shortcuts")} width="medium" onClose={closeDialog}>
      <div className="shortcut-list">
        {list.map((c) => (
          <div key={c.id} className="shortcut-row">
            <span>{t(c.label).replace(/…$/, "")}</span>
            <Shortcut keys={c.shortcut!} />
          </div>
        ))}
        {extra.map(([label, keys]) => (
          <div key={label} className="shortcut-row">
            <span>{t(label)}</span>
            <Shortcut keys={keys} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case "prompt":
      return <PromptDialog key={d.title + d.value} d={d} />;
    case "confirm":
      return <ConfirmDialog d={d} />;
    case "newProject":
      return <NewProjectDialog d={d} />;
    case "newJavaFile":
      return <NewJavaFileDialog d={d} />;
    case "settings":
      return <SettingsDialog />;
    case "about":
      return <AboutDialog />;
    case "shortcuts":
      return <ShortcutsDialog />;
    case "runConfig":
    case "libraries":
    case "languages":
      return <ToolDialogs d={d} />;
    case "clone":
      return <CloneDialog />;
    case "update":
      return <UpdateDialog d={d} />;
    case "manual":
      return <ManualDialog />;
    default:
      return <UmlDialogs d={d} />;
  }
}


