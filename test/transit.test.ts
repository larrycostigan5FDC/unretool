import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "../src/transit.js";
import { Num, parseJson, stringifyJson, type JsonObject } from "../src/json.js";
import { IMap, List, Rec, sampleTransit, writeTransit } from "./fixture.js";

test("re-encodes transit-js output byte for byte", () => {
  const text = sampleTransit();
  assert.equal(encode(decode(text)), text);
});

test("matches transit-js when the 1936-entry cache wraps around", () => {
  const keys: [string, unknown][] = Array.from({ length: 2500 }, (_, i) => [`key${i}`, `~#notATag${i % 3}`]);
  const text = writeTransit(new List([new IMap(keys), new IMap(keys.slice(0, 100), true), new Rec("r", { key5: 1 })]));
  assert.equal(encode(decode(text)), text);
});

test("decodes to the same shapes as transit.py", () => {
  const app = decode(sampleTransit()) as JsonObject;
  const json = stringifyJson(app);
  assert.match(json, /^\{"~#iR":\{"n":"appTemplate","v":\{"appMaxWidth":"100%"/);
  assert.match(json, /"plugins":\{"~#iOM":\{"table1":\{"~#iR":/);
  assert.match(json, /"columnWidths":\{"a":120,"10":80,"2":40\}/);
  assert.match(json, /"tiny":1e-7/);
  assert.match(json, /"folders":\{"~#iL":\[\]\}/);
  assert.match(json, /"createdAt":"~m\d+"/);
  assert.match(json, /"odd":\{"~#iR":\{"n":"pluginTemplate","v":\{[^]*"template":\{"~#iM":\[1,"one","query","select 1"\]\}/);
});

test("JSON keeps key order, number text and Python's formatting", () => {
  const text = '{\n  "b": 1.50,\n  "10": [],\n  "a": {},\n  "n": [\n    1e-07,\n    12345678901234567890\n  ],\n  "s": "\\u00e9\\n\\u0001"\n}';
  const v = parseJson(text);
  assert.deepEqual([...(v as JsonObject).keys()], ["b", "10", "a", "n", "s"]);
  assert.equal(((v as JsonObject).get("b") as Num).raw, "1.50");
  assert.equal(stringifyJson(v, 2), text.replace("\\u00e9", "é"));
  assert.equal(stringifyJson(v), '{"b":1.50,"10":[],"a":{},"n":[1e-07,12345678901234567890],"s":"é\\n\\u0001"}');
  assert.throws(() => parseJson('{"a": 1,}'), /Expected a string key at line 1/);
});
