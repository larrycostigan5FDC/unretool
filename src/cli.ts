import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { Command } from "commander";
import { splitExport } from "./split.js";
import { compileDir } from "./compile.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const shown = (p: string) => {
  const rel = relative(process.cwd(), p);
  return rel === "" ? "." : rel.startsWith("..") || isAbsolute(rel) ? resolve(p) : rel;
};

export function createProgram(): Command {
  const program = new Command()
    .name("unretool")
    .description("Split and compile Retool classic apps from their exported JSON file.")
    .version(version);

  program
    .command("split")
    .description("Split an exported Retool app JSON file into a directory of source files")
    .argument("<app.json>", "exported Retool app JSON file")
    .option("-o, --out <dir>", "output directory (default: the JSON file's path without its extension)")
    .option("-f, --force", "replace the output directory if it holds an earlier split")
    .action((input: string, opts: { out?: string; force?: boolean }) => {
      const r = splitExport(input, opts);
      console.log(`Split ${shown(input)} into ${shown(r.out)} (${plural(r.plugins, "plugin")}, ${plural(r.modules, "module")})`);
    });

  program
    .command("compile")
    .description("Compile a split directory back into a Retool app JSON file")
    .argument("<dir>", "directory created by `unretool split`")
    .option("-o, --out <file>", "output JSON file (default: <dir>.json)")
    .option("-f, --force", "overwrite the output file if it exists")
    .action((dir: string, opts: { out?: string; force?: boolean }) => {
      const r = compileDir(dir, { ...opts, warn: (m) => console.error(`warning: ${m}`) });
      console.log(`Compiled ${shown(dir)} into ${shown(r.out)} (${plural(r.plugins, "plugin")}, ${plural(r.modules, "module")})`);
    });

  return program;
}
