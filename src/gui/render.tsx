import type { CSSProperties } from "react";
import { ChevronDown, ChevronUp, Image } from "lucide-react";
import type { GuiComponent } from "./model";

/*
 * How each component looks on the canvas: close to Swing with the Windows
 * look and feel the generated main method sets, in a neutral light theme
 * whatever the IDE's theme (the window will look like that when it runs).
 */

function textStyle(c: GuiComponent): CSSProperties {
  return {
    color: c.foreground,
    fontSize: c.fontSize ? `${c.fontSize}px` : undefined,
    fontWeight: c.bold ? 700 : undefined,
    fontStyle: c.italic ? "italic" : undefined,
  };
}

function Icon({ c }: { c: GuiComponent }) {
  return c.icon ? <Image size={Math.min(16, c.h - 4)} className="gw-icon" aria-hidden="true" /> : null;
}

export function ComponentView({ c }: { c: GuiComponent }) {
  const off = c.enabled === false ? " is-disabled" : "";
  const bg = c.background ? { background: c.background } : undefined;
  const items = c.items ?? [];
  const ratio = (v: number | undefined) => {
    const min = c.min ?? 0;
    const max = c.max ?? 100;
    return max > min ? Math.max(0, Math.min(1, ((v ?? min) - min) / (max - min))) : 0;
  };
  switch (c.type) {
    case "JButton":
      return (
        <div className={"gw gw-button" + off} style={{ ...textStyle(c), ...bg }}>
          <Icon c={c} />
          <span className="gw-text">{c.text}</span>
        </div>
      );
    case "JLabel":
      return (
        <div className={`gw gw-label is-${c.align ?? "left"}` + off + (c.text || c.icon || c.background ? "" : " is-empty")} style={{ ...textStyle(c), ...bg }}>
          <Icon c={c} />
          <span className="gw-text">{c.text || " "}</span>
        </div>
      );
    case "JTextField":
    case "JPasswordField":
      return (
        <div className={`gw gw-field is-${c.align ?? "left"}` + off + (c.editable === false ? " is-readonly" : "")} style={{ ...textStyle(c), ...bg }}>
          <span className="gw-text">{c.type === "JPasswordField" ? "••••••" : c.text}</span>
        </div>
      );
    case "JTextArea":
      return (
        <div className={"gw gw-area" + off} style={bg}>
          <span className="gw-area-text" style={{ ...textStyle(c), whiteSpace: c.lineWrap ? "pre-wrap" : "pre" }}>
            {c.text}
          </span>
          <span className="gw-scrollbar" />
        </div>
      );
    case "JCheckBox":
    case "JRadioButton":
      return (
        <div className={"gw gw-check" + off} style={{ ...textStyle(c), ...bg }}>
          <span className={c.type === "JCheckBox" ? "gw-box" : "gw-radio"}>{c.selected && <span className="gw-mark" />}</span>
          <span className="gw-text">{c.text}</span>
        </div>
      );
    case "JComboBox":
      return (
        <div className={"gw gw-combo" + off} style={{ ...textStyle(c), ...bg }}>
          <span className="gw-text">{items[0] ?? ""}</span>
          <span className="gw-combo-arrow">
            <ChevronDown size={12} aria-hidden="true" />
          </span>
        </div>
      );
    case "JList":
      return (
        <div className={"gw gw-list" + off} style={bg}>
          {items.map((x, i) => (
            <div key={i} className="gw-list-item" style={textStyle(c)}>
              {x}
            </div>
          ))}
        </div>
      );
    case "JSpinner":
      return (
        <div className={"gw gw-spinner" + off} style={textStyle(c)}>
          <span className="gw-text">{c.value ?? 0}</span>
          <span className="gw-spinner-arrows">
            <ChevronUp size={10} aria-hidden="true" />
            <ChevronDown size={10} aria-hidden="true" />
          </span>
        </div>
      );
    case "JSlider": {
      const r = ratio(c.value);
      const ticks = c.ticks && c.max !== undefined && c.min !== undefined && c.ticks > 0 ? Math.min(40, Math.floor((c.max - c.min) / c.ticks)) : 0;
      return (
        <div className={"gw gw-slider" + off} style={bg}>
          <span className="gw-slider-track" />
          <span className="gw-slider-thumb" style={{ left: `calc(${r * 100}% - ${r * 12}px)` }} />
          {ticks > 0 && (
            <span className="gw-slider-ticks">
              {Array.from({ length: ticks + 1 }, (_, i) => (
                <span key={i} className="gw-tick">
                  <span className="gw-tick-label">{(c.min ?? 0) + i * c.ticks!}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      );
    }
    case "JProgressBar": {
      const r = ratio(c.value);
      return (
        <div className={"gw gw-progress" + off} style={bg}>
          <span className="gw-progress-fill" style={{ width: `${r * 100}%`, background: c.foreground }} />
          {c.showText && <span className="gw-progress-text">{Math.round(r * 100)}%</span>}
        </div>
      );
    }
    case "JPanel":
      return (
        <div className={"gw gw-panel" + (c.border ? " has-border" : "")} style={bg}>
          {c.border && <span className="gw-panel-title">{c.border}</span>}
        </div>
      );
  }
}
