/*
 * Settings → Snippets: the snippets you write yourself. Each has a language, the words that call it, a
 * description and its code; they come before the built-in ones, so a word both use calls yours.
 */
import { useState, type KeyboardEvent } from "react";
import { Braces, Pencil, Plus, Trash2 } from "lucide-react";
import { openDialog, setSettings, toast, useStore } from "../lib/store";
import type { OwnSnippet } from "../lib/settings";
import { SET_NAMES, bodyError, builtInFor, isSnippetSet, previewOf, wordsError, wordsOf, type SnippetSet } from "../editor/snippets";
import { Button, IconButton } from "./ui/Button";
import { Select, TextField } from "./ui/Field";
import { EmptyState } from "./ui/Feedback";
import { t } from "../lib/i18n";
import { cx } from "../lib/utils";

const LANGS = Object.entries(SET_NAMES).map(([value, label]) => ({ value: value as SnippetSet, label }));

export interface SnippetDraft {
  lang: SnippetSet;
  body: string;
}

const newId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Tab in the code writes a tab (one level of indent where the snippet is written). */
function tabInserts(e: KeyboardEvent<HTMLTextAreaElement>, set: (v: string) => void) {
  if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  const el = e.currentTarget;
  const { selectionStart: a, selectionEnd: b, value } = el;
  set(value.slice(0, a) + "\t" + value.slice(b));
  requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
}

function SnippetEditor({ start, onDone }: { start: OwnSnippet; onDone: () => void }) {
  const all = useStore((s) => s.settings.snippets);
  const [x, setX] = useState(start);
  const [tried, setTried] = useState(false);
  const lang = isSnippetSet(x.lang) ? x.lang : "java";
  const wordsWrong = wordsError(x.words);
  // A word one of your other snippets for this language already has.
  const taken = wordsOf(x.words).find((w) => all.some((o) => o.id !== x.id && o.lang === lang && wordsOf(o.words).includes(w)));
  const bodyWrong = bodyError(x.body);
  const replaced = wordsOf(x.words)
    .map((w) => builtInFor(lang, w) && w)
    .filter(Boolean) as string[];
  const save = () => {
    setTried(true);
    if (wordsWrong || taken || bodyWrong) return;
    const clean = { ...x, lang, words: wordsOf(x.words).join(" "), description: x.description.trim() };
    setSettings({ snippets: all.some((o) => o.id === x.id) ? all.map((o) => (o.id === x.id ? clean : o)) : [...all, clean] });
    onDone();
  };
  return (
    <div className="snippet-editor" onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && save()}>
      <div className="settings-row">
        <Select label={t("Language")} value={lang} options={LANGS} onChange={(v) => setX({ ...x, lang: v })} />
        <TextField
          label={t("Words to type")}
          mono
          autoFocus
          value={x.words}
          placeholder="hello"
          helper={replaced.length ? t("Replaces the built-in snippet {0}.", replaced.join(", ")) : t("Several are separated by spaces.")}
          error={tried ? (wordsWrong ?? (taken ? t("Another of your {0} snippets has “{1}”.", SET_NAMES[lang], taken) : null)) : null}
          onChange={(e) => setX({ ...x, words: e.target.value })}
        />
      </div>
      <TextField label={t("Description")} value={x.description} placeholder={t("What it writes, in a few words")} onChange={(e) => setX({ ...x, description: e.target.value })} />
      <label className="field">
        <span className="field-label">{t("Code")}</span>
        <textarea
          className={cx("textarea snippet-code", tried && bodyWrong && "is-invalid")}
          rows={8}
          spellCheck={false}
          value={x.body}
          placeholder={'System.out.println("Hello, ${name}!");'}
          aria-invalid={tried && bodyWrong ? true : undefined}
          onChange={(e) => setX({ ...x, body: e.target.value })}
          onKeyDown={(e) => tabInserts(e, (body) => setX({ ...x, body }))}
        />
        {tried && bodyWrong ? (
          <span className="field-message is-error">{bodyWrong}</span>
        ) : (
          <span className="field-message">
            {t("Write ${name} for a field to fill in (fields with the same name change together) and ${} where the cursor ends up. Tab moves from field to field; a tab at the start of a line indents it.")}
          </span>
        )}
      </label>
      <div className="snippet-editor-actions">
        <Button onClick={onDone}>{t("Cancel")}</Button>
        <Button appearance="primary" onClick={save}>
          {t("Save snippet")}
        </Button>
      </div>
    </div>
  );
}

export function SnippetSettings({ draft }: { draft?: SnippetDraft }) {
  const all = useStore((s) => s.settings.snippets);
  const [editing, setEditing] = useState<OwnSnippet | null>(() => (draft ? { id: newId(), lang: draft.lang, words: "", description: "", body: draft.body } : null));
  const [filter, setFilter] = useState<SnippetSet | "">("");
  const shown = all.filter((o) => !filter || o.lang === filter).sort((a, b) => a.lang.localeCompare(b.lang) || a.words.localeCompare(b.words));

  const remove = (o: OwnSnippet) => {
    const before = all;
    setSettings({ snippets: all.filter((x) => x.id !== o.id) });
    toast("success", t("Snippet deleted"), wordsOf(o.words).join(", "), { label: t("Undo"), run: () => setSettings({ snippets: before }) });
  };

  return (
    <>
      <p className="dialog-text">{t("Type a snippet's word and press Ctrl+Space or Tab to write it out. Your own come before the built-in ones, so the same word calls yours.")}</p>
      {editing && (
        <SnippetEditor
          key={editing.id}
          start={editing}
          onDone={() => {
            setEditing(null);
            // The selection it started from is used up.
            if (draft) openDialog({ kind: "settings", section: "snippets" });
          }}
        />
      )}
      {!editing && (
        <div className="snippet-toolbar">
          <Select<SnippetSet | "">
            label={t("Language")}
            compact
            value={filter}
            options={[{ value: "", label: t("All languages") }, ...LANGS]}
            onChange={setFilter}
          />
          <Button appearance="primary" iconBefore={Plus} onClick={() => setEditing({ id: newId(), lang: filter || "java", words: "", description: "", body: "" })}>
            {t("New snippet")}
          </Button>
        </div>
      )}
      {!editing &&
        (shown.length ? (
          <ul className="snippet-list">
            {shown.map((o) => (
              <li key={o.id} className="snippet-row">
                <div className="snippet-row-main">
                  <span className="snippet-row-head">
                    <code className="snippet-words">{wordsOf(o.words).join(", ")}</code>
                    <span className="snippet-lang">{isSnippetSet(o.lang) ? SET_NAMES[o.lang] : o.lang}</span>
                    {o.description && <span className="snippet-desc">{o.description}</span>}
                  </span>
                  <span className="snippet-preview">{previewOf(o.body).split("\n")[0]}</span>
                </div>
                <IconButton icon={Pencil} label={t("Edit")} onClick={() => setEditing(o)} />
                <IconButton icon={Trash2} label={t("Delete")} onClick={() => remove(o)} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={Braces} title={filter ? t("No {0} snippets of your own yet", SET_NAMES[filter]) : t("No snippets of your own yet")}>
            {t("Select code in the editor and use Edit → Save selection as snippet, or start with New snippet.")}
          </EmptyState>
        ))}
    </>
  );
}
