/*
 * The object bench, as in BlueJ and the Röhner editor: create objects of the
 * project's classes, call their methods with arguments, and see their fields
 * change. The objects live in a JVM run by the native side; every answer
 * carries the whole bench, so this store just mirrors it.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { errorText } from "../lib/api";
import { appendOutput, get as getApp, toast } from "../lib/store";
import { compileJava } from "../lib/actions";
import { t } from "../lib/i18n";
import { javaIndex } from "./javaIndex";
import { simpleType } from "./javaParser";
import type { JMethod, JType } from "./model";

export interface BenchField {
  name: string;
  type: string;
  value: string;
  static: boolean;
  owner: string;
  ref?: string;
}

export interface BenchObject {
  name: string;
  cls: string;
  simple: string;
  fields: BenchField[];
}

export interface BenchValue {
  text: string;
  type: string;
  ref?: string;
  keepable?: boolean;
}

interface Answer {
  ok: boolean;
  error?: string;
  value?: BenchValue;
  out?: string;
  objects: BenchObject[];
}

export interface BenchResult {
  call: string;
  value?: BenchValue;
  error?: string;
  void?: boolean;
}

interface BenchState {
  status: "off" | "starting" | "ready" | "busy";
  objects: BenchObject[];
  /** The Java code version the bench was started with. */
  codeVersion: number;
  result: BenchResult | null;
  /** A card highlighted from a reference. */
  focus: string | null;
}

export const useBench = create<BenchState>(() => ({ status: "off", objects: [], codeVersion: -1, result: null, focus: null }));
const set = useBench.setState;
const get = useBench.getState;

/** `java.util.List<Shape>` → `List`, `int...` → `int[]`: how the JVM names parameter types. */
export function erasure(type: string): string {
  let s = type.trim().replace(/<.*>/g, "");
  s = s.replace(/\.\.\.$/, "[]");
  const dims = (s.match(/\[\]/g) ?? []).length;
  const base = s.replace(/\[\]/g, "").trim();
  const simple = base.slice(base.lastIndexOf(".") + 1);
  return simple + "[]".repeat(dims);
}

function field(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\u001f/g, " ");
}

export function encode(parts: string[]): string {
  return parts.map(field).join("\u001f");
}

function apply(a: Answer) {
  set({ objects: a.objects });
  if (a.out) appendOutput("stdout", a.out);
}

export function isStale(): boolean {
  return get().status !== "off" && get().codeVersion !== javaIndex.version;
}

/** Compiles the project and starts a fresh, empty bench. */
export async function startBench(): Promise<boolean> {
  const root = getApp().root;
  if (!root) return false;
  set({ status: "starting", result: null });
  const version = javaIndex.version;
  if (!(await compileJava(true))) {
    set({ status: "off" });
    return false;
  }
  try {
    const jdk = getApp().settings.jdkHome || getApp().jdks[0]?.home || null;
    const a = JSON.parse(await invoke<string>("bench_start", { root, jdkHome: jdk })) as Answer;
    set({ status: "ready", objects: a.objects, codeVersion: version, focus: null });
    appendOutput("system", t("Object bench ready.") + "\n");
    return true;
  } catch (e) {
    set({ status: "off" });
    toast("error", t("The object bench didn't start"), errorText(e));
    return false;
  }
}

export async function stopBench() {
  await invoke("bench_stop").catch(() => {});
  set({ status: "off", objects: [], result: null, focus: null });
}

async function ensure(): Promise<boolean> {
  if (get().status === "busy" || get().status === "starting") {
    toast("info", t("The object bench is busy"), t("Wait for the running call, or reset the bench."));
    return false;
  }
  if (get().status === "ready" && !isStale()) return true;
  // New code: the objects of the old classes can't be kept.
  if (get().status === "ready" && get().objects.length) toast("info", t("The bench restarted with the changed code"), t("The objects of the old code are gone."));
  return startBench();
}

async function send(parts: string[], call: string, isVoid = false): Promise<Answer | null> {
  set({ status: "busy" });
  try {
    const a = JSON.parse(await invoke<string>("bench_send", { request: encode(parts) })) as Answer;
    set({ status: "ready" });
    apply(a);
    set({ result: a.ok ? { call, value: a.value, void: isVoid && !a.value } : { call, error: a.error } });
    return a;
  } catch (e) {
    const msg = errorText(e);
    if (msg === "timeout") {
      set({ result: { call, error: t("Still running after 15 seconds. Reset the bench to stop it.") } });
    } else {
      set({ status: "off", objects: [], result: { call, error: msg === "stopped" ? t("The bench stopped (did the program call System.exit?).") : msg } });
      return null;
    }
    return null;
  }
}

export function suggestName(cls: string): string {
  const base = cls[0].toLowerCase() + cls.slice(1);
  const taken = new Set(get().objects.map((o) => o.name));
  for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

export function paramList(m: JMethod | null): string {
  return (m?.params ?? []).map((p) => erasure(p.type)).join(",");
}

export async function benchNew(type: JType, ctor: JMethod | null, args: string[], name: string) {
  if (!(await ensure())) return;
  const call = `new ${type.name}(${args.join(", ")})`;
  const a = await send(["new", name, type.qualifiedName, paramList(ctor), ...args], call, true);
  if (a?.ok) set({ result: { call: `${name} = ${call}`, void: true }, focus: name });
}

export async function benchCall(target: string | null, owner: JType, m: JMethod, args: string[]) {
  if (!(await ensure())) return;
  if (target && !get().objects.some((o) => o.name === target)) return;
  const call = `${target ?? owner.name}.${m.name}(${args.join(", ")})`;
  await send(["call", target ?? "", owner.qualifiedName, m.name, paramList(m), ...args], call, m.returnType === "void");
}

export async function benchKeep(name: string) {
  const a = await send(["keep", name], "");
  if (a?.ok) set({ result: null, focus: name });
}

export async function benchRemove(name: string) {
  if (get().status !== "ready") return;
  await send(["remove", name], "");
  set({ result: null });
}

export function focusObject(name: string | null) {
  set({ focus: name });
}

/** The methods an object can be asked to run: its class's and its supertypes' (not static, not constructors). */
export function methodsFor(clsQualified: string): { owner: JType; method: JMethod }[] {
  const types = javaIndex.types();
  const out: { owner: JType; method: JMethod }[] = [];
  const seen = new Set<string>();
  const visit = (q: string) => {
    const t2 = types.find((x) => x.qualifiedName === q || x.name === q);
    if (!t2 || seen.has(t2.qualifiedName)) return;
    seen.add(t2.qualifiedName);
    for (const m of t2.methods) {
      if (m.isConstructor || m.isStatic || m.isAbstract) continue;
      const sig = `${m.name}(${paramList(m)})`;
      if (out.some((o) => `${o.method.name}(${paramList(o.method)})` === sig)) continue;
      out.push({ owner: t2, method: m });
    }
    for (const s of [...t2.extends, ...t2.implements]) visit(simpleType(s).replace(/<.*/, ""));
  };
  visit(clsQualified);
  return out;
}

export function describeMethod(m: JMethod): string {
  const ps = m.params.map((p) => `${simpleType(p.type)} ${p.name}`).join(", ");
  return `${m.name}(${ps})${m.returnType && m.returnType !== "void" ? `: ${simpleType(m.returnType)}` : ""}`;
}
