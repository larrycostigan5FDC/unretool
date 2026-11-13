import { createRequire } from "node:module";
import { relative } from "node:path";
import { Command } from "commander";
import { importApp } from "./import.js";
import { exportApp } from "./export.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const shown = (p: string) => relative(process.cwd(), p) || ".";
const ROOT_HELP = "project directory holding export/ and source/";

export function createProgram(): Command {
  const program = new Command()
    .name("unretool")
    .description("Import Retool classic app exports into source files, and export them back.")
    .version(version);

  program
    .command("import")
    .description("Split a Retool app export (export/*.json) into files under source/")
    .argument("[export_file]", "Retool export JSON (default: the only *.json in export/)")
    .option("-C, --root <dir>", ROOT_HELP, ".")
    .action((exportFile: string | undefined, opts: { root: string }) => {
      const r = importApp(exportFile, { root: opts.root });
      console.log(`Imported ${shown(r.exportFile)} -> ${shown(r.sourceDir)} (${r.plugins} plugins)`);
    });

  program
    .command("export")
    .description("Rebuild the Retool app export JSON in export/ from files in source/")
    .option("-o, --output <file>", "output path (default: export/<exportFile from manifest>)")
    .option("-C, --root <dir>", ROOT_HELP, ".")
    .action((opts: { output?: string; root: string }) => {
      const r = exportApp({ ...opts, warn: (m) => console.error(`warning: ${m}`) });
      console.log(`Exported ${shown(r.sourceDir)} -> ${shown(r.output)} (${r.plugins} plugins)`);
    });

  return program;
}
