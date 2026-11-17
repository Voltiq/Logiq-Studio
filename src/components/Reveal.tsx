import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const DURATION = 240;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * A panel and its resize handle that slide in when opened and out when closed, the editor taking or giving
 * up the space as they go.
 *
 * At rest the wrapper takes no part in the layout (`display: contents`). While it moves, the panel keeps the
 * size it has open, so its content (a file tree, a terminal) doesn't reflow, and only the wrapper's size
 * changes; the part out of reach is clipped on the side the panel slides away to.
 */
export function Reveal({ open, axis, from, children }: { open: boolean; axis: "x" | "y"; from: "start" | "end"; children: ReactNode }) {
  const [shown, setShown] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const frozen = useRef<{ el: HTMLElement; css: string }[]>([]);
  const first = useRef(true);
  // Opening: render the panel first, the effect below then slides it in before it is painted.
  if (open && !shown) setShown(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      if (!open) setShown(false);
      return;
    }
    const prop = axis === "x" ? "width" : "height";
    // Turned around halfway: go on from where it is now.
    const moving = anim.current?.playState === "running";
    const now = moving ? el.getBoundingClientRect()[prop] : null;
    anim.current?.cancel();
    anim.current = null;
    const thaw = () => {
      for (const f of frozen.current) f.el.style.cssText = f.css;
      frozen.current = [];
      el.classList.remove("is-moving");
    };
    thaw();

    const inner = el.firstElementChild as HTMLElement;
    const parts = [...inner.children] as HTMLElement[];
    const sizes = parts.map((p) => p.getBoundingClientRect()[prop]);
    const full = sizes.reduce((a, b) => a + b, 0);
    if (!full) {
      if (!open) setShown(false);
      return;
    }
    frozen.current = parts.map((p) => ({ el: p, css: p.style.cssText }));
    parts.forEach((p, i) => {
      const size = `${sizes[i]}px`;
      p.style.flex = "none";
      p.style.setProperty(prop, size);
      p.style.setProperty(`min-${prop}`, size);
      p.style.setProperty(`max-${prop}`, "none");
    });
    el.classList.add("is-moving");

    const start = now ?? (open ? 0 : full);
    const end = open ? full : 0;
    const a = el.animate(
      [
        { [prop]: `${start}px`, opacity: open && now === null ? 0 : 1 },
        { [prop]: `${end}px`, opacity: open ? 1 : 0 },
      ],
      { duration: DURATION * (Math.abs(end - start) / full || 1), easing: EASING, fill: "forwards" },
    );
    anim.current = a;
    const done = () => {
      window.clearTimeout(late);
      if (anim.current !== a) return;
      anim.current = null;
      // Closed: it goes as it is; open: back to its own size, which is where it ended.
      if (!open) setShown(false);
      else {
        a.cancel();
        thaw();
      }
    };
    // A window that draws no frames (hidden, minimised) neither moves animations on nor reports their end:
    // end it all the same.
    const late = window.setTimeout(done, (a.effect?.getTiming().duration as number) + 200);
    a.oncancel = () => window.clearTimeout(late);
    a.onfinish = done;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => () => anim.current?.cancel(), []);

  if (!shown) return null;
  return (
    <div ref={ref} className={`reveal reveal-${axis} reveal-from-${from}`}>
      <div className="reveal-inner">{children}</div>
    </div>
  );
}
