# Folder sites

A folder site is a Culm site kept as a folder of JSON files. A person edits the files in any editor. An agent changes them through the MCP server. `@culmjs/tools` loads the folder into the canonical document, writes changes back into the same files, serves the site while you edit, builds it, and measures it in a browser.

Every error and every measure finding on a folder site names a file and a line.

This page is the reference for the folder and its files. For the agent side, see [mcp.md](mcp.md). For the document model underneath, see [overview.md](overview.md).

## The folder

```text
my-site/
  culm.json          plug-in package names, output folder
  site.json          name, look, styles, fonts, languages, header, footer
  pages/*.json       one page per file
  pieces/**/*.json   reusable subtrees with named settings
  blocks/*.json      blocks written as data
  data/<source>.json rows for a data source
  assets/            files the pages use (copied to assets/ in the output)
  fonts/             font files (copied to _fonts/ in the output)
  .culm/             Culm's own record; not edited by hand
```

A project is a folder with a `culm.json`. Every `culm` command run outside one stops with one problem that names `culm.json`.

All files are JSONC: JSON with comments. Culm keeps your comments, key order and indentation when it writes (see "What is kept when Culm writes").

`culm init` does not exist yet; it comes with the starter package in checkpoint 2c. For now, copy `packages/tools/__tests__/fixtures/site-basic` in the Culm repository, which has one of each file below.

## The files

### `culm.json`

```jsonc
{
  "$schema": "./culm.schema.json",
  "plugins": [], // package names, imported from this folder's node_modules
  "out": "dist", // where `culm build` writes
}
```

- `plugins` lists plug-in packages by bare name (`my-plugin`, `@scope/my-plugin`). Culm imports each from `<folder>/node_modules/<name>` and registers its default export. A path, an absolute path or a package that exists only in a parent folder is refused with a problem at that line. A project therefore has a `package.json` and installs `@culmjs/tools` and its plug-ins with npm.
- `out` is the build folder. It may not be, or lie inside, `blocks`, `pages`, `pieces`, `data`, `assets`, `fonts`, `node_modules`, `.culm`, `site.json` or `culm.json`, and may not leave the project.

### `site.json`

```jsonc
{
  "$schema": "./culm.schema.json",
  "name": "Corner Bakery",
  "look": {
    /* a Look: id, name, family, brand, ink, bg, fonts, corners, dark */
  },
  "styles": { "textRange": { "min": 11, "max": 96 } },
  "fonts": ["sys:sans"],
  "languages": [{ "code": "en" }],
  "pages": ["home.json", "menu.json"], // order of pages; file names in pages/
  "header": { "block": "pageheader" }, // a node, a short form or a use
  "footer": { "block": "pagefooter" },
}
```

The `pages` list is the order of the pages. A file in `pages/` that the list does not name is a problem, and so is a name in the list with no file.

### `pages/<name>.json`

```jsonc
{
  "$schema": "../culm.schema.json",
  "id": "menu",
  "title": "Menu",
  "slug": "/menu",
  "on": true,
  "inMenu": true,
  "inFooter": false,
  "icon": "",
  "root": {
    "kind": "column",
    "name": "Page",
    "children": [
      { "block": "hero", "look": "plain", "title": "Today's bakes" }, // short form
      { "use": "../pieces/visit-card.json", "note": "Open from 7" }, // use of a piece
      {
        "id": "intro",
        "kind": "text",
        "name": "Intro", // a plain node
        "props": { "runs": [{ "text": "Baked every morning." }] },
      },
    ],
  },
}
```

File names are free. When `addPage` creates a page file, it names it from the slug with each `/` after the first replaced by `-` (`/a/b` becomes `a-b.json`), and `home.json` for `/`. A name already taken gets `-2`.

A page that is on and whose first slug segment is `assets`, `_fonts` or `culm-manifest.json` would collide with what a build writes, and is refused with the file and line of the slug.

### A node, a short form, a use

A page's `root`, and every child, is one of three things.

- **A node** is the document's node with `id`, `slot` and `name` optional. A missing `slot` is the default for the parent's kind; a missing `name` is the kind's label.
- **A short form** is `{ "block": id, "look"?: id, "id"?: id, ...settings }`. Every other key is a setting of that block. The loader expands it with the registered block, so a short form can use only what the block declares. An unknown setting is a problem at the key.
- **A use** is `{ "use": path, "id"?: id, "name"?: text, ...values }`. The path is relative to the file. Every other key is a value for one of the piece's settings. `name` is the name of the node; a piece that declares a setting called `name` keeps that key for the setting, and a differing node name on such a use is a problem.

`culm expand <file> <id>` rewrites one short form in a file as its nodes, so you can then edit the parts inside it.

### `pieces/**/*.json`

```jsonc
{
  "id": "visitcard", // optional; else derived from the file path
  "name": "Visit card", // optional; else the file's path
  "settings": [
    { "key": "note", "label": "Note", "type": "text", "part": "line" },
  ],
  "root": { "id": "card", "kind": "box", "name": "Visit", "children": [] },
}
```

A piece is a reusable subtree. The loader makes one component per piece file and one instance per use. A change addressed to the piece's tree edits the piece file, so every use changes; a change through `setInstance` edits the one use. Two pieces with the same id are refused, with the file and line of both. A circular use, a use of a missing piece and a use whose path leaves the project are each a problem at the use. The order of components is not meaningful.

### `blocks/*.json`

```jsonc
{
  "id": "openinghours",
  "version": 1,
  "name": "Opening hours",
  "category": "content",
  "looks": [{ "id": "list", "name": "List", "tree": {} }],
  "settings": [],
}
```

A block written as data: the document's `BlockDef` with no function fields. A file that names a function (`onInsert`, or a setting with `fn`) is refused with file and line. A bad block file is skipped alone; the others still register. All block files register as one local plug-in named `local`.

### `data/<source>.json`

```jsonc
{
  "fields": { "name": "text", "price": "text" },
  "rows": [{ "name": "Sourdough", "price": "6" }],
}
```

This is how a project declares a data source without TypeScript. The loader registers a source of that name with those fields, and passes the rows to the compiler after `checkRows`; a row with an unknown field is a problem at the row. Data files are not part of a revision.

### Fonts and files

`fonts/` is copied to `_fonts/` in the output and `assets/` to `assets/`. Culm ships no font files. A site that names a catalogue font whose file is not in `fonts/` gets a problem from `culm build` and `culm dev`. `culm check` does not report it as a problem: the font cannot load, the page is measured with its fallback font, and the findings say `assets: false`. A site that uses only system font stacks (`sys:sans`, `sys:serif`) needs no font file.

## Ids

A node written without an id gets one derived from its file and position: `x` followed by 12 characters of a base-36 hash of the file path and the JSON path. It fits the id rule (`^[a-z0-9]{1,20}$`) and cannot collide with the `n` ids the operations assign.

A derived id changes when you insert or reorder siblings by hand, so a finding or a diff for such a node does not survive that edit. The loader reports each node without a written id as a notice, not a problem. The writer writes an id into the file for every node an operation touches, and for all children of a parent whose order changes. A node that a trigger or anything else refers to by id must have a written id, and the loader reports it if not.

## What is kept when Culm writes

Loading a folder and writing it back with no change leaves every file byte for byte the same: key order, indentation, comments, line endings and a byte order mark.

When an operation changes the site, the writer takes the difference between the head document and the new one, finds each changed node in the source map, and edits that file in place with `jsonc-parser`. A change to one field touches one line of one file. A moved element takes its trailing comment and the block comment above it. Created and deleted files (`addPage`, `removePage`, `makeComponent`, `removeComponent`) go through the same journal as edits.

Two things you may notice:

- Changing an inner part of a short form first rewrites that short form in expanded form. `apply`'s result says so in its `notes`, naming the node; `plan` does not show that note. A change a setting of the short form can hold leaves it a short form.
- A node moved to another parent is rewritten whole, and a comment inside it that was attached to the old place is lost.

An edit that cannot be made (a file with a syntax error, a path through a scalar) is a located problem, and nothing is written.

## Errors point at the file

Each problem has a code, the file, the line and column, what is wrong, and the allowed values. `culm build` and `culm check` print them as

```text
pages/home.json:14:9 UNKNOWN_KIND Its kind "marquee" is not one this site knows.
  allowed: free, box, row, column, grid, list, table, ...
```

A measure finding is located at its first node. A finding on a part of a short form is located at the short form's line, because the settings of a short form do not name the part they change.

A syntax error in a JSON file is one problem for that file, and no document loads until it is fixed. A symbolic link that leaves the project is refused at the link, with file and line.

## Commands

| Command                               | Does                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `culm dev [--port n]`                 | Serves the compiled pages on `127.0.0.1` (default port 4321), watches the folder, recompiles on save and reloads the page through server-sent events. On a problem it keeps serving the last good pages and draws an overlay. |
| `culm build`                          | Writes the compiled pages, `assets/`, `_fonts/` and `culm-manifest.json` to `out`. It writes nothing when anything is a problem.                                                                                              |
| `culm check [--chrome path]`          | Validates, then measures every page in Chrome, and prints problems and findings with file and line.                                                                                                                           |
| `culm expand <file> <id>`             | Rewrites one short form as its nodes.                                                                                                                                                                                         |
| `culm schema`                         | Writes `culm.schema.json`.                                                                                                                                                                                                    |
| `culm mcp [--port n] [--chrome path]` | Starts the MCP server (see [mcp.md](mcp.md)).                                                                                                                                                                                 |

Exit codes: 0 done; 1 problems or findings; 2 wrong usage, or `check` could not measure. `culm check` exits 1 on any problem, or on a finding of class 1 or 2, and 2 when measure could not run or was incomplete, so a missing browser is told apart from a finding.

### `culm dev`

The server binds `127.0.0.1` only and has no option to bind elsewhere. It refuses a request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`. It serves `assets/` and `fonts/` (as `/_fonts/`) from the project and nothing outside it, including through a symbolic link.

On a save, the server waits 50 ms for the burst of file events to end, reloads the folder, compiles, and swaps the new pages in whole. It then sends a `reload` event and the page reloads itself.

When the save leaves a problem, the pages on screen stay the last good ones, and an overlay shows each problem as `file:line:column`, the message and the allowed values. Fix the file and the next save sends `reload`. Before the first good compile every page path answers 503 with the client script, so the overlay can show.

The reload and overlay code is added by the server to what it serves. It is in no file `culm build` writes (`CLIENT_MARKER is absent from every file buildSite writes`).

`culm dev` also writes `culm.schema.json` when it starts, and again when a plug-in or a file in `blocks/` changes.

### `culm build`

`culm build` refuses an output folder that is not empty and holds no `culm-manifest.json`, so it cannot clear a folder it did not write. It clears an output folder only if that folder holds a manifest Culm wrote, and only inside it. It refuses an `out` that resolves, by real path, to a source folder, a parent of the project, or a symbolic link out, in any letter case on a case-insensitive disk. A site with no page at `/` is a problem. `build` and `dev` make no network request.

The manifest's `build` is one hash of what the build used: the document, the data, the registry and the hash of every file in `assets/` and `fonts/`.

### `culm check`

`culm check` measures each page at widths 1280, 834 and 390, in the light and dark themes and in each direction the site's languages declare, with the default state of each part. That is the measure profile, version 1. It opens Chrome over the DevTools protocol on a pipe; no port opens, and no browser is ever downloaded.

Chrome is found from `--chrome`, or `CULM_CHROME`, or a Chromium already installed by `npx playwright install chromium` (found on disk; Playwright itself is not used), or the system Chrome, in that order. If none is found, the run is `MEASUREMENT_INCOMPLETE`, the message names those three ways, and the exit code is 2.

Measure serves each page from memory under a Content-Security-Policy, answers only requests the compiled bundle can answer, and refuses every other address. A page cannot make Culm contact the network.

## `.culm/`: Culm's own record

```text
.culm/
  head                current revision number
  blobs/<sha256>      file contents, stored once each
  revisions/<n>.json  { files: { path: sha256 }, by: "culm" | "outside", key?, request?, result?, time }
  journal.json        present only while a batch is being written
  lock                present only while a process is writing
```

`.culm/` is the history of the folder. A revision is a set of file contents, not a copy of the document, so a restore writes those contents back and comments and layout return exactly. It is not edited by hand, and `culm init` will write a `.gitignore` that excludes it, so history is per machine.

- **What a revision covers.** `culm.json`, `site.json`, and every file under `pages/`, `pieces/` and `blocks/`. Not `data/`, `assets/` or `fonts/`.
- **Only `apply` and `restore` write to `.culm/`.** `dev`, `build`, `check`, `schema`, `expand` and every read write nothing there.
- **A batch is wholly visible or wholly absent**, with its key, including after a crash at any step. The rename of `head` is the single commit point. On the next open, a revision record above `head` is deleted, and the files in a journal are restored from the head revision's blobs.
- **Hand edits.** `apply` and `restore` record an outside revision first if the files changed since `head`, holding the lock, and the revision number always advances. Any number of saves between two batches is one outside revision. A batch from a revision before it is `REVISION_CONFLICT`.
- **`SOURCE_CONFLICT`.** The revision matched when the batch was planned, and a file to be edited changed before the write. Nothing is changed.
- **Files that do not load.** Nothing is recorded. `head` returns the located problems, and `plan`, `apply`, reads and `measure` return them as the refusal until the files load again.
- **The lock** is stale when its process is gone or it is older than 60 seconds. It is taken over by an atomic rename, so only one of two contenders succeeds. `culm dev` and `culm mcp` can run on one folder; only writers take the lock.
- **Size.** The last 200 revisions are kept, with their keys. Blobs no kept revision names are deleted when revisions are pruned. A restore or diff that names an older revision is `UNSUPPORTED_CAPABILITY`, and a key of a pruned revision is treated as new.

### What losing `.culm/` means

Your files are the site. If `.culm/` is deleted:

- the site loads and builds exactly as before;
- every earlier revision is gone, so `diff` and `restore` to an older revision are `UNSUPPORTED_CAPABILITY`;
- every request key is forgotten, so a retry of a batch sent before the loss is applied again, not answered from the record;
- the next revision numbers are the Unix time in seconds, and count up from it, so a number from the lost history is lower than any number in the new one. A batch, cursor or key that names an old number is refused, never matched to a different state.

A store that is running when `.culm/` is deleted never restarts at an old number either. Damage that is not a clean deletion (a missing `head` beside several revision records, an unreadable record) is reported as a problem naming the file, and nothing is rewritten.

## The JSON Schema for editors

`culm schema` writes `culm.schema.json`, generated from the registry: the node fields, the settings and style properties each kind allows, short forms with each block's settings, uses of pieces, and the site and page files. Every file's `$schema` names it, so an editor completes keys and flags a misspelt kind.

The schema and `validateSite` are two statements of what is valid, and they can disagree. The schema never refuses what validation accepts; this is tested on every valid fixture. The reverse is allowed: the schema cannot express depth and count limits, references between nodes, or a product's rules, so a file that passes the schema in the editor can still fail validation on save.

## What this does not protect

Two limits are stated here and are not tested away.

1. **A plug-in in `culm.json` runs as code.** Culm imports each named package and runs it with the privileges of the process, which is yours. A plug-in can read and write any file you can, and open the network. Install only plug-ins you would run. A package folder in `node_modules` that is a symbolic link to somewhere else still loads, because workspaces and pnpm link packages that way; only an install can create such a link. Block and data files are data: they cannot name a function.
2. **A caller with file access can bypass every operation.** The operations, the revision check, the request keys and the `protect` guard (see [mcp.md](mcp.md)) are rules for callers that go through `plan` and `apply`. Anyone or anything that can write the files can write a file the guard would have refused. Culm then sees an outside revision and validates it on the next load, but it does not stop the write. Protect the folder as you protect the source of the site.

## Not built yet

`culm init` and the starter package (checkpoint 2c). A change to a plug-in's own code is not picked up by `culm dev`: Node caches an imported module, so restart the server.
