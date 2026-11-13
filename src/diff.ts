/**
 * diff: compare two Retool apps plugin by plugin (components, queries, state, ...)
 * and report what was added, removed and changed, as text or Markdown.
 *
 * Each side is an app name or a path to an export file. A name is read from
 * source/<name>/ when it has been imported (so unexported edits count), otherwise
 * from export/<name>.json. Fields that change on every save or copy (timestamps,
 * ids, the changes record) are left out so only real edits show.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { buildExport, manifestExportFile } from "./export.js";
import { isObject, parseJson, stringifyJson, type Json, type JsonObject } from "./json.js";
import { appName, getPath, projectPaths, recordValue, resolveExportFile } from "./layout.js";
import { lineDiff } from "./textdiff.js";
import { decode } from "./transit.js";

/** Plugin and app record fields that change without anyone editing them. */
const IGNORED_RECORD_FIELDS = new Set(["createdAt", "updatedAt"]);
/** Export wrapper paths that differ between copies of the same app. */
const IGNORED_WRAPPER_PATHS = [
  "uuid", "page.id", "page.pageId", "page.userId", "page.createdAt", "page.updatedAt", "page.changesRecord",
  "page.checksum", "page.data.appState",
];

export interface DiffOptions {
  root?: string;
  warn?: (message: string) => void;
}

export type Segment = string | number;

export interface Change {
  path: Segment[];
  kind: "added" | "removed" | "changed";
  before?: Json;
  after?: Json;
}

export interface PluginInfo {
  id: string;
  subtype?: string;
}

export interface AppDiff {
  from: string;
  to: string;
  added: PluginInfo[];
  removed: PluginInfo[];
  changed: (PluginInfo & { changes: Change[] })[];
  /** App-level settings (appState outside plugins). */
  app: Change[];
  /** Export wrapper fields other than the ignored ones. */
  wrapper: Change[];
}

interface AppModel {
  label: string;
  wrapper: JsonObject;
  app: JsonObject;
  plugins: JsonObject;
}

/** Reads one side of a diff: an imported app, or an export file. */
function loadApp(arg: string, options: DiffOptions): AppModel {
  const root = options.root;
  const looksLikePath = /[\\/]/.test(arg) || /\.json$/i.test(arg);
  let text: string;
  let label = arg;
  const paths = !looksLikePath && projectPaths(root, arg);
  if (paths && existsSync(paths.manifestFile)) {
    text = buildExport(paths, options.warn).text;
    const exportFile = manifestExportFile(paths);
    if (existsSync(exportFile) && readFileSync(exportFile, "utf8") !== text) {
      options.warn?.(
        `source/${arg}/ differs from ${relative(paths.root, exportFile).replace(/\\/g, "/")}; comparing source/${arg}/ ` +
          "(run unretool import or export to bring them in line)",
      );
    }
  } else {
    const file = resolveExportFile(root, arg);
    text = readFileSync(file, "utf8");
    if (looksLikePath) label = appName(file);
  }
  const where = looksLikePath ? resolve(arg) : arg;
  let wrapper: Json;
  try {
    wrapper = parseJson(text);
  } catch (err) {
    throw new Error(`${where} is not valid JSON: ${(err as Error).message}`);
  }
  const appStateStr = getPath(wrapper, ["page", "data", "appState"], where);
  if (typeof appStateStr !== "string") throw new Error(`${where}: page.data.appState is not a string`);
  const app = getPath(decode(appStateStr), ["~#iR", "v"], `${where} appState`);
  const plugins = getPath(app, ["plugins", "~#iOM"], `${where} appState.v`);
  if (!isObject(wrapper) || !isObject(app) || !isObject(plugins)) throw new Error(`${where}: unexpected app structure`);
  return { label, wrapper, app, plugins };
}

const same = (a: Json, b: Json) => stringifyJson(a) === stringifyJson(b);

/** The single key of a one-entry map, such as a Transit tag ({"~#iR": ...}). */
function onlyKey(v: Json): string | undefined {
  return isObject(v) && v.size === 1 ? v.keys().next().value : undefined;
}

/**
 * Collects the differences between two values. Transit tags are looked through
 * (a record's fields are compared directly), maps are compared key by key, lists
 * of the same length item by item, and anything else as a whole.
 */
export function compareValues(a: Json, b: Json, path: Segment[] = [], out: Change[] = []): Change[] {
  if (same(a, b)) return out;
  const tag = onlyKey(a);
  if (tag?.startsWith("~#") && tag === onlyKey(b)) {
    const av = (a as JsonObject).get(tag)!;
    const bv = (b as JsonObject).get(tag)!;
    if (tag === "~#iR" && isObject(av) && isObject(bv) && same(av.get("n") ?? null, bv.get("n") ?? null)) {
      return compareValues(av.get("v") ?? null, bv.get("v") ?? null, path, out);
    }
    if (tag !== "~#iR") return compareValues(av, bv, path, out);
  }
  if (isObject(a) && isObject(b) && !onlyKey(a)?.startsWith("~#") && !onlyKey(b)?.startsWith("~#")) {
    for (const [k, av] of a) {
      if (b.has(k)) compareValues(av, b.get(k)!, [...path, k], out);
      else out.push({ path: [...path, k], kind: "removed", before: av });
    }
    for (const [k, bv] of b) if (!a.has(k)) out.push({ path: [...path, k], kind: "added", after: bv });
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((av, i) => compareValues(av, b[i], [...path, i], out));
    return out;
  }
  out.push({ path, kind: "changed", before: a, after: b });
  return out;
}

function withoutKeys(m: JsonObject, keys: Set<string>): JsonObject {
  return new Map([...m].filter(([k]) => !keys.has(k)));
}

/** Copy of an object with dotted paths removed. */
function withoutPaths(m: JsonObject, paths: string[]): JsonObject {
  const copy = parseJson(stringifyJson(m)) as JsonObject;
  for (const p of paths) {
    const keys = p.split(".");
    let cur: Json | undefined = copy;
    for (const k of keys.slice(0, -1)) cur = isObject(cur) ? cur.get(k) : undefined;
    if (isObject(cur)) cur.delete(keys[keys.length - 1]);
  }
  return copy;
}

function pluginInfo(id: string, plugin: Json): PluginInfo {
  const subtype = recordValue(plugin)?.get("subtype");
  return typeof subtype === "string" ? { id, subtype } : { id };
}

function comparePlugin(a: Json, b: Json): Change[] {
  const ar = recordValue(a);
  const br = recordValue(b);
  if (ar && br) return compareValues(withoutKeys(ar, IGNORED_RECORD_FIELDS), withoutKeys(br, IGNORED_RECORD_FIELDS));
  return compareValues(a, b);
}

/** Compares app `from` with app `to` (app names or export file paths). */
export function diffApps(from: string, to: string, options: DiffOptions = {}): AppDiff {
  const a = loadApp(from, options);
  const b = loadApp(to, options);
  const result: AppDiff = { from: a.label, to: b.label, added: [], removed: [], changed: [], app: [], wrapper: [] };

  for (const [id, plugin] of a.plugins) {
    const other = b.plugins.get(id);
    if (other === undefined) {
      result.removed.push(pluginInfo(id, plugin));
      continue;
    }
    const changes = comparePlugin(plugin, other);
    if (changes.length) result.changed.push({ ...pluginInfo(id, other), changes });
  }
  for (const [id, plugin] of b.plugins) if (!a.plugins.has(id)) result.added.push(pluginInfo(id, plugin));

  const appIgnored = new Set([...IGNORED_RECORD_FIELDS, "plugins"]);
  result.app = compareValues(withoutKeys(a.app, appIgnored), withoutKeys(b.app, appIgnored));
  result.wrapper = compareValues(withoutPaths(a.wrapper, IGNORED_WRAPPER_PATHS), withoutPaths(b.wrapper, IGNORED_WRAPPER_PATHS));
  return result;
}

export function hasChanges(d: AppDiff): boolean {
  return d.added.length + d.removed.length + d.changed.length + d.app.length + d.wrapper.length > 0;
}

// ---------------------------------------------------------------------------
// Rendering

/** Values shorter than this, on one line, are shown inline as `before -> after`. */
const INLINE_LIMIT = 80;

export function formatPath(path: Segment[]): string {
  let s = "";
  for (const seg of path) {
    if (typeof seg === "number") s += `[${seg}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(seg)) s += s ? `.${seg}` : seg;
    else s += `[${JSON.stringify(seg)}]`;
  }
  return s || "(value)";
}

const isInline = (s: string) => s.length <= INLINE_LIMIT && !s.includes("\n");

/** How a value reads in a block: strings as their text, other values as indented JSON. */
const blockText = (v: Json) => (typeof v === "string" ? v : stringifyJson(v, 2));

type Line = { text: string } | { block: string[] };

/** The lines describing one change: an inline summary, or a heading plus a diff block. */
function describeChange(c: Change, code: (s: string) => string): Line[] {
  const name = code(formatPath(c.path));
  if (c.kind !== "changed") {
    const v = (c.kind === "added" ? c.after : c.before)!;
    const sign = c.kind === "added" ? "+" : "-";
    const compact = stringifyJson(v);
    if (isInline(compact)) return [{ text: `${name} ${c.kind}: ${code(compact)}` }];
    return [{ text: `${name} ${c.kind}:` }, { block: blockText(v).split(/\r?\n/).map((l) => sign + l) }];
  }
  const before = stringifyJson(c.before!);
  const after = stringifyJson(c.after!);
  const multiLine = [c.before, c.after].some((v) => typeof v === "string" && v.includes("\n"));
  if (isInline(before) && isInline(after) && !multiLine) {
    return [{ text: `${name}: ${code(before)} -> ${code(after)}` }];
  }
  const bothStrings = typeof c.before === "string" && typeof c.after === "string";
  const lines = lineDiff(bothStrings ? (c.before as string) : blockText(c.before!), bothStrings ? (c.after as string) : blockText(c.after!));
  if (!lines.length) return [{ text: `${name}: line endings changed` }];
  return [{ text: `${name}:` }, { block: lines }];
}

const label = (p: PluginInfo, code: (s: string) => string) => (p.subtype ? `${code(p.id)} (${p.subtype})` : code(p.id));

export function formatText(d: AppDiff): string {
  const out: string[] = [`Comparing ${d.from} -> ${d.to}`];
  const id = (s: string) => s;
  const emit = (lines: Line[], indent: string) => {
    for (const l of lines) {
      if ("text" in l) out.push(indent + l.text);
      else for (const b of l.block) out.push(`${indent}    ${b}`);
    }
  };
  if (!hasChanges(d)) return `${out[0]}\n\nNo differences.\n`;
  if (d.added.length) {
    out.push("", `Added (${d.added.length})`);
    for (const p of d.added) out.push(`  + ${label(p, id)}`);
  }
  if (d.removed.length) {
    out.push("", `Removed (${d.removed.length})`);
    for (const p of d.removed) out.push(`  - ${label(p, id)}`);
  }
  if (d.changed.length) {
    out.push("", `Changed (${d.changed.length})`);
    for (const p of d.changed) {
      out.push(`  ~ ${label(p, id)}`);
      for (const c of p.changes) emit(describeChange(c, id), "      ");
    }
  }
  for (const [title, changes] of [["App settings", d.app], ["Export file", d.wrapper]] as const) {
    if (!changes.length) continue;
    out.push("", title);
    for (const c of changes) emit(describeChange(c, id), "  ");
  }
  return out.join("\n") + "\n";
}

/** Inline code that survives backticks inside it. */
function mdCode(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

function mdFence(lines: string[], indent: string): string[] {
  const longest = Math.max(2, ...lines.flatMap((l) => (l.match(/`+/g) ?? []).map((r) => r.length)));
  const fence = "`".repeat(longest + 1);
  return [`${indent}${fence}diff`, ...lines.map((l) => indent + l), `${indent}${fence}`];
}

export function formatMarkdown(d: AppDiff): string {
  const out: string[] = [`## Changes from ${mdCode(d.from)} to ${mdCode(d.to)}`];
  const emit = (lines: Line[]) => {
    for (const l of lines) {
      if ("text" in l) out.push(`- ${l.text}`);
      else out.push(...mdFence(l.block, "  "));
    }
  };
  if (!hasChanges(d)) return `${out[0]}\n\nNo differences.\n`;
  const counts = [
    d.added.length && `${d.added.length} added`,
    d.removed.length && `${d.removed.length} removed`,
    d.changed.length && `${d.changed.length} changed`,
  ].filter(Boolean);
  if (counts.length) out.push("", `Components and queries: ${counts.join(", ")}.`);
  if (d.added.length) {
    out.push("", "### Added", "");
    for (const p of d.added) out.push(`- ${label(p, mdCode)}`);
  }
  if (d.removed.length) {
    out.push("", "### Removed", "");
    for (const p of d.removed) out.push(`- ${label(p, mdCode)}`);
  }
  if (d.changed.length) {
    out.push("", "### Changed");
    for (const p of d.changed) {
      out.push("", `#### ${label(p, mdCode)}`, "");
      for (const c of p.changes) emit(describeChange(c, mdCode));
    }
  }
  for (const [title, changes] of [["App settings", d.app], ["Export file", d.wrapper]] as const) {
    if (!changes.length) continue;
    out.push("", `### ${title}`, "");
    for (const c of changes) emit(describeChange(c, mdCode));
  }
  return out.join("\n") + "\n";
}
