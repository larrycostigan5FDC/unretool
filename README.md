# unretool
A command line tool that imports Retool classic app exports into source files you can
edit and review, and exports them back into a file Retool can import.

It started as a replacement for the Python `scripts/import_app.py` /
`scripts/export_app.py` used in PdoxLetters, and the files it writes for each app are
the same. Unlike those scripts, it handles any number of apps, one folder per app
under `source/`, and can compare two apps.

## Usage

Run from the project directory (the one holding `export/` and `source/`), or pass
`-C <dir>`:

```
unretool import [EXPORT ...]      # export/<name>.json -> source/<name>/
unretool export [APP ...]         # source/<name>/ -> export/<name>.json
unretool diff FROM TO [-m] [-o F] # what changed between two apps
```

`import` imports every `*.json` in `export/` when no files are given. Each argument
can be a path to an export file or an app name (`MyApp` means `export/MyApp.json`).
An app's name is its export file name without `.json`, and it is imported into
`source/<name>/`. Import regenerates `source/<name>/plugins/` from scratch and leaves
other files in `source/<name>/` alone. It refuses to import an app whose `appState`
wouldn't export back identically.

`export` exports every app in `source/` when no names are given. `-o OUTPUT` writes
somewhere other than `export/` and needs a single app. Plugins are written in the
order of `$pluginOrder` in `source/<name>/app.json`. Plugin files that aren't listed
there are appended (with a warning), so to add a plugin you can copy a similar
`plugins/<id>.json` and change its `id`. Each file's name must match the plugin's `id`.

### Comparing apps

To update an app, it's common to copy it in Retool, change and test the copy, and
then carry the changes over to the original. `diff` lists what to carry over:

```
unretool diff MyApp MyApp-copy              # readable summary in the terminal
unretool diff MyApp MyApp-copy -m -o pr.md  # Markdown, for a PR or a message
```

Plugins (components, queries, transformers, state, ...) are matched by id and listed
as added, removed or changed. For a changed plugin each changed property is listed,
such as `template.data: "{{ a }}" -> "{{ b }}"`, and code and other long values get
a line diff. App-level settings and export file fields that changed come last.

Copying an app in Retool keeps its plugin ids, so a copy lines up with its original.
A renamed plugin shows as one removed and one added. Things that change on every save
or copy are left out: plugin and app `createdAt`/`updatedAt`, and the export's
`uuid`, `page.id`, `page.pageId`, `page.userId`, `page.createdAt`, `page.updatedAt`,
`page.changesRecord` and `page.checksum`.

`FROM` and `TO` are app names or paths to export files. A name is read from
`source/<name>/` when that app has been imported, so edits not yet exported are
included, and from `export/<name>.json` otherwise. If the two differ you get a
warning; run `import` or `export` to bring them in line.

## Layout

```
export/<name>.json           a Retool app export (as downloaded from Retool); any number
source/<name>/               one folder per export
  manifest.json              name of the export file this source maps to
  export.json                export wrapper (uuid, page metadata, changes record);
                             page.data.appState is "$appState: see app.json"
  app.json                   decoded appState (app settings); the plugins map is
                             replaced by {"$pluginOrder": [ids...]}
  plugins/<id>.json          one decoded plugin (component, query, state, ...)
  plugins/<id>.<field>.<ext> (or <id>.<ext> when field == ext, e.g. html4.css)
                             code fields (SQL, JS, CSS, HTML, multi-line text)
                             pulled out of the plugin template; the JSON holds
                             {"$file": "<id>.<field>.<ext>"} in their place
```

Projects from before per-app folders kept a single app directly in `source/`. Delete
`source/manifest.json`, `app.json`, `export.json` and `plugins/` and run
`unretool import` to switch over. The tool reports the old layout if it finds one.

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
