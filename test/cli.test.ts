import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgram } from "../src/cli.js";

test("registers the same commands as the Python scripts", () => {
  const names = createProgram().commands.map((c) => c.name());
  assert.deepEqual(names.sort(), ["export", "import"]);
});
