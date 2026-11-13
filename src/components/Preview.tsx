import { useEffect, useRef, useState } from "react";
import { ExternalLink, Monitor, RotateCw, Smartphone, Tablet, X } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { previewUrl } from "../lib/api";
import { set, useStore } from "../lib/store";
import { relative } from "../lib/paths";
import { IconButton } from "./ui/Button";

const WIDTHS = { full: null, tablet: 768, phone: 390 } as const;

/*
 * The live web preview: the open folder is served on its own origin, so the
 * page loads its CSS, scripts and images by their relative paths. It reloads
 * when a page, style sheet or script is saved.
 */
export function Preview() {
  const root = useStore((s) => s.root);
  const path = useStore((s) => s.previewPath);
  const nonce = useStore((s) => s.previewNonce);
  const [device, setDevice] = useState<keyof typeof WIDTHS>("full");
  const frame = useRef<HTMLIFrameElement>(null);

  const rel = root && path ? relative(root, path) : "";
  const src = rel ? previewUrl(rel) : "about:blank";

  useEffect(() => {
    // Reload in place so the page keeps its scroll position where it can.
    const f = frame.current;
    if (!f || !nonce) return;
    try {
      f.contentWindow?.location.reload();
    } catch {
      f.src = src;
    }
  }, [nonce]);

  return (
    <section className="preview panel" aria-label="Web preview">
      <div className="preview-head">
        <span className="preview-url" data-tooltip={rel} data-tooltip-overflow>
          {rel || "No page"}
        </span>
        <div className="segmented preview-devices" role="group" aria-label="Width">
          {(
            [
              ["full", Monitor, "Full width"],
              ["tablet", Tablet, "Tablet (768 px)"],
              ["phone", Smartphone, "Phone (390 px)"],
            ] as const
          ).map(([k, Icon, label]) => (
            <button key={k} type="button" className={`segment${device === k ? " is-selected" : ""}`} aria-label={label} aria-pressed={device === k} data-tooltip={label} onClick={() => setDevice(k)}>
              <Icon size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
        <IconButton icon={RotateCw} label="Reload" spacing="compact" onClick={() => set((s) => ({ previewNonce: s.previewNonce + 1 }))} />
        <IconButton icon={ExternalLink} label="Open the file in the browser" spacing="compact" disabled={!path} onClick={() => path && openPath(path).catch(() => {})} />
        <IconButton icon={X} label="Close preview" spacing="compact" onClick={() => set({ previewOpen: false })} />
      </div>
      <div className="preview-stage">
        <iframe
          ref={frame}
          key={src}
          title="Web preview"
          className="preview-frame"
          src={src}
          style={WIDTHS[device] ? { width: WIDTHS[device]!, flex: "none" } : undefined}
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
        />
      </div>
    </section>
  );
}
