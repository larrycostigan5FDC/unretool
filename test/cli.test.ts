import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgram } from "../src/cli.js";

test("registers split and compile commands", () => {
  const names = createProgram().commands.map((c) => c.name());
  assert.deepEqual(names.sort(), ["compile", "split"]);
});

test("split rejects until implemented", async () => {
  const program = createProgram().exitOverride();
  await assert.rejects(
    program.parseAsync(["split", "app.json"], { from: "user" }),
    /not implemented/,
  );
});
