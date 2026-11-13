/**
 * The split directory layout:
 *
 *   export.json          RetoolAppExport. page.data.appState is "unretool:app:." and
 *                        each split module's appState is "unretool:app:modules/<name>".
 *   app.json             AppTemplate. plugins maps each id to "unretool:file:plugins/<id>.json";
 *                        preloadedAppJavaScript and appStyles may point to app.js / app.css.
 *   app.js, app.css      preloadedAppJavaScript and appStyles, when not empty.
 *   plugins/<id>.json    PluginTemplate. template.query may point to plugins/<id>.<sql|js|graphql>.
 *   transit.json         Transit tags and key orders per file, so compile can rebuild appState.
 *   modules/<name>/      The same app layout (app.json, plugins/, transit.json) for each module.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const EXPORT_FILE = "export.json";
export const APP_FILE = "app.json";
export const TRANSIT_FILE = "transit.json";
export const PLUGINS_DIR = "plugins";
export const MODULES_DIR = "modules";
export const APP_JS_FILE = "app.js";
export const APP_CSS_FILE = "app.css";

export const APP_REF = "unretool:app:";
export const FILE_REF = "unretool:file:";

/** Query languages that get their own file, by plugin subtype. */
export const QUERY_EXTENSIONS: Record<string, string> = {
  SqlQueryUnified: ".sql",
  SqlQuery: ".sql",
  JavascriptQuery: ".js",
  Function: ".js",
  GraphQLQuery: ".graphql",
};

export const isRef = (v: unknown): v is string =>
  typeof v === "string" && (v.startsWith(FILE_REF) || v.startsWith(APP_REF));

/** Resolves a ref's path inside base, refusing paths that leave it. */
export function refPath(base: string, ref: string, prefix: string): string {
  const rel = ref.slice(prefix.length);
  const full = resolve(base, rel);
  const inside = relative(base, full);
  if (isAbsolute(rel) || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`Reference "${ref}" points outside ${base}`);
  }
  return full;
}

/** Hands out file names that are safe on every OS and unique ignoring case. */
export class FileNames {
  private used = new Set<string>();
  take(name: string): string {
    let base = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_") || "_";
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = "_" + base;
    let candidate = base;
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) candidate = `${base}~${n}`;
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}

export function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`Cannot read ${file}`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

export function readText(file: string): string {
  if (!existsSync(file)) throw new Error(`Missing file ${file}`);
  return readFileSync(file, "utf8");
}

export function writeJson(file: string, value: unknown) {
  writeText(file, JSON.stringify(value, null, 2) + "\n");
}

export function writeText(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

export const posixJoin = (...parts: string[]) => join(...parts).replace(/\\/g, "/");
