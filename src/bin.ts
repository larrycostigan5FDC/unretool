#!/usr/bin/env node
import { createProgram } from "./cli.js";

createProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(`unretool: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
