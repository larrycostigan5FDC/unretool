import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { decodeAppState } from "./app-state.js";
import type { AppTemplate, RetoolAppExport } from "./retool-classic-export.js";
import { assertAppExport } from "./schema.js";
import { childPointer, subMeta, type TransitMeta } from "./transit.js";
import {
  APP_CSS_FILE, APP_FILE, APP_JS_FILE, APP_REF, EXPORT_FILE, FILE_REF, FileNames, MODULES_DIR, PLUGINS_DIR,
  QUERY_EXTENSIONS, TRANSIT_FILE, posixJoin, readJson, writeJson, writeText,
} from "./layout.js";

export interface SplitOptions {
  out?: string;
  force?: boolean;
}

export interface SplitResult {
  out: string;
  plugins: number;
  modules: number;
}

export function defaultSplitDir(input: string): string {
  return join(dirname(input), basename(input, extname(input)));
}

export function splitExport(input: string, options: SplitOptions = {}): SplitResult {
  const data = readJson(input);
  assertAppExport(data, input);
  const out = options.out ?? defaultSplitDir(input);
  prepareOutDir(out, options.force ?? false);

  const exported = structuredClone(data) as RetoolAppExport;
  let plugins = splitApp(out, data.page.data.appState, `${input}: page.data.appState`);
  exported.page.data.appState = APP_REF + ".";

  let modules = 0;
  const names = new FileNames();
  for (const [key, mod] of Object.entries(exported.modules)) {
    const appState = mod.page?.data.appState;
    if (typeof appState !== "string") continue;
    const rel = posixJoin(MODULES_DIR, names.take(key));
    plugins += splitApp(join(out, rel), appState, `${input}: modules.${key}.page.data.appState`);
    mod.page!.data.appState = APP_REF + rel;
    modules++;
  }

  writeJson(join(out, EXPORT_FILE), exported);
  return { out, plugins, modules };
}

/** Writes one app (or module) and returns its plugin count. */
function splitApp(dir: string, appState: string, what: string): number {
  const { state, meta } = decodeAppState(appState, what);
  const template = state.appTemplate;
  const names = new FileNames();
  const transit: Record<string, TransitMeta> = {};
  const appMeta: TransitMeta = { tags: { ...meta.tags }, order: { ...meta.order } };
  delete appMeta.tags[""]; // the appTemplate Record; compile adds it back

  const app: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) app[key] = value;

  const pluginRefs: Record<string, string> = {};
  for (const [id, plugin] of Object.entries(template.plugins)) {
    const base = names.take(id);
    const file = posixJoin(PLUGINS_DIR, `${base}.json`);
    const ptr = childPointer("/plugins", id);
    transit[file] = subMeta(meta, ptr);
    for (const p of Object.keys(appMeta.tags)) if (p === ptr || p.startsWith(ptr + "/")) delete appMeta.tags[p];
    for (const p of Object.keys(appMeta.order)) if (p === ptr || p.startsWith(ptr + "/")) delete appMeta.order[p];

    const out = { ...plugin, template: { ...plugin.template } };
    const query = plugin.template.query;
    const ext = QUERY_EXTENSIONS[plugin.subtype];
    if (typeof query === "string" && query !== "" && ext) {
      const queryFile = posixJoin(PLUGINS_DIR, base + ext);
      writeText(join(dir, queryFile), query);
      out.template.query = FILE_REF + queryFile;
    } else {
      refuseRefLike(query, `${what}: plugins.${id}.template.query`);
    }
    writeJson(join(dir, file), out);
    pluginRefs[id] = FILE_REF + file;
  }
  app.plugins = pluginRefs;

  extract(app, "preloadedAppJavaScript", APP_JS_FILE, dir, what);
  extract(app, "appStyles", APP_CSS_FILE, dir, what);

  writeJson(join(dir, APP_FILE), app);
  writeJson(join(dir, TRANSIT_FILE), { [APP_FILE]: appMeta, ...transit } satisfies Record<string, TransitMeta>);
  return Object.keys(template.plugins).length;
}

function extract(app: Record<string, unknown>, key: keyof AppTemplate & string, file: string, dir: string, what: string) {
  const value = app[key];
  if (typeof value === "string" && value !== "") {
    refuseRefLike(value, `${what}: ${key}`);
    writeText(join(dir, file), value);
    app[key] = FILE_REF + file;
  }
}

/** A real value that looks like one of our refs would be misread by compile. */
function refuseRefLike(value: unknown, what: string) {
  if (typeof value === "string" && value.startsWith("unretool:")) {
    throw new Error(`${what} starts with "unretool:", which unretool uses for file references`);
  }
}

function prepareOutDir(out: string, force: boolean) {
  if (!existsSync(out) || readdirSync(out).length === 0) return;
  if (!force) throw new Error(`${out} already exists and is not empty (use --force to replace it)`);
  // Only ever delete a directory that unretool created.
  if (!existsSync(join(out, EXPORT_FILE)) || !existsSync(join(out, TRANSIT_FILE))) {
    throw new Error(`${out} is not an unretool split directory, so --force won't delete it`);
  }
  rmSync(out, { recursive: true, force: true });
}
