import { test } from "node:test";
import assert from "node:assert/strict";
import transit from "transit-js";
import { decodeTransit, encodeTransit } from "../src/transit.js";
import { decodeAppState, encodeAppState } from "../src/app-state.js";
import { List, OMap, Rec, appTemplate, plugin, sampleApp, writeTransit } from "./fixture.js";

test("re-encodes transit-js output byte for byte", () => {
  const text = writeTransit(sampleApp());
  const { value, meta } = decodeTransit(text);
  assert.equal(encodeTransit(value, meta), text);
});

test("matches transit-js when the 1936-entry cache wraps around", () => {
  const keys: [string, unknown][] = Array.from({ length: 2500 }, (_, i) => [`key${i}`, `~#notATag${i % 3}`]);
  const text = writeTransit(new List([new OMap(keys), new OMap(keys.slice(0, 100)), new Rec("r", { key5: 1 })]));
  const { value, meta } = decodeTransit(text);
  assert.equal(encodeTransit(value, meta), text);
});

test("output is readable by transit-js", () => {
  const { value, meta } = decodeTransit(writeTransit(sampleApp()));
  // Dropping the key orders makes the output differ from the original.
  const reader = transit.reader("json", { handlers: { iR: (r: unknown) => r, iOM: (r: unknown) => r, iL: (r: unknown) => r } });
  assert.doesNotThrow(() => reader.read(encodeTransit(value, { tags: meta.tags, order: {} })));
});

test("decodes appState to the schema's layer 2 shapes", () => {
  const { state, meta } = decodeAppState(writeTransit(sampleApp()));
  const t = state.appTemplate;
  assert.equal(t.version, "3.120.0");
  assert.deepEqual(Object.keys(t.plugins), ["table1", "getUsers", "format", "weird/Name", "WEIRD_Name"]);

  const table = t.plugins.table1;
  assert.equal(table.subtype, "TableWidget2");
  assert.equal(table.position2?.rowGroup, "body");
  assert.equal(table.createdAt, "2026-11-01T12:30:00.000Z");
  assert.deepEqual(table.template.events, [
    { event: "rowClick", type: "datasource", method: "trigger", pluginId: "getUsers" },
  ]);
  assert.deepEqual(t.plugins.getUsers.template.events, {});
  assert.equal(t.plugins.format.template.query, "return `^${value}`;");
  assert.equal(t.plugins["weird/Name"].template.value, "`reserved");

  assert.equal(meta.tags[""], "#iR:appTemplate");
  assert.equal(meta.tags["/plugins"], "#iOM");
  assert.equal(meta.tags["/plugins/table1/position2"], "#iR:position2");
  assert.equal(meta.tags["/plugins/table1/createdAt"], "~m");
  assert.deepEqual(meta.order["/plugins/table1/template/columnWidths"], ["name", "10", "2"]);
});

test("encodeAppState applies edits", () => {
  const { state, meta } = decodeAppState(writeTransit(sampleApp()));
  state.appTemplate.plugins.getUsers.template.query = "select 1";
  const again = decodeAppState(encodeAppState(state, meta));
  assert.equal(again.state.appTemplate.plugins.getUsers.template.query, "select 1");
  assert.deepEqual(again.meta, meta);
});

test("rejects appState that isn't an appTemplate Record", () => {
  assert.throws(() => decodeAppState(writeTransit(new Rec("other", {}))), /not an appTemplate Record/);
  assert.throws(() => decodeAppState("not json"), /not valid Transit/);
});

test("rejects plugins that don't match the schema", () => {
  const bad = appTemplate([plugin("q", "datasource", "SqlQueryUnified", {}, { folder: 3 })]);
  assert.throws(() => decodeAppState(writeTransit(bad)), /appTemplate\.plugins\.q\.folder: expected string, got number/);
  const noVersion = new Rec("appTemplate", { plugins: new OMap([]) });
  assert.throws(() => decodeAppState(writeTransit(noVersion)), /appTemplate\.version: missing/);
});
