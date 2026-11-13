import { languageFor, IMAGE_EXTENSIONS } from "../editor/languages";
import { extname } from "../lib/paths";

/*
 * A document icon with a folded corner and a coloured badge for its
 * language, or a folder in the accent. Drawn from the shared file-icon tokens.
 */
export function FileIcon({ name, folder, open, size = 16 }: { name: string; folder?: boolean; open?: boolean; size?: number }) {
  if (folder) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="file-icon">
        <path d="M1.5 4.2c0-.8.6-1.4 1.4-1.4h3.3l1.5 1.5h5.4c.8 0 1.4.6 1.4 1.4v6.6c0 .8-.6 1.4-1.4 1.4H2.9c-.8 0-1.4-.6-1.4-1.4z" fill="var(--folder-back)" />
        {open ? (
          <path d="M2.6 7.1c.1-.6.6-1 1.2-1h10.1c.7 0 1.2.6 1.1 1.3l-.8 4.6c-.1.6-.6 1-1.2 1H2.9c-.8 0-1.3-.7-1.2-1.4z" fill="var(--folder-front)" />
        ) : (
          <path d="M1.5 6.3c0-.6.5-1.1 1.1-1.1h10.8c.6 0 1.1.5 1.1 1.1v5.5c0 .8-.6 1.4-1.4 1.4H2.9c-.8 0-1.4-.6-1.4-1.4z" fill="var(--folder-front)" />
        )}
      </svg>
    );
  }
  const ext = extname(name);
  const lang = languageFor(name);
  const image = IMAGE_EXTENSIONS.has(ext);
  const color = image ? "var(--accent-purple)" : lang.color;
  const badge = image ? "" : lang.badge;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="file-icon">
      <path d="M3.5 1.5h6l3 3v9.2c0 .5-.4.8-.8.8H3.5c-.5 0-.8-.4-.8-.8V2.3c0-.5.4-.8.8-.8z" fill="var(--file-page)" stroke="var(--file-page-edge)" strokeWidth=".6" />
      <path d="M9.5 1.5v2.2c0 .4.4.8.8.8h2.2" fill="var(--file-fold)" />
      {badge ? (
        <>
          <rect x="1" y="8.2" width={badge.length > 1 ? 10.4 : 7.4} height="6" rx="1.6" fill={color} />
          <text
            x={badge.length > 1 ? 6.2 : 4.7}
            y="12.6"
            textAnchor="middle"
            fontSize={badge.length > 1 ? 4.6 : 5}
            fontWeight="700"
            fontFamily="var(--font-code)"
            fill="#fff"
          >
            {badge}
          </text>
        </>
      ) : image ? (
        <path d="M4.5 12.5l2.2-2.8 1.6 1.9 1.4-1.4 1.8 2.3z" fill={color} />
      ) : (
        <path d="M4.8 7.5h5M4.8 9.5h6M4.8 11.5h4" stroke="var(--file-ink)" strokeWidth=".9" strokeLinecap="round" />
      )}
    </svg>
  );
}
