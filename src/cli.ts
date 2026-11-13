import { createRequire } from "node:module";
import { relative } from "node:path";
import { Command } from "commander";
import { importApps } from "./import.js";
import { exportApps } from "./export.js";
import { diffApps, formatMarkdown, formatText } from "./diff.js";
import { writeText } from "./layout.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const shown = (p: string) => relative(process.cwd(), p) || ".";
const warn = (m: string) => console.error(`warning: ${m}`);
const ROOT_HELP = "project directory holding export/ and source/";

export function createProgram(): Command {
  const program = new Command()
    .name("unretool")
    .description("Import Retool classic app exports into source files, export them back, and compare apps.")
    .version(version);

  program
    .command("import")
    .description("Split Retool app exports (export/<name>.json) into files under source/<name>/")
    .argument("[export_files...]", "export files or app names (default: every *.json in export/)")
    .option("-C, --root <dir>", ROOT_HELP, ".")
    .action((exportFiles: string[], opts: { root: string }) => {
      for (const r of importApps(exportFiles, { root: opts.root, warn })) {
        console.log(`Imported ${shown(r.exportFile)} -> ${shown(r.sourceDir)} (${r.plugins} plugins)`);
      }
    });

  program
    .command("export")
    .description("Rebuild Retool app export JSON in export/ from files in source/<name>/")
    .argument("[apps...]", "app names, i.e. folders in source/ (default: every imported app)")
    .option("-o, --output <file>", "output path, for a single app (default: export/<exportFile from manifest>)")
    .option("-C, --root <dir>", ROOT_HELP, ".")
    .action((apps: string[], opts: { output?: string; root: string }) => {
      for (const r of exportApps(apps, { ...opts, warn })) {
        console.log(`Exported ${shown(r.sourceDir)} -> ${shown(r.output)} (${r.plugins} plugins)`);
      }
    });

  program
    .command("diff")
    .description("Show what changed between two apps: added, removed and changed components and queries")
    .argument("<from>", "the original app: an app name or an export file")
    .argument("<to>", "the changed app: an app name or an export file")
    .option("-m, --markdown", "write Markdown, e.g. for a pull request or a message to teammates")
    .option("-o, --output <file>", "write to a file instead of the terminal")
    .option("-C, --root <dir>", ROOT_HELP, ".")
    .action((from: string, to: string, opts: { markdown?: boolean; output?: string; root: string }) => {
      const d = diffApps(from, to, { root: opts.root, warn });
      const text = opts.markdown ? formatMarkdown(d) : formatText(d);
      if (opts.output) {
        writeText(opts.output, text);
        console.log(`Wrote ${shown(opts.output)}`);
      } else {
        process.stdout.write(text);
      }
    });

  return program;
}
