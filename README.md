# unretool
A command line tool that imports Retool classic app exports into source files you can
edit and review, and exports them back into a file Retool can import.

It replaces the Python `scripts/import_app.py` / `scripts/export_app.py` used in
PdoxLetters: the commands, folders and files are the same, and both tools produce
byte-identical output, so they can be used on the same project.

## Usage

Run from the project directory (the one holding `export/` and `source/`), or pass
`-C <dir>`:

```
unretool import [EXPORT_JSON]   # export/*.json -> source/
unretool export [-o OUTPUT]     # source/ -> export/<exportFile from source/manifest.json>
```

`import` uses the only `*.json` in `export/` when `EXPORT_JSON` is omitted. It
regenerates `source/plugins/` from scratch and leaves other files in `source/` alone.
It refuses to import an app whose `appState` wouldn't export back identically.

`export` writes plugins in the order of `$pluginOrder` in `source/app.json`. Plugin
files that aren't listed there are appended (with a warning), so to add a plugin you
can copy a similar `plugins/<id>.json` and change its `id`. Each file's name must
match the plugin's `id`.

## Layout

```
export/<name>.json         the Retool app export (as downloaded from Retool)
source/
  manifest.json            name of the export file this source maps to
  export.json              export wrapper (uuid, page metadata, changes record);
                           page.data.appState is "$appState: see app.json"
  app.json                 decoded appState (app settings); the plugins map is
                           replaced by {"$pluginOrder": [ids...]}
  plugins/<id>.json        one decoded plugin (component, query, state, ...)
  plugins/<id>.<field>.<ext>  (or <id>.<ext> when field == ext, e.g. html4.css)
                           code fields (SQL, JS, CSS, HTML, multi-line text) pulled
                           out of the plugin template; the JSON holds
                           {"$file": "<id>.<field>.<ext>"} in their place
```

The template fields `query`, `transformer`, `css`, `html`, `javascript`, `funcBody`
and `script` are always extracted when non-empty, as is any other multi-line string.
Queries get `.sql` for SQL subtypes, `.js` for `JavascriptQuery`/`Function`, and
`.txt` otherwise.

`page.data.appState` is Transit JSON. The decoded files keep its tags inline:
`{"~#iR": {"n": ..., "v": ...}}` for Immutable Records, `{"~#iM": {...}}` and
`{"~#iOM": {...}}` for Immutable Maps, `{"~#iL": [...]}` for Lists, and strings such
as `"~m1759583917404"` (dates) as-is. `export` re-applies the Transit write cache as
transit-js does.

## Development

Requires Node 18+.

```
npm install          # also builds dist/
npm run dev -- --help  # run from source with tsx
npm run build        # compile to dist/
npm test             # node:test suite
npm link             # put `unretool` on your PATH
```
