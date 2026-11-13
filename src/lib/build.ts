/*
 * Maven and Gradle: which tool the open folder uses, and its tasks, which
 * run in the terminal (compiling for Run and Debug happens in the native
 * compile step, which saves the tool's class path).
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { get as getApp, toast, useStore } from "./store";
import { events } from "./api";
import { runProgramInTerminal } from "./terminals";
import { t } from "./i18n";

export interface BuildInfo {
  tool: "maven" | "gradle";
  wrapper: boolean;
  program: string | null;
}

export const useBuild = create<{ info: BuildInfo | null }>(() => ({ info: null }));

export function toolName(info: BuildInfo | null) {
  return info?.tool === "maven" ? "Maven" : info?.tool === "gradle" ? "Gradle" : "";
}

export async function loadBuildInfo() {
  const root = getApp().root;
  const info = root ? await invoke<BuildInfo | null>("build_info", { root }).catch(() => null) : null;
  useBuild.setState({ info });
}

/** The common tasks of each tool, with what they do. */
export const TASKS: Record<BuildInfo["tool"], { task: string[]; label: string }[]> = {
  maven: [
    { task: ["compile"], label: "Compile" },
    { task: ["test"], label: "Run the tests" },
    { task: ["package"], label: "Package (JAR in target/)" },
    { task: ["install"], label: "Install into the local repository" },
    { task: ["clean"], label: "Clean (delete target/)" },
    { task: ["dependency:tree"], label: "Show the dependencies" },
  ],
  gradle: [
    { task: ["build"], label: "Build" },
    { task: ["test"], label: "Run the tests" },
    { task: ["run"], label: "Run (application plugin)" },
    { task: ["jar"], label: "Package (JAR in build/libs/)" },
    { task: ["clean"], label: "Clean (delete build/)" },
    { task: ["dependencies", "--configuration", "runtimeClasspath"], label: "Show the dependencies" },
  ],
};

/** Runs a Maven goal or Gradle task in the terminal, in the project folder. */
export async function runBuildTask(task: string[]) {
  const info = useBuild.getState().info;
  const root = getApp().root;
  if (!info || !root) return;
  if (!info.program) {
    toast(
      "error",
      t("{0} wasn't found", toolName(info)),
      info.tool === "maven"
        ? t("Install Maven (maven.apache.org) and add its bin folder to the PATH, or add the Maven Wrapper (mvnw.cmd) to the project.")
        : t("Install Gradle (gradle.org) and add its bin folder to the PATH, or add the Gradle Wrapper (gradlew.bat) to the project."),
    );
    return;
  }
  await runProgramInTerminal(info.program, info.tool === "maven" ? ["-Dstyle.color=always", ...task] : task, { cwd: root });
}

/** Keeps the build tool in step with the open folder and its build files. */
export function initBuild() {
  let last: string | null = null;
  useStore.subscribe((s) => {
    if (s.root !== last) {
      last = s.root;
      void loadBuildInfo();
    }
  });
  last = getApp().root;
  void loadBuildInfo();
  void events.onFsChanged((paths) => {
    if (paths.some((p) => /[\\/](pom\.xml|(build|settings)\.gradle(\.kts)?|mvnw(\.cmd)?|gradlew(\.bat)?)$/i.test(p))) void loadBuildInfo();
  });
}
