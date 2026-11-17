import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui/Button";
import { set, useStore } from "../lib/store";
import { t } from "../lib/i18n";

/*
 * The tour: a handful of cards, each pointing at one part of the window.
 * A step whose part is not on screen (the bottom panel while it is closed)
 * shows its card in the middle instead. It starts once, the first time the
 * app runs, and again from Help → Tour.
 */

interface Step {
  /** CSS selector of the part the card points at; none for a card in the middle. */
  target?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: t("Welcome to Logiq Studio"),
    body: t("Seven short steps show where everything is. You can leave at any time with Esc and start the tour again from the Help menu."),
  },
  {
    target: ".menubar",
    title: t("Menus and commands"),
    body: t("Every command is in these menus. The field beside them finds files by name, and with Ctrl+Shift+P any command."),
  },
  {
    target: ".rail",
    title: t("The views"),
    body: t("Explorer for your files, search in all files, the outline of a file, Git and the debugger. Below them: the UML class diagram of your code and the terminal."),
  },
  {
    target: ".stage",
    title: t("Your code"),
    body: t("Files open here as tabs. Start with a project from a template or open a folder; the class diagram draws itself from the classes you write."),
  },
  {
    target: '[data-tour="run"]',
    title: t("Run"),
    body: t("F5 compiles and runs what is open: a Java class, a Python script, a C program, a web page in the preview, a SQL script. Output and errors appear in the panel at the bottom."),
  },
  {
    target: ".statusbar",
    title: t("The status bar"),
    body: t("Errors and warnings, the Git branch, and the tool the open file runs with. Click an item to change it."),
  },
  {
    target: '[data-tour="help"]',
    title: t("Help is here"),
    body: t("The manual opens with F1, and Ctrl+K lists the keyboard shortcuts. Settings are at the bottom of the rail on the left."),
  },
];

const SEEN_KEY = "logiq.tour";

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "done";
  } catch {
    return true;
  }
}

function rememberTour() {
  try {
    localStorage.setItem(SEEN_KEY, "done");
  } catch {
    // Shown again next time.
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CARD_WIDTH = 352;
const GAP = 14;

export function Tour() {
  const on = useStore((s) => s.tour);
  const blocked = useStore((s) => !!s.dialog);
  if (!on || blocked) return null;
  return <TourCards />;
}

function TourCards() {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const finish = useCallback(() => {
    rememberTour();
    set({ tour: false });
  }, []);

  const measure = useCallback(() => {
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    const r = el?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return setBox(null);
    // A part as large as the window is shown by its edge only.
    const x = Math.max(4, r.left - 6);
    const y = Math.max(4, r.top - 6);
    setBox({ x, y, w: Math.min(window.innerWidth - 4, r.right + 6) - x, h: Math.min(window.innerHeight - 4, r.bottom + 6) - y });
  }, [step]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight);
    card.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [index, box]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "Enter" || e.key === " " || e.key === "Tab") return;
      // No other key reaches the window behind the tour.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finish]);

  // The card goes below the part, or above it, or beside it: wherever there is room; else over its middle.
  let style: React.CSSProperties = {};
  let centred = !box;
  if (box) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(12, Math.min(vw - CARD_WIDTH - 12, x));
    const clampY = (y: number) => Math.max(12, Math.min(vh - cardHeight - 12, y));
    if (box.y + box.h + GAP + cardHeight <= vh - 12) style = { left: clampX(box.x), top: box.y + box.h + GAP };
    else if (box.y - GAP - cardHeight >= 12) style = { left: clampX(box.x), top: box.y - GAP - cardHeight };
    else if (box.x + box.w + GAP + CARD_WIDTH <= vw - 12) style = { left: box.x + box.w + GAP, top: clampY(box.y) };
    else if (box.x - GAP - CARD_WIDTH >= 12) style = { left: box.x - GAP - CARD_WIDTH, top: clampY(box.y) };
    else centred = true;
  }

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={t("Tour")}>
      {box ? <div className="tour-spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} /> : <div className="tour-dim" />}
      <div ref={card} className={centred ? "tour-card is-centred" : "tour-card"} style={{ ...(centred ? {} : style), width: CARD_WIDTH }}>
        <p className="eyebrow">{t("Step {0} of {1}", index + 1, STEPS.length)}</p>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className={i === index ? "tour-dot is-current" : "tour-dot"} />
            ))}
          </div>
          {!last && (
            <Button appearance="subtle" spacing="compact" onClick={finish}>
              {t("Skip")}
            </Button>
          )}
          {index > 0 && (
            <Button spacing="compact" onClick={() => setIndex(index - 1)}>
              {t("Back")}
            </Button>
          )}
          <Button appearance="primary" spacing="compact" data-autofocus onClick={() => (last ? finish() : setIndex(index + 1))}>
            {last ? t("Done") : t("Next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
