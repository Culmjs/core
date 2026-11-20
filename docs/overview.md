# Culm: what it is

Culm is a JavaScript framework that builds websites from data. This page says exactly what exists in the repository today. The package is `@culmjs/core`. It has no runtime dependencies and runs in Node 22+, edge workers and the browser.

This page covers stage 1 (the document, validation and the compiler) and checkpoint 2a of stage 2 (checked operations, reads, the catalogue, diff and restore). Stage 2 is not finished: measure, the folder loader, the command, the MCP server and the starter package are checkpoints 2b and 2c, and they do not exist yet. The API will change before a first release.

## The idea in three sentences

A site is one versioned JSON document. People and agents change the document, never page code. Culm checks the document and compiles it to static HTML and CSS, and it compiles nothing from a document that has problems.

## The site document

The document holds the pages and what they share.

| Part                      | Holds                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `schemaVersion`           | Which stored structure the document uses. Today it is 2                                        |
| `pages`                   | Each page has an id, a title, a slug and a root node                                           |
| `header`, `footer`        | A node tree each, shared by every page                                                         |
| `components`              | Reusable trees. An `instance` node points at one                                               |
| `fonts`, `styles`, `look` | Fonts in use, named styles (colours, text styles, spacing, shadows) and the site's look tokens |
| `languages`               | Language codes and direction                                                                   |

A page slug is a site path. It begins with `/`, the home page is exactly `/`, and each segment uses lowercase letters, digits and dashes. `compileSite` reports a problem when no page that is switched on has the slug `/`, and still returns the files, so a preview can show a site that has no home page yet.

### Nodes

A page is a tree of nodes. A node has:

- `id`, `kind` and `name`
- `props`: the settings its kind allows
- `style`: layers for base, tablet, phone, dark mode, interaction states (hover, pressed, focus and others) and declared states
- `children`
- optional `state` and `on`: declared states and the triggers that change them
- optional `repeat`, `bind`, `showIf`: data binding and conditional display
- optional `slot` and `placement`: how it sits in its parent

There are 21 core kinds, all layout or content: `free`, `box`, `row`, `column`, `grid`, `list`, `table`, `table-row`, `table-cell`, `text`, `image`, `icon`, `button`, `divider`, `embed`, `video`, `menu`, `form`, `field`, `details` and `instance`. A plug-in can add more.

The limits are 2,000 nodes per page and 12 levels of nesting. `KINDS`, the table of core kinds, is frozen along with everything in it, so a consumer cannot change a kind for every registry in the process.

### Required content and text size

A node can be marked `required: true`. A required node must stay in the site and stay visible:

- Validation refuses a document in which a required node is hidden, with a `POLICY_VIOLATION` whose `rule` is `required`. The hiding can be a `hide` flag for any layout, `hidden: true` in any style layer, an instance override or component variant that hides the part, or a hidden ancestor. The problem names the node and the path of the hiding.
- A required `text` must keep a run that has text or a data binding. For a text inside a component, each use of the component is judged by the text it shows.
- `remove` refuses a subtree that holds a required node. It also refuses to remove the last instance of a component that holds one.
- A `form` is required unless it is marked `required: false`. A `field` is required unless it is marked `required: false` or its form is. These two kinds are the only ones that can be marked `false`.

To take required content out on purpose, change the mark first, in the same batch: `setRequired` with `null` deletes the mark, and with `false` it opts a form or field out. A form is required by its kind, so it needs `false`. The refusal is meant to be a decision, not an accident.

The site styles can also hold `textRange: { min, max }`, whole numbers from 1 to 400. A text size outside the range, in a node layer, a run style, a named text style or the smallest value of a fluid size, is refused with a `POLICY_VIOLATION` whose `rule` is `textRange` and whose `allowed` is `[min, max]`. With no `textRange`, no size is refused. `setSiteStyles` sets it, and `null` removes it.

### Versions and migration

`migrate(doc)` runs registered steps from the document's version to the current one. It is pure, never changes its input, refuses a document from a newer version, and reports the path of the first node a step could not migrate. `previewMigration` is the same function under the name a tool uses to show what a migration would do.

The schema version is 2. The one step, from 1 to 2, gives `required: false` to every form or field that version 1 hides, because version 2 refuses a hidden required node and version 1 documents could hide a form. A version 1 document that hides nothing gains no field. `restore` migrates an older revision the same way before it checks it.

## Plug-ins

A product creates a registry and registers plug-ins on it. There is no global registry.

```ts
const registry = createRegistry()
registry.use(myPlugin)
```

A plug-in is a plain object. It declares its `name`, `version`, the Culm API versions it supports (`api`, currently `[1]`), when it runs and its trust tier, and it may carry:

| Field        | What it adds                                                                       |
| ------------ | ---------------------------------------------------------------------------------- |
| `blocks`     | Ready-made sections, described below                                               |
| `sources`    | Data sources: a name, the fields of a row and sample rows                          |
| `rules`      | Extra validation. A rule is a named function from a document to a list of problems |
| `kinds`      | Extra node kinds                                                                   |
| `settingFns` | Named functions for the rare block setting that cannot be declared as data         |

Registering two things under one name is an error.

### Blocks

A block has an id, a version, a name, a category and a list of **looks**. A look is a fixed tree of core nodes. `insertBlock` copies a look's tree into the site, gives every node its own id and tags the root with the block's name and version. From then on the nodes belong to the site, and each one can be edited on its own. A stored site never points back at a block.

A block's **settings** are data. A setting has a key, a label, a type and a list of actions:

| Action   | Does                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| `set`    | Writes the value to one or more paths in the tree                                               |
| `choose` | Each option maps to a bundle of writes and removals. Keys owned by any option are cleared first |
| `show`   | Hides or shows named nodes depending on whether the value is empty                              |
| `filter` | Sets a list's filter to a field and value                                                       |

`applySetting` validates the value, runs the actions and returns a new tree. `readSettings` reads the current values back from the same declaration. One setting can serve looks with different parts: a path whose node a look does not have is skipped.

Because a block with no functions is only data, it can be written as JSON.

### Data

A `list` node repeats its child over the rows of a named source. The query lives in the tree: filter, exclude, sort, skip, limit, group and nested repeats over a row's own collection. Text and settings can bind to a field of the current row or to a single value.

Culm never fetches. The caller passes the rows:

```ts
compilePage(site, pageId, {
  registry,
  data: {
    rows: { projects: [{ title: 'Alpha', years: '2024' }] },
    values: { 'has.projects': true },
  },
})
```

Rows are checked against the source's declared fields before anything compiles.

## Validation

```ts
const problems = validateSite(doc, registry)
```

`validateSite` checks the shape of the document, every tree (kinds, settings, styles per kind, which kinds may sit where, ids, limits, bindings against the data sources, component references and cycles), fonts and named styles, and then runs every registered rule. It returns a list and does not throw.

A problem has a stable `code`, a `message`, and where they apply a `nodeId`, a `path` to the field, the `allowed` values and the `rule` that raised it.

| Code                      | Means                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| `INVALID_DOCUMENT`        | The document's shape, version or a site-level value is wrong          |
| `INVALID_NODE`            | A node's field, id, style or position is wrong                        |
| `UNKNOWN_KIND`            | A node's kind is not registered                                       |
| `UNKNOWN_COMPONENT`       | An instance points at a component that is missing                     |
| `UNKNOWN_BLOCK`           | A block or look is not registered                                     |
| `UNKNOWN_SOURCE`          | A list or binding names a data source or field that is not registered |
| `RESOURCE_LIMIT_EXCEEDED` | A node, depth or byte ceiling was passed                              |
| `POLICY_VIOLATION`        | A product's own rule refused the document                             |

Wording may change. Codes keep their meaning.

A field or setting that Culm does not know, or does not act on yet, is refused. Nothing is dropped silently.

## Changing a site

A change is a request: a list of operations, applied to a known revision of a site. Nothing here changes a document in place. Every operation takes a document and returns a new one, or a refusal.

### Operations

There are 26 operations. Each has typed arguments, and `catalogue` lists them with an example of each.

| Group      | Operations                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Nodes (11) | `add`, `remove`, `move`, `setProps`, `setText`, `setStyle`, `setHidden`, `setSlot`, `setRequired`, `bindData`, `setStates` |
| Blocks (3) | `insertBlock`, `setBlockSetting`, `updateBlock`                                                                            |
| Pieces (4) | `makeComponent`, `setInstance`, `detach`, `removeComponent`                                                                |
| Site (8)   | `addPage`, `removePage`, `setPage`, `movePage`, `setSite`, `setLook`, `setSiteStyles`, `setFonts`                          |

A node is addressed by a tree and an id: `{ tree: 'header' | 'footer' | { page: id } | { component: id }, id }`. A component's tree has its own ids, apart from the pages. `add` fills in an id (the lowest unused `n` id), a slot and a name when the node leaves them out. `detach` turns an instance back into its own nodes with new ids. `updateBlock` brings an inserted block to the registered version of its block and lists, as a note, the parts a person had changed.

A refusal is a list of problems. Each has a stable `code`, a `message`, and where they apply the `nodeId`, the `path` of the field, the `allowed` values and the `rule`. A problem from a batch also has `op`, the index of the operation that raised it. For a problem that a validation found at the end, `op` is the last operation that changed that node, and a problem that names no node has no `op`. `INVALID_OPERATION` means the operation itself is wrong (an unknown id, a value of the wrong type, an unsafe key, an unknown operation name, with the allowed names listed). `UNKNOWN_BLOCK`, `POLICY_VIOLATION` and the other codes of validation mean the same as in validation.

### The change contract

```ts
{ site: 'main', baseRevision: 0, key: 'first-change', ops: [ /* up to 200 operations */ ] }
```

- `baseRevision` is the revision the request was made from. If the site has moved on, the request is refused with `REVISION_CONFLICT` and nothing is written.
- `key` is the request key, 1 to 200 characters. The same key with the same content returns the first result and applies once. The same key with other content is refused with `KEY_CONFLICT`. A refused batch does not use its key up: it is planned again if sent again.
- The batch is all or nothing. The operations run in order on a copy, and a later one can use what an earlier one created. The first refusal stops the batch.
- The document is validated once, after the last operation. A batch whose result has any problem is refused whole, and the problems come back.
- A request holds at most 200 operations and 1,000,000 characters of canonical JSON. Past either, it is refused with `RESOURCE_LIMIT_EXCEEDED`.

`plan(doc, registry, request, allow?)` runs the batch on a document and returns the result without a store. `apply(store, registry, request, allow?)` does the same against a store, in four steps: replay the key, check the revision, plan, commit. Both return problems and never throw for a bad request. A store that throws makes `apply` reject with that error.

A successful result has `created` and `changed` (node references, with no repeats), `pages` (the ids of the pages affected), `notes`, and from `apply` the new `revision`. A note has a `kind` (`reset`, `expanded` or `info`), the node `ids` it is about and a `text`. One note says which links now lead to no page after a page was removed, switched off or given another slug. Culm does not rewrite links.

`allow` is a function a product passes to refuse an operation for its own reasons. It is called once for each operation, with the operation and the working document, and returns a problem or nothing. The result is a `POLICY_VIOLATION` with the rule it gave, or with the rule `allow` if the function threw.

### The store

A store is the interface the contract writes through:

| Method                                                  | Does                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `head(site)`                                            | The latest `{ revision, doc }`, or problems if there is no such site                                                                                 |
| `get(site, revision)`                                   | The document of one revision, or `undefined`                                                                                                         |
| `replay(site, key)`                                     | The request and result recorded under a key, or `undefined`                                                                                          |
| `commit(site, { expected, doc, key, request, result })` | Writes revision `expected + 1` if the head is `expected`, as one step. Otherwise it returns `REVISION_CONFLICT`, `KEY_CONFLICT` or `SOURCE_CONFLICT` |

`memoryStore({ main: doc })` is a store in memory. It keeps every revision with its key, request and result, and copies in and out, so a document it returned cannot be used to change it. A store for files or a database follows the same four methods. The folder store is part of checkpoint 2b.

### Reads

An agent reads a site without receiving the whole document. The four reads take a head (what `store.head` returns), never change it, and never throw.

| Read                                       | Returns                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `siteOutline(head)`                        | The site name, languages, text range, counts, style and font names, then one row per page and component              |
| `pageOutline(head, tree, { depth, from })` | One row per node: id, kind, parent, index, layouts it is hidden on, block of origin, required, a preview of its text |
| `readNode(head, tree, id)`                 | One node without its children, the ids of the children and, for a block root, the current settings                   |
| `search(head, { text, kind, block })`      | The nodes that match every condition given, with a preview                                                           |

A reply is at most `READ_CAP` (16,000) characters of JSON. A long string is cut and its path listed, and a node too large to show whole is shown with its largest fields replaced by their length. When a reply cannot hold every row it has `cut: true` and a `cursor` such as `"3:120"` (the revision and the offset); pass it back in `options.cursor` (or `query.cursor`) to get the next rows. A cursor made for another revision is refused with `REVISION_CONFLICT`, so a page never mixes two versions of a site.

### The catalogue

```ts
catalogue(registry, { what: 'kinds' }) // compact rows, paged
catalogue(registry, { what: 'kinds', id: 'text' }) // one entry in full
```

`what` is `kinds`, `blocks`, `sources` or `operations`. It is generated from the registry, so a plug-in's kinds, blocks and sources appear with the core ones. A list view pages compact rows: a block with its looks and its settings as key and type, a kind with its settings, a source with its fields and its first sample row. A view with an `id` returns the one entry in full, with its settings paged as rows, every select option listed (a long list is cut and counted) and a ready insert operation for a block that `plan` accepts as it stands. Pass `site` (a head) and that operation names the first page of the site. An unknown `id` is refused with the code of its kind and the allowed names. The `operations` entries give each operation's fields and an example.

### Diff and restore

```ts
diffSites(a, b)
```

`diffSites` compares two documents and returns, for each tree with a difference, the ids that were `added`, `removed` and `moved`, and the `changed` ones with the paths of their changed fields. `site` lists the site-level keys that differ (`pages.<id>.inMenu`, `components.<id>`, `pages` for page order and so on), and `pages` lists the affected pages: the page whose own tree changed, every page for a changed header, footer, look or style, and the pages that use a changed component, also through a nested one. Its replies are paged like the reads. It never throws for a malformed document.

```ts
restore(store, registry, { site: 'main', to: 0, baseRevision: 3, key: 'undo-1' }, allow?)
```

`restore` commits the document of revision `to` as a new revision. The history is kept, and the new document equals the old one. It follows the same contract as `apply` (key, revision), migrates an older schema, validates the document against the current registry, and calls `allow` once with `{ op: 'restore', to }`. A revision the store does not hold, or one above `baseRevision`, is refused with `UNSUPPORTED_CAPABILITY`. Restoring the head is allowed.

### The build identity

`buildIdentity(doc, data, registry, files?)` returns one SHA-256 as 64 hex characters, over the document, the rows and values given to the compiler, the framework version, the name and version of every registered plug-in in name order, and, when given, the SHA-256 of each font or asset file in path order. The same inputs give the same identity, and a change to any one of them changes it. It is asynchronous, and it rejects with an `Error` if the rows or the document cannot be written as JSON. `FRAMEWORK_VERSION` is the version it uses.

## Compiling

| Function                                       | Returns                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compilePage(doc, pageId, options)`            | One page: `html`, `css`, the `scripts` it needs, `stats` and any `problems`                                                                                         |
| `compileSubtree(doc, pageId, nodeId, options)` | One node's `html` and `css` in editing mode, with class names prefixed by the node id so a replaced part never collides with the page, plus the page-wide `pageCss` |
| `compileSite(doc, options)`                    | A file for every page that is switched on, and a manifest of scripts and styles with their sizes                                                                    |

Options: `registry` (required), `data`, `mode` (`'live'` or `'edit'`), `links` (how page slugs and file ids become addresses), `lang` and `fontBase`.

Each of these validates first. If the document, the rows or an option has a problem, the result is `ok: false` with the problems, and nothing is compiled.

### What a page contains

- All content is in the HTML. The page is complete with scripts off.
- One `<style>` element: font faces, base CSS, the look and the page's own rules. Nodes with the same rules share one class.
- In live mode, one inline script made of the parts the page needs:

| Script       | Size        | Included when                              |
| ------------ | ----------- | ------------------------------------------ |
| base         | 304 bytes   | always                                     |
| open snippet | 105 bytes   | a layer is marked open at load             |
| mail snippet | 277 bytes   | a hidden mail address was written          |
| states       | 1,963 bytes | a node on the page uses states or triggers |

- In editing mode there is no script, and every node's element carries `data-id` so an editor can map the page back to the document.
- A text node still marked as an untouched sample is left out of a live page and kept in editing mode.

### Budgets

| What                         | Ceiling      |
| ---------------------------- | ------------ |
| All shared scripts on a page | 20,000 bytes |
| Base script                  | 10,000 bytes |
| States script                | 6,193 bytes  |
| CSS per page                 | 16,000 bytes |
| Elements per page            | 2,000        |
| Nesting depth                | 12           |

Sizes are raw minified bytes. `compilePage` reports a page that passes a ceiling as a `RESOURCE_LIMIT_EXCEEDED` problem and returns its real figures in `stats`.

## Guarantees and their limits

What the code holds today, each backed by tests:

- `validateSite`, `migrate`, `checkRows`, the three compile functions, `plan`, `apply`, `restore`, the four reads, `catalogue` and `diffSites` return problems for bad input and do not throw. `buildIdentity` rejects when its input cannot be written as JSON.
- No operation changes the document it is given.
- A batch is saved whole or not at all, a request key applies once, and a reply of a read never passes `READ_CAP`.
- Culm writes every byte of HTML through one writer with one escape function. A text, an attribute value, a page title or a row cannot open a tag.
- Addresses are limited to `http`, `https`, `mailto`, in-page anchors and in-site paths. Anything else writes no `href` or `src`.
- Every value from the document that reaches CSS is checked first as a known keyword, a number or a colour.
- A file path produced by `compileSite` comes from a validated slug and cannot leave the bundle.
- The same document, rows and options compile to the same bytes.

What it does not do:

- It does not fetch, store, host, publish or sign anyone in.
- It does not store a site on disk. The only store is `memoryStore`. Reading a folder of files, writing it back, the `culm` command and its dev server, and an MCP server are checkpoint 2b.
- It does not measure a rendered page. Reporting overflow, clipped text and contrast is checkpoint 2b.
- It has no starter package or `culm init` (checkpoint 2c) and has not been compared with agents that write page code (checkpoint 2d).
- A removed or moved page does not rewrite the links that pointed at it. The result says which links now lead nowhere.
- A plug-in's block functions and rules are ordinary code that runs with the product's rights. Culm checks what they return. It does not sandbox them.

## Package layout

`@culmjs/core` exports its public names from the package root, and by area from `/document`, `/style`, `/layout`, `/scripts`, `/registry`, `/validate`, `/data`, `/compile` and `/ops`. A test pins the exact set of names the root exports, so a new public name is always a deliberate change.

Inside, the code is layered in this order: `scripts`, `document`, `style`, `layout`, `registry`, `validate`, `data`, `compile`, `ops`. A script fails the build when a layer imports from a later one.
