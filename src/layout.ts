/**
 * Shared paths and layout rules for the export/ <-> source/ conversion. Derived from
 * PdoxLetters' scripts/common.py, with one source folder per app instead of a
 * single source/.
 *
 * <project>/
 *   export/<name>.json     the Retool app export (as downloaded from Retool); any number
 *   source/<name>/         one folder per export, named after the export file
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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isObject, parseJson, stringifyJson, type Json, type JsonObject } from "./json.js";

export interface Paths {
  root: string;
  /** App name: the export file name without .json, and the folder under source/. */
  name: string;
  exportDir: string;
  sourceDir: string;
  pluginsDir: string;
  manifestFile: string;
  wrapperFile: string;
  appFile: string;
}

const JSON_EXT = process.platform === "win32" ? /\.json$/i : /\.json$/;

/** The app name for an export file: its file name without .json. */
export const appName = (exportFile: string) => basename(exportFile).replace(JSON_EXT, "");

export function projectPaths(root: string | undefined, name: string): Paths {
  root = resolve(root ?? ".");
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw new Error(`Invalid app name ${JSON.stringify(name)}`);
  const sourceDir = join(root, "source", name);
  return {
    root,
    name,
    exportDir: join(root, "export"),
    sourceDir,
    pluginsDir: join(sourceDir, "plugins"),
    manifestFile: join(sourceDir, "manifest.json"),
    wrapperFile: join(sourceDir, "export.json"),
    appFile: join(sourceDir, "app.json"),
  };
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
const listDir = (dir: string) => {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith(".")).sort();
  } catch {
    return []; // A missing directory has nothing in it.
  }
};

/** The *.json files in <root>/export/. */
export function listExportFiles(root?: string): string[] {
  const dir = join(resolve(root ?? "."), "export");
  return listDir(dir).filter((f) => JSON_EXT.test(f)).map((f) => join(dir, f)).filter(isFile);
}

/** Names of the imported apps: folders in <root>/source/ holding a manifest.json. */
export function listApps(root?: string): string[] {
  const dir = join(resolve(root ?? "."), "source");
  return listDir(dir).filter((f) => isFile(join(dir, f, "manifest.json")));
}

/** A note about a source/ from before per-app folders, if there is one. */
export function legacyLayoutNote(root?: string): string | undefined {
  const old = join(resolve(root ?? "."), "source", "manifest.json");
  if (!isFile(old)) return undefined;
  return `${old} is from the old single-app layout, which is no longer read; delete source/manifest.json, ` +
    "app.json, export.json and plugins/ and re-run unretool import";
}

/**
 * Finds an export from a command line argument: a path to a file, or an app name
 * meaning export/<name>.json.
 */
export function resolveExportFile(root: string | undefined, arg: string): string {
  if (isFile(arg)) return resolve(arg);
  const named = join(resolve(root ?? "."), "export", JSON_EXT.test(arg) ? arg : `${arg}.json`);
  if (isFile(named)) return named;
  throw new Error(`No export file ${arg} (looked for ${resolve(arg)} and ${named})`);
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
