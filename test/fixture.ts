/**
 * Builds Retool classic exports for tests. appState is written by transit-js (the
 * reference implementation) with Immutable-style handlers, as Retool does, so the
 * codec is checked against real transit-js output rather than against itself.
 */
import transit from "transit-js";
import type { RetoolAppExport } from "../src/retool-classic-export.js";

export class Rec {
  constructor(readonly n: string, readonly v: Record<string, unknown>) {}
}
export class OMap {
  constructor(readonly entries: [string, unknown][]) {}
}
export class List {
  constructor(readonly items: unknown[]) {}
}

const writer = transit.writer("json", {
  handlers: transit.map([
    Rec, transit.makeWriteHandler({ tag: () => "iR", rep: (r: Rec) => ({ n: r.n, v: r.v }) }),
    OMap, transit.makeWriteHandler({ tag: () => "iOM", rep: (m: OMap) => m.entries.flat() }),
    List, transit.makeWriteHandler({ tag: () => "iL", rep: (l: List) => l.items }),
  ]),
});

export const writeTransit = (v: unknown): string => writer.write(v);

const position = (row: number) =>
  new Rec("position2", {
    container: "", rowGroup: "body", subcontainer: "", row, col: 0, height: 5, width: 12, tabNum: 0, stackPosition: null,
  });

const at = new Date(Date.UTC(2026, 10, 1, 12, 30));

export function plugin(id: string, type: string, subtype: string, template: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return new Rec("pluginTemplate", {
    id, uuid: `uuid-${id}`, _comment: null, type, subtype, namespace: null,
    resourceName: type === "datasource" ? "res-uuid" : null,
    resourceDisplayName: type === "datasource" ? "Postgres" : null,
    template: new OMap(Object.entries(template)),
    style: new OMap([]),
    position2: type === "widget" ? position(0) : null,
    mobilePosition2: null,
    folder: "", screen: null,
    createdAt: at, updatedAt: at,
    ...extra,
  });
}

export function appTemplate(plugins: Rec[], extra: Record<string, unknown> = {}) {
  return new Rec("appTemplate", {
    appMaxWidth: "100%",
    version: "3.120.0",
    appStyles: ".title { color: red; }\n",
    preloadedAppJavaScript: "window.answer = 42;\n",
    plugins: new OMap(plugins.map((p) => [p.v.id as string, p])),
    folders: new List([]),
    createdAt: null,
    ...extra,
  });
}

export function sampleApp() {
  return appTemplate([
    plugin("table1", "widget", "TableWidget2", {
      data: "{{ getUsers.data }}",
      // Integer-like keys come first in plain JS objects; the original order must survive.
      columnWidths: new OMap([["name", 120], ["10", 80], ["2", 40]]),
      events: new List([
        new OMap([["event", "rowClick"], ["type", "datasource"], ["method", "trigger"], ["pluginId", "getUsers"]]),
      ]),
    }),
    plugin("getUsers", "datasource", "SqlQueryUnified", {
      query: "select *\nfrom users\nwhere name like {{ '~' + search.value }}",
      runWhenPageLoads: true,
      events: new OMap([]),
    }),
    plugin("format", "function", "JavascriptQuery", {
      query: "return `^${value}`;",
      events: null,
    }),
    plugin("weird/Name", "state", "State", { value: "`reserved", other: "^ not a cache code" }),
    plugin("WEIRD_Name", "state", "State", { value: "" }),
  ]);
}

export function sampleExport(): RetoolAppExport {
  const page = (appState: string, id: number) => ({
    id, data: { appState }, changesRecord: [], gitSha: null, checksum: null,
    createdAt: "2026-11-01T12:30:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z",
    pageId: id, userId: 7, branchId: null,
  });
  const module = appTemplate([plugin("moduleQuery", "datasource", "SqlQueryUnified", { query: "select 1" })], {
    isGlobalWidget: true,
  });
  return {
    uuid: "app-uuid",
    page: page(writeTransit(sampleApp()), 101),
    modules: { "module-uuid": { uuid: "module-uuid", page: page(writeTransit(module), 202) } },
  };
}
