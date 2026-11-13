/**
 * export: rebuild Retool app export JSON in export/ from files in source/<name>/.
 * By default the file named in source/<name>/manifest.json is (over)written in
 * export/. Plugin order comes from "$pluginOrder" in source/<name>/app.json; plugin
 * files that are not listed there are appended at the end (with a warning).
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isObject, stringifyJson, type Json, type JsonObject } from "./json.js";
import {
  APP_STATE_MARKER, FILE_REF_KEY, PLUGIN_ORDER_KEY, getPath, getTemplate, insideDir, legacyLayoutNote, listApps,
  pluginFileStem, projectPaths, readJson, readText, recordValue, writeText, type Paths,
} from "./layout.js";
import { encode } from "./transit.js";

export interface ExportOptions {
  /** Project directory holding export/ and source/ (default: the current directory). */
  root?: string;
  /** Output path (default: export/<exportFile from manifest>). */
  output?: string;
  warn?: (message: string) => void;
}

export interface ExportResult {
  name: string;
  sourceDir: string;
  output: string;
  plugins: number;
}

function loadPlugin(paths: Paths, pluginId: string): Json {
  const plugin = readJson(join(paths.pluginsDir, `${pluginFileStem(pluginId)}.json`));
  const record = recordValue(plugin);
  const template = record && getTemplate(record);
  if (template) {
    for (const [field, value] of template) {
      if (isObject(value) && value.size === 1 && value.has(FILE_REF_KEY)) {
        const name = value.get(FILE_REF_KEY);
        if (typeof name !== "string") throw new Error(`${pluginId}.json: template.${field}.${FILE_REF_KEY} is not a string`);
        template.set(field, readText(insideDir(paths.pluginsDir, name)));
      }
    }
  }
  return plugin;
}

/** The export file named in source/<name>/manifest.json. */
export function manifestExportFile(paths: Paths): string {
  const file = getPath(readJson(paths.manifestFile), ["exportFile"], paths.manifestFile);
  if (typeof file !== "string") throw new Error(`${paths.manifestFile}: exportFile is not a string`);
  return join(paths.exportDir, file);
}

/**
 * Exports each named app (folders under source/), or every imported app when none
 * are named. output may only be given for a single app.
 */
export function exportApps(names: string[], options: ExportOptions = {}): ExportResult[] {
  const all = names.length ? names : listApps(options.root);
  if (!all.length) {
    const note = legacyLayoutNote(options.root);
    throw new Error(note ?? `No imported apps in ${join(resolve(options.root ?? "."), "source")}; run unretool import first`);
  }
  if (options.output !== undefined && all.length > 1) {
    throw new Error(`--output needs a single app, but there are ${all.length}: ${all.join(", ")}`);
  }
  return all.map((name) => exportApp(name, options));
}

export function exportApp(name: string, options: ExportOptions = {}): ExportResult {
  const paths = projectPaths(options.root, name);
  const output = resolve(options.output ?? manifestExportFile(paths));
  const { text, plugins } = buildExport(paths, options.warn);
  writeText(output, text);
  return { name, sourceDir: paths.sourceDir, output, plugins };
}

/** Builds the export file text for source/<name>/ without writing it. */
export function buildExport(paths: Paths, warn: (message: string) => void = () => {}): { text: string; plugins: number } {
  const appState = readJson(paths.appFile);
  const app = getPath(appState, ["~#iR", "v"], paths.appFile) as JsonObject;
  const listedOrder = getPath(app, ["plugins", PLUGIN_ORDER_KEY], paths.appFile);
  if (!Array.isArray(listedOrder) || !listedOrder.every((p): p is string => typeof p === "string")) {
    throw new Error(`${paths.appFile}: plugins.${PLUGIN_ORDER_KEY} should be a list of plugin ids`);
  }
  const order = [...listedOrder];

  const onDisk = readdirSync(paths.pluginsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
  const present = new Set(onDisk);
  const missing = order.filter((p) => !present.has(pluginFileStem(p)));
  if (missing.length) {
    throw new Error(`Plugins listed in app.json but missing from source/${paths.name}/plugins/: ${missing.join(", ")}`);
  }
  const listed = new Set(order.map(pluginFileStem));
  for (const p of onDisk.filter((p) => !listed.has(p))) {
    warn(`${p}.json is not in ${PLUGIN_ORDER_KEY}; appending it`);
    order.push(p);
  }

  const plugins: JsonObject = new Map();
  for (const pluginId of order) {
    const plugin = loadPlugin(paths, pluginId);
    const id = recordValue(plugin)?.get("id") ?? pluginId;
    if (id !== pluginId) {
      throw new Error(`Plugin file ${pluginId}.json has id ${stringifyJson(id)}; the file name must match the id.`);
    }
    plugins.set(pluginId, plugin);
  }
  app.set("plugins", new Map([["~#iOM", plugins]]));

  const wrapper = readJson(paths.wrapperFile);
  const data = getPath(wrapper, ["page", "data"], paths.wrapperFile) as JsonObject;
  if (data.get("appState") !== APP_STATE_MARKER) {
    warn("page.data.appState in export.json is not the marker; overwriting it");
  }
  data.set("appState", encode(appState));

  return { text: stringifyJson(wrapper), plugins: plugins.size };
}
