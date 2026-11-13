import { AppWindow, Boxes, Braces, Clock, Coffee, Cpu, Database, FileCode, FileCode2, FolderOpen, FolderPlus, GitBranch, Globe, Network, Package, Server, X } from "lucide-react";
import { openDialog, setSettings, useStore } from "../lib/store";
import { chooseFolder, openFolder } from "../lib/actions";
import { basename, dirname } from "../lib/paths";
import { TEMPLATES } from "../lib/templates";
import { Button, IconButton } from "./ui/Button";
import { Shortcut } from "./ui/Feedback";
import { t } from "../lib/i18n";

const TEMPLATE_ICON = {
  "java-classes": Network,
  "java-console": Coffee,
  swing: AppWindow,
  web: Globe,
  maven: Package,
  gradle: Boxes,
  python: FileCode2,
  c: Cpu,
  cpp: Cpu,
  php: Server,
  kotlin: Braces,
  sql: Database,
} as const;

/* The start screen: open or create a project, or pick up a recent one. */
export function Welcome() {
  const recent = useStore((s) => s.settings.recent);
  const jdks = useStore((s) => s.jdks);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <img className="welcome-icon" src="/app-icon.svg" alt="" />
          <div>
            <h1 className="welcome-title">
              Logiq <span>{t("Studio")}</span>
            </h1>
            <p className="welcome-sub">{t("Write Java, Python, C, C++, Kotlin, PHP, SQL, HTML, CSS and JavaScript. See your classes as a UML diagram while you type.")}</p>
          </div>
        </div>

        <div className="welcome-actions">
          <Button appearance="primary" iconBefore={FolderPlus} onClick={() => openDialog({ kind: "newProject" })}>
            {t("New project")}
          </Button>
          <Button iconBefore={FolderOpen} onClick={() => void chooseFolder()}>
            {t("Open folder")}
          </Button>
          <Button iconBefore={GitBranch} onClick={() => openDialog({ kind: "clone" })}>
            {t("Clone repository")}
          </Button>
        </div>

        <div className="welcome-grid">
          <section className="welcome-card panel">
            <h2 className="eyebrow">{t("Start from")}</h2>
            <div className="welcome-templates">
              {TEMPLATES.map((x) => {
                const Icon = TEMPLATE_ICON[x.id];
                return (
                  <button key={x.id} type="button" className="template" onClick={() => openDialog({ kind: "newProject", template: x.id })}>
                    <span className="icon-tile" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="template-text">
                      <span className="template-title">{t(x.title)}</span>
                      <span className="template-desc">{t(x.description)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="welcome-card panel">
            <h2 className="eyebrow">{t("Recent")}</h2>
            {recent.length === 0 ? (
              <p className="welcome-note">{t("Folders you open appear here.")}</p>
            ) : (
              <ul className="recent">
                {recent.map((p) => (
                  <li key={p} className="recent-row">
                    <button type="button" className="recent-main" onClick={() => void openFolder(p)} data-tooltip={p}>
                      <Clock size={14} aria-hidden="true" />
                      <span className="recent-name">{basename(p)}</span>
                      <span className="recent-path">{dirname(p)}</span>
                    </button>
                    <IconButton icon={X} label={t("Remove from recent")} spacing="compact" onClick={() => setSettings({ recent: recent.filter((r) => r !== p) })} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="welcome-foot">
          <span>
            <FileCode size={13} aria-hidden="true" /> {jdks[0] ? t("Java {0} found", jdks[0].version) : t("No JDK found: Java code can be edited but not compiled")}
            {!jdks[0] && (
              <button type="button" className="link-button" onClick={() => openDialog({ kind: "installJdk" })}>
                {t("Install a JDK…")}
              </button>
            )}
          </span>
          <span>
            <Braces size={13} aria-hidden="true" /> Commands <Shortcut keys="Ctrl+Shift+P" />
          </span>
        </div>
      </div>
    </div>
  );
}
