import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { dismissToast, useStore } from "../lib/store";
import { IconButton } from "./ui/Button";

const ICONS = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.appearance];
        return (
          <div key={t.id} className={`toast toast-${t.appearance}`} role={t.appearance === "error" ? "alert" : "status"}>
            <Icon size={16} className="toast-icon" aria-hidden="true" />
            <div className="toast-content">
              <p className="toast-title">{t.title}</p>
              {t.description && <p className="toast-description">{t.description}</p>}
            </div>
            <IconButton icon={X} label="Dismiss" spacing="compact" onClick={() => dismissToast(t.id)} />
          </div>
        );
      })}
    </div>
  );
}
