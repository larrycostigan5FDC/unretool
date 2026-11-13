/**
 * Builds Retool classic exports for tests. appState is written by transit-js (the
 * reference implementation) with Immutable-style handlers, as Retool does, so the
 * codec is checked against real transit-js output rather than against itself.
 */
import transit from "transit-js";

export class Rec {
  constructor(readonly n: string, readonly v: Record<string, unknown>) {}
}
/** An Immutable Map (~#iM) or OrderedMap (~#iOM), written as a flat [k, v, ...] list. */
export class IMap {
  constructor(readonly entries: [unknown, unknown][], readonly ordered = false) {}
}
export class List {
  constructor(readonly items: unknown[]) {}
}

const writer = transit.writer("json", {
  handlers: transit.map([
    Rec, transit.makeWriteHandler({ tag: () => "iR", rep: (r: Rec) => ({ n: r.n, v: r.v }) }),
    IMap, transit.makeWriteHandler({ tag: (m: IMap) => (m.ordered ? "iOM" : "iM"), rep: (m: IMap) => m.entries.flat() }),
    List, transit.makeWriteHandler({ tag: () => "iL", rep: (l: List) => l.items }),
  ]),
});

export const writeTransit = (v: unknown): string => writer.write(v);

const at = new Date(Date.UTC(2026, 10, 1, 12, 30));

export function plugin(id: string, type: string, subtype: string, template: Record<string, unknown>) {
  return new Rec("pluginTemplate", {
    id, uuid: null, type, subtype,
    template: new IMap(Object.entries(template)),
    style: new IMap([]),
    position2: type === "widget" ? new Rec("position2", { row: 0, col: 0, height: 4.5, width: 12 }) : null,
    createdAt: at, updatedAt: at,
  });
}

export function sampleApp() {
  const plugins = [
    plugin("table1", "widget", "TableWidget2", {
      data: "{{ getUsers.data }}",
      // Integer-like keys come first in plain JS objects; see sampleTransit for the order written.
      columnWidths: { a: 120, "10": 80, "2": 40 },
      tiny: 1e-7,
      events: new List([new IMap([["event", "rowClick"], ["pluginId", "getUsers"]])]),
    }),
    plugin("getUsers", "datasource", "SqlQueryUnified", {
      query: "select *\r\nfrom users\r\nwhere name like {{ '~' + search.value }}",
      transformer: "return data;",
      runWhenPageLoads: true,
    }),
    plugin("format", "function", "JavascriptQuery", { query: "return `^${value}`;", events: null }),
    plugin("html1", "widget", "HTMLWidget", { html: "<b>hi</b>\n", css: ".x { color: red; }\n", tooltip: "line 1\nline 2" }),
    plugin("$main", "frame", "Frame", { query: "" }),
    // A non-string key keeps the template as a flat list.
    plugin("odd", "state", "State", {}),
  ];
  (plugins[5].v as { template: IMap }).template = new IMap([[1, "one"], ["query", "select 1"]]);
  return new Rec("appTemplate", {
    appMaxWidth: "100%",
    version: "3.120.0",
    plugins: new IMap(plugins.map((p) => [p.v.id, p]), true),
    folders: new List([]),
    createdAt: null,
  });
}

/** sampleApp as Transit, with columnWidths in an order a plain JS object can't hold (keys too short to cache). */
export function sampleTransit(): string {
  const text = writeTransit(sampleApp());
  const from = '["^ ","2",40,"10",80,"a",120]';
  if (!text.includes(from)) throw new Error("fixture: columnWidths not found");
  return text.replace(from, '["^ ","a",120,"10",80,"2",40]');
}

export function sampleExport() {
  return {
    uuid: "app-uuid",
    page: {
      id: 101, data: { appState: sampleTransit() }, changesRecord: [], checksum: null,
      createdAt: "2026-11-01T12:30:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z", pageId: 101, userId: 7,
    },
    modules: {},
  };
}
