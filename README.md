# unretool
A command line tool that splits and compiles Retool classic apps from their exported JSON file.

## Usage

```
unretool split <app.json> [-o <dir>]     # exported app JSON -> directory of source files
unretool compile <dir> [-o <file.json>]  # directory -> app JSON for import into Retool
```

## Development

Requires Node 18+.

```
npm install          # also builds dist/
npm run dev -- --help  # run from source with tsx
npm run build        # compile to dist/
npm test             # node:test suite
npm link             # put `unretool` on your PATH
```
