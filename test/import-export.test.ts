import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importApps } from "../src/import.js";
import { exportApps } from "../src/export.js";
import { decode } from "../src/transit.js";
import { stringifyJson, type JsonObject } from "../src/json.js";
import { sampleExport } from "./fixture.js";

const APP = "My%20App";
const EXPORT_NAME = `${APP}.json`;

function setup() {
  const root = mkdtempSync(join(tmpdir(), "unretool-"));
  mkdirSync(join(root, "export"));
  const original = JSON.stringify(sampleExport());
  writeFileSync(join(root, "export", EXPORT_NAME), original);
  return { root, original, src: join(root, "source", APP), plugins: join(root, "source", APP, "plugins") };
}

const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const readJson = (...p: string[]) => JSON.parse(read(...p));

test("import writes the source/ layout", () => {
  const { root, src, plugins } = setup();
  const [r, ...rest] = importApps([], { root });
  assert.equal(rest.length, 0);
  assert.equal(r.name, APP);
  assert.equal(r.sourceDir, src);
  assert.equal(r.plugins, 6);
  assert.equal(r.exportFile, join(root, "export", EXPORT_NAME));

  assert.deepEqual(readJson(src, "manifest.json"), { exportFile: EXPORT_NAME });
  assert.equal(readJson(src, "export.json").page.data.appState, "$appState: see app.json");
  assert.deepEqual(readJson(src, "app.json")["~#iR"].v.plugins, {
    $pluginOrder: ["table1", "getUsers", "format", "html1", "$main", "odd"],
  });

  const getUsers = readJson(plugins, "getUsers.json")["~#iR"].v;
  assert.equal(getUsers.id, "getUsers");
  assert.deepEqual(getUsers.template["~#iM"].query, { $file: "getUsers.query.sql" });
  assert.deepEqual(getUsers.template["~#iM"].transformer, { $file: "getUsers.transformer.js" });
  assert.equal(read(plugins, "getUsers.query.sql"), "select *\r\nfrom users\r\nwhere name like {{ '~' + search.value }}");
  assert.equal(read(plugins, "format.query.js"), "return `^${value}`;");

  const html = readJson(plugins, "html1.json")["~#iR"].v.template["~#iM"];
  assert.deepEqual(html.html, { $file: "html1.html" });
  assert.deepEqual(html.css, { $file: "html1.css" });
  assert.deepEqual(html.tooltip, { $file: "html1.tooltip.txt" });
  assert.equal(read(plugins, "html1.tooltip.txt"), "line 1\nline 2");

  // Empty strings stay inline, and integer-like keys keep their order on disk.
  assert.equal(readJson(plugins, "$main.json")["~#iR"].v.template["~#iM"].query, "");
  assert.match(read(plugins, "table1.json"), /"a": 120,\s+"10": 80,\s+"2": 40/);
  assert.ok(!existsSync(join(plugins, "odd.query.sql")));
});

test("export reproduces the original file exactly", () => {
  const { root, original } = setup();
  importApps([], { root });
  const [r] = exportApps([], { root });
  assert.equal(r.output, join(root, "export", EXPORT_NAME));
  assert.equal(r.plugins, 6);
  assert.equal(read(r.output), original);
});

test("import replaces source/plugins/ and keeps other files in source/", () => {
  const { root, src, plugins } = setup();
  importApps([], { root });
  writeFileSync(join(plugins, "stale.json"), "{}");
  writeFileSync(join(src, "NOTES.md"), "mine");
  importApps([], { root });
  assert.ok(!existsSync(join(plugins, "stale.json")));
  assert.equal(read(src, "NOTES.md"), "mine");
});

test("export picks up edited code files and appends unlisted plugins", () => {
  const { root, plugins } = setup();
  importApps([], { root });
  writeFileSync(join(plugins, "getUsers.query.sql"), "select 1");
  const copy = read(plugins, "format.json").replace('"id": "format"', '"id": "format2"');
  writeFileSync(join(plugins, "format2.json"), copy);

  const warnings: string[] = [];
  const out = join(root, "out", "new.json");
  exportApps([APP], { root, output: out, warn: (m) => warnings.push(m) });
  assert.deepEqual(warnings, ["format2.json is not in $pluginOrder; appending it"]);

  const app = decode(readJson(out).page.data.appState) as JsonObject;
  const json = stringifyJson(app);
  assert.match(json, /"query":"select 1"/);
  assert.match(json, /"\$main":\{[^]*"odd":\{[^]*"format2":\{/);
});

test("export rejects missing plugins and mismatched ids", () => {
  const { root, plugins } = setup();
  importApps([], { root });
  renameSync(join(plugins, "format.json"), join(plugins, "formatX.json"));
  assert.throws(() => exportApps([], { root }), /missing from source\/My%20App\/plugins\/: format$/);
  renameSync(join(plugins, "formatX.json"), join(plugins, "format.json"));

  writeFileSync(join(plugins, "format.json"), read(plugins, "format.json").replace('"id": "format"', '"id": "other"'));
  assert.throws(() => exportApps([], { root }), /format\.json has id "other"; the file name must match the id/);
});

test("each export gets its own source folder and exports back to its own file", () => {
  const { root, original } = setup();
  writeFileSync(join(root, "export", "copy.json"), original);
  const imported = importApps([], { root });
  assert.deepEqual(imported.map((r) => r.name), [APP, "copy"]);
  assert.deepEqual(readJson(root, "source", "copy", "manifest.json"), { exportFile: "copy.json" });

  writeFileSync(join(root, "source", "copy", "plugins", "getUsers.query.sql"), "select 1");
  rmSync(join(root, "export", "copy.json"));
  const exported = exportApps([], { root });
  assert.deepEqual(exported.map((r) => r.output), [join(root, "export", EXPORT_NAME), join(root, "export", "copy.json")]);
  assert.equal(read(root, "export", EXPORT_NAME), original);
  assert.match(read(root, "export", "copy.json"), /select 1/);

  assert.throws(() => exportApps([], { root, output: join(root, "x.json") }), /--output needs a single app, but there are 2/);
});

test("import and export take app names", () => {
  const { root, original } = setup();
  writeFileSync(join(root, "export", "copy.json"), original);
  assert.deepEqual(importApps(["copy"], { root }).map((r) => r.name), ["copy"]);
  assert.ok(!existsSync(join(root, "source", APP)));
  assert.deepEqual(importApps([join(root, "export", EXPORT_NAME)], { root }).map((r) => r.name), [APP]);
  assert.deepEqual(exportApps(["copy"], { root }).map((r) => r.name), ["copy"]);
  assert.throws(() => importApps(["nope"], { root }), /No export file nope/);
});

test("import and export explain an empty or old-style project", () => {
  const root = mkdtempSync(join(tmpdir(), "unretool-"));
  assert.throws(() => importApps([], { root }), /No \.json files in /);
  assert.throws(() => exportApps([], { root }), /No imported apps in .*run unretool import first/);
  mkdirSync(join(root, "source"));
  writeFileSync(join(root, "source", "manifest.json"), "{}");
  assert.throws(() => exportApps([], { root }), /old single-app layout/);
});
