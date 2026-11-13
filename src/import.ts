/**
 * import: split a Retool app export (export/*.json) into files under source/.
 * source/plugins/ is regenerated from scratch; other files in source/ that this
 * command does not manage are left alone.
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isObject, type Json } from "./json.js";
import {
  APP_STATE_MARKER, FILE_REF_KEY, PLUGIN_ORDER_KEY, fieldExtension, getPath, getTemplate, pluginFileStem, projectPaths,
  readJson, recordValue, shouldExtract, writeJson, writeText, type Paths,
} from "./layout.js";
import { decode, encode } from "./transit.js";

export interface ImportOptions {
  /** Project directory holding export/ and source/ (default: the current directory). */
  root?: string;
}

export interface ImportResult {
  exportFile: string;
  sourceDir: string;
  plugins: number;
}

export function findExportFile(paths: Paths): string {
  const isJson = process.platform === "win32" ? /\.json$/i : /\.json$/;
  let files: string[] = [];
  try {
    files = readdirSync(paths.exportDir)
      .filter((f) => !f.startsWith(".") && isJson.test(f) && statSync(join(paths.exportDir, f)).isFile())
      .sort();
  } catch {
    // A missing export/ is reported as finding no files.
  }
  if (files.length !== 1) {
    throw new Error(`Expected exactly one .json in ${paths.exportDir}, found ${files.length}; pass the file explicitly.`);
  }
  return join(paths.exportDir, files[0]);
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

export function importApp(exportFile?: string, options: ImportOptions = {}): ImportResult {
  const paths = projectPaths(options.root);
  const file = resolve(exportFile ?? findExportFile(paths));
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

  return { exportFile: file, sourceDir: paths.sourceDir, plugins: plugins.size };
}
