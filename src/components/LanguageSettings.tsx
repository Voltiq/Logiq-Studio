import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { setSettings, useStore } from "../lib/store";
import { chooseTool, findTools, toolLabel, useToolchain, type ToolKind } from "../languages/toolchain";
import { useLsp } from "../lsp/clients";
import { Select } from "./ui/Select";
import { TextField, Toggle } from "./ui/Field";
import { IconButton } from "./ui/Button";
import { t } from "../lib/i18n";

const KINDS: { kind: ToolKind; label: string }[] = [
  { kind: "python", label: "Python" },
  { kind: "cc", label: "C compiler" },
  { kind: "cxx", label: "C++ compiler" },
  { kind: "php", label: "PHP" },
  { kind: "kotlinc", label: "Kotlin compiler" },
];

function ToolSelect({ kind, label }: { kind: ToolKind; label: string }) {
  const found = useToolchain((s) => s.found[kind]);
  const chosen = useToolchain((s) => s.chosen[kind]);
  useEffect(() => void findTools(kind), [kind]);
  const list = found ?? [];
  const value = list.some((x) => x.path === chosen) ? chosen! : (list[0]?.path ?? "");
  return (
    <Select
      label={t(label)}
      value={value}
      onChange={(v) => chooseTool(kind, v)}
      options={list.length ? list.map((x) => ({ value: x.path, label: toolLabel(kind, x), description: x.path })) : [{ value: "", label: found ? t("None found") : t("Looking…") }]}
    />
  );
}

/* Settings → Languages: the tool each language uses, its language servers and compiler flags. */
export function LanguageSettings() {
  const s = useStore((st) => st.settings);
  const servers = useLsp((st) => st.plugins);
  const running = Object.values(servers).filter((x) => x.state === "ready" || x.state === "starting");
  return (
    <>
      <div className="settings-tools">
        {KINDS.map((k) => (
          <ToolSelect key={k.kind} {...k} />
        ))}
        <IconButton
          icon={RefreshCw}
          label={t("Look again")}
          onClick={() => {
            for (const k of KINDS) void findTools(k.kind, true);
          }}
        />
      </div>
      <Toggle
        label={t("Use installed language servers")}
        description={
          running.length
            ? t("Running: {0}.", running.map((x) => x.name).join(", "))
            : t("clangd for C and C++ (it comes with LLVM), Pyright, basedpyright, pylsp or jedi for Python, Intelephense for PHP and kotlin-language-server, when they are installed.")
        }
        checked={s.languageServers}
        onChange={(v) => setSettings({ languageServers: v })}
      />
      <div className="settings-row">
        <TextField label={t("More C and C++ compiler flags")} placeholder="-O2 -lm" value={s.cFlags} spellCheck={false} onChange={(e) => setSettings({ cFlags: e.target.value })} compact />
        <TextField label={t("SQL rows shown at most")} type="number" min={100} max={1000000} value={s.sqlMaxRows} onChange={(e) => setSettings({ sqlMaxRows: Math.max(100, Math.min(1000000, +e.target.value || 10000)) })} compact />
      </div>
      <p className="dialog-text">{t("Each project remembers its own Python; a virtual environment in the project folder (.venv) is used first.")}</p>
    </>
  );
}
