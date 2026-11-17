import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Boxes, Coffee, FolderOpen, Palette, Save, Search, SquareTerminal, TextCursorInput, RefreshCw, X, type LucideIcon } from "lucide-react";
import { open as pickPath } from "@tauri-apps/plugin-dialog";
import { closeDialog, openDialog, setSettings, useStore } from "../lib/store";
import type { Settings } from "../lib/settings";
import type { ThemePreference } from "../lib/types";
import { applyTheme } from "../lib/theme";
import { loadShells, useTerminals } from "../lib/terminals";
import { installJavaServer, startJavaServer, useLsp } from "../lsp/clients";
import { LanguageSettings } from "./LanguageSettings";
import { MaintenanceSetting, UpdatesSetting } from "./ReleaseDialogs";
import { Modal } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import { Checkbox, Segmented, Select, TextField, Toggle } from "./ui/Field";
import { SectionMessage } from "./ui/Feedback";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";

type SectionId = "appearance" | "editor" | "saving" | "terminal" | "languages" | "java" | "updates";

interface Section {
  id: SectionId;
  icon: LucideIcon;
  title: () => string;
  /** The words a search finds the section by: the labels of its settings. */
  terms: () => string[];
  body: () => ReactNode;
}

const REMEMBER = "logiq.settings.section";

/* ----- Pieces ------------------------------------------------------------------------------------ */

const THEMES: { value: ThemePreference; label: () => string }[] = [
  { value: "system", label: () => t("System") },
  { value: "dark", label: () => t("Graphite") },
  { value: "light", label: () => t("Porcelain") },
];

/** The theme as three small pictures of the window. */
function ThemeCards() {
  const theme = useStore((s) => s.settings.theme);
  return (
    <div className="theme-cards" role="radiogroup" aria-label={t("Theme")}>
      {THEMES.map((x) => (
        <button
          key={x.value}
          type="button"
          role="radio"
          aria-checked={theme === x.value}
          className={cx("theme-card", theme === x.value && "is-on")}
          onClick={() => {
            setSettings({ theme: x.value });
            void applyTheme(x.value);
          }}
        >
          <span className={`theme-preview is-${x.value}`} aria-hidden="true">
            <span className="tp-rail" />
            <span className="tp-side" />
            <span className="tp-main">
              <span className="tp-line" />
              <span className="tp-line is-short" />
              <span className="tp-line is-accent" />
            </span>
          </span>
          <span className="theme-card-label">{x.label()}</span>
        </button>
      ))}
    </div>
  );
}

function TerminalShellSetting() {
  const shells = useTerminals((s) => s.shells);
  const value = useStore((st) => st.settings.terminalShell);
  useEffect(() => void loadShells(), []);
  return (
    <Select
      label={t("Shell for new terminals")}
      value={shells.some((x) => x.id === value) ? value : ""}
      onChange={(v) => setSettings({ terminalShell: v })}
      options={[{ value: "", label: shells[0] ? t("First found ({0})", shells[0].name) : t("None found") }, ...shells.map((x) => ({ value: x.id, label: x.name }))]}
    />
  );
}

/** The terminal's cursor, with a line of terminal showing it. */
function CursorSetting() {
  const s = useStore((st) => st.settings);
  return (
    <div className="cursor-setting">
      <div className="field">
        <span className="field-label">{t("Cursor")}</span>
        <Segmented<Settings["terminalCursor"]>
          label={t("Cursor")}
          value={s.terminalCursor}
          onChange={(terminalCursor) => setSettings({ terminalCursor })}
          options={[
            { value: "block", label: t("Block") },
            { value: "bar", label: t("Vertical line") },
            { value: "underline", label: t("Underscore") },
          ]}
        />
      </div>
      <div className="cursor-sample" aria-hidden="true">
        <span>PS C:\Projects&gt;&nbsp;</span>
        <span className={cx("cursor-sample-cursor", `is-${s.terminalCursor}`, s.terminalCursorBlink && "is-blinking")} />
      </div>
    </div>
  );
}

/** Install or switch the Java language server (Eclipse JDT LS). */
function JavaServerSetting() {
  const state = useLsp((s) => s.java);
  const on = useStore((st) => st.settings.javaServer);
  const missing = state === "missing";
  return (
    <div className="lsp-setting">
      <div className="lsp-setting-text">
        <span className="field-label">{t("Java language server")}</span>
        <span className="dialog-text">
          {state === "ready"
            ? t("Running: errors as you type, completion that knows types, quick fixes (Ctrl+.), organize imports.")
            : state === "starting"
              ? t("Starting… The first start indexes the JDK and takes a minute.")
              : state === "installing"
                ? t("Downloading and unpacking (about 50 MB)…")
                : state === "failed"
                  ? t("It stopped. It needs Java 21 or newer to run.")
                  : missing
                    ? t("Eclipse JDT LS gives errors as you type, completion that knows types and quick fixes. It is downloaded once (about 50 MB) from eclipse.org.")
                    : t("Switched off. Java uses Logiq Studio's own completion and the compiler's errors.")}
        </span>
      </div>
      {missing || state === "installing" ? (
        <Button appearance="primary" loading={state === "installing"} onClick={() => void installJavaServer()}>
          {t("Install")}
        </Button>
      ) : (
        <Toggle
          label={t("Use it")}
          checked={on}
          onChange={(v) => {
            setSettings({ javaServer: v });
            void startJavaServer();
          }}
        />
      )}
    </div>
  );
}

function JavaSettings() {
  const s = useStore((st) => st.settings);
  const jdks = useStore((st) => st.jdks);
  const node = useStore((st) => st.node);
  const jdkOptions = useMemo(
    () => [{ value: "", label: jdks[0] ? t("Newest found (Java {0})", jdks[0].version) : t("None found") }, ...jdks.map((j) => ({ value: j.home, label: `Java ${j.version} · ${j.home}` }))],
    [jdks],
  );
  const chooseJdk = async () => {
    const picked = await pickPath({ directory: true, title: t("Choose a JDK folder") }).catch(() => null);
    if (typeof picked === "string") setSettings({ jdkHome: picked });
  };
  return (
    <>
      <div className="settings-row is-end">
        <Select label={t("JDK")} value={jdkOptions.some((o) => o.value === s.jdkHome) ? s.jdkHome : ""} options={jdkOptions} onChange={(v) => setSettings({ jdkHome: v })} />
        <Button iconBefore={FolderOpen} onClick={() => void chooseJdk()}>
          {t("Other…")}
        </Button>
      </div>
      {s.jdkHome && !jdks.some((j) => j.home === s.jdkHome) && <p className="dialog-text">{t("Using {0}", s.jdkHome)}</p>}
      {!jdks.length && (
        <SectionMessage appearance="warning" title={t("No JDK found")}>
          <Button spacing="compact" onClick={() => openDialog({ kind: "languages", focus: "java" })}>
            {t("Set up languages…")}
          </Button>
        </SectionMessage>
      )}
      <JavaServerSetting />
      <p className="dialog-text">{node ? t("JavaScript files run with Node.js {0}.", node.version) : t("JavaScript files run with Node.js, which wasn't found on this computer.")}</p>
    </>
  );
}

/* ----- The sections ------------------------------------------------------------------------------- */

function useSections(): Section[] {
  const s = useStore((st) => st.settings);
  return [
    {
      id: "appearance",
      icon: Palette,
      title: () => t("Appearance"),
      terms: () => [t("Theme"), t("System"), t("Graphite"), t("Porcelain"), t("Language"), t("Editor text size")],
      body: () => (
        <>
          <ThemeCards />
          <div className="settings-row">
            <Select
              label={t("Language")}
              value={s.language}
              onChange={(language) => setSettings({ language })}
              helper={t("Applies the next time Logiq Studio starts.")}
              options={[
                { value: "system", label: t("Same as Windows") },
                { value: "en", label: "English" },
                { value: "de", label: "Deutsch" },
                { value: "es", label: "Español" },
                { value: "fr", label: "Français" },
              ]}
            />
            <TextField label={t("Editor text size")} type="number" min={9} max={28} value={s.fontSize} onChange={(e) => setSettings({ fontSize: Math.max(9, Math.min(28, +e.target.value || 13)) })} />
          </div>
        </>
      ),
    },
    {
      id: "editor",
      icon: TextCursorInput,
      title: () => t("Editor"),
      terms: () => [t("Tab size"), t("Indent with spaces"), t("Wrap long lines"), t("Line numbers"), t("Close brackets and quotes automatically")],
      body: () => (
        <>
          <div className="settings-row is-narrow">
            <TextField label={t("Tab size")} type="number" min={1} max={8} value={s.tabSize} onChange={(e) => setSettings({ tabSize: Math.max(1, Math.min(8, +e.target.value || 4)) })} />
          </div>
          <div className="settings-grid">
            <Checkbox label={t("Indent with spaces")} checked={s.insertSpaces} onChange={(v) => setSettings({ insertSpaces: v })} />
            <Checkbox label={t("Wrap long lines")} checked={s.wordWrap} onChange={(v) => setSettings({ wordWrap: v })} />
            <Checkbox label={t("Line numbers")} checked={s.lineNumbers} onChange={(v) => setSettings({ lineNumbers: v })} />
            <Checkbox label={t("Close brackets and quotes automatically")} checked={s.autoCloseBrackets} onChange={(v) => setSettings({ autoCloseBrackets: v })} />
          </div>
        </>
      ),
    },
    {
      id: "saving",
      icon: Save,
      title: () => t("Saving and running"),
      terms: () => [t("Save automatically"), t("Format when saving"), t("Keep unsaved changes when closing"), t("Save all files before running"), t("Reload the web preview on save"), "Prettier", "clang-format"],
      body: () => (
        <div className="settings-grid is-cards">
          <Toggle label={t("Save automatically")} description={t("A second after you stop typing.")} checked={s.autoSave} onChange={(v) => setSettings({ autoSave: v })} />
          <Toggle label={t("Format when saving")} description={t("Java, HTML, CSS, JavaScript, JSON and Markdown with Prettier; C and C++ with clang-format.")} checked={s.formatOnSave} onChange={(v) => setSettings({ formatOnSave: v })} />
          <Toggle
            label={t("Keep unsaved changes when closing")}
            description={t("Open files and unsaved text come back on the next start, without asking.")}
            checked={s.hotExit}
            onChange={(v) => setSettings({ hotExit: v })}
          />
          <Toggle label={t("Save all files before running")} checked={s.saveBeforeRun} onChange={(v) => setSettings({ saveBeforeRun: v })} />
          <Toggle label={t("Reload the web preview on save")} checked={s.livePreview} onChange={(v) => setSettings({ livePreview: v })} />
        </div>
      ),
    },
    {
      id: "terminal",
      icon: SquareTerminal,
      title: () => t("Terminal"),
      terms: () => [t("Shell for new terminals"), t("Cursor"), t("Block"), t("Vertical line"), t("Underscore"), t("Blinking cursor"), "PowerShell"],
      body: () => (
        <>
          <TerminalShellSetting />
          <CursorSetting />
          <Toggle label={t("Blinking cursor")} checked={s.terminalCursorBlink} onChange={(v) => setSettings({ terminalCursorBlink: v })} />
        </>
      ),
    },
    {
      id: "languages",
      icon: Boxes,
      title: () => t("Languages"),
      terms: () => ["Python", "C", "C++", "PHP", "Kotlin", "SQL", t("Use installed language servers"), t("More C and C++ compiler flags"), t("SQL rows shown at most"), t("Set up languages…")],
      body: () => (
        <>
          <div className="settings-callout">
            <span>{t("Something missing? Install a language and its tools in one step.")}</span>
            <Button spacing="compact" appearance="primary" onClick={() => openDialog({ kind: "languages" })}>
              {t("Set up languages…")}
            </Button>
          </div>
          <LanguageSettings />
        </>
      ),
    },
    {
      id: "java",
      icon: Coffee,
      title: () => "Java",
      terms: () => [t("JDK"), t("Java language server"), "Node.js", "JavaScript"],
      body: () => <JavaSettings />,
    },
    {
      id: "updates",
      icon: RefreshCw,
      title: () => t("Updates and data"),
      terms: () => [t("Updates"), t("Settings file and log")],
      body: () => (
        <>
          <h3 className="settings-heading">{t("Updates")}</h3>
          <UpdatesSetting />
          <h3 className="settings-heading">{t("Settings file and log")}</h3>
          <MaintenanceSetting />
        </>
      ),
    },
  ];
}

/* ----- The dialog ---------------------------------------------------------------------------------- */

export function SettingsDialog() {
  const sections = useSections();
  const [current, setCurrent] = useState<SectionId>(() => {
    try {
      const saved = localStorage.getItem(REMEMBER) as SectionId | null;
      return saved && sections.some((x) => x.id === saved) ? saved : "appearance";
    } catch {
      return "appearance";
    }
  });
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q ? sections.filter((x) => [x.title(), ...x.terms()].some((term) => term.toLowerCase().includes(q))) : [];
  const pick = (id: SectionId) => {
    setCurrent(id);
    setQuery("");
    try {
      localStorage.setItem(REMEMBER, id);
    } catch {
      // Remembered for this time only.
    }
  };
  const shown = q ? matches : sections.filter((x) => x.id === current);

  return (
    <Modal title={t("Settings")} width="large" className="settings-modal" onClose={closeDialog}>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("Settings")}>
          <label className="settings-search">
            <Search size={14} aria-hidden="true" />
            <input value={query} placeholder={t("Search settings")} aria-label={t("Search settings")} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
            {query && <IconButton icon={X} label={t("Clear")} spacing="compact" onClick={() => setQuery("")} />}
          </label>
          {sections.map((x) => {
            const Icon = x.icon;
            const on = q ? matches.includes(x) : x.id === current;
            return (
              <button key={x.id} type="button" className={cx("settings-nav-item", on && "is-on", q && !on && "is-dim")} aria-current={on && !q ? "page" : undefined} onClick={() => pick(x.id)}>
                <Icon size={16} aria-hidden="true" />
                <span>{x.title()}</span>
              </button>
            );
          })}
        </nav>
        <div className="settings-pane" key={q ? "search" : current}>
          {shown.length === 0 && <p className="settings-empty">{t("No setting matches.")}</p>}
          {shown.map((x) => (
            <section key={x.id} className="settings-section" aria-label={x.title()}>
              <h3 className="settings-section-title">{x.title()}</h3>
              {x.body()}
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}
