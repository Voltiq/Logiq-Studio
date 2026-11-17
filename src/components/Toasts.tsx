import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { dismissToast, useStore } from "../lib/store";
import { IconButton } from "./ui/Button";
import { t } from "../lib/i18n";

const ICONS = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((x) => {
        const Icon = ICONS[x.appearance];
        return (
          <div key={x.id} className={`toast toast-${x.appearance}`} role={x.appearance === "error" ? "alert" : "status"}>
            <Icon size={16} className="toast-icon" aria-hidden="true" />
            <div className="toast-content">
              <p className="toast-title">{x.title}</p>
              {x.description && <p className="toast-description">{x.description}</p>}
              {x.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    dismissToast(x.id);
                    x.action!.run();
                  }}
                >
                  {x.action.label}
                </button>
              )}
            </div>
            <IconButton icon={X} label={t("Dismiss")} spacing="compact" onClick={() => dismissToast(x.id)} />
          </div>
        );
      })}
    </div>
  );
}
