import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { closeDialog, useStore, type Dialog } from "../lib/store";
import { relative } from "../lib/paths";
import { packageFor } from "../lib/actions";
import { t } from "../lib/i18n";
import { Modal } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import { Checkbox, Segmented, Select, TextField } from "../components/ui/Field";
import { SectionMessage } from "../components/ui/Feedback";
import { javaIndex } from "./javaIndex";
import { simpleType } from "./javaParser";
import type { Visibility } from "./model";
import { changeField, changeSignature, addField, addMethod, parseParams, renderClass, setSupertypes, TYPE_RE, type ClassSpec, type FieldSpec } from "./codegen";
import { addAssociation, createClass, editType, indentUnit } from "./edit";
import { renameEverywhere } from "../editor/javaNav";
import { BenchDialogs } from "./BenchPanel";
import { setWhole, type Whole } from "./relations";

const NAME_RE = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const PRIMITIVES = ["int", "double", "boolean", "char", "long", "float", "short", "byte", "String", "void"];

const VIS_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "private", label: "− private" },
  { value: "package", label: "~ package" },
  { value: "protected", label: "# protected" },
  { value: "public", label: "+ public" },
];

/** Type names offered while typing a type: primitives, the project's classes, common library types. */
function TypeList({ id }: { id: string }) {
  const types = useMemo(() => [...new Set([...PRIMITIVES, ...javaIndex.types().map((x) => x.name), "List<>", "ArrayList<>", "Map<,>", "Object", "Integer", "Double"])], []);
  return (
    <datalist id={id}>
      {types.map((x) => (
        <option key={x} value={x} />
      ))}
    </datalist>
  );
}

function checkType(type: string, allowVoid = false): string | null {
  if (!type.trim()) return t("Enter a type.");
  if (!TYPE_RE.test(type.trim())) return t("That isn't a valid Java type.");
  if (type.trim() === "void" && !allowVoid) return t("A field can't be void.");
  return null;
}

// ----- New class -----------------------------------------------------------------------------

interface Row extends FieldSpec {
  key: number;
}

let rowKey = 0;

function ClassWizard({ d }: { d: Extract<Dialog, { kind: "classWizard" }> }) {
  const root = useStore((s) => s.root)!;
  const classes = useMemo(() => javaIndex.types(), []);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ClassSpec["kind"]>("class");
  const [ext, setExt] = useState("");
  const [impl, setImpl] = useState("");
  const [constants, setConstants] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: ++rowKey, name: "", type: "String", visibility: "private" }]);
  const [ctor, setCtor] = useState(true);
  const [getters, setGetters] = useState(true);
  const [setters, setSetters] = useState(true);
  const [toStr, setToStr] = useState(false);
  const [main, setMain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = rows.filter((r) => r.name.trim()).map(({ key: _k, ...f }) => ({ ...f, name: f.name.trim(), type: f.type.trim() }));
  const spec: ClassSpec = {
    name: name.trim() || "NewClass",
    kind,
    pkg: packageFor(d.dir),
    extends: kind === "class" || kind === "abstract" ? ext.trim() : "",
    implements: impl
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    fields,
    constants: constants
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
    constructor: ctor,
    getters,
    setters,
    toString: toStr,
    main,
  };
  const preview = renderClass(spec, indentUnit());

  const create = async () => {
    const n = name.trim();
    if (!NAME_RE.test(n)) return setError(t("A class name starts with a letter and has only letters, digits and _."));
    if (classes.some((c) => c.name === n)) return setError(t("There is already a class called {0}.", n));
    for (const f of fields) {
      if (!NAME_RE.test(f.name)) return setError(t("“{0}” isn't a valid attribute name.", f.name));
      const bad = checkType(f.type);
      if (bad) return setError(`${f.name}: ${bad}`);
    }
    if (spec.constants?.some((c) => !NAME_RE.test(c))) return setError(t("Enum constants are names separated by commas."));
    closeDialog();
    await createClass(d.dir, spec);
  };

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Modal
      title={t("New class")}
      width="large"
      onClose={closeDialog}
      closeOnBlanket={false}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" onClick={() => void create()}>
            {t("Create class")}
          </Button>
        </>
      }
    >
      <div className="wizard">
        <div className="wizard-form">
          <div className="settings-row">
            <TextField label={t("Name")} value={name} placeholder={t("Account")} autoFocus spellCheck={false} onChange={(e) => (setName(e.target.value), setError(null))} />
            <Select
              label={t("Kind")}
              value={kind}
              onChange={setKind}
              options={[
                { value: "class", label: t("Class") },
                { value: "abstract", label: t("Abstract class") },
                { value: "interface", label: t("Interface") },
                { value: "enum", label: t("Enum") },
                { value: "record", label: t("Record") },
              ]}
            />
          </div>
          <div className="settings-row">
            {(kind === "class" || kind === "abstract") && (
              <TextField label={t("Extends")} value={ext} list="logiq-classes" placeholder={t("Superclass")} spellCheck={false} onChange={(e) => setExt(e.target.value)} />
            )}
            <TextField
              label={kind === "interface" ? t("Extends interfaces") : t("Implements")}
              value={impl}
              list="logiq-classes"
              placeholder={t("Interfaces, separated by commas")}
              spellCheck={false}
              onChange={(e) => setImpl(e.target.value)}
            />
          </div>
          <datalist id="logiq-classes">
            {classes.map((c) => (
              <option key={c.qualifiedName} value={c.name} />
            ))}
          </datalist>
          {kind === "enum" && <TextField label={t("Constants")} value={constants} placeholder="RED, GREEN, BLUE" spellCheck={false} onChange={(e) => setConstants(e.target.value)} />}
          <div className="field">
            <span className="field-label">{kind === "record" ? t("Components") : t("Attributes")}</span>
            <div className="attr-rows">
              {rows.map((r) => (
                <div key={r.key} className="attr-row">
                  {kind !== "record" && kind !== "interface" && (
                    <select className="attr-vis" aria-label={t("Visibility")} value={r.visibility} onChange={(e) => update(r.key, { visibility: e.target.value as Visibility })}>
                      {VIS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <input className="attr-input" aria-label={t("Name")} placeholder={t("name")} value={r.name} spellCheck={false} onChange={(e) => update(r.key, { name: e.target.value })} />
                  <input className="attr-input is-type" aria-label={t("Type")} placeholder={t("Type")} list="logiq-types" value={r.type} spellCheck={false} onChange={(e) => update(r.key, { type: e.target.value })} />
                  {kind !== "record" && (
                    <label className="attr-flag" title={t("static")}>
                      <input type="checkbox" checked={!!r.isStatic} onChange={(e) => update(r.key, { isStatic: e.target.checked })} /> {t("static")}
                    </label>
                  )}
                  {kind !== "record" && (
                    <label className="attr-flag" title={t("final")}>
                      <input type="checkbox" checked={!!r.isFinal} onChange={(e) => update(r.key, { isFinal: e.target.checked })} /> {t("final")}
                    </label>
                  )}
                  <IconButton icon={Trash2} label={t("Remove attribute")} spacing="compact" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                </div>
              ))}
              <Button spacing="compact" appearance="subtle" iconBefore={Plus} onClick={() => setRows((rs) => [...rs, { key: ++rowKey, name: "", type: "int", visibility: "private" }])}>
                {t("Add attribute")}
              </Button>
            </div>
            <TypeList id="logiq-types" />
          </div>
          {kind !== "interface" && (
            <div className="wizard-checks">
              {kind !== "record" && <Checkbox label={t("Constructor with all attributes")} checked={ctor} onChange={setCtor} />}
              {kind !== "record" && <Checkbox label={t("Getters")} checked={getters} onChange={setGetters} />}
              {kind !== "record" && <Checkbox label={t("Setters")} checked={setters} onChange={setSetters} />}
              {kind !== "record" && <Checkbox label={t("toString()")} checked={toStr} onChange={setToStr} />}
              <Checkbox label={t("main method")} checked={main} onChange={setMain} />
            </div>
          )}
          {error && <SectionMessage appearance="danger">{error}</SectionMessage>}
          <p className="dialog-text">{t("In {0}", relative(root, d.dir) || t("the project folder"))}</p>
        </div>
        <pre className="wizard-preview" aria-label={t("Preview of the code")}>
          {preview}
        </pre>
      </div>
    </Modal>
  );
}

// ----- Attribute, method or constructor ---------------------------------------------------------

function MemberDialog({ d }: { d: Extract<Dialog, { kind: "member" }> }) {
  const owner = javaIndex.types().find((x) => x.qualifiedName === d.owner);
  const existingField = d.member === "field" && d.line ? owner?.fields.find((f) => f.line === d.line) : undefined;
  const existingMethod = d.member !== "field" && d.line ? owner?.methods.find((m) => m.line === d.line) : undefined;
  const isInterface = owner?.kind === "interface";
  const [vis, setVis] = useState<Visibility>(existingField?.visibility ?? existingMethod?.visibility ?? (d.member === "field" && !isInterface ? "private" : "public"));
  const [name, setName] = useState(existingField?.name ?? (existingMethod && !existingMethod.isConstructor ? existingMethod.name : ""));
  const [type, setType] = useState(existingField?.type ?? existingMethod?.returnType ?? (d.member === "field" ? "int" : "void"));
  const [params, setParams] = useState(existingMethod ? existingMethod.params.map((p) => `${p.type} ${p.name}`).join(", ") : "");
  const [isStatic, setStatic] = useState(existingField?.isStatic ?? existingMethod?.isStatic ?? false);
  const [isFinal, setFinal] = useState(existingField?.isFinal ?? false);
  const [isAbstract, setAbstract] = useState(existingMethod?.isAbstract ?? false);
  const [init, setInit] = useState("");
  const [withGetter, setGetter] = useState(false);
  const [withSetter, setSetter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!owner) return null;

  const editing = !!(existingField || existingMethod);
  const title =
    d.member === "field"
      ? editing
        ? t("Edit attribute of {0}", owner.name)
        : t("New attribute in {0}", owner.name)
      : d.member === "ctor"
        ? editing
          ? t("Edit constructor of {0}", owner.name)
          : t("New constructor in {0}", owner.name)
        : editing
          ? t("Edit method of {0}", owner.name)
          : t("New method in {0}", owner.name);

  const save = async () => {
    const n = name.trim();
    if (d.member !== "ctor" && !NAME_RE.test(n)) return setError(t("That isn't a valid Java name."));
    if (d.member !== "ctor") {
      const bad = checkType(type, d.member === "method");
      if (bad) return setError(bad);
    }
    const ps = d.member === "field" ? [] : parseParams(params);
    if (ps === null) return setError(t("Write parameters as “type name”, separated by commas."));
    const unit = indentUnit();
    // A new name is changed everywhere it is used first.
    const oldName = existingField?.name ?? (existingMethod && !existingMethod.isConstructor ? existingMethod.name : null);
    closeDialog();
    if (oldName && oldName !== n) {
      await renameEverywhere(oldName, n, owner.path, existingField?.line ?? existingMethod!.line);
    }
    await editType(owner.qualifiedName, (text, fresh) => {
      if (d.member === "field") {
        const spec: FieldSpec = { name: n, type: type.trim(), visibility: vis, isStatic, isFinal, init: init.trim() || undefined };
        if (existingField) {
          const f = fresh.fields.find((x) => x.line === existingField.line) ?? fresh.fields.find((x) => x.name === n);
          return f ? changeField(text, f, { ...spec, init: init.trim() || undefined }) : text;
        }
        return addField(text, fresh, spec, { getter: withGetter, setter: withSetter }, unit);
      }
      const spec = {
        name: d.member === "ctor" ? owner.name : n,
        returnType: d.member === "ctor" ? null : type.trim(),
        params: ps,
        visibility: vis,
        isStatic: d.member === "method" && isStatic,
        isAbstract: d.member === "method" && isAbstract,
      };
      if (existingMethod) {
        const m = fresh.methods.find((x) => x.line === existingMethod.line);
        return m ? changeSignature(text, fresh, m, spec) : text;
      }
      return addMethod(text, fresh, spec, unit);
    });
  };

  return (
    <Modal
      title={title}
      width="medium"
      onClose={closeDialog}
      closeOnBlanket={false}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" onClick={() => void save()}>
            {editing ? t("Change") : t("Add")}
          </Button>
        </>
      }
    >
      <form
        className="member-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Segmented<Visibility> label={t("Visibility")} value={vis} onChange={setVis} options={VIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <div className="settings-row">
          {d.member !== "ctor" && <TextField label={t("Name")} value={name} autoFocus spellCheck={false} onChange={(e) => (setName(e.target.value), setError(null))} />}
          {d.member !== "ctor" && (
            <TextField label={d.member === "field" ? t("Type") : t("Return type")} value={type} list="logiq-types" spellCheck={false} onChange={(e) => (setType(e.target.value), setError(null))} />
          )}
        </div>
        {d.member !== "field" && (
          <TextField
            label={t("Parameters")}
            value={params}
            mono
            autoFocus={d.member === "ctor"}
            placeholder="int x, String name"
            spellCheck={false}
            helper={t("Type and name, separated by commas.")}
            onChange={(e) => (setParams(e.target.value), setError(null))}
          />
        )}
        {d.member === "field" && !editing && <TextField label={t("Initial value (optional)")} value={init} mono spellCheck={false} placeholder="0" onChange={(e) => setInit(e.target.value)} />}
        <TypeList id="logiq-types" />
        <div className="wizard-checks">
          {d.member !== "ctor" && <Checkbox label={t("static")} checked={isStatic} onChange={setStatic} />}
          {d.member === "field" && <Checkbox label={t("final")} checked={isFinal} onChange={setFinal} />}
          {d.member === "method" && (owner.isAbstract || isInterface) && <Checkbox label={t("abstract (no body)")} checked={isAbstract} onChange={setAbstract} />}
          {d.member === "field" && !editing && <Checkbox label={t("Getter")} checked={withGetter} onChange={setGetter} />}
          {d.member === "field" && !editing && <Checkbox label={t("Setter")} checked={withSetter} onChange={setSetter} />}
        </div>
        {editing && name.trim() && (existingField?.name ?? existingMethod?.name) !== name.trim() && d.member !== "ctor" && (
          <p className="dialog-text">{t("The new name is also changed wherever it is used.")}</p>
        )}
        {error && <SectionMessage appearance="danger">{error}</SectionMessage>}
      </form>
    </Modal>
  );
}

// ----- Association --------------------------------------------------------------------------------

function AssociationDialog({ d }: { d: Extract<Dialog, { kind: "association" }> }) {
  const from = javaIndex.types().find((x) => x.qualifiedName === d.from);
  const to = javaIndex.types().find((x) => x.qualifiedName === d.to);
  const base = to ? to.name[0].toLowerCase() + to.name.slice(1) : "";
  const [many, setMany] = useState<"one" | "many">("one");
  const [role, setRole] = useState(base);
  const [vis, setVis] = useState<Visibility>("private");
  const [whole, setWholeKind] = useState<"none" | Whole>("none");
  const [error, setError] = useState<string | null>(null);
  if (!from || !to) return null;
  const save = async () => {
    const r = role.trim();
    if (!NAME_RE.test(r)) return setError(t("That isn't a valid Java name."));
    if (from.fields.some((f) => f.name === r)) return setError(t("{0} already has an attribute called {1}.", from.name, r));
    closeDialog();
    await addAssociation(d.from, d.to, r, many === "many", vis);
    setWhole(d.from, d.to, whole === "none" ? null : whole);
  };
  return (
    <Modal
      title={t("Association from {0} to {1}", from.name, to.name)}
      width="small"
      onClose={closeDialog}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" onClick={() => void save()}>
            {t("Add")}
          </Button>
        </>
      }
    >
      <Segmented<"one" | "many">
        label={t("Multiplicity")}
        value={many}
        onChange={(v) => {
          setMany(v);
          if (role === base || role === base + "s") setRole(v === "many" ? base + "s" : base);
        }}
        options={[
          { value: "one", label: t("one (1)") },
          { value: "many", label: t("many (0..*)") },
        ]}
      />
      <Segmented<"none" | Whole>
        label={t("Kind")}
        value={whole}
        onChange={setWholeKind}
        options={[
          { value: "none", label: t("Association") },
          { value: "aggregation", label: t("Aggregation") },
          { value: "composition", label: t("Composition") },
        ]}
      />
      <p className="dialog-text">
        {whole === "aggregation"
          ? t("{1} is a part of {0}, but can exist without it.", from.name, to.name)
          : whole === "composition"
            ? t("{1} belongs to {0} and exists only with it.", from.name, to.name)
            : t("{0} knows {1}.", from.name, to.name)}
      </p>
      <TextField label={t("Role name (the attribute in {0})", from.name)} value={role} autoFocus spellCheck={false} onChange={(e) => (setRole(e.target.value), setError(null))} />
      <Select label={t("Visibility")} value={vis} onChange={setVis} options={VIS_OPTIONS} />
      <p className="dialog-text is-mono">
        {vis === "package" ? "" : vis + " "}
        {many === "many" ? `List<${to.name}> ${role || "…"} = new ArrayList<>();` : `${to.name} ${role || "…"};`}
      </p>
      {error && <SectionMessage appearance="danger">{error}</SectionMessage>}
    </Modal>
  );
}

// ----- Class header ---------------------------------------------------------------------------------

function EditClassDialog({ d }: { d: Extract<Dialog, { kind: "editClass" }> }) {
  const type = javaIndex.types().find((x) => x.qualifiedName === d.owner);
  const [name, setName] = useState(type?.name ?? "");
  const [ext, setExt] = useState(type?.extends.map(simpleType).join(", ") ?? "");
  const [impl, setImpl] = useState(type?.implements.map(simpleType).join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!type) return null;
  const isInterface = type.kind === "interface";
  const split = (s: string) =>
    s
      .split(/,(?![^<]*>)/)
      .map((x) => x.trim())
      .filter(Boolean);
  const save = async () => {
    const n = name.trim();
    if (!NAME_RE.test(n)) return setError(t("A class name starts with a letter and has only letters, digits and _."));
    if (type.kind === "class" && split(ext).length > 1) return setError(t("A class extends one class only."));
    closeDialog();
    await editType(type.qualifiedName, (text, fresh) => setSupertypes(text, fresh, split(ext), isInterface ? [] : split(impl)));
    if (n !== type.name) await renameEverywhere(type.name, n, type.path, type.line);
  };
  return (
    <Modal
      title={t("Edit {0}", type.name)}
      width="small"
      onClose={closeDialog}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button appearance="primary" onClick={() => void save()}>
            {t("Change")}
          </Button>
        </>
      }
    >
      <TextField label={t("Name")} value={name} autoFocus spellCheck={false} helper={name !== type.name ? t("The class, its file and every use are renamed.") : undefined} onChange={(e) => (setName(e.target.value), setError(null))} />
      {(type.kind === "class" || isInterface) && (
        <TextField label={isInterface ? t("Extends interfaces") : t("Extends")} value={ext} list="logiq-classes2" spellCheck={false} onChange={(e) => setExt(e.target.value)} />
      )}
      {!isInterface && <TextField label={t("Implements")} value={impl} list="logiq-classes2" spellCheck={false} onChange={(e) => setImpl(e.target.value)} />}
      <datalist id="logiq-classes2">
        {javaIndex.types().map((c) => (
          <option key={c.qualifiedName} value={c.name} />
        ))}
      </datalist>
      {error && <SectionMessage appearance="danger">{error}</SectionMessage>}
    </Modal>
  );
}

/** Ticks classes in a list, with a filter. */
function PickClassesDialog({ d }: { d: Extract<Dialog, { kind: "pickClasses" }> }) {
  const [chosen, setChosen] = useState(() => new Set(d.selected));
  const [filter, setFilter] = useState("");
  const shown = d.options.filter((o) => !filter || o.label.toLowerCase().includes(filter.toLowerCase()) || o.detail?.toLowerCase().includes(filter.toLowerCase()));
  const all = shown.length > 0 && shown.every((o) => chosen.has(o.value));
  return (
    <Modal
      title={d.title}
      width="small"
      onClose={closeDialog}
      footer={
        <>
          <Button appearance="subtle" onClick={closeDialog}>
            {t("Cancel")}
          </Button>
          <Button
            appearance="primary"
            onClick={() => {
              d.onSubmit(d.options.map((o) => o.value).filter((v) => chosen.has(v)));
              closeDialog();
            }}
          >
            {d.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="pick-classes">
        <TextField label={t("Filter")} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <Checkbox
          label={t("All shown ({0})", shown.length)}
          checked={all}
          indeterminate={!all && shown.some((o) => chosen.has(o.value))}
          onChange={(v) => {
            const next = new Set(chosen);
            for (const o of shown) v ? next.add(o.value) : next.delete(o.value);
            setChosen(next);
          }}
        />
        <div className="pick-classes-list">
          {shown.map((o) => (
            <Checkbox
              key={o.value}
              label={
                <span className="pick-classes-item">
                  {o.label}
                  {o.detail && <span className="pick-classes-detail">{o.detail}</span>}
                </span>
              }
              checked={chosen.has(o.value)}
              onChange={(v) => {
                const next = new Set(chosen);
                v ? next.add(o.value) : next.delete(o.value);
                setChosen(next);
              }}
            />
          ))}
          {!shown.length && <p className="dialog-text">{t("No class matches.")}</p>}
        </div>
      </div>
    </Modal>
  );
}

export function UmlDialogs({ d }: { d: Dialog }) {
  switch (d.kind) {
    case "pickClasses":
      return <PickClassesDialog d={d} />;
    case "classWizard":
      return <ClassWizard d={d} />;
    case "member":
      return <MemberDialog key={`${d.owner}:${d.line}`} d={d} />;
    case "association":
      return <AssociationDialog d={d} />;
    case "editClass":
      return <EditClassDialog d={d} />;
    default:
      return <BenchDialogs d={d} />;
  }
}
