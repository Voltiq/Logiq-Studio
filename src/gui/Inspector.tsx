import { useEffect, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowRight,
  MoveHorizontal,
  MoveVertical,
  Trash2,
  X,
} from "lucide-react";
import { badName, componentInfo, EVENT_INFO, handlerName, type GuiComponent, type GuiForm } from "./model";
import type { AlignKind } from "./geometry";
import { IconButton } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Field";
import { t } from "../lib/i18n";

/** A text input that reports when it is done (Enter or leaving), so typing isn't a change per key. */
function Field({ label, value, onCommit, type = "text", mono, error, multiline, placeholder }: { label: string; value: string; onCommit: (v: string) => void; type?: "text" | "number"; mono?: boolean; error?: string | null; multiline?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  const props = {
    className: "gi-input" + (mono ? " is-mono" : "") + (error ? " is-invalid" : ""),
    value: draft,
    placeholder,
    spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    "aria-label": label,
  };
  return (
    <label className="gi-field">
      <span className="gi-label">{label}</span>
      {multiline ? (
        <textarea {...props} rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))} onKeyDown={(e) => e.key === "Escape" && setDraft(value)} />
      ) : (
        <input
          {...props}
          type={type}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(value);
          }}
        />
      )}
      {error && <span className="gi-error">{error}</span>}
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <div className="gi-field">
      <span className="gi-label">{label}</span>
      <div className="gi-color">
        <input type="color" value={value ?? "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={label} className={value ? undefined : "is-unset"} />
        <span className="gi-color-value">{value ?? t("Default")}</span>
        {value && <IconButton icon={X} label={t("Back to default")} spacing="compact" onClick={() => onChange(undefined)} />}
      </div>
    </div>
  );
}

const num = (s: string, fallback: number) => (Number.isFinite(Number(s)) && s.trim() !== "" ? Math.round(Number(s)) : fallback);

export interface InspectorProps {
  form: GuiForm;
  selected: GuiComponent[];
  onForm: (patch: Partial<GuiForm>) => void;
  onComponent: (name: string, patch: Partial<GuiComponent>) => void;
  onRename: (from: string, to: string) => void;
  onEvent: (name: string, event: GuiComponent["events"][number], on: boolean) => void;
  onGoToHandler: (method: string) => void;
  onAlign: (kind: AlignKind) => void;
  onDelete: () => void;
  /** The panels the selected component can be put into. */
  containers: string[];
  onContainer: (name: string, parent: string | null) => void;
}

export function Inspector(p: InspectorProps) {
  const { form, selected } = p;
  if (selected.length > 1) {
    const a = (kind: AlignKind, icon: typeof X, label: string) => <IconButton icon={icon} label={label} spacing="compact" onClick={() => p.onAlign(kind)} />;
    return (
      <div className="gi">
        <div className="gi-head">
          <span className="gi-title">{t("{0} components", selected.length)}</span>
          <IconButton icon={Trash2} label={t("Delete")} spacing="compact" onClick={p.onDelete} />
        </div>
        <p className="gi-note">{t("Lined up against the first one you selected.")}</p>
        <div className="gi-section">{t("Align")}</div>
        <div className="gi-tools">
          {a("left", AlignStartVertical, t("Left edges"))}
          {a("centerX", AlignCenterVertical, t("Centres, across"))}
          {a("right", AlignEndVertical, t("Right edges"))}
          {a("top", AlignStartHorizontal, t("Top edges"))}
          {a("centerY", AlignCenterHorizontal, t("Centres, down"))}
          {a("bottom", AlignEndHorizontal, t("Bottom edges"))}
        </div>
        <div className="gi-section">{t("Size and spacing")}</div>
        <div className="gi-tools">
          {a("sameWidth", MoveHorizontal, t("Same width"))}
          {a("sameHeight", MoveVertical, t("Same height"))}
          {a("spreadX", AlignHorizontalSpaceAround, t("Spread evenly across"))}
          {a("spreadY", AlignVerticalSpaceAround, t("Spread evenly down"))}
        </div>
      </div>
    );
  }

  if (!selected.length) {
    return (
      <div className="gi">
        <div className="gi-head">
          <span className="gi-title">{t("Window")}</span>
          <span className="gi-type">JFrame · {form.className}</span>
        </div>
        <Field label={t("Title")} value={form.title} onCommit={(v) => p.onForm({ title: v })} />
        <div className="gi-row">
          <Field label={t("Width")} type="number" value={String(form.width)} onCommit={(v) => p.onForm({ width: Math.max(80, num(v, form.width)) })} />
          <Field label={t("Height")} type="number" value={String(form.height)} onCommit={(v) => p.onForm({ height: Math.max(40, num(v, form.height)) })} />
        </div>
        <Checkbox label={t("Resizable")} checked={form.resizable} onChange={(v) => p.onForm({ resizable: v })} />
        <ColorField label={t("Background")} value={form.background} onChange={(v) => p.onForm({ background: v })} />
        <p className="gi-note">{t("Drag components from the left into the window. Double-click one to write what happens when it is used.")}</p>
      </div>
    );
  }

  const c = selected[0];
  const info = componentInfo(c.type);
  const has = (k: keyof GuiComponent) => info.props.includes(k);
  const set = (patch: Partial<GuiComponent>) => p.onComponent(c.name, patch);
  return (
    <div className="gi">
      <div className="gi-head">
        <span className="gi-title">{c.name}</span>
        <span className="gi-type">{c.type}</span>
        <span className="spacer" />
        <IconButton icon={Trash2} label={t("Delete")} spacing="compact" onClick={p.onDelete} />
      </div>
      <Field
        label={t("Name (variable)")}
        value={c.name}
        mono
        onCommit={(v) => {
          const name = v.trim();
          if (!badName(name, form, c)) p.onRename(c.name, name);
        }}
      />
      {has("text") && <Field label={t("Text")} value={c.text ?? ""} multiline={c.type === "JTextArea"} onCommit={(v) => set({ text: v })} />}
      {has("items") && <Field label={t("Items (one per line)")} value={(c.items ?? []).join("\n")} multiline onCommit={(v) => set({ items: v.split("\n").filter((x, i, all) => x !== "" || i < all.length - 1) })} />}
      {has("border") && <Field label={t("Title of the border")} value={c.border ?? ""} placeholder={t("(no border)")} onCommit={(v) => set({ border: v })} />}

      <div className="gi-section">{t("Position and size")}</div>
      {(p.containers.length > 0 || c.parent) && (
        <label className="gi-field">
          <span className="gi-label">{t("Placed in")}</span>
          <select className="gi-input" value={c.parent ?? ""} onChange={(e) => p.onContainer(c.name, e.target.value || null)}>
            <option value="">{t("The window")}</option>
            {[...new Set([...(c.parent ? [c.parent] : []), ...p.containers])].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {c.parent && <p className="gi-note">{t("x and y count from the top left of {0}.", c.parent)}</p>}
      <div className="gi-row is-four">
        <Field label="x" type="number" value={String(c.x)} onCommit={(v) => set({ x: num(v, c.x) })} />
        <Field label="y" type="number" value={String(c.y)} onCommit={(v) => set({ y: num(v, c.y) })} />
        <Field label={t("Width")} type="number" value={String(c.w)} onCommit={(v) => set({ w: Math.max(4, num(v, c.w)) })} />
        <Field label={t("Height")} type="number" value={String(c.h)} onCommit={(v) => set({ h: Math.max(4, num(v, c.h)) })} />
      </div>

      {(has("min") || has("value")) && (
        <>
          <div className="gi-section">{t("Values")}</div>
          <div className="gi-row">
            {has("min") && <Field label={t("Minimum")} type="number" value={String(c.min ?? 0)} onCommit={(v) => set({ min: num(v, c.min ?? 0) })} />}
            {has("max") && <Field label={t("Maximum")} type="number" value={String(c.max ?? 100)} onCommit={(v) => set({ max: num(v, c.max ?? 100) })} />}
          </div>
          <div className="gi-row">
            {has("value") && <Field label={t("Value")} type="number" value={String(c.value ?? 0)} onCommit={(v) => set({ value: num(v, c.value ?? 0) })} />}
            {has("step") && <Field label={t("Step")} type="number" value={String(c.step ?? 1)} onCommit={(v) => set({ step: Math.max(1, num(v, c.step ?? 1)) })} />}
            {has("ticks") && <Field label={t("Ticks every")} type="number" value={String(c.ticks ?? 0)} onCommit={(v) => set({ ticks: Math.max(0, num(v, c.ticks ?? 0)) })} />}
          </div>
          {has("showText") && <Checkbox label={t("Show the percentage")} checked={!!c.showText} onChange={(v) => set({ showText: v })} />}
        </>
      )}

      <div className="gi-section">{t("Appearance")}</div>
      {has("align") && (
        <div className="gi-field">
          <span className="gi-label">{t("Text alignment")}</span>
          <div className="segmented gi-segmented" role="group">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" className={`segment${(c.align ?? "left") === a ? " is-selected" : ""}`} aria-pressed={(c.align ?? "left") === a} onClick={() => set({ align: a })}>
                {a === "left" ? t("Left") : a === "center" ? t("Centre") : t("Right")}
              </button>
            ))}
          </div>
        </div>
      )}
      {has("fontSize") && (
        <div className="gi-row is-font">
          <Field label={t("Font size")} type="number" value={c.fontSize ? String(c.fontSize) : ""} placeholder={t("Default")} onCommit={(v) => set({ fontSize: v.trim() ? Math.max(6, Math.min(96, num(v, 12))) : undefined })} />
          {has("bold") && (
            <button type="button" className={`gi-toggle is-bold${c.bold ? " is-on" : ""}`} aria-pressed={!!c.bold} onClick={() => set({ bold: !c.bold || undefined })} data-tooltip={t("Bold")}>
              B
            </button>
          )}
          {has("italic") && (
            <button type="button" className={`gi-toggle is-italic${c.italic ? " is-on" : ""}`} aria-pressed={!!c.italic} onClick={() => set({ italic: !c.italic || undefined })} data-tooltip={t("Italic")}>
              I
            </button>
          )}
        </div>
      )}
      {has("foreground") && <ColorField label={c.type === "JProgressBar" ? t("Bar colour") : t("Text colour")} value={c.foreground} onChange={(v) => set({ foreground: v })} />}
      {has("background") && <ColorField label={t("Background")} value={c.background} onChange={(v) => set({ background: v })} />}
      {has("icon") && <Field label={t("Image (next to the class, e.g. images/logo.png)")} value={c.icon ?? ""} mono onCommit={(v) => set({ icon: v.trim() || undefined })} />}

      <div className="gi-section">{t("Behaviour")}</div>
      {has("tooltip") && <Field label={t("Tooltip")} value={c.tooltip ?? ""} onCommit={(v) => set({ tooltip: v || undefined })} />}
      {has("group") && <Field label={t("Button group (one choice among them)")} value={c.group ?? ""} mono placeholder={t("(none)")} onCommit={(v) => set({ group: /^[A-Za-z_]\w*$/.test(v.trim()) ? v.trim() : undefined })} />}
      <div className="gi-checks">
        {has("enabled") && <Checkbox label={t("Enabled")} checked={c.enabled !== false} onChange={(v) => set({ enabled: v ? undefined : false })} />}
        {has("editable") && <Checkbox label={t("Editable")} checked={c.editable ?? c.type !== "JComboBox"} onChange={(v) => set({ editable: v })} />}
        {has("selected") && <Checkbox label={t("Selected")} checked={!!c.selected} onChange={(v) => set({ selected: v || undefined })} />}
        {has("lineWrap") && <Checkbox label={t("Wrap lines")} checked={!!c.lineWrap} onChange={(v) => set({ lineWrap: v || undefined })} />}
      </div>

      {info.events.length > 0 && (
        <>
          <div className="gi-section">{t("Events")}</div>
          {info.events.map((e) => {
            const on = c.events.includes(e);
            const method = handlerName(c.name, e);
            return (
              <div key={e} className="gi-event">
                <Checkbox label={t(EVENT_INFO[e].label)} checked={on} onChange={(v) => p.onEvent(c.name, e, v)} />
                {on && (
                  <button type="button" className="gi-link" onClick={() => p.onGoToHandler(method)} data-tooltip={t("Go to {0}()", method)}>
                    {method}
                    <ArrowRight size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
