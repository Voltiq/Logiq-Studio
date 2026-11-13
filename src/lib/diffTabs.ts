/*
 * Diff tabs: a file's changes, side by side. Each tab knows how to load its
 * two sides, so a diff of the working tree follows edits and commits.
 */
import { create } from "zustand";
import { api } from "./api";
import { getDoc } from "../editor/docs";
import { openViewTab } from "./actions";
import { basename } from "./paths";
import { t } from "./i18n";
import { absPath, headText, relPath, showFile, type ChangedFile, type Commit } from "./git";

export interface DiffSides {
  left: string;
  right: string;
}

export interface DiffSource {
  /** The file, for its language and "Open file". */
  path: string;
  leftLabel: string;
  rightLabel: string;
  /** Whether the right side is the file as it is now (it is reloaded as the file changes). */
  live: boolean;
  load: () => Promise<DiffSides>;
}

const sources = new Map<string, DiffSource>();

/** Bumped when a diff tab is opened again, so it reloads. */
export const useDiffs = create<{ nonce: number }>(() => ({ nonce: 0 }));

export function diffSource(id: string): DiffSource | undefined {
  return sources.get(id);
}

function open(id: string, title: string, src: DiffSource) {
  sources.set(id, src);
  useDiffs.setState((s) => ({ nonce: s.nonce + 1 }));
  openViewTab({ id, kind: "diff", path: src.path, title, dirty: false });
}

async function currentText(abs: string): Promise<string> {
  const doc = getDoc(abs);
  if (doc) return doc.state.doc.toString();
  return (await api.readText(abs).catch(() => ({ text: "" }))).text.replace(/\r\n/g, "\n");
}

/**
 * A file's changes in the working tree: against the staged copy (or the last
 * commit), or, for staged changes, the staged copy against the last commit.
 */
export function openWorkingDiff(abs: string, staged = false) {
  const rel = relPath(abs);
  if (!rel) return;
  const name = basename(abs);
  if (staged) {
    open(`diff:staged:${abs}`, t("{0} (staged)", name), {
      path: abs,
      leftLabel: "HEAD",
      rightLabel: t("Staged"),
      live: false,
      load: async () => ({ left: (await headText(abs)) ?? "", right: (await showFile(`:${rel}`)) ?? "" }),
    });
  } else {
    open(`diff:working:${abs}`, t("{0} (changes)", name), {
      path: abs,
      leftLabel: t("Last commit or staged"),
      rightLabel: t("Working copy"),
      live: true,
      load: async () => ({ left: (await showFile(`:${rel}`)) ?? (await headText(abs)) ?? "", right: await currentText(abs) }),
    });
  }
}

/** What a commit changed in one file, against its first parent. */
export function openCommitDiff(c: Commit, f: ChangedFile) {
  const name = basename(f.path);
  open(`diff:${c.hash}:${f.path}`, `${name} (${c.short})`, {
    path: absPath(f.path),
    leftLabel: c.parents[0] ? c.parents[0].slice(0, 7) : t("(nothing)"),
    rightLabel: c.short,
    live: false,
    load: async () => ({
      left: c.parents[0] && f.status !== "A" ? ((await showFile(`${c.hash}^:${f.orig ?? f.path}`)) ?? "") : "",
      right: f.status === "D" ? "" : ((await showFile(`${c.hash}:${f.path}`)) ?? ""),
    }),
  });
}
