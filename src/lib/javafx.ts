/*
 * JavaFX for a project: it doesn't come with the JDK, so OpenJFX is downloaded once into the project's
 * lib/javafx (asked first), where compiling, running and debugging find it on the module path.
 */
import { invoke } from "@tauri-apps/api/core";
import { errorText } from "./api";
import { get, openDialog, toast } from "./store";
import { t } from "./i18n";
import { join } from "./paths";

export const hasJavaFX = (root: string) => invoke<boolean>("javafx_find", { root }).catch(() => false);

/** Downloads OpenJFX into the project, after asking; true when the project has it (now or already). */
export async function ensureJavaFX(): Promise<boolean> {
  const root = get().root;
  if (!root) return false;
  if (await hasJavaFX(root)) return true;
  return new Promise((resolve) => {
    openDialog({
      kind: "confirm",
      title: t("Add JavaFX to the project?"),
      body: t(
        "JavaFX doesn't come with the JDK. Logiq Studio downloads OpenJFX 21 (base, graphics, controls and fxml, about 9.4 MB) from Maven Central into the project's lib/javafx folder, once; then the windows compile and run.",
      ),
      confirmLabel: t("Download JavaFX"),
      onConfirm: async () => {
        toast("info", t("Downloading JavaFX…"), t("About 9.4 MB from Maven Central."));
        try {
          await invoke<string>("javafx_download", { root });
          toast("success", t("JavaFX added"), t("In lib/javafx. JavaFX windows now compile and run."));
          const { loadDir } = await import("./actions");
          await loadDir(join(root, "lib")).catch(() => {});
          await loadDir(root).catch(() => {});
          resolve(true);
        } catch (e) {
          toast("error", t("JavaFX wasn't downloaded"), errorText(e));
          resolve(false);
        }
      },
      onCancel: () => resolve(false),
    });
  });
}

/** Compiler messages that say JavaFX is missing (`package javafx.fxml does not exist`). */
export const missesJavaFX = (output: string) => /package javafx\.[\w.]+ does not exist/.test(output);
