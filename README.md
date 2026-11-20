# Culm

**The JavaScript framework for the AI era.**

Culm builds websites from data. A whole site is one JSON document. Culm checks that document, then compiles it to static HTML and CSS.

It is made for sites that AI agents build and maintain. An agent does not write page code. It writes a small piece of data, Culm tells it exactly what is wrong if anything is, and only a valid document becomes a page.

> **Status: early.** Stage 1 of 6 is done: the document model, validation, the plug-in registry and the compiler. The API will change, and nothing is on npm yet. See [What exists today](#what-exists-today).

## Why

### Fewer tokens

An agent that builds a page by writing markup, styles and scripts spends most of its output on text the framework could have produced. With Culm the agent writes the description and Culm writes the page.

In the example below, the agent's part is 127 characters of JSON. The compiled page is 5,407 bytes.

The same holds for changes. Editing a heading is one small edit to one node. The agent does not re-read or re-emit a file of code to make it.

A measured comparison of token use against agents that write page code is planned for stage 2. Until it is done, treat this as a design aim backed by the sizes above, not a benchmark.

### The agent cannot break the page

- **Nothing invalid compiles.** `validateSite` checks every node, setting, style, binding and link. `compilePage` refuses a document with problems and returns them.
- **A problem says what to do.** Each one has a stable code, the node, the field, and the values that are allowed there. An agent can act on it without guessing.
- **Unknown content is refused, never silently dropped.** A field or setting Culm does not act on is an error, so a document cannot look fine and quietly lose something.
- **Text is always escaped.** Culm writes all HTML itself. Text, attributes and addresses from the document cannot become markup, script or an unsafe link.
- **Bad input returns problems.** The public functions do not throw on a malformed document.

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

## How it works

1. **One document.** A site is pages, a header and footer, reusable components, fonts and named styles. A page is a tree of nodes. A node has a kind (`text`, `image`, `row`, `list`, `form` and so on), settings, style layers for desktop, tablet, phone and dark mode, and optional states and data bindings.
2. **Plug-ins add the product's own parts.** A product registers blocks, data sources, node kinds and validation rules with a registry it creates. A block is data: a set of looks, each a tree of nodes, with settings declared as actions (`set`, `choose`, `show`, `filter`). Inserting a block copies its nodes into the site, so every part can be edited afterwards.
3. **Validation.** One call checks the whole document against the core rules and every registered rule.
4. **Compilation.** Culm binds the rows you supply, resolves the tree to elements and CSS rules, and writes the page. Identical rule sets share one class. A script is included only when a node on the page needs it.

Read [docs/overview.md](docs/overview.md) for the document model, the plug-in API, the compile functions and the guarantees in more detail.

## What exists today

Stage 1, in `packages/core` (`@culmjs/core`), with no runtime dependencies. It runs in Node 22+, edge workers and the browser.

| Area       | What you get                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Document   | Types for the site document, 21 core node kinds, tree helpers, `emptySite`, a schema version with a migration runner       |
| Plug-ins   | `createRegistry`, blocks with declared settings, data sources with row checks, validation rules, extra node kinds          |
| Validation | `validateSite`, with stable problem codes                                                                                  |
| Data       | `expand` and `rowsOf`: filter, sort, group, limit and nested repeats over rows the caller supplies                         |
| Compiler   | `compilePage`, `compileSubtree` (for editors that replace part of a canvas) and `compileSite` (every page plus a manifest) |
| Budgets    | `BUDGETS` and `checkBudgets`                                                                                               |

Not built yet, by stage:

| Stage | Adds                                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | Checked operations for agents, a catalogue, page measurement with findings an agent can act on, an MCP server, a command-line tool with a dev server, and a starter package of general blocks |
| 3     | Motion in CSS and a small timeline script                                                                                                                                                     |
| 4     | GPU effects, including shaders written by agents under checked limits                                                                                                                         |
| 5     | Live data, sign-in state, in-page navigation, islands and shared component packages                                                                                                           |

Until stage 2, an agent uses Culm by editing the document and calling `validateSite` and `compilePage`. The checked operations that let an agent make changes by name, with dry runs and all-or-nothing batches, are stage 2.

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

## Licence

MIT. See [LICENSE](LICENSE).
