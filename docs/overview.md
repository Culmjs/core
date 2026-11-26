# Culm: what it is

Culm is a JavaScript framework that builds websites from data. This page says exactly what exists in the repository today. The package is `@culmjs/core`. It has no runtime dependencies and runs in Node 22+, edge workers and the browser.

This page describes the site document, validation, compilation and checked operations in `@culmjs/core`. `@culmjs/tools` provides folder sites, the CLI and [agent authoring over MCP](mcp.md#ordered-json-edits). `@culmjs/starter` supplies the site created by `culm init`.

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
- optional `motion`: a trigger and either checked steps or a registered effect (including Stage 4 GPU/WASM effects such as `contours`, `ripple_field` or custom shaders when `gpu` is enabled). An entrance can run once on entering view; a scroll track can seek in either direction. [Motion docs](motion/replay.md) · [GPU exit summary](gpu/exit.md)
- optional `repeat`, `bind`, `showIf`: data binding and conditional display
- optional `slot` and `placement`: how it sits in its parent

There are 22 core kinds, all layout or content: `free`, `box`, `row`, `column`, `grid`, `list`, `table`, `table-row`, `table-cell`, `text`, `image`, `icon`, `button`, `divider`, `embed`, `video`, `menu`, `form`, `field`, `details`, `instance` and `shape`. A `shape` is a vector drawing (rect, ellipse, polygon, star, line, blob, path or a group of up to 32 parts) painted with site colours, a gradient or a stroke; a button may hold up to 4 shapes behind its label, and any container may hold shapes placed `behind` or `front`. A shape is decoration unless it has a `label`, and it never counts as text. A plug-in can add more.

The limits are 2,000 nodes per page and 12 levels of nesting. `KINDS`, the table of core kinds, is frozen along with everything in it, so a consumer cannot change a kind for every registry in the process.

### Required content and text size

A node can be marked `required: true`. A required node must stay in the site and stay visible:

- Validation refuses a document in which a required node is hidden, with a `POLICY_VIOLATION` whose `rule` is `required`. It judges required content on the tree the page is built from: the header, the footer and each page with every instance unrolled as compile unrolls it, so property defaults, the looks in use, `set` values, bindings, overrides and what an outer instance does to a nested component are already applied, at any depth. A node is hidden when it or an ancestor in that tree has a `hide` flag for any layout or `hidden: true` or `opacity: 0` in any style layer (state and `when` layers included; a node with `motion` is exempt from the opacity rule, as an entrance may start at 0). A component nobody uses is in no tree and is not judged. A node the document holds under its own id (a page node, or a required instance, whose unrolled root keeps its id) is reported at that id; a part of an instance is reported at the outermost instance with the path `parts.<the part's id inside it>`. A `path` is always on the node named: when the hiding sits on the node itself it ends in the field (`hide.<layout>`, `style.<layer>.hidden`, `style.when.<i>.decl.hidden`); when it sits on an ancestor there is no field (no path at all for a node held under its own id), and the message names the ancestor. When the hiding is written in a component's master, the message says so and names `components.<id>` and the part, as changing it there fixes every use. A property bound to data becomes a show condition and, like any `showIf`, is not judged. A page, header or footer that the unroll cuts at the node limit is not judged part by part: when it holds required content (a required node, a form or field, or an instance of a component that holds one), it is refused once with `RESOURCE_LIMIT_EXCEEDED`, rule `required` and the path `pages.<id>`, `header` or `footer`, as the cut may leave that content out; a cut tree without required content stays valid.
- A required `text` must keep a run that has a data binding or a character a reader sees: a letter, a number, punctuation or a symbol, other than the Hangul fillers and the Braille blank (so a zero-width space, a soft hyphen, a combining mark alone or a private-use character is not content), judged on the same unrolled tree. A math run does not count as the content of a required text: such a text needs a run with visible characters or a binding.
- The provenance marks `sample` and `chrome` are written only by inserting a block. `setProps` refuses a `props` with either key, `setInstance` an override whose `props` has one, and `add` a node anywhere in the added subtree that carries one, or an `origin` tag (`INVALID_OPERATION`, with the path to it). And `plan` refuses a batch after which a node that was required and kept on the live page is still required but left out as sample text (`POLICY_VIOLATION`, rule `required`): a text the block marks as a sample or its own wording, or a box that would hold a sample and nothing a person wrote, whichever operation caused it (`setBlockSetting`, `updateBlock`, `remove`, `move`, a hide). Writing the words again with `setText` in the same batch is a way out.
- `remove` refuses a subtree that holds a required node. It also refuses to remove the last instance of a component that holds one. `removePage`, `updateBlock` and `setBlockSetting` refuse any result that no longer holds a node that was required, and `detach` gives the detached root the instance's own mark. `updateBlock` keeps a person's explicit `required` (true or false) on every node in both versions, over the new look's.
- A `form` is required unless it is marked `required: false`. A `field` is required unless it is marked `required: false` or its form is. These two kinds are the only ones that can be marked `false`.

To take required content out on purpose, change the mark first, in the same batch: `setRequired` with `null` deletes the mark, and with `false` it opts a form or field out. A form is required by its kind, so it needs `false`. The refusal is meant to be a decision, not an accident.

The site styles can also hold `textRange: { min, max }`, whole numbers from 1 to 400. A text size outside the range, in a node layer, a run style, a named text style or either end of a fluid size (`fluidSize.min` and `fluidSize.max`), is refused with a `POLICY_VIOLATION` whose `rule` is `textRange` and whose `allowed` is the range as two texts, such as `['11', '96']`. Node sizes are judged on the same unrolled tree, so that includes a size an instance or a component gives a part: in an override, in a look in use, or as the value of a `fontSize` property; a component nobody uses is not judged. With no `textRange`, no size is refused. `setSiteStyles` sets it, and `null` removes it.

### Versions and migration

`migrate(doc)` runs registered steps from the document's version to the current one. It is pure, never changes its input, refuses a document from a newer version, and reports the path of the first node a step could not migrate. `previewMigration` is the same function under the name a tool uses to show what a migration would do.

The schema version is 2. The one step, from 1 to 2, gives `required: false` to every form or field it cannot show to be visible, because version 2 refuses a hidden required node and version 1 documents could hide a form: one hidden in its own tree (`hide` or `hidden: true` on it or an ancestor), every one inside a component's master, and every one under an instance (slot content), and every one in a page, the header or the footer whose tree, expanded through its components, reaches the element or depth limit (version 2 refuses such a cut tree when it holds required content). The step cannot see what a use does, so it exempts all forms inside components; that only loosens, as version 1 had no such protection. A form on a page that nothing hides gains no field. `restore` migrates an older revision the same way before it checks it.

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
| `FETCH_FAILED`            | A font or icon could not be fetched                                   |

Wording may change. Codes keep their meaning.

A field or setting that Culm does not know, or does not act on yet, is refused. Nothing is dropped silently.

## Changing a site

A change is a request: a list of operations, applied to a known revision of a site. Nothing here changes a document in place. Every operation takes a document and returns a new one, or a refusal.

### Operations

There are 27 operations. Each has typed arguments, and `catalogue` lists them with an example of each.

| Group      | Operations                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Nodes (12) | `add`, `remove`, `move`, `setProps`, `setText`, `setStyle`, `setHidden`, `setSlot`, `setRequired`, `bindData`, `setStates`, `setMotion` |
| Blocks (3) | `insertBlock`, `setBlockSetting`, `updateBlock`                                                                                         |
| Pieces (4) | `makeComponent`, `setInstance`, `detach`, `removeComponent`                                                                             |
| Site (8)   | `addPage`, `removePage`, `setPage`, `movePage`, `setSite`, `setLook`, `setSiteStyles`, `setFonts`                                       |

A node is addressed by a tree and an id: `{ tree: 'header' | 'footer' | { page: id } | { component: id }, id }`. A component's tree has its own ids, apart from the pages. `add` fills in an id (the lowest unused `n` id), a slot and a name when the node leaves them out. `detach` turns an instance back into its own nodes: the component's own parts get new ids, while the root and the content a person placed in the instance's slots keep theirs. It is refused with `RESOURCE_LIMIT_EXCEEDED` when the instance, filled in, holds more than 2,000 elements, because the copy would be cut. `updateBlock` brings an inserted block to the registered version of its block and lists, as a note, the parts a person had changed. The block's root keeps its slot, placement, hiding, show conditions, lock and name.

A refusal is a list of problems. Each has a stable `code`, a `message`, and where they apply the `nodeId`, the `path` of the field, the `allowed` values and the `rule`. A problem from a batch also has `op`, the index of the operation that raised it. For a problem that a validation found at the end, `op` is the last operation that changed that node, and a problem that names no node, or names a node that no operation changed (a required text hidden by an ancestor that the batch hid, for example), has no `op`. A refusal about a page has the `path` `page` and no `nodeId`, because a page id is not a node id. A refusal about a node inside the node an `add` sends has the path to it, such as `node.children.2.id`. `INVALID_OPERATION` means the operation itself is wrong (an unknown id, a value of the wrong type, an unsafe key, an unknown operation name, with the allowed names listed). `UNKNOWN_BLOCK`, `POLICY_VIOLATION` and the other codes of validation mean the same as in validation.

### The change contract

```ts
{ site: 'main', baseRevision: 0, key: 'first-change', ops: [ /* up to 200 operations */ ] }
```

- `baseRevision` is the revision the request was made from. If the site has moved on, the request is refused with `REVISION_CONFLICT` and nothing is written.
- `key` is the request key, 1 to 200 characters. The same key with the same content returns the first result and applies once. The same key with other content is refused with `KEY_CONFLICT`. A refused batch does not use its key up: it is planned again if sent again.
- The batch is all or nothing. The operations run in order on a copy, and a later one can use what an earlier one created. The first refusal stops the batch.
- The document is validated once, after the last operation. A batch whose result has any problem is refused whole, and the problems come back.
- A request holds at most 200 operations and 1,000,000 characters of canonical JSON. Past either, it is refused with `RESOURCE_LIMIT_EXCEEDED`.

`plan(doc, registry, request, allow?)` runs the batch on a document and returns the result without a store. Before it checks, an alias pass rewrites `align` on a text to `textAlign`, a layer's `display` to `hidden`, and a rect shape's style `radius` to `geometry.radius`. `apply(store, registry, request, allow?)` does the same against a store, in four steps: replay the key, check the revision, plan, commit. Both return problems and never throw for a bad request. A store that throws makes `apply` reject with that error.

A successful result has `created` and `changed` (node references, with no repeats), `pages` (the ids of the pages affected), `notes`, and from `apply` the new `revision`. `created` and `changed` are what `diffSites` reports between the document before and after the batch: `created` is every id the diff lists as added, `changed` every id it lists as changed or moved that is not created. A node that was removed is in neither list (the diff lists it as removed), and a parent whose children changed is not changed. A page's own settings are in `pages`, not in `changed`. A note has a `kind` (`reset`, `expanded` or `info`), the node `ids` it is about and a `text`. One note says which links now lead to no page after a page was removed, switched off or given another slug. Culm does not rewrite links.

`allow` is a function a product passes to refuse an operation for its own reasons. It is called once for each operation, with the operation and the working document, and returns a problem or nothing. The result is a `POLICY_VIOLATION` with the `message`, `rule`, `nodeId` and `path` it gave when they are text (and `allowed` when it is a list of texts), and nothing else of what it returned; with the message "Not allowed." if it gave none, and with the rule `allow` if the function threw.

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

| Read                                            | Returns                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `siteOutline(head)`                             | The site name, languages, text range, counts, style and font names, then one row per page and component                               |
| `pageOutline(head, tree, { depth, from })`      | One row per node: id, kind, parent, index, layouts it is hidden on, block of origin, required, a preview of its text                  |
| `readNode(head, tree, id, options?, registry?)` | One node without its children, the ids of the children and, for a block root, the current settings (only when the registry is passed) |
| `search(head, { text, kind, block })`           | The nodes that match every condition given, with a preview                                                                            |

A reply is at most `READ_CAP` (16,000) characters of JSON. A long string is cut and its path listed, and a node too large to show whole is shown with its largest fields replaced by their length. When a reply cannot hold every row it has `cut: true` and a `cursor` such as `"3:120:1k9x"` (the revision, the offset and a short tag of the read and the options that select its rows); pass it back in `options.cursor` (or `query.cursor`) to get the next rows. `readNode` adds the run and the character, and the node's tree and id to its tag. A cursor made for another revision is refused with `REVISION_CONFLICT`, so a page never mixes two versions of a site. A cursor made by another read, or by the same read with other options (another `depth`, `from`, tree, query, `what` or `id`), is refused with `INVALID_OPERATION` at `cursor`. The tag guards against mix-ups; it is not a proof, and for `diffSites` it is made from a glance at each document (its schema version, page count and node count), which tells an obviously different pair apart.

### The catalogue

```ts
catalogue(registry, { what: 'kinds' }) // compact rows, paged
catalogue(registry, { what: 'kinds', id: 'text' }) // one entry in full
```

`what` is `guide`, `kinds`, `operations`, `recipes`, `blocks`, `sources` or `effects`. It is generated from the registry, so a plug-in's kinds, blocks, sources and effects appear with the core ones. The list views are terse: `guide` is rows of plain sentences on composing a section; `kinds` is one string per kind (`kind(role): setting, setting`); `operations` is one string per operation with a `legend` for the long types; `recipes` is rows `{ recipe, name, guide, ops }`; a block is `{ block, name, category, looks, guide }`; a source has its fields; an effect has its name and minimum tier. A view with an `id` returns the one entry in full: a kind's settings with their `hint` (the grammar of a shape's `geometry`, `fill` and `stroke`), an operation's fields and example, a recipe's batch (its first operation aimed at the first page of the site, which `plan` accepts as it stands), a block's settings with a ready insert (pass `site` to name the first page of the site), a source's first sample row or an effect's numeric settings. Effect detail includes a `setMotion` example for a compatible site node, or describes the required target. An unknown `id` is refused with the code of its kind and the allowed names; an unknown recipe or effect is `INVALID_OPERATION` at `id`.

`GUIDE` and `RECIPES` are core data, like `OPERATIONS`: six recipes (`hero`, `split`, `cta-band`, `buttons`, `divider`, `card`) that use only site colours and leave node ids out so one can be applied twice. The five list replies `guide`, `kinds`, `operations`, `recipes` and `blocks` stay within 10,500 characters on the starter registry.

### Diff and restore

```ts
diffSites(a, b)
```

`diffSites` compares two documents and returns, for each tree with a difference, the ids that were `added`, `removed` and `moved`, and the `changed` ones with the paths of their changed fields. `site` lists the site-level keys that differ (`pages.<id>.inMenu`, `components.<id>`, `pages` for page order and so on), and `pages` lists the affected pages: the page whose own tree changed, every page that is on for a changed header or footer, every page for a changed look or style, and the pages that use a changed component, also through a nested one. Its replies are paged like the reads. It never throws: a malformed document or options of the wrong shape give a refusal or an empty diff, and a tree nested past 64 levels is compared level by level down to that depth, and below it as one value.

```ts
restore(store, registry, { site: 'main', to: 0, baseRevision: 3, key: 'undo-1' }, allow?)
```

`restore` commits the document of revision `to` as a new revision. The history is kept, and the new document equals the old one. It follows the same contract as `apply` (a key of 1 to 200 characters, the revision), migrates an older schema, validates the document against the current registry, and calls `allow` once with `{ op: 'restore', to }`. A revision the store does not hold, or one above `baseRevision`, is refused with `UNSUPPORTED_CAPABILITY`. Restoring the head is allowed.

### The build identity

`buildIdentity(doc, data, registry, files?)` returns one SHA-256 as 64 hex characters, over the document, the rows and values given to the compiler, the framework version, the name and version of every registered plug-in in name order, and, when given, the SHA-256 of each font or asset file, sorted by path and then by hash (so the same set of files in any order gives the same identity). What is hashed is the JSON form of the rows and values, so a value JSON cannot represent (a function, a `Map`, a `Date` against its ISO text, `values: null` against no values) does not tell two builds apart. The same inputs give the same identity, and a change to any one of them changes it. It is asynchronous, and it rejects with an `Error` if the rows or the document cannot be written as JSON. `FRAMEWORK_VERSION` is the version it uses.

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

| Script    | Size          | Included when                              |
| --------- | ------------- | ------------------------------------------ |
| base      | 304–688 bytes | always (includes open/mail when used)      |
| states    | 1,654 bytes   | a node on the page uses states or triggers |
| timeline  | 4,681–7,214 B | the rendered page needs the motion host    |
| gpuLoader | 893 bytes     | the page renders GPU/WASM regions in main  |
| gpuHost   | 9,513 bytes   | lazy `_culm/gpu.js` asset (loaded via SRI) |

- In editing mode there is no script, and every node's element carries `data-id` so an editor can map the page back to the document.
- A text node still marked as an untouched sample is left out of a live page and kept in editing mode.

### Budgets

| What                             | Ceiling      |
| -------------------------------- | ------------ |
| All shared scripts on a page     | 20,000 bytes |
| Base script                      | 10,000 bytes |
| States script                    | 6,193 bytes  |
| Timeline script                  | 8,192 bytes  |
| GPU host script (`_culm/gpu.js`) | 9,513 bytes  |
| Shader source per page           | 16,384 bytes |
| CSS per page                     | 16,000 bytes |
| Elements per page                | 2,000        |
| Nesting depth                    | 12           |

Sizes are raw minified bytes. Shader source counts the final text shipped, one trailing newline per definition. The 512-byte raw / 684-byte base64 WASM module ceilings are enforced when an effect is registered, not per page. `compilePage` reports a page that passes a ceiling as a `RESOURCE_LIMIT_EXCEEDED` problem and returns its real figures in `stats`.

CSS-only motion ships no timeline script. The shared 20,000-byte cap applies independently of the individual script ceilings. The [stage comparison](motion/exit.md) gives measured byte totals and the desktop and phone frames the owner accepted; the Stage 3c blind recreate rerun and the matched [Culm vs. Astro & GSAP comparison](comparison/README.md) are closed.

## Measure

The `measure` layer of the core says what is wrong with a rendered page, in a form an agent can act on, and confirms a repair. It has no browser in it: it takes measurements that a runner made and returns findings.

- `PROBE_SCRIPT` is one function a runner evaluates in the page. It returns, for every element with a node id, its box, whether it paints, its background, clipping, text lines and size, and tap size.
- `runChecks(input)` takes those measurements for every layout of one page, and returns findings. There are 31 checks and one row for a compile problem (`invalid`). Class 1 is a compile problem, class 2 a defect (`off-screen`, `overflow`, `h-scroll`, `overlap`, `contrast`, `tap-target`, and for shapes `shape-covers`, `shape-complex` and `raw-colour`; and the design findings `stretched-button`, `header-edge`, `hero-bare`, `orphan-heading`, `bleed-gutter`, `all-stacked`, `no-accent`, `starter-chrome`, `side-stripe`, `gradient-text`, `glow` and `emoji-icon`, each with a `fix`) and class 3 taste (`column`, `alignment`, `symmetry`, `rhythm`, `empty-band`, `line-length`, `heading-order`, `duplicate-heading`, `stacked-row`, `phone-order`). The thresholds are in `THRESHOLDS`. `runChecks` takes the document (`doc`), not a root, and unrolls the header, the page and the footer itself.
- A finding names the check, the class, the page, the width, the theme, the direction, the nodes, what was observed, what was expected, and a `key` (`findingKey`) that is the same on every run for the same defect.
- `buildReport` joins the findings of many cells into one `Report`, and `compareReports(old, new, doc)` says, for each earlier finding, whether it is `fixed`, still `present`, `unobservable` (every node of the finding is gone or hidden at the finding's width) or `unchecked`, and lists the findings that are new.
- The measure profile is version 1: widths 1280, 834 and 390, themes light and dark, each direction the site's languages declare, and the default state of each part. `MEASURE_PROFILE` is that version, and a report says what the profile skipped.
- `compilePage` accepts `mode: 'measure'` for a runner: the live page with the node ids on its elements. `compileSite` and `culm build` never use it.

`isRequired(node, form?)` is also public: the rule that decides whether a node is required, so a product's guard cannot drift from core's.

## Tools

`@culmjs/tools` depends on `@culmjs/core` (a peer dependency), `@modelcontextprotocol/sdk` and `jsonc-parser`. It adds what needs files, a browser or a port.

| What           | Does                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder sites   | `loadFolder` reads a folder of JSON files into the document with a source map; `fileStore` is a `SiteStore` that writes changes back into the same files and keeps history in `.culm/`                    |
| `culm` command | `init`, `dev`, `build`, `check`, `expand`, `render`, `schema`, `mcp`                                                                                                                                      |
| Dev server     | Serves the pages on `127.0.0.1`, reloads on save, and shows an overlay with file, line and message when a save has a problem                                                                              |
| Measure runner | Opens Chrome over the DevTools protocol on a pipe, with no dependency and no port, and runs the probe and the checks on every page                                                                        |
| MCP server     | `createMcpServer`: 6 authoring tools by default (`culm mcp` / `jsonOps: true`, including `render`), or 12 full tools (`culm mcp --full`), over stdio and optionally a local HTTP port with a bearer token |
| JSON Schema    | `authoringSchema(registry)` and `culm schema`: completion and checks for the folder's files in an editor                                                                                                  |

Read [docs/folder-sites.md](folder-sites.md) for the folder format, `.culm/` and the commands, and [docs/mcp.md](mcp.md) for the MCP tools, what `protect` refuses and the local port.

## The starter

`@culmjs/starter` is a plug-in (`trust: 'declarative'`, build only) with eight blocks and one look, written only against the public names of `@culmjs/core`. Every setting of every block is a declared action; no block has `onInsert`, and the plug-in has no setting functions, kinds or rules. An ESLint rule limits its imports to the public names of `@culmjs/core`, and `npm run check:terms` finds no product term in it. A test in `packages/starter` shows it and core's test plug-in sharing one registry and one page, and a test in `packages/tools` shows that the template compiles within every ceiling.

| Block            | Looks                       | What it is                                                                                                      |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `page-header`    | `bar`, `centered`           | The site name, the navigation and an optional button; the navigation is required in every look                  |
| `page-footer`    | `simple`, `columns`         | A note and optional links                                                                                       |
| `hero`           | `plain`, `image`            | The page title (a required `h1`), a lead line and a button, with an optional image                              |
| `text-section`   | `narrow`, `wide`            | A heading and text in a column of 640 or 960 px                                                                 |
| `image-text`     | `image-left`, `image-right` | An image beside a heading and text                                                                              |
| `card-grid`      | `cards`, `rows`             | A heading and one card or row for each row of a source (default source `menu`); with no rows, the heading alone |
| `link-list`      | `plain`, `boxed`            | A heading and one link for each row of a source (default source `links`); with no rows, the heading alone       |
| `call-to-action` | `band`, `card`              | A heading and a button                                                                                          |

Tokens: colours `ink #1c1917`, `canvas #fafaf9`, `brand #b45309`, `muted #57534e`, `line #e7e5e4`; text styles `eyebrow` 11, `body` 17, `lead` 20, `h3` 24, `h2` 32, `h1` 48. New starters set `textRange` to 11–96px for regular text with `displayMax: 240` for H1/H2. Phone size, leading and tracking can be set independently. Spacing: `xs` 4, `s` 8, `m` 16, `l` 24, `xl` 40, `2xl` 64. Fonts are the system stacks only; the package ships no font file. Every heading and the navigation are required content.

### First run

```sh
npx @culmjs/tools init my-site
cd my-site
npm install
npx culm dev     # serve the site; reloads on save
npx culm build   # write the site to dist/
```

Nothing is on npm yet, so until a release the steps above do not work. From a checkout of this repository, run `npm run pack:all` (it writes three tarballs to `.pack/`), then `node packages/tools/bin/culm.js init my-site --from .pack`, then `npm install` in `my-site`. `--from <folder>` is a folder that holds `culmjs-core-*.tgz`, `culmjs-starter-*.tgz` and `culmjs-tools-*.tgz`; `init` then writes `file:` dependencies on them in place of version numbers. A relative `--from` is resolved against the folder you run the command in.

`culm init <folder> [--blank]` writes a 4-page bakery site (or a minimal single-page site with `--blank`) into a new or empty folder. A folder that holds anything, hidden files included, is refused, and the message lists up to five of the names found. It also writes a `package.json`, a `culm.schema.json` and a `.gitignore` (which excludes `node_modules`, `dist` and `.culm/`).

## Guarantees and their limits

What the code holds today, each backed by tests:

- `validateSite`, `migrate`, `checkRows`, the three compile functions, `plan`, `apply`, `restore`, the four reads, `catalogue`, `diffSites`, `runChecks` and `compareReports` return problems for bad input and do not throw. `buildIdentity` rejects when its input cannot be written as JSON.
- No operation changes the document it is given.
- A batch is saved whole or not at all, a request key applies once, and a reply of a read never passes `READ_CAP`.
- Culm writes every byte of HTML through one writer with one escape function. A text, an attribute value, a page title or a row cannot open a tag.
- Addresses are limited to `http`, `https`, `mailto`, in-page anchors and in-site paths. Anything else writes no `href` or `src`.
- Every value from the document that reaches CSS is checked first as a known keyword, a number or a colour.
- A file path produced by `compileSite` comes from a validated slug and cannot leave the bundle.
- The same document, rows and options compile to the same bytes.

What the tools add, each backed by tests:

- A folder loaded and written back with no change leaves every file byte for byte the same, comments included. A write to a file that changed since it was loaded is `SOURCE_CONFLICT` and changes nothing.
- Every problem and measure finding on a folder site names a file and a line.
- `culm dev`, `culm mcp --port` and the measure runner bind or serve `127.0.0.1` only. The loader reads inside the project folder only, and `culm build` deletes only inside an output folder that holds a manifest it wrote.
- Measure never downloads a browser and never contacts an address outside the compiled bundle. `build` and `dev` make no network request.
- The dev server's reload code is in no file `build` writes.

What it does not do:

- Culm builds local files; it does not publish them to a host or sign anyone in.
- A plug-in named in `culm.json` runs as code with your rights, and a caller that can write the files can bypass every operation. Both are stated in "What this does not protect" in [folder-sites.md](folder-sites.md).
- Measure covers the default state of each part. Hover, focus, open and other states are listed as skipped, not measured.
- A removed or moved page does not rewrite the links that pointed at it. The result says which links now lead nowhere.
- A plug-in's block functions and rules are ordinary code that runs with the product's rights. Culm checks what they return. It does not sandbox them.

## Package layout

`@culmjs/core` exports its public names from the package root, and by area from `/document`, `/style`, `/layout`, `/scripts`, `/registry`, `/validate`, `/data`, `/compile`, `/ops` and `/measure`. A test pins the exact set of names the root exports, so a new public name is always a deliberate change.

Inside, the code is layered in this order: `scripts`, `document`, `style`, `layout`, `registry`, `validate`, `data`, `compile`, `ops`, `measure`. A script fails the build when a layer imports from a later one.

`@culmjs/tools` is a separate package. Its source imports `@culmjs/core` by its public sub-paths only, never by a relative path into another package, and the lint rules hold that boundary. `npm test` needs no browser and no network; the tests that open Chrome are in `packages/tools/__browser__` and run with `npm run test:browser`.
