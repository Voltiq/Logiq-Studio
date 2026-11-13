import { useEffect, useRef, useState } from "react";
import { ExternalLink, Monitor, RotateCw, Smartphone, Tablet, X } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { api, previewUrl } from "../lib/api";
import { getDoc } from "../editor/docs";
import { set, useStore } from "../lib/store";
import { relative } from "../lib/paths";
import { IconButton } from "./ui/Button";
import { t } from "../lib/i18n";

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
  const php = useStore((s) => s.phpServer);
  const [device, setDevice] = useState<keyof typeof WIDTHS>("full");
  const frame = useRef<HTMLIFrameElement>(null);

  const rel = root && path ? relative(root, path) : "";
  const markdown = !!path && /\.(md|markdown)$/i.test(path);
  // PHP pages come from PHP's web server, which serves the same folder.
  const phpRel = php && path && /\.(php|phtml)$/i.test(path) ? relative(php.root, path) : null;
  const src = phpRel !== null ? `http://127.0.0.1:${php!.port}/${phpRel.split("/").map(encodeURIComponent).join("/")}` : rel && !markdown ? previewUrl(rel) : "about:blank";
  const [md, setMd] = useState<string | null>(null);

  // Markdown renders from the editor's text as you type (or from disk when not open).
  useEffect(() => {
    if (!markdown || !path) return setMd(null);
    let last: unknown = null;
    let live = true;
    const render = async (text: string) => {
      const { marked } = await import("marked");
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
      const html = await marked.parse(text, { gfm: true });
      if (live) setMd(markdownPage(html, previewUrl(dir)));
    };
    const tick = () => {
      const doc = getDoc(path);
      if (doc && doc.state.doc !== last) {
        last = doc.state.doc;
        void render(doc.state.doc.toString());
      }
    };
    if (!getDoc(path)) api.readText(path).then((f) => render(f.text)).catch(() => {});
    tick();
    const timer = window.setInterval(tick, 350);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [markdown, path, rel, nonce]);

  useEffect(() => {
    // Reload in place so the page keeps its scroll position where it can.
    const f = frame.current;
    if (!f || !nonce || markdown) return;
    try {
      f.contentWindow?.location.reload();
    } catch {
      f.src = src;
    }
  }, [nonce]);

  return (
    <section className="preview panel" aria-label={t("Web preview")}>
      <div className="preview-head">
        <span className="preview-url" data-tooltip={rel} data-tooltip-overflow>
          {rel || t("No page")}
        </span>
        <div className="segmented preview-devices" role="group" aria-label={t("Width")}>
          {(
            [
              ["full", Monitor, t("Full width")],
              ["tablet", Tablet, t("Tablet (768 px)")],
              ["phone", Smartphone, t("Phone (390 px)")],
            ] as const
          ).map(([k, Icon, label]) => (
            <button key={k} type="button" className={`segment${device === k ? " is-selected" : ""}`} aria-label={label} aria-pressed={device === k} data-tooltip={label} onClick={() => setDevice(k)}>
              <Icon size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
        <IconButton icon={RotateCw} label={t("Reload")} spacing="compact" onClick={() => set((s) => ({ previewNonce: s.previewNonce + 1 }))} />
        <IconButton icon={ExternalLink} label={t("Open the file in the browser")} spacing="compact" disabled={!path} onClick={() => path && openPath(path).catch(() => {})} />
        <IconButton icon={X} label={t("Close preview")} spacing="compact" onClick={() => set({ previewOpen: false })} />
      </div>
      <div className="preview-stage">
        <iframe
          ref={frame}
          key={src}
          title={t("Web preview")}
          className="preview-frame"
          {...(markdown ? { srcDoc: md ?? "" } : { src })}
          style={WIDTHS[device] ? { width: WIDTHS[device]!, flex: "none" } : undefined}
          // Rendered Markdown runs no scripts; web pages do.
          sandbox={markdown ? "allow-popups" : "allow-scripts allow-forms allow-modals allow-popups allow-same-origin"}
        />
      </div>
    </section>
  );
}

function markdownPage(body: string, base: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${base}"><style>
body{margin:0;padding:28px 32px 60px;font:15px/1.65 system-ui,"Segoe UI",sans-serif;color:#111318;background:#fff;max-width:820px}
h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em}h1{font-size:1.9em;margin-top:0}h2{font-size:1.45em;border-bottom:1px solid #e2e5ea;padding-bottom:.25em}
a{color:#4a3bd6}code{font:13px/1.5 Consolas,"Cascadia Mono",monospace;background:#f2f3f6;padding:.1em .35em;border-radius:5px}
pre{background:#f5f6f8;border:1px solid #e2e5ea;border-radius:10px;padding:12px 14px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:.2em 1em;border-left:3px solid #c9c4ff;color:#4a505e}table{border-collapse:collapse}th,td{border:1px solid #e2e5ea;padding:6px 10px}
img{max-width:100%}hr{border:0;border-top:1px solid #e2e5ea}li+li{margin-top:.2em}input[type=checkbox]{margin-right:.4em}
</style></head><body>${body}</body></html>`;
}
