import { createRequire } from "node:module";
import { Command } from "commander";
import { split } from "./commands/split.js";
import { compile } from "./commands/compile.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createProgram(): Command {
  const program = new Command()
    .name("unretool")
    .description("Split and compile Retool classic apps from their exported JSON file.")
    .version(version);

  program
    .command("split")
    .description("Split an exported Retool app JSON file into a directory of source files")
    .argument("<app.json>", "exported Retool app JSON file")
    .option("-o, --out <dir>", "output directory (default: the JSON file name without extension)")
    .action(split);

  program
    .command("compile")
    .description("Compile a split source directory back into a Retool app JSON file")
    .argument("<dir>", "directory created by `unretool split`")
    .option("-o, --out <file>", "output JSON file (default: <dir>.json)")
    .action(compile);

  return program;
}
