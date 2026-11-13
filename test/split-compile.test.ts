import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitExport } from "../src/split.js";
import { compileDir, compileExport } from "../src/compile.js";
import { decodeAppState } from "../src/app-state.js";
import { sampleExport } from "./fixture.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "unretool-"));
  const input = join(dir, "My App.json");
  const original = sampleExport();
  writeFileSync(input, JSON.stringify(original));
  return { dir, input, original, out: join(dir, "My App") };
}

const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const readJson = (...p: string[]) => JSON.parse(read(...p));

test("split writes the documented layout", () => {
  const { input, out } = setup();
  const r = splitExport(input);
  assert.deepEqual(r, { out, plugins: 6, modules: 1 });

  const exported = readJson(out, "export.json");
  assert.equal(exported.page.data.appState, "unretool:app:.");
  assert.equal(exported.modules["module-uuid"].page.data.appState, "unretool:app:modules/module-uuid");

  const app = readJson(out, "app.json");
  assert.equal(app.plugins.getUsers, "unretool:file:plugins/getUsers.json");
  assert.equal(app.plugins["weird/Name"], "unretool:file:plugins/weird_Name.json");
  assert.equal(app.plugins.WEIRD_Name, "unretool:file:plugins/WEIRD_Name~2.json");
  assert.equal(app.preloadedAppJavaScript, "unretool:file:app.js");
  assert.equal(read(out, "app.css"), ".title { color: red; }\n");

  assert.equal(readJson(out, "plugins", "getUsers.json").template.query, "unretool:file:plugins/getUsers.sql");
  assert.match(read(out, "plugins", "getUsers.sql"), /^select \*\nfrom users/);
  assert.equal(read(out, "plugins", "format.js"), "return `^${value}`;");
  assert.equal(readJson(out, "plugins", "table1.json").position2.row, 0);
  assert.equal(read(out, "modules", "module-uuid", "plugins", "moduleQuery.sql"), "select 1");

  const transit = readJson(out, "transit.json");
  assert.equal(transit["app.json"].tags["/plugins"], "#iOM");
  assert.equal(transit["plugins/table1.json"].tags[""], "#iR:pluginTemplate");
});

test("compile reproduces the original export exactly", () => {
  const { input, out, original } = setup();
  splitExport(input);
  assert.throws(() => compileDir(out), /My App\.json already exists/); // the default is the original export
  const r = compileDir(out, { out: out + ".compiled.json" });
  assert.deepEqual(JSON.parse(read(r.out)), original);
  assert.equal(read(r.out), JSON.stringify(original));
});

test("compile picks up edited query files", () => {
  const { input, out } = setup();
  splitExport(input);
  writeFileSync(join(out, "plugins", "getUsers.sql"), "select id from users");
  const { exported } = compileExport(out);
  const { state } = decodeAppState(exported.page.data.appState);
  assert.equal(state.appTemplate.plugins.getUsers.template.query, "select id from users");
});

test("compile adds unlisted plugin files, borrowing Transit types from a similar plugin", () => {
  const { input, out } = setup();
  splitExport(input);
  const copy = readJson(out, "plugins", "getUsers.json");
  writeFileSync(join(out, "plugins", "getOrders.json"), JSON.stringify({ ...copy, id: "getOrders", template: { ...copy.template, query: "select * from orders" } }));

  const warnings: string[] = [];
  const { exported } = compileExport(out, (m) => warnings.push(m));
  assert.match(warnings.join("\n"), /added plugins\/getOrders\.json \(plugin "getOrders"\)/);

  const { state, meta } = decodeAppState(exported.page.data.appState);
  assert.equal(state.appTemplate.plugins.getOrders.template.query, "select * from orders");
  assert.equal(meta.tags["/plugins/getOrders"], "#iR:pluginTemplate");
  assert.equal(meta.tags["/plugins/getOrders/createdAt"], "~m");
});

test("compile rejects a plugin whose id doesn't match app.json", () => {
  const { input, out } = setup();
  splitExport(input);
  const file = join(out, "plugins", "getUsers.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), id: "renamed" }));
  assert.throws(() => compileExport(out), /plugins\.getUsers\.id: is "renamed", must match its key/);
});

test("compile refuses references that leave the split directory", () => {
  const { input, out } = setup();
  splitExport(input);
  const file = join(out, "plugins", "getUsers.json");
  const p = JSON.parse(readFileSync(file, "utf8"));
  p.template.query = "unretool:file:../../secret.txt";
  writeFileSync(file, JSON.stringify(p));
  assert.throws(() => compileExport(out), /points outside/);
});

test("split rejects exports that don't match the schema", () => {
  const { input, original } = setup();
  const { uuid: _, ...noUuid } = original;
  writeFileSync(input, JSON.stringify(noUuid));
  assert.throws(() => splitExport(input), /\$\.uuid: missing/);
});

test("split and compile don't overwrite without --force", () => {
  const { dir, input, out } = setup();
  splitExport(input);
  assert.throws(() => splitExport(input), /already exists/);
  splitExport(input, { force: true });

  const other = join(dir, "other");
  mkdirSync(other);
  writeFileSync(join(other, "keep.txt"), "x");
  assert.throws(() => splitExport(input, { out: other, force: true }), /not an unretool split directory/);
  assert.ok(existsSync(join(other, "keep.txt")));

  renameSync(input, join(dir, "original.json"));
  compileDir(out);
  assert.ok(existsSync(input));
  assert.throws(() => compileDir(out), /already exists/);
  compileDir(out, { force: true });
});
