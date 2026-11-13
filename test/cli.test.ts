import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgram } from "../src/cli.js";

test("registers the import, export and diff commands", () => {
  const names = createProgram().commands.map((c) => c.name());
  assert.deepEqual(names.sort(), ["diff", "export", "import"]);
});
