<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/culm-logo-reverse.svg">
    <img src="docs/brand/culm-logo.svg" alt="Culm" width="340">
  </picture>
</h1>

<p align="center"><strong>The JavaScript framework for the AI era.</strong></p>

<p align="center">
  <a href="docs/overview.md">Overview</a> ·
  <a href="#why">Why</a> ·
  <a href="#example">Example</a> ·
  <a href="#what-exists-today">Status</a>
</p>

Culm builds websites from data. A whole site is one JSON document. Culm checks that document, then compiles it to static HTML and CSS.

It is made for sites that AI agents build and maintain. An agent does not write page code. It writes a small piece of data, Culm tells it exactly what is wrong if anything is, and only a valid document becomes a page.

> **Status: early.** Stage 1 of 6 is done: the document model, validation, the plug-in registry and the compiler. Stage 2 is under way: its first checkpoint, checked operations with reads, a catalogue, diff and restore, is done, and measurement, the command-line tool, the MCP server and the starter are still to come. The API will change, and nothing is on npm yet. See [What exists today](#what-exists-today).

## Why

### Fewer tokens

An agent that builds a page by writing markup, styles and scripts spends most of its output on text the framework could have produced. With Culm the agent writes the description and Culm writes the page.

In the example below, the agent's part is 127 characters of JSON. The compiled page is 5,407 bytes.

The same holds for changes. Editing a heading is one small edit to one node. The agent does not re-read or re-emit a file of code to make it.

A measured comparison of token use against agents that write page code is the last checkpoint of stage 2 and has not been run. Until it is, treat this as a design aim backed by the sizes above, not a benchmark.

### The agent cannot break the page

- **Nothing invalid compiles.** `validateSite` checks every node, setting, style, binding and link. `compilePage` refuses a document with problems and returns them.
- **A problem says what to do.** Each one has a stable code, the node, the field, and the values that are allowed there. An agent can act on it without guessing.
- **Unknown content is refused, never silently dropped.** A field or setting Culm does not act on is an error, so a document cannot look fine and quietly lose something.
- **Text is always escaped.** Culm writes all HTML itself. Text, attributes and addresses from the document cannot become markup, script or an unsafe link.
- **Bad input returns problems.** The public functions do not throw on a malformed document.
- **A change is a named operation, applied whole or not at all.** An agent sends a batch of operations from a known revision with a request key. If any operation is refused, or the result is invalid, nothing is written. The same key twice applies once.
- **Marked content stays.** A node marked `required` cannot be hidden or removed, and a site can declare a range for text sizes, so a repair cannot fix a clipped title by deleting or shrinking it.

### The same website, faster

- **Static output.** A page is complete HTML and CSS and works with scripts off.
- **A page pays only for what it uses.** A plain page ships one base script of 304 bytes. A page with interactive states adds one more script of under 2 KB.
- **Hard ceilings, held by tests.** 16,000 bytes of CSS per page, 20,000 bytes for all shared scripts, 2,000 elements, 12 levels of nesting. A page over a ceiling is reported.
- **No framework in the browser.** There is no runtime to download, parse or hydrate.

## Example

```ts
import {
  emptySite,
  createRegistry,
  validateSite,
  compilePage,
} from '@culmjs/core'

const site = emptySite('Field Notes', {
  id: 'ink',
  name: 'Ink',
  family: 'Minimal',
  dark: 'auto',
  corners: 8,
  brand: '#2c5282',
  ink: '#1f2a44',
  bg: '#ffffff',
  headingFont: 'sys:serif',
  bodyFont: 'sys:sans',
})

// This is the part an agent writes.
const page = site.pages[0]
page.root.children = [
  {
    id: 'hello',
    kind: 'text',
    name: 'Hello',
    slot: {},
    props: { level: 'h1', runs: [{ text: 'Hello from one JSON document' }] },
  },
]

const registry = createRegistry()

validateSite(site, registry) // []

const out = compilePage(site, page.id, { registry })
if (out.ok) {
  out.html // '<!doctype html><html lang="en">…'
  out.scripts.map(s => s.name) // ['base']
  out.stats // { bytes: 5407, styleBytes: 4747, scriptBytes: { base: 304, states: 0 }, elements: 5, depth: 2 }
}
```

When the document is wrong, the agent is told how, and no page is produced:

```ts
page.root.children[0].kind = 'marquee'

validateSite(site, registry)[0]
// {
//   code: 'UNKNOWN_KIND',
//   message: 'Its kind "marquee" is not one this site knows.',
//   nodeId: 'hello',
//   path: 'kind',
//   allowed: ['free', 'box', 'row', 'column', 'grid', 'list', 'table', …]
// }

compilePage(site, page.id, { registry }).ok // false
```

### Changing the site with operations

An agent changes the site with a request, not by editing the document. This continues the example above, before the document is broken:

```ts
import {
  apply,
  memoryStore,
  siteOutline,
  diffSites,
  restore,
} from '@culmjs/core'

const store = memoryStore({ main: site }) // `site` and `registry` from above

const done = await apply(store, registry, {
  site: 'main',
  baseRevision: 0,
  key: 'add-heading',
  ops: [
    {
      op: 'add',
      tree: { page: 'home' },
      parent: 'homeroot',
      index: 0,
      node: { kind: 'text', props: { level: 'h1', runs: [{ text: 'Hello' }] } },
    },
    { op: 'addPage', title: 'About', slug: '/about' },
  ],
})
// { ok: true, revision: 1, created: [...], changed: [...], pages: ['home', 'p1'], notes: [] }

const head = await store.head('main') // { revision: 1, doc }
siteOutline(head).rows // one row per page and component
```

A batch against an old revision is refused with `REVISION_CONFLICT`. A batch with a bad operation is refused whole, and the problem carries the index of the operation: `{ code: 'INVALID_OPERATION', message: 'No page "nope".', path: 'page', nodeId: 'nope', op: 1 }`. `restore(store, registry, { site: 'main', to: 0, baseRevision: 1, key: 'undo' })` makes revision 2 equal to revision 0, and `diffSites(a, b)` lists the ids that differ between two documents.

## How it works

1. **One document.** A site is pages, a header and footer, reusable components, fonts and named styles. A page is a tree of nodes. A node has a kind (`text`, `image`, `row`, `list`, `form` and so on), settings, style layers for desktop, tablet, phone and dark mode, and optional states and data bindings.
2. **Plug-ins add the product's own parts.** A product registers blocks, data sources, node kinds and validation rules with a registry it creates. A block is data: a set of looks, each a tree of nodes, with settings declared as actions (`set`, `choose`, `show`, `filter`). Inserting a block copies its nodes into the site, so every part can be edited afterwards.
3. **Validation.** One call checks the whole document against the core rules and every registered rule.
4. **Compilation.** Culm binds the rows you supply, resolves the tree to elements and CSS rules, and writes the page. Identical rule sets share one class. A script is included only when a node on the page needs it.
5. **Operations.** A change is a request of up to 200 operations, such as `add`, `setProps`, `insertBlock` or `setPage`, made from a known revision. `plan` runs it on a copy and validates once at the end. `apply` commits it to a store. An agent reads the site in pages (`siteOutline`, `pageOutline`, `readNode`, `search`), asks `catalogue` what it may insert, compares two revisions with `diffSites` and goes back to an earlier one with `restore`.

Read [docs/overview.md](docs/overview.md) for the document model, the plug-in API, the operations, the compile functions and the guarantees in more detail.

## What exists today

Stage 1 and the first checkpoint of stage 2, in `packages/core` (`@culmjs/core`), with no runtime dependencies. It runs in Node 22+, edge workers and the browser.

| Area       | What you get                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document   | Types for the site document, 21 core node kinds (frozen), tree helpers, `emptySite`, schema version 2 with a migration runner, `required` marks and a `textRange` for text sizes |
| Plug-ins   | `createRegistry`, blocks with declared settings, data sources with row checks, validation rules, extra node kinds                                                                |
| Validation | `validateSite`, with stable problem codes                                                                                                                                        |
| Operations | 26 operations, `plan` and `apply` with request keys and revisions, `restore`, `memoryStore`, `allow` for a product's own refusals                                                |
| Reads      | `siteOutline`, `pageOutline`, `readNode` and `search`, paged under a 16,000-character cap, and `catalogue` of kinds, blocks, sources and operations                              |
| Diff       | `diffSites`, which lists the added, removed, moved and changed nodes and the affected pages of two revisions                                                                     |
| Data       | `expand` and `rowsOf`: filter, sort, group, limit and nested repeats over rows the caller supplies                                                                               |
| Compiler   | `compilePage`, `compileSubtree` (for editors that replace part of a canvas) and `compileSite` (every page plus a manifest), and `buildIdentity`, one hash of what a build used   |
| Budgets    | `BUDGETS` and `checkBudgets`                                                                                                                                                     |

Not built yet, by stage:

| Stage | Adds                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2     | Still to come after the operations above: page measurement with findings an agent can act on, a folder of JSON files as a site, a command-line tool with a dev server and an MCP server (checkpoint 2b), a starter package of general blocks (2c), and a measured comparison with agents that write page code (2d) |
| 3     | Motion in CSS and a small timeline script                                                                                                                                                                                                                                                                          |
| 4     | GPU effects, including shaders written by agents under checked limits                                                                                                                                                                                                                                              |
| 5     | Live data, sign-in state, in-page navigation, islands and shared component packages                                                                                                                                                                                                                                |

An agent can use Culm today by sending operations to `plan` or `apply`, reading with the four reads and `catalogue`, and compiling with `compilePage`. The only store is `memoryStore`. A site as a folder of files, the command and the MCP server are not built yet.

## Development

Requires Node 22.18 or later.

```sh
npm install
npm test
```

| Command                                   | Does                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm test`                                | Runs the tests with Node's built-in runner                |
| `npm run typecheck`                       | Type-checks the repository                                |
| `npm run lint`                            | Runs ESLint                                               |
| `npm run format` / `npm run format-check` | Runs Prettier                                             |
| `npm run check:layers`                    | Fails when a lower layer of the core imports a higher one |
| `npm run check:terms`                     | Fails when a product-specific term appears in the core    |
| `npm run gen:scripts`                     | Regenerates the minified page scripts                     |

The core is layered: `scripts`, `document`, `style`, `layout`, `registry`, `validate`, `data`, `compile`. A layer never imports from a later one.

## Brand

Write the name as **Culm** and the project handle as `culmjs`. The logo files are in [docs/brand](docs/brand): the standard logo for light backgrounds, the reverse logo for dark ones, and the icon. The colours are charcoal `#262626`, amber `#FF9400`, cream `#FFF9DF` and white. Use the supplied artwork as it is; [BRAND-RULES.txt](docs/brand/BRAND-RULES.txt) has the rules for size, spacing and placement.

## Licence

MIT. See [LICENSE](LICENSE).
