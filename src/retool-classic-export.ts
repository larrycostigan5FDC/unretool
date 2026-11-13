/**
 * Type definitions for a Retool classic app JSON export.
 *
 * Retool does not publish an official schema. These types are inferred from
 * real exports and field names vary between Retool versions, so most objects
 * allow extra keys via index signatures. Verify against your own export.
 *
 * Two layers:
 *   1. RetoolAppExport: the raw file, where page.data.appState is a
 *      Transit-encoded string.
 *   2. RetoolAppState / AppTemplate: the shape after decoding appState with
 *      transit-js and converting Immutable structures to plain JS.
 */

// ---------------------------------------------------------------------------
// Layer 1: raw exported file
// ---------------------------------------------------------------------------

export interface RetoolAppExport {
  uuid: string;
  page: RetoolPage;
  /** Modules used by the app, keyed by module id/uuid. */
  modules: Record<string, RetoolModuleExport>;
  [key: string]: unknown;
}

export interface RetoolPage {
  id: number;
  data: {
    /**
     * Transit-encoded Immutable.js Record, e.g.
     * '["~#iR",["^ ","n","appTemplate","v",["^ ", ...]]]'.
     * Decode with transit-js to get RetoolAppState.
     */
    appState: string;
    [key: string]: unknown;
  };
  changesRecord?: unknown[];
  changesRecordV2?: unknown[];
  gitSha?: string | null;
  checksum: string | null;
  createdAt: string;
  updatedAt: string;
  pageId: number;
  userId: number | null;
  branchId?: number | null;
  multiplayerSessionId?: string | null;
  appTestingSaveId?: unknown;
  subflows?: unknown;
  isCopilotGenerated?: boolean;
  [key: string]: unknown;
}

/** Modules are exported in roughly the same shape as an app page. */
export interface RetoolModuleExport {
  uuid?: string;
  page?: RetoolPage;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Transit encoding helpers (only needed if you walk appState without decoding)
// ---------------------------------------------------------------------------

/** "~#iR" = Immutable Record, "~#iOM" = OrderedMap, "~#iL" = List, etc. */
export type TransitTag = `~#${string}`;

/** A tagged value: [tag, payload]. */
export type TransitTagged = [TransitTag, TransitValue];

/** A Transit map: ["^ ", key1, value1, key2, value2, ...]. */
export type TransitMap = ["^ ", ...TransitValue[]];

export type TransitValue =
  | string
  | number
  | boolean
  | null
  | TransitTagged
  | TransitMap
  | TransitValue[];

// ---------------------------------------------------------------------------
// Layer 2: decoded app state
// ---------------------------------------------------------------------------

export interface RetoolAppState {
  appTemplate: AppTemplate;
}

export interface AppTemplate {
  version: string;
  /** All components, queries, state variables, and frames, keyed by name. */
  plugins: Record<string, PluginTemplate>;

  appMaxWidth?: string;
  appStyles?: string;
  rowHeight?: number;
  isMobileApp?: boolean;
  isFormApp?: boolean;
  isGlobalWidget?: boolean;
  multiScreenMobileApp?: boolean;
  responsiveLayoutDisabled?: boolean;
  marginsDisabled?: boolean;
  loadingIndicatorsDisabled?: boolean;
  queryStatusVisibility?: boolean;
  instrumentationEnabled?: boolean;

  preloadedAppJavaScript?: string | null;
  preloadedAppJSLinks?: string[];
  customDocumentTitle?: string | null;
  customShortcuts?: unknown[];
  urlFragmentDefinitions?: unknown[];
  folders?: unknown[];
  pageCodeFolders?: Record<string, unknown>;
  experimentalFeatures?: Record<string, unknown>;
  customComponentCollections?: unknown[];
  internationalizationSettings?: Record<string, unknown>;
  notificationsSettings?: Record<string, unknown>;
  mobileAppSettings?: Record<string, unknown>;
  formAppSettings?: Record<string, unknown>;
  tests?: unknown[];
  testEntities?: unknown[];
  appTesting?: unknown;
  shortlink?: string | null;
  savePlatform?: string;
  createdAt?: string | null;

  [key: string]: unknown;
}

export type PluginType =
  | "widget"
  | "datasource"
  | "function"
  | "state"
  | "frame"
  | (string & {}); // allow unknown types while keeping autocomplete

/** Common subtypes; many more exist. */
export type PluginSubtype =
  | "TableWidget2"
  | "TextInputWidget2"
  | "ButtonWidget2"
  | "TextWidget2"
  | "ContainerWidget2"
  | "ModalWidget"
  | "SqlQueryUnified"
  | "RESTQuery"
  | "GraphQLQuery"
  | "JavascriptQuery"
  | "Function"
  | "State"
  | (string & {});

export interface PluginTemplate {
  /** The component or query name, e.g. "table1" or "getUsers". */
  id: string;
  uuid: string | null;
  type: PluginType;
  subtype: PluginSubtype;
  namespace: string | null;

  /** Resource uuid for queries; null for components. */
  resourceName: string | null;
  resourceDisplayName: string | null;

  /** Component props or query config (query text, triggers, events, ...). */
  template: PluginTemplateConfig;
  style: Record<string, unknown> | null;

  position2: Position | null;
  mobilePosition2: Position | null;
  mobileAppPosition?: unknown;
  tabIndex?: number | null;
  mobileTabIndex?: number | null;

  folder: string;
  presetName?: string | null;
  screen: string | null;
  boxId?: string | null;
  _comment?: string | null;

  /**
   * Transit timestamps ("~m<epoch ms>"). transit-js decodes them to Date by
   * default; a custom handler may leave them as strings.
   */
  createdAt: string | Date;
  updatedAt: string | Date;

  [key: string]: unknown;
}

/** Shape varies by subtype; a few common query/component keys are typed. */
export interface PluginTemplateConfig {
  /** SQL / JS / request body for queries. */
  query?: string;
  runWhenPageLoads?: boolean;
  runWhenModelUpdates?: boolean;
  /** An empty map ({}) or null when a plugin has no handlers. */
  events?: EventHandler[] | Record<string, never> | null;
  [key: string]: unknown;
}

export interface EventHandler {
  event: string;
  type: string;
  method: string | null;
  pluginId?: string;
  params?: Record<string, unknown>;
  waitType?: string;
  waitMs?: string;
  [key: string]: unknown;
}

export interface Position {
  container: string;
  rowGroup: string;
  subcontainer: string;
  row: number;
  col: number;
  height: number;
  width: number;
  tabNum: number;
  stackPosition: unknown | null;
  [key: string]: unknown;
}
