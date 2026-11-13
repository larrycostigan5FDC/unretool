/**
 * Shared paths and layout rules for the export/ <-> source/ conversion. Matches
 * PdoxLetters' scripts/common.py, so either tool can read the other's files.
 *
 * <project>/
 *   export/<name>.json     the Retool app export (as downloaded from Retool)
 *   source/
 *     manifest.json        name of the export file this source maps to
 *     export.json          export wrapper (uuid, page metadata, changes record);
 *                          page.data.appState is replaced by APP_STATE_MARKER
 *     app.json             decoded appState (app settings); the plugins map is
 *                          replaced by {"$pluginOrder": [ids...]}
 *     plugins/<id>.json    one decoded plugin (component, query, state, ...)
 *     plugins/<id>.<field>.<ext>  (or <id>.<ext> when field == ext, e.g. html4.css)
 *                          code fields (SQL, JS, CSS, HTML, multi-line text)
 *                          pulled out of the plugin template; the JSON holds
 *                          {"$file": "<id>.<field>.<ext>"} in their place
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isObject, parseJson, stringifyJson, type Json, type JsonObject } from "./json.js";

export interface Paths {
  root: string;
  exportDir: string;
  sourceDir: string;
  pluginsDir: string;
  manifestFile: string;
  wrapperFile: string;
  appFile: string;
}

export function projectPaths(root = "."): Paths {
  root = resolve(root);
  const sourceDir = join(root, "source");
  return {
    root,
    exportDir: join(root, "export"),
    sourceDir,
    pluginsDir: join(sourceDir, "plugins"),
    manifestFile: join(sourceDir, "manifest.json"),
    wrapperFile: join(sourceDir, "export.json"),
    appFile: join(sourceDir, "app.json"),
  };
}

export const APP_STATE_MARKER = "$appState: see app.json";
export const PLUGIN_ORDER_KEY = "$pluginOrder";
export const FILE_REF_KEY = "$file";

/** Template fields that are always extracted when they hold a non-empty string. */
const CODE_FIELDS = new Set(["query", "transformer", "css", "html", "javascript", "funcBody", "script"]);

export function fieldExtension(subtype: Json | undefined, field: string): string {
  if (field === "query") {
    if (typeof subtype === "string" && subtype.includes("Sql")) return "sql";
    if (subtype === "JavascriptQuery" || subtype === "Function") return "js";
    return "txt";
  }
  if (field === "transformer" || field === "javascript" || field === "funcBody" || field === "script") return "js";
  if (field === "css" || field === "html") return field;
  return "txt";
}

export function shouldExtract(field: string, value: Json): value is string {
  return typeof value === "string" && value !== "" && (CODE_FIELDS.has(field) || value.includes("\n"));
}

/** Plugin ids are JS identifiers (optionally prefixed with "$"), which are safe file names everywhere. */
export const pluginFileStem = (pluginId: string) => pluginId;

/** The template field map of a decoded plugin record, if it has one. */
export function getTemplate(record: JsonObject): JsonObject | undefined {
  const tpl = record.get("template");
  if (isObject(tpl)) {
    const fields = tpl.get("~#iM");
    if (isObject(fields)) return fields;
  }
  return undefined;
}

/** The record ({"n": ..., "v": {...}}) value inside {"~#iR": ...}, if it is one. */
export function recordValue(v: Json | undefined): JsonObject | undefined {
  const r = isObject(v) ? v.get("~#iR") : undefined;
  const value = isObject(r) ? r.get("v") : undefined;
  return isObject(value) ? value : undefined;
}

/** Follows a chain of object keys, failing with the path that was missing. */
export function getPath(v: Json, keys: string[], what: string): Json {
  let cur: Json | undefined = v;
  for (let i = 0; i < keys.length; i++) {
    cur = isObject(cur) ? cur.get(keys[i]) : undefined;
    if (cur === undefined) throw new Error(`${what}: missing ${keys.slice(0, i + 1).map((k) => `[${JSON.stringify(k)}]`).join("")}`);
  }
  return cur!;
}

/** Joins a file name from a $file ref onto dir, refusing names that leave it. */
export function insideDir(dir: string, name: string): string {
  const full = resolve(dir, name);
  const rel = relative(dir, full);
  if (isAbsolute(name) || rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${JSON.stringify(name)} points outside ${dir}`);
  }
  return full;
}

export function readJson(file: string): Json {
  const text = readText(file);
  try {
    return parseJson(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

export function writeJson(file: string, value: Json) {
  writeText(file, stringifyJson(value, 2) + "\n");
}

/** Reads a file with its line endings exactly as stored. */
export function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`Cannot read ${file}`);
  }
}

export function writeText(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}
