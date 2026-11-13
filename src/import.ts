/**
 * import: split Retool app exports (export/<name>.json) into files under
 * source/<name>/. source/<name>/plugins/ is regenerated from scratch; other files
 * in source/<name>/ that this command does not manage are left alone.
 */
import { mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isObject, type Json } from "./json.js";
import {
  APP_STATE_MARKER, FILE_REF_KEY, PLUGIN_ORDER_KEY, appName, fieldExtension, getPath, getTemplate, legacyLayoutNote,
  listExportFiles, pluginFileStem, projectPaths, readJson, recordValue, resolveExportFile, shouldExtract, writeJson,
  writeText, type Paths,
} from "./layout.js";
import { decode, encode } from "./transit.js";

export interface ImportOptions {
  /** Project directory holding export/ and source/ (default: the current directory). */
  root?: string;
  warn?: (message: string) => void;
}

export interface ImportResult {
  name: string;
  exportFile: string;
  sourceDir: string;
  plugins: number;
}

/** Writes one plugin to source/plugins/, extracting code fields. */
function splitPlugin(paths: Paths, pluginId: string, plugin: Json) {
  const stem = pluginFileStem(pluginId);
  const record = recordValue(plugin);
  const template = record && getTemplate(record);
  if (record && template) {
    for (const [field, value] of template) {
      if (!shouldExtract(field, value)) continue;
      const ext = fieldExtension(record.get("subtype"), field);
      const name = ext === field ? `${stem}.${ext}` : `${stem}.${field}.${ext}`;
      writeText(join(paths.pluginsDir, name), value);
      template.set(field, new Map([[FILE_REF_KEY, name]]));
    }
  }
  writeJson(join(paths.pluginsDir, `${stem}.json`), plugin);
}

/**
 * Imports each export given (paths, or app names meaning export/<name>.json), or
 * every *.json in export/ when none are given.
 */
export function importApps(exportFiles: string[], options: ImportOptions = {}): ImportResult[] {
  const note = legacyLayoutNote(options.root);
  if (note) options.warn?.(note);
  const files = exportFiles.length
    ? exportFiles.map((f) => resolveExportFile(options.root, f))
    : listExportFiles(options.root);
  if (!files.length) throw new Error(`No .json files in ${join(resolve(options.root ?? "."), "export")}`);
  const names = new Map<string, string>();
  for (const f of files) {
    const other = names.get(appName(f));
    if (other !== undefined && other !== f) throw new Error(`${other} and ${f} would both import to source/${appName(f)}/`);
    names.set(appName(f), f);
  }
  return [...names.values()].map((f) => importApp(f, options));
}

/** Imports one export file into source/<name>/, where name is the file name without .json. */
export function importApp(exportFile: string, options: ImportOptions = {}): ImportResult {
  const file = resolve(exportFile);
  const paths = projectPaths(options.root, appName(file));
  const wrapper = readJson(file);
  const appStateStr = getPath(wrapper, ["page", "data", "appState"], file);
  if (typeof appStateStr !== "string") throw new Error(`${file}: page.data.appState is not a string`);
  let appState: Json;
  try {
    appState = decode(appStateStr);
  } catch (err) {
    throw new Error(`${file}: page.data.appState is not valid Transit: ${(err as Error).message}`);
  }
  if (encode(appState) !== appStateStr) {
    throw new Error("Transit round-trip check failed; refusing to import (export would not be faithful).");
  }

  const app = getPath(appState, ["~#iR", "v"], "appState") as Map<string, Json>;
  const plugins = getPath(app, ["plugins", "~#iOM"], "appState.v");
  if (!isObject(plugins)) throw new Error("Unexpected plugins structure in appState.");

  mkdirSync(paths.sourceDir, { recursive: true });
  rmSync(paths.pluginsDir, { recursive: true, force: true });
  mkdirSync(paths.pluginsDir);

  for (const [pluginId, plugin] of plugins) splitPlugin(paths, pluginId, plugin);

  app.set("plugins", new Map([[PLUGIN_ORDER_KEY, [...plugins.keys()]]]));
  writeJson(paths.appFile, appState);

  (getPath(wrapper, ["page", "data"], file) as Map<string, Json>).set("appState", APP_STATE_MARKER);
  writeJson(paths.wrapperFile, wrapper);

  writeJson(paths.manifestFile, new Map([["exportFile", basename(file)]]));

  return { name: paths.name, exportFile: file, sourceDir: paths.sourceDir, plugins: plugins.size };
}
