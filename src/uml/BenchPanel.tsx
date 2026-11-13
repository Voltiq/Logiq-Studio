import { useState } from "react";
import { Box, ChevronDown, CornerDownRight, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { closeDialog, openDialog, openMenu, type Dialog } from "../lib/store";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";
import { Modal } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import { Spinner } from "../components/ui/Feedback";
import { TextField } from "../components/ui/Field";
import { javaIndex, useJavaIndexVersion } from "./javaIndex";
import { simpleType } from "./javaParser";
import type { JMethod } from "./model";
import { benchCall, benchKeep, benchNew, benchRemove, describeMethod, focusObject, isStale, methodsFor, startBench, stopBench, suggestName, useBench, type BenchObject } from "./bench";
import type { MenuItem } from "../components/ui/Menu";

function objectMenu(o: BenchObject): MenuItem[] {
  const methods = methodsFor(o.cls);
  return [
    { type: "heading", label: `${o.name} : ${o.simple}` },
    ...methods.map(({ owner, method }) => ({
      label: describeMethod(method),
      icon: Play,
      onSelect: () => (method.params.length ? openDialog({ kind: "benchCall", owner: owner.qualifiedName, methodLine: method.line, target: o.name }) : void benchCall(o.name, owner, method, [])),
    })),
    ...(methods.length ? [] : [{ label: t("No methods to call"), disabled: true, onSelect: () => {} }]),
    { type: "separator" },
    { label: t("Remove from the bench"), icon: Trash2, danger: true, onSelect: () => void benchRemove(o.name) },
  ];
}

/*
 * The objects on the bench, drawn as UML objects ("name : Class" with the
 * field values), with the last call's result above them.
 */
export function BenchPanel() {
  useJavaIndexVersion();
  const { status, objects, result, focus } = useBench();
  const [collapsed, setCollapsed] = useState(false);
  if (status === "off" && !objects.length && !result) return null;
  const stale = isStale();

  return (
    <section className={cx("bench", collapsed && "is-collapsed")} aria-label={t("Object bench")}>
      <div className="bench-head">
        <button type="button" className="bench-title" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <ChevronDown size={14} className={cx("bench-chevron", collapsed && "is-closed")} aria-hidden="true" />
          {t("Object bench")}
          <span className="badge">{objects.length}</span>
        </button>
        {(status === "starting" || status === "busy") && <Spinner size={14} label={t("Running")} />}
        {stale && status !== "off" && (
          <span className="bench-stale">
            {t("The code changed.")}
            <button type="button" className="link-button" onClick={() => void startBench()}>
              {t("Restart with the new code")}
            </button>
          </span>
        )}
        <span className="spacer" />
        <IconButton icon={RotateCcw} label={t("Reset the bench")} spacing="compact" onClick={() => void startBench()} />
        <IconButton icon={Square} label={t("Stop the bench")} spacing="compact" onClick={() => void stopBench()} />
      </div>
      {!collapsed && (
        <>
          {result && result.call && (
            <div className={cx("bench-result", result.error && "is-error")} role="status">
              <CornerDownRight size={14} aria-hidden="true" />
              <code className="bench-call">{result.call}</code>
              {result.error ? (
                <pre className="bench-error">{result.error}</pre>
              ) : result.value ? (
                <>
                  <span className="bench-arrow">→</span>
                  <code className="bench-value">{result.value.text}</code>
                  <span className="bench-type">{result.value.type}</span>
                  {result.value.keepable && (
                    <Button spacing="compact" iconBefore={Box} onClick={() => void benchKeep(suggestName(result.value!.type))}>
                      {t("Put on the bench")}
                    </Button>
                  )}
                </>
              ) : (
                result.void && <span className="bench-type">{t("done")}</span>
              )}
              <IconButton icon={X} label={t("Dismiss")} spacing="compact" onClick={() => useBench.setState({ result: null })} />
            </div>
          )}
          <div className="bench-objects">
            {objects.length === 0 && <p className="bench-empty">{t("Right-click a class in the diagram and choose new … to create an object.")}</p>}
            {objects.map((o) => (
              <div
                key={o.name}
                className={cx("bench-card", focus === o.name && "is-focus")}
                onClick={(e) => openMenu({ items: objectMenu(o), x: e.clientX, y: e.clientY })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu({ items: objectMenu(o), x: e.clientX, y: e.clientY });
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    openMenu({ items: objectMenu(o), x: r.left + 12, y: r.bottom });
                  } else if (e.key === "Delete") void benchRemove(o.name);
                }}
              >
                <div className="bench-card-head">
                  <span>
                    {o.name} : {o.simple}
                  </span>
                </div>
                <div className="bench-fields">
                  {o.fields.filter((f) => !f.static).length === 0 && <span className="bench-none">{t("no attributes")}</span>}
                  {o.fields
                    .filter((f) => !f.static)
                    .map((f) => (
                      <div key={f.owner + f.name} className="bench-field" title={`${f.type} ${f.name} (${f.owner})`}>
                        <span className="bench-fname">{f.name}</span>
                        <span className="bench-eq">=</span>
                        {f.ref ? (
                          <button
                            type="button"
                            className="bench-ref"
                            onClick={(e) => {
                              e.stopPropagation();
                              focusObject(f.ref!);
                            }}
                          >
                            {f.ref}
                          </button>
                        ) : (
                          <span className="bench-fvalue">{f.value}</span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ----- Arguments ------------------------------------------------------------------------------

function ArgsDialog({ title, method, name, onSubmit }: { title: string; method: JMethod | null; name?: string; onSubmit: (args: string[], name: string) => void }) {
  const params = method?.params ?? [];
  const [args, setArgs] = useState<string[]>(params.map((p) => (simpleType(p.type) === "String" ? '""' : "")));
  const [objName, setObjName] = useState(name ?? "");
  const objects = useBench((s) => s.objects);
  const submit = () => {
    closeDialog();
    onSubmit(args, objName.trim());
  };
  return (
    <Modal
      title={title}
      width="small"
      onClose={closeDialog}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" onClick={submit}>
            {name !== undefined ? t("Create") : t("Call")}
          </Button>
        </>
      }
    >
      <form
        className="member-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {name !== undefined && <TextField label={t("Object name")} value={objName} spellCheck={false} onChange={(e) => setObjName(e.target.value)} />}
        {params.map((p, i) => (
          <TextField
            key={i}
            label={`${simpleType(p.type)} ${p.name}`}
            value={args[i]}
            mono
            autoFocus={i === 0 && name === undefined}
            list="logiq-bench-objects"
            spellCheck={false}
            onChange={(e) => setArgs((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
        <datalist id="logiq-bench-objects">
          {objects.map((o) => (
            <option key={o.name} value={o.name}>
              {o.simple}
            </option>
          ))}
        </datalist>
        {params.length > 0 && <p className="dialog-text">{t("Numbers, true/false, text in quotes, null, or the name of an object on the bench.")}</p>}
      </form>
    </Modal>
  );
}

export function BenchDialogs({ d }: { d: Dialog }) {
  if (d.kind === "benchNew") {
    const type = javaIndex.types().find((x) => x.qualifiedName === d.cls);
    if (!type) return null;
    const ctor = d.ctorLine === null ? null : (type.methods.find((m) => m.isConstructor && m.line === d.ctorLine) ?? null);
    return (
      <ArgsDialog
        title={`new ${type.name}(${(ctor?.params ?? []).map((p) => simpleType(p.type)).join(", ")})`}
        method={ctor}
        name={suggestName(type.name)}
        onSubmit={(args, name) => {
          if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) return;
          void benchNew(type, ctor, args, name);
        }}
      />
    );
  }
  if (d.kind === "benchCall") {
    const owner = javaIndex.types().find((x) => x.qualifiedName === d.owner);
    const m = owner?.methods.find((x) => x.line === d.methodLine);
    if (!owner || !m) return null;
    return <ArgsDialog title={`${d.target ?? owner.name}.${describeMethod(m)}`} method={m} onSubmit={(args) => void benchCall(d.target, owner, m, args)} />;
  }
  return null;
}
