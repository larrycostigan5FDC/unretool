/**
 * Runtime checks that values match the types in retool-classic-export.ts.
 * Keep these in step with that file.
 */
import type { AppTemplate, PluginTemplate, RetoolAppExport } from "./retool-classic-export.js";

type Check = (v: unknown, path: string, issues: string[]) => void;
type Field = { check: Check; optional?: boolean };

const describe = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const prim =
  (type: "string" | "number" | "boolean"): Check =>
  (v, path, issues) => {
    if (typeof v !== type) issues.push(`${path}: expected ${type}, got ${describe(v)}`);
  };

const str = prim("string");
const num = prim("number");
const bool = prim("boolean");
const any: Check = () => {};

const nullable =
  (check: Check): Check =>
  (v, path, issues) => {
    if (v !== null) check(v, path, issues);
  };

const arrayOf =
  (check: Check): Check =>
  (v, path, issues) => {
    if (!Array.isArray(v)) return void issues.push(`${path}: expected array, got ${describe(v)}`);
    v.forEach((x, i) => check(x, `${path}[${i}]`, issues));
  };

const recordOf =
  (check: Check): Check =>
  (v, path, issues) => {
    if (!isPlainObject(v)) return void issues.push(`${path}: expected object, got ${describe(v)}`);
    for (const [k, x] of Object.entries(v)) check(x, `${path}.${k}`, issues);
  };

const object =
  (fields: Record<string, Field | Check>): Check =>
  (v, path, issues) => {
    if (!isPlainObject(v)) return void issues.push(`${path}: expected object, got ${describe(v)}`);
    for (const [name, f] of Object.entries(fields)) {
      const { check, optional } = typeof f === "function" ? { check: f, optional: false } : f;
      if (!Object.prototype.hasOwnProperty.call(v, name)) {
        if (!optional) issues.push(`${path}.${name}: missing`);
        continue;
      }
      if (optional && v[name] === undefined) continue;
      check(v[name], `${path}.${name}`, issues);
    }
  };

const oneOf =
  (label: string, ...checks: Check[]): Check =>
  (v, path, issues) => {
    if (!checks.some((c) => { const tmp: string[] = []; c(v, path, tmp); return tmp.length === 0; })) {
      issues.push(`${path}: expected ${label}, got ${describe(v)}`);
    }
  };

const opt = (check: Check): Field => ({ check, optional: true });
const anyObject = recordOf(any);
const emptyObject: Check = (v, path, issues) => {
  if (!isPlainObject(v) || Object.keys(v).length > 0) issues.push(`${path}: expected {}`);
};

// --- layer 1 -----------------------------------------------------------------

const page = object({
  id: num,
  data: object({ appState: str }),
  changesRecord: opt(arrayOf(any)),
  changesRecordV2: opt(arrayOf(any)),
  gitSha: opt(nullable(str)),
  checksum: nullable(str),
  createdAt: str,
  updatedAt: str,
  pageId: num,
  userId: nullable(num),
  branchId: opt(nullable(num)),
  multiplayerSessionId: opt(nullable(str)),
  isCopilotGenerated: opt(bool),
});

const moduleExport = object({ uuid: opt(str), page: opt(page) });

const appExport = object({ uuid: str, page, modules: recordOf(moduleExport) });

// --- layer 2 -----------------------------------------------------------------

const position = object({
  container: str,
  rowGroup: str,
  subcontainer: str,
  row: num,
  col: num,
  height: num,
  width: num,
  tabNum: num,
  stackPosition: any,
});

const eventHandler = object({
  event: str,
  type: str,
  method: nullable(str),
  pluginId: opt(str),
  params: opt(anyObject),
  waitType: opt(str),
  waitMs: opt(str),
});

const pluginTemplateConfig = object({
  query: opt(str),
  runWhenPageLoads: opt(bool),
  runWhenModelUpdates: opt(bool),
  events: opt(oneOf("array of event handlers, {} or null", arrayOf(eventHandler), emptyObject, (v, p, i) => {
    if (v !== null) i.push(p);
  })),
});

const pluginTemplate = object({
  id: str,
  uuid: nullable(str),
  type: str,
  subtype: str,
  namespace: nullable(str),
  resourceName: nullable(str),
  resourceDisplayName: nullable(str),
  template: pluginTemplateConfig,
  style: nullable(anyObject),
  position2: nullable(position),
  mobilePosition2: nullable(position),
  tabIndex: opt(nullable(num)),
  mobileTabIndex: opt(nullable(num)),
  folder: str,
  presetName: opt(nullable(str)),
  screen: nullable(str),
  boxId: opt(nullable(str)),
  _comment: opt(nullable(str)),
  createdAt: str,
  updatedAt: str,
});

const appTemplate = object({
  version: str,
  plugins: recordOf(pluginTemplate),
  appMaxWidth: opt(str),
  appStyles: opt(str),
  rowHeight: opt(num),
  isMobileApp: opt(bool),
  isFormApp: opt(bool),
  isGlobalWidget: opt(bool),
  multiScreenMobileApp: opt(bool),
  responsiveLayoutDisabled: opt(bool),
  marginsDisabled: opt(bool),
  loadingIndicatorsDisabled: opt(bool),
  queryStatusVisibility: opt(bool),
  instrumentationEnabled: opt(bool),
  preloadedAppJavaScript: opt(nullable(str)),
  preloadedAppJSLinks: opt(arrayOf(str)),
  customDocumentTitle: opt(nullable(str)),
  customShortcuts: opt(arrayOf(any)),
  urlFragmentDefinitions: opt(arrayOf(any)),
  folders: opt(arrayOf(any)),
  pageCodeFolders: opt(anyObject),
  experimentalFeatures: opt(anyObject),
  customComponentCollections: opt(arrayOf(any)),
  internationalizationSettings: opt(anyObject),
  notificationsSettings: opt(anyObject),
  mobileAppSettings: opt(anyObject),
  formAppSettings: opt(anyObject),
  tests: opt(arrayOf(any)),
  testEntities: opt(arrayOf(any)),
  shortlink: opt(nullable(str)),
  savePlatform: opt(str),
  createdAt: opt(nullable(str)),
});

// --- entry points ------------------------------------------------------------

export class SchemaError extends Error {
  constructor(what: string, readonly issues: string[]) {
    const shown = issues.slice(0, 10).map((i) => `  - ${i}`);
    if (issues.length > shown.length) shown.push(`  ... and ${issues.length - shown.length} more`);
    super(`${what} does not match the Retool classic export schema:\n${shown.join("\n")}`);
  }
}

function run(check: Check, v: unknown, root: string, what: string) {
  const issues: string[] = [];
  check(v, root, issues);
  if (issues.length) throw new SchemaError(what, issues);
}

export function assertAppExport(v: unknown, what = "Export"): asserts v is RetoolAppExport {
  run(appExport, v, "$", what);
}

export function assertAppTemplate(v: unknown, what = "appTemplate"): asserts v is AppTemplate {
  run(appTemplate, v, "appTemplate", what);
  const plugins = (v as AppTemplate).plugins;
  const issues = Object.entries(plugins)
    .filter(([key, p]) => p.id !== key)
    .map(([key, p]) => `appTemplate.plugins.${key}.id: is "${p.id}", must match its key`);
  if (issues.length) throw new SchemaError(what, issues);
}

export function assertPluginTemplate(v: unknown, what: string): asserts v is PluginTemplate {
  run(pluginTemplate, v, "plugin", what);
}
