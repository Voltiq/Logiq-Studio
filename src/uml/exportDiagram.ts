/*
 * Exporting the class diagram. The export is drawn in print colours (white
 * boxes, dark lines) whatever the app's theme, with the Geist fonts
 * embedded, so it looks the same in a document, a browser or on paper.
 */
import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import geistMonoUrl from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";

const PRINT_CSS = `
.uml-shadow,.uml-hit,.uml-outline{display:none}
.uml-box{fill:#ffffff;stroke:#2b3038;stroke-width:1.1}
.uml-head{fill:#efedff}
.uml-sep{stroke:#2b3038;stroke-width:1}
.uml-title{fill:#111318;font:600 13px Geist,"Segoe UI",Arial,sans-serif}
.uml-title.is-abstract{font-style:italic}
.uml-stereo{fill:#4a505e;font:400 11px Geist,"Segoe UI",Arial,sans-serif}
.uml-member{fill:#111318;font:400 12px "Geist Mono",Consolas,monospace}
.uml-member.is-static{text-decoration:underline}
.uml-member.is-abstract{font-style:italic}
.uml-edge{fill:none;stroke:#2b3038;stroke-width:1.2}
.uml-edge.is-dashed{stroke-dasharray:6 4}
.uml-arrow-hollow{fill:#ffffff;stroke:#2b3038;stroke-width:1.2}
.uml-arrow-open{fill:none;stroke:#2b3038;stroke-width:1.2}
.uml-label{fill:#4a505e;font:400 11px Geist,"Segoe UI",Arial,sans-serif}
`;

let fontCss: Promise<string> | null = null;

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function fonts(): Promise<string> {
  fontCss ??= Promise.all([dataUrl(geistUrl), dataUrl(geistMonoUrl)])
    .then(
      ([sans, mono]) =>
        `@font-face{font-family:Geist;font-weight:100 900;src:url(${sans}) format("woff2")}` +
        `@font-face{font-family:"Geist Mono";font-weight:100 900;src:url(${mono}) format("woff2")}`,
    )
    .catch(() => "");
  return fontCss;
}

/** A standalone SVG document of the diagram's content group. */
export async function exportSvgString(content: SVGGElement, b: { x0: number; y0: number; x1: number; y1: number }): Promise<string> {
  const margin = 24;
  const clone = content.cloneNode(true) as SVGGElement;
  clone.removeAttribute("transform");
  clone.querySelectorAll(".is-dim,.is-hot,.is-selected").forEach((el) => el.classList.remove("is-dim", "is-hot", "is-selected"));
  const w = Math.ceil(b.x1 - b.x0 + margin * 2);
  const h = Math.ceil(b.y1 - b.y0 + margin * 2);
  const css = (await fonts()) + PRINT_CSS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${b.x0 - margin} ${b.y0 - margin} ${w} ${h}">` +
    `<style>${css}</style>` +
    `<rect x="${b.x0 - margin}" y="${b.y0 - margin}" width="${w}" height="${h}" fill="#ffffff"/>` +
    new XMLSerializer().serializeToString(clone).replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "") +
    `</svg>`
  );
}

/** Renders the SVG to a PNG at `scale` times its size. */
export async function exportPng(svg: string, scale: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The diagram couldn't be drawn."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
