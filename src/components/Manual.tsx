import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { marked } from "marked";
import { Modal } from "./ui/Modal";
import { closeDialog } from "../lib/store";
import { language, t } from "../lib/i18n";
import { cx } from "../lib/utils";
import english from "../../docs/GUIDE.md?raw";
import german from "../../docs/ANLEITUNG.md?raw";
import spanish from "../../docs/GUIA.md?raw";
import french from "../../docs/MANUEL.md?raw";

const MANUALS = { en: english, de: german, es: spanish, fr: french };

/*
 * The manual inside the app (F1). It shows the same files that are in the
 * repository (docs/GUIDE.md and its translations), so the two cannot drift
 * apart: a list of chapters on the left, the text on the right.
 */

export interface Chapter {
  title: string;
  html: string;
}

/** Splits a manual at its `## ` headings; what comes before the first is the introduction. */
export function chapters(source: string): { title: string; intro: string; chapters: Chapter[] } {
  const text = source.replace(/\r/g, "");
  const title = /^# (.+)$/m.exec(text)?.[1] ?? "";
  const parts = text.replace(/^# .+\n/m, "").split(/^## /m);
  const html = (md: string) => marked.parse(md, { gfm: true, async: false }) as string;
  return {
    title,
    intro: html(parts[0]),
    chapters: parts.slice(1).map((p) => {
      const nl = p.indexOf("\n");
      return { title: p.slice(0, nl < 0 ? p.length : nl).trim(), html: html(nl < 0 ? "" : p.slice(nl + 1)) };
    }),
  };
}

export function ManualDialog() {
  const manual = useMemo(() => chapters(MANUALS[language] ?? english), []);
  const [current, setCurrent] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  // The chapter in view is the one marked in the list.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onScroll = () => {
      const sections = [...el.querySelectorAll<HTMLElement>("section")];
      const at = sections.findIndex((s) => s.offsetTop + s.offsetHeight > el.scrollTop + 24);
      if (at >= 0) setCurrent(at);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const go = (i: number) => {
    const section = body.current?.querySelectorAll<HTMLElement>("section")[i];
    if (section && body.current) body.current.scrollTop = section.offsetTop - 8;
    setCurrent(i);
  };

  return (
    <Modal title={manual.title || t("Manual")} titleIcon={<BookOpen size={18} aria-hidden="true" />} width="large" className="manual" onClose={closeDialog}>
      <div className="manual-layout">
        <nav className="manual-nav" aria-label={t("Chapters")}>
          {manual.chapters.map((c, i) => (
            <button key={i} type="button" className={cx("manual-link", i === current && "is-current")} aria-current={i === current ? "true" : undefined} onClick={() => go(i)}>
              {c.title}
            </button>
          ))}
        </nav>
        <div ref={body} className="manual-text" tabIndex={0}>
          <div dangerouslySetInnerHTML={{ __html: manual.intro }} />
          {manual.chapters.map((c, i) => (
            <section key={i} aria-label={c.title}>
              <h2>{c.title}</h2>
              <div dangerouslySetInnerHTML={{ __html: c.html }} />
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}
