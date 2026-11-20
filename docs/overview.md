# Culm: what it is

Culm is a JavaScript framework that builds websites from data. This page says exactly what exists in the repository today. The package is `@culmjs/core`. It has no runtime dependencies and runs in Node 22+, edge workers and the browser.

Everything here is stage 1. The API will change before a first release.

## The idea in three sentences

A site is one versioned JSON document. People and agents change the document, never page code. Culm checks the document and compiles it to static HTML and CSS, and it compiles nothing from a document that has problems.

## The site document

The document holds the pages and what they share.

| Part                      | Holds                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `schemaVersion`           | Which stored structure the document uses. Today it is 1                                        |
| `pages`                   | Each page has an id, a title, a slug and a root node                                           |
| `header`, `footer`        | A node tree each, shared by every page                                                         |
| `components`              | Reusable trees. An `instance` node points at one                                               |
| `fonts`, `styles`, `look` | Fonts in use, named styles (colours, text styles, spacing, shadows) and the site's look tokens |
| `languages`               | Language codes and direction                                                                   |

A page slug is a site path. It begins with `/`, the home page is exactly `/`, and each segment uses lowercase letters, digits and dashes.

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

The limits are 2,000 nodes per page and 12 levels of nesting.

### Versions and migration

`migrate(doc)` runs registered steps from the document's version to the current one. It is pure, never changes its input, refuses a document from a newer version, and reports the path of the first node a step could not migrate. There is one schema version so far, so there are no steps yet.

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

- `validateSite`, `migrate`, `checkRows` and the three compile functions return problems for bad input and do not throw.
- Culm writes every byte of HTML through one writer with one escape function. A text, an attribute value, a page title or a row cannot open a tag.
- Addresses are limited to `http`, `https`, `mailto`, in-page anchors and in-site paths. Anything else writes no `href` or `src`.
- Every value from the document that reaches CSS is checked first as a known keyword, a number or a colour.
- A file path produced by `compileSite` comes from a validated slug and cannot leave the bundle.
- The same document, rows and options compile to the same bytes.

What it does not do:

- It does not fetch, store, host, publish or sign anyone in.
- It does not yet give an agent named operations, dry runs or batches. Until stage 2, a change is an edit to the document followed by `validateSite`.
- It does not measure a rendered page. Reporting overflow, clipped text and contrast is stage 2.
- A plug-in's block functions and rules are ordinary code that runs with the product's rights. Culm checks what they return. It does not sandbox them.

## Package layout

`@culmjs/core` exports its public names from the package root, and by area from `/document`, `/style`, `/layout`, `/scripts`, `/registry`, `/validate`, `/data` and `/compile`. A test pins the exact set of names the root exports, so a new public name is always a deliberate change.

Inside, the code is layered in this order: `scripts`, `document`, `style`, `layout`, `registry`, `validate`, `data`, `compile`. A script fails the build when a layer imports from a later one.
