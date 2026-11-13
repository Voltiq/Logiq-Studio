import { useRef } from "react";

/*
 * A thin handle between two areas. Dragging reports the new size; the
 * caller clamps and stores it. Arrow keys resize too.
 */
export function Resizer({
  axis,
  size,
  min,
  max,
  invert,
  label,
  onResize,
}: {
  axis: "x" | "y";
  size: number;
  min: number;
  max: number;
  /** The area grows when the pointer moves left / up. */
  invert?: boolean;
  label: string;
  onResize: (size: number) => void;
}) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)));

  return (
    <div
      className={`resizer resizer-${axis}`}
      role="separator"
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { pos: axis === "x" ? e.clientX : e.clientY, size };
        document.body.classList.add(axis === "x" ? "is-resizing-cols" : "is-resizing-rows");
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const delta = (axis === "x" ? e.clientX : e.clientY) - start.current.pos;
        onResize(clamp(start.current.size + (invert ? -delta : delta)));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove("is-resizing-cols", "is-resizing-rows");
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const grow = axis === "x" ? (invert ? "ArrowLeft" : "ArrowRight") : invert ? "ArrowUp" : "ArrowDown";
        const shrink = axis === "x" ? (invert ? "ArrowRight" : "ArrowLeft") : invert ? "ArrowDown" : "ArrowUp";
        if (e.key === grow) onResize(clamp(size + step));
        else if (e.key === shrink) onResize(clamp(size - step));
        else return;
        e.preventDefault();
      }}
    />
  );
}
