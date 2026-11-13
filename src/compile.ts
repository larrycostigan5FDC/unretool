import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeAppState } from "./app-state.js";
import type { AppTemplate, PluginTemplate, RetoolAppExport } from "./retool-classic-export.js";
import { assertAppExport, assertPluginTemplate } from "./schema.js";
import { childPointer, emptyMeta, mergeMeta, type TransitMeta } from "./transit.js";
import {
  APP_FILE, APP_REF, EXPORT_FILE, FILE_REF, PLUGINS_DIR, TRANSIT_FILE, posixJoin, readJson, readText, refPath, writeText,
} from "./layout.js";

export interface CompileOptions {
  out?: string;
  force?: boolean;
  /** Notices about things compile did on its own (e.g. picking up a new plugin file). */
  warn?: (message: string) => void;
}

export interface CompileResult {
  out: string;
  plugins: number;
  modules: number;
}

export function defaultCompileFile(dir: string): string {
  return resolve(dir) + ".json";
}

/** Rebuilds the export as an object without writing it. */
export function compileExport(dir: string, warn: (m: string) => void = () => {}): { exported: RetoolAppExport; plugins: number; modules: number } {
  const exportFile = join(dir, EXPORT_FILE);
  const exported = readJson(exportFile) as RetoolAppExport;
  const appRef = exported?.page?.data?.appState;
  if (typeof appRef !== "string" || !appRef.startsWith(APP_REF)) {
    throw new Error(`${exportFile}: page.data.appState should be "${APP_REF}.", got ${JSON.stringify(appRef)}`);
  }
  let plugins = 0;
  const app = compileApp(refPath(dir, appRef, APP_REF), warn);
  exported.page.data.appState = app.appState;
  plugins += app.plugins;

  let modules = 0;
  for (const [key, mod] of Object.entries(exported.modules ?? {})) {
    const ref = mod?.page?.data?.appState;
    if (typeof ref !== "string" || !ref.startsWith(APP_REF)) continue;
    const moduleApp = compileApp(refPath(dir, ref, APP_REF), warn, `modules.${key}`);
    mod.page!.data.appState = moduleApp.appState;
    plugins += moduleApp.plugins;
    modules++;
  }

  assertAppExport(exported, `Compiled ${exportFile}`);
  return { exported, plugins, modules };
}

export function compileDir(dir: string, options: CompileOptions = {}): CompileResult {
  const out = options.out ?? defaultCompileFile(dir);
  if (existsSync(out) && !options.force) throw new Error(`${out} already exists (use --force to overwrite it)`);
  const { exported, plugins, modules } = compileExport(dir, options.warn);
  writeText(out, JSON.stringify(exported));
  return { out, plugins, modules };
}

function compileApp(dir: string, warn: (m: string) => void, label = "app"): { appState: string; plugins: number } {
  const app = readJson(join(dir, APP_FILE)) as Record<string, unknown>;
  const transitFile = join(dir, TRANSIT_FILE);
  const transit = (existsSync(transitFile) ? readJson(transitFile) : {}) as Record<string, TransitMeta>;
  if (!existsSync(transitFile)) warn(`${transitFile} is missing; Transit types will be guessed from nothing`);

  const refs = app.plugins;
  if (refs === null || typeof refs !== "object" || Array.isArray(refs)) {
    throw new Error(`${join(dir, APP_FILE)}: plugins should map plugin ids to "${FILE_REF}${PLUGINS_DIR}/<id>.json"`);
  }

  // Load plugins in app.json order, then any plugin files app.json doesn't list.
  const loaded: { id: string; file?: string; plugin: PluginTemplate }[] = [];
  const listed = new Set<string>();
  for (const [id, ref] of Object.entries(refs as Record<string, unknown>)) {
    if (typeof ref === "string" && ref.startsWith(FILE_REF)) {
      const file = ref.slice(FILE_REF.length);
      listed.add(file.toLowerCase());
      loaded.push({ id, file, plugin: loadPlugin(dir, ref) });
    } else {
      assertPluginTemplate(ref, `${join(dir, APP_FILE)}: plugins.${id}`);
      loaded.push({ id, plugin: ref });
    }
  }
  const pluginsDir = join(dir, PLUGINS_DIR);
  const extra = existsSync(pluginsDir)
    ? readdirSync(pluginsDir).filter((f) => f.endsWith(".json")).map((f) => posixJoin(PLUGINS_DIR, f)).sort()
    : [];
  for (const file of extra) {
    if (listed.has(file.toLowerCase())) continue;
    const plugin = loadPlugin(dir, FILE_REF + file);
    warn(`${label}: added ${file} (plugin "${plugin.id}"), which ${APP_FILE} doesn't list`);
    loaded.push({ id: plugin.id, file, plugin });
  }

  const meta: TransitMeta = structuredClone(transit[APP_FILE] ?? emptyMeta());
  const plugins: Record<string, PluginTemplate> = {};
  for (const { id, file, plugin } of loaded) {
    if (Object.prototype.hasOwnProperty.call(plugins, id)) throw new Error(`${label}: two plugins are named "${id}"`);
    plugins[id] = plugin;
    let pluginMeta = file ? transit[file] : undefined;
    if (!pluginMeta) {
      pluginMeta = guessMeta(plugin, loaded, transit);
      if (!pluginMeta) warn(`${label}: no Transit types for plugin "${id}"; it will be written as plain maps`);
    }
    if (pluginMeta) mergeMeta(meta, pluginMeta, childPointer("/plugins", id));
  }

  const template = { ...app, plugins } as AppTemplate;
  for (const key of ["preloadedAppJavaScript", "appStyles"] as const) {
    const v = template[key];
    if (typeof v === "string" && v.startsWith(FILE_REF)) template[key] = readText(refPath(dir, v, FILE_REF));
  }

  const appState = encodeAppState({ appTemplate: template }, meta, `${label} (${join(dir, APP_FILE)})`);
  return { appState, plugins: loaded.length };
}

function loadPlugin(dir: string, ref: string): PluginTemplate {
  const file = refPath(dir, ref, FILE_REF);
  const plugin = readJson(file) as PluginTemplate;
  const query = plugin?.template?.query;
  if (typeof query === "string" && query.startsWith(FILE_REF)) {
    plugin.template.query = readText(refPath(dir, query, FILE_REF));
  }
  assertPluginTemplate(plugin, file);
  return plugin;
}

/** Transit types for a plugin with no entry in transit.json, borrowed from the most similar plugin. */
function guessMeta(
  plugin: PluginTemplate,
  loaded: { file?: string; plugin: PluginTemplate }[],
  transit: Record<string, TransitMeta>,
): TransitMeta | undefined {
  const known = loaded.filter((l) => l.file && transit[l.file] && l.plugin !== plugin);
  const match =
    known.find((l) => l.plugin.subtype === plugin.subtype) ??
    known.find((l) => l.plugin.type === plugin.type) ??
    known[0];
  // Key orders are specific to the plugin they came from.
  return match ? { tags: transit[match.file!].tags, order: {} } : undefined;
}
