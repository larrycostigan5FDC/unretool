# unretool
A command line tool that splits and compiles Retool classic apps from their exported JSON file.

## Usage

```
unretool split <app.json> [-o <dir>] [--force]
unretool compile <dir> [-o <file.json>] [--force]
```

`split` writes `<app.json>` without its extension (e.g. `My App.json` -> `My App/`).
`compile` writes `<dir>.json`. Neither overwrites existing output without `--force`,
and `split --force` only replaces a directory that `split` created.

Files follow the types in [`src/retool-classic-export.ts`](src/retool-classic-export.ts).
Both commands check their input and output against them.

## Split layout

```
My App/
  export.json          the export (RetoolAppExport); appState strings point to the app dirs
  app.json             appTemplate settings; plugins maps each id to its file
  app.js, app.css      preloadedAppJavaScript and appStyles
  plugins/<id>.json    one file per component, query, state variable, ...
  plugins/<id>.sql     query text (.sql, .js or .graphql, by plugin subtype)
  transit.json         Transit types that plain JSON can't hold (generated; don't edit)
  modules/<uuid>/      the same layout for each module
```

Values that `split` moved into files are written as `"unretool:file:<path>"`.

`page.data.appState` is a Transit-encoded Immutable.js structure. `split` decodes it,
and `compile` re-encodes it with the same tags and Transit write caching as
transit-js, so an unchanged split compiles back to a byte-identical file.

To add a plugin, add `plugins/<id>.json` (copying a similar plugin is easiest).
`compile` picks up plugin files that `app.json` doesn't list and takes their Transit
types from a plugin with the same subtype.

## Development

Requires Node 18+.

```
npm install          # also builds dist/
npm run dev -- --help  # run from source with tsx
npm run build        # compile to dist/
npm test             # node:test suite
npm link             # put `unretool` on your PATH
```
