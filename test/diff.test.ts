import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importApps } from "../src/import.js";
import { diffApps, formatMarkdown, formatText, hasChanges } from "../src/diff.js";
import { lineDiff } from "../src/textdiff.js";
import { parseJson, stringifyJson, type Json } from "../src/json.js";
import { getPath } from "../src/layout.js";
import { sampleExport } from "./fixture.js";

/** A project with export/Orig.json and export/Copy.json, the copy saved later under a new uuid. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "unretool-"));
  mkdirSync(join(root, "export"));
  writeFileSync(join(root, "export", "Orig.json"), JSON.stringify(sampleExport()));
  const copy = sampleExport();
  copy.uuid = "copy-uuid";
  copy.page.id = copy.page.pageId = 202;
  copy.page.updatedAt = "2026-11-12T09:00:00.000Z";
  writeFileSync(join(root, "export", "Copy.json"), JSON.stringify(copy));
  return { root, copy: join(root, "source", "Copy") };
}

const edit = (file: string, from: string, to: string) => {
  const text = readFileSync(file, "utf8");
  assert.ok(text.includes(from), `${file} should contain ${from}`);
  writeFileSync(file, text.replace(from, to));
};

/** Imports both apps and makes a typical set of edits to the copy. */
function editedCopy() {
  const p = setup();
  importApps([], { root: p.root });
  const plugins = join(p.copy, "plugins");
  writeFileSync(join(plugins, "getUsers.query.sql"), "select *\r\nfrom customers\r\nwhere name like {{ '~' + search.value }}");
  edit(join(plugins, "table1.json"), '"{{ getUsers.data }}"', '"{{ getUsers.data.filter(u => u.active) }}"');
  edit(join(plugins, "table1.json"), '"row": 0', '"row": 3');
  edit(join(plugins, "format.json"), '"events": null', '"events": null,\n        "note": "uses `x`"');
  rmSync(join(plugins, "odd.json"));
  writeFileSync(join(plugins, "format2.json"), readFileSync(join(plugins, "format.json"), "utf8").replace('"id": "format"', '"id": "format2"'));
  edit(join(p.copy, "app.json"), '"appMaxWidth": "100%"', '"appMaxWidth": "1200px"');
  edit(join(p.copy, "app.json"), '"odd"', '"format2"');
  return p;
}

test("copies that differ only in ids and timestamps have no differences", () => {
  const { root } = setup();
  const d = diffApps("Orig", "Copy", { root });
  assert.ok(!hasChanges(d));
  assert.equal(formatText(d), "Comparing Orig -> Copy\n\nNo differences.\n");
});

test("reports added, removed and changed plugins and app settings", () => {
  const { root } = editedCopy();
  const warnings: string[] = [];
  const d = diffApps("Orig", "Copy", { root, warn: (m) => warnings.push(m) });
  assert.deepEqual(warnings, ["source/Copy/ differs from export/Copy.json; comparing source/Copy/ (run unretool import or export to bring them in line)"]);
  assert.deepEqual(d.added, [{ id: "format2", subtype: "JavascriptQuery" }]);
  assert.deepEqual(d.removed, [{ id: "odd", subtype: "State" }]);
  assert.deepEqual(d.changed.map((p) => p.id), ["table1", "getUsers", "format"]);
  assert.deepEqual(d.changed[0].changes.map((c) => c.path), [["template", "data"], ["position2", "row"]]);
  assert.deepEqual(d.app.map((c) => c.path), [["appMaxWidth"]]);
  assert.deepEqual(d.wrapper, []);

  assert.equal(formatText(d), [
    "Comparing Orig -> Copy",
    "",
    "Added (1)",
    "  + format2 (JavascriptQuery)",
    "",
    "Removed (1)",
    "  - odd (State)",
    "",
    "Changed (3)",
    "  ~ table1 (TableWidget2)",
    '      template.data: "{{ getUsers.data }}" -> "{{ getUsers.data.filter(u => u.active) }}"',
    "      position2.row: 0 -> 3",
    "  ~ getUsers (SqlQueryUnified)",
    "      template.query:",
    "          @@ -1,3 +1,3 @@",
    "           select *",
    "          -from users",
    "          +from customers",
    "           where name like {{ '~' + search.value }}",
    "  ~ format (JavascriptQuery)",
    '      template.note added: "uses `x`"',
    "",
    "App settings",
    '  appMaxWidth: "100%" -> "1200px"',
    "",
  ].join("\n"));
});

test("Markdown output fences code and escapes backticks", () => {
  const { root } = editedCopy();
  const md = formatMarkdown(diffApps("Orig", "Copy", { root }));
  assert.match(md, /^## Changes from `Orig` to `Copy`\n\nComponents and queries: 1 added, 1 removed, 3 changed\.\n/);
  assert.match(md, /\n### Added\n\n- `format2` \(JavascriptQuery\)\n/);
  assert.match(md, /\n#### `getUsers` \(SqlQueryUnified\)\n\n- `template\.query`:\n {2}```diff\n {2}@@ -1,3 \+1,3 @@\n/);
  assert.ok(md.includes('\n- `template.note` added: ``"uses `x`"``\n'));
  assert.match(md, /\n### App settings\n\n- `appMaxWidth`: `"100%"` -> `"1200px"`\n$/);
});

test("compares export files when given paths, and the export wrapper outside ignored fields", () => {
  const { root } = setup();
  const copy = JSON.parse(readFileSync(join(root, "export", "Copy.json"), "utf8"));
  copy.modules = { m1: true };
  writeFileSync(join(root, "export", "Copy.json"), JSON.stringify(copy));
  const d = diffApps(join(root, "export", "Orig.json"), join(root, "export", "Copy.json"));
  assert.equal(d.from, "Orig");
  assert.deepEqual(d.wrapper, [{ path: ["modules", "m1"], kind: "added", after: true }]);
});

test("long values are shown as a line diff of their JSON", () => {
  const { root, copy } = setup();
  importApps(["Copy"], { root });
  const file = join(copy, "plugins", "table1.json");
  const plugin = parseJson(readFileSync(file, "utf8"));
  const events = getPath(plugin, ["~#iR", "v", "template", "~#iM", "events", "~#iL"], "table1") as Json[];
  events.push(parseJson('{"~#iM": {"event": "rowSelect", "pluginId": "format"}}'));
  writeFileSync(file, stringifyJson(plugin, 2));
  const text = formatText(diffApps("Orig", "Copy", { root }));
  assert.ok(text.includes([
    "      template.events:",
    "          @@ -4,5 +4,11 @@",
    '                 "event": "rowClick",',
    '                 "pluginId": "getUsers"',
    "               }",
    "          +  },",
    "          +  {",
    '          +    "~#iM": {',
    '          +      "event": "rowSelect",',
    '          +      "pluginId": "format"',
    "          +    }",
    "             }",
    "           ]",
  ].join("\n")), text);
});

test("lineDiff gives unified hunks with context", () => {
  const a = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const b = [...a];
  b[1] = "changed 2";
  b.splice(15, 1);
  assert.deepEqual(lineDiff(a.join("\n"), b.join("\n"), 1), [
    "@@ -1,3 +1,3 @@", " line 1", "-line 2", "+changed 2", " line 3",
    "@@ -15,3 +15,2 @@", " line 15", "-line 16", " line 17",
  ]);
  assert.deepEqual(lineDiff("a\r\nb", "a\nb"), []);
  assert.deepEqual(lineDiff("", "x"), ["@@ -1,1 +1,1 @@", "-", "+x"]);
});
