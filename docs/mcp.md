# The MCP server

`culm mcp` gives an agent five local tools to build a site: `describe`, `write`, `find`, `measure`, and `build`. Start with [ordered JSON edits](#ordered-json-edits). Use `culm mcp --full` for low-level operations or importing existing source.

The server has no accounts and no identity. It does not sign anyone in and does not know who is calling. The one secret it uses is a random token on the local port, which keeps other programs on the same machine out (see "The local port").

For the folder the server works on, see [folder-sites.md](folder-sites.md). For the operations a tool takes, see "Changing a site" in [overview.md](overview.md).

## Starting it

```sh
culm mcp                    # standard input and output
culm mcp --port 3333        # also a local port, with a token
culm mcp --chrome /path/to/chrome
culm mcp --json-ops         # explicit alias for the default JSON authoring interface
culm mcp --full             # general editing API, including read, apply, diff and restore
```

`culm mcp` speaks the protocol on standard input and output, and writes nothing else to standard output. Run it from the project folder. A host that starts it as a child process, such as an editor or an agent runner, needs no port.

`--port n` also opens the SDK's HTTP transport on `127.0.0.1:n`. The server then runs until standard input ends (or it gets SIGINT or SIGTERM), so a host that closes the pipe stops it, port included. `--chrome` and `CULM_CHROME` name the Chrome that `measure` opens.

`culm mcp` refuses to start (exit 1, problems on standard error) when `culm.json`, any file in `blocks/` (including a nested one) or any file in `data/` (a field declaration or a row) has a problem, because no registry can be built. Any other problem in the files does not stop it: every tool answers with the located problems as a refusal until the files load again.

A host process builds the same server over its own storage:

```ts
import { createMcpServer, protect } from '@culmjs/tools'

const server = createMcpServer({
  store, // a SiteStore: memoryStore, fileStore, or your own
  registry,
  site: 'main', // the store's name for the site
  data, // rows for data sources
  jsonOps: true, // same five tools as the CLI; omit for the full SDK interface
  allow: protect, // the default guard; your own `Allow` also works
  // browser, executable, out, locate, pageFile, build, folder: all optional
})
```

`createMcpServer` returns an unconnected SDK `Server`. Connect it to a transport yourself. `build` is `UNSUPPORTED_CAPABILITY` unless you pass a `build` function.

## Every reply

For an agent host, register one **stdio** server: executable `<site>/node_modules/.bin/culm`, arguments `["mcp"]`, working directory `<site>` (the folder containing `culm.json`). Use the revision from `describe` for the first write and the **returned** revision for subsequent edits.

### Write in a familiar format

In `--full` mode `write` can also import existing page source. For example, this replaces the content of the home page with a custom responsive section:

```json
{
  "baseRevision": 0,
  "page": "home",
  "html": "<section id='intro' class='hero'><h1 id='headline'>Kiln Index</h1><p>Independent ceramics. <a href='mailto:studio@example.org'>Contact the studio</a>.</p></section>",
  "css": ".hero {padding: 4rem 6%; background: #f2eee4} .hero h1 {font-family: Georgia, serif; font-size: clamp(40px, 8vw, 90px)} @media (max-width: 600px) {.hero {padding: 2rem 6%}}"
}
```

- **HTML/CSS:** supply `html` with inline `style`, embedded `<style>`, or a `css` stylesheet for that write. Sections, articles, asides, divs, nav, headings, paragraphs, inline marks and links, lists, images, buttons and dividers lower to editable nodes. A full `<html><head><title>…</title></head><body>…</body></html>` writes the page and shared header/footer; omitted header/footer are cleared. CSS supports tag, class, id, compound and descendant selectors, flex/grid layouts and max-width media rules (phone 600px; tablet 1024px). This is a static import: unsupported elements and selectors are reported; approximated declarations carry warnings. Use `find` for stored node ids.
- **Literal JSX:** supply `jsx`, for example `"<Column><Text level=\"h1\">Studio</Text></Column>"`. Components, text marks, plain attributes and literal style objects are supported. No JS runtime is needed.
- **JSON:** supply `json` as a node, sibling array, or JSON/JSONC string. For example: `{"kind":"text","id":"headline","level":"h1","text":"Kiln Index","style":{"fontSize":64},"phone":{"fontSize":36}}`. Containers have `children`; native `props` and layered `style: {base, tablet, phone}` are also accepted. `Page`, `Header`, `Footer` and `Site` can be expressed as JSON nodes.

Choose one source per write or per `insert` item. `page` + `append:true` adds a fragment; `target` replaces one existing node, using any source format. A top-level `theme` accepts partial look fields, including CSS font stacks, hex or named colors, and `corners: "square"` or `"8px"`. `theme` alone changes no page content.

`insert` appends ordered `{html, css?}`, `{jsx}`, `{json}` or registered `{use, id, look?, set?}` items. `patch` merges fields on named nodes without replacing siblings or resending the page. Inserts and patches in the same write commit together. For example, to edit the previous heading at revision 1:

```json
{
  "baseRevision": 1,
  "patch": [
    {
      "id": "headline",
      "text": "Kiln Index / 02",
      "phone": { "fontSize": "32px" }
    }
  ]
}
```

A refused write can return a session-local `draft`. At the same revision, use JSON Patch replacements on the original arguments, for example `{"baseRevision":1,"draft":"<returned id>","edits":[{"op":"replace","path":"/patch/0/id","value":"headline"}]}`. `/insert/1/html` replaces just the second item's markup; `/json/children/0/text` replaces one field of a JSON object. No literal search or partial commit is involved. The server keeps its eight most recent drafts within the write size limit.

### Ordered JSON edits

Start `culm mcp --json-ops` (or pass `jsonOps: true` to `createMcpServer`). `describe`, `find`, `write`, `measure` and `build` are the entire tool list. In this profile `write` takes 1–32 ordered `ops`; it validates and commits them together. A single op works the same way. Earlier inserts can be updated or moved later in the same request. Retry the identical write with its original revision to replay it without adding duplicates. This form of `write` is also available on the general server.

```json
{
  "baseRevision": 0,
  "page": "home",
  "ops": [
    {
      "op": "insert",
      "node": {
        "id": "intro",
        "kind": "column",
        "children": [
          {
            "id": "title",
            "kind": "text",
            "level": "h1",
            "text": "Open studio",
            "style": { "size": "clamp(64px, 14vw, 192px)" },
            "phone": { "size": 64 }
          }
        ]
      }
    },
    {
      "op": "insert",
      "node": {
        "id": "visit",
        "kind": "row",
        "phone": { "direction": "column", "align": "start" },
        "children": [
          { "kind": "text", "text": "Come by on Saturdays." },
          {
            "kind": "button",
            "label": "Plan a visit",
            "link": "mailto:desk@example.org"
          }
        ]
      }
    }
  ]
}
```

`insert.node` appends one ordinary subtree. `update` merges `text`, `props` or style layers on an `id`; `move` takes `id`, destination `index` and optional `parent` (page root by default); `remove` takes an `id`; `theme.value` changes the look. The receipt names the revision and section ids. `find {}` returns the section outline. For a targeted read, use e.g. `{"id":"title","full":true}`. Call `measure` explicitly: a `crowded-phone-row` finding reports the constrained heading/button, its parent, its measured width and line count, and a copyable phone-only update. Horizontal schedule rows can stay horizontal.

New starters opt in to a display ceiling: `styles.textRange: {"min":11,"max":96,"displayMax":240}`. H1/H2 may use the larger range, including CSS `clamp()` or viewport sizes. They get tighter default leading and tracking; explicit styles, site heading tracking and phone overrides still win. Sites without `displayMax` keep their previous typography.

Use `describe {"example":"display"}`, `"phone-row"`, `"figure"` or `"group"` for a small, editable node. The figure pairs an original path, gradient and stroke with a mixed-run caption; group parts have their own geometry, paint and slots. Replace or omit anything. There is no block registration or separate planning step.

### Motion on a heading

On a home page with no `title` node, send these arguments to `write`, substituting the revision from `describe`. The heading rises 24 pixels into place the first time it enters view:

```json
{
  "baseRevision": 0,
  "page": "home",
  "ops": [
    {
      "op": "insert",
      "node": {
        "kind": "text",
        "id": "title",
        "level": "h1",
        "text": "Open studio",
        "motion": {
          "trigger": "enter-view",
          "effect": "rise",
          "settings": { "distance": 24 }
        }
      }
    }
  ]
}
```

`find {"tree":"home","id":"title","full":true}` returns the stored program. To replace it, send another `write` using the revision just returned:

```json
{
  "baseRevision": 1,
  "page": "home",
  "ops": [
    {
      "op": "update",
      "id": "title",
      "motion": {
        "trigger": "load",
        "steps": [
          {
            "target": "self",
            "from": { "opacity": 0 },
            "to": { "opacity": 1 },
            "durationMs": 300
          }
        ]
      }
    }
  ]
}
```

Omitting `motion` from an `update` keeps it. Sending `"motion": null` removes it. A full subtree replacement describes the whole node, so leaving `motion` out there removes it too. Invalid motion refuses the batch, including any earlier edits.

In `--full` mode, send `{"op":"setMotion","tree":{"page":"home"},"id":"title","motion":null}` in `plan` or `apply` to clear this heading. Supply either program above instead of `null` to set it. A tree can also be `"header"`, `"footer"` or `{"component":"<piece id>"}`. Use `diff` between revisions to see the motion field that changed, and `restore` to bring an earlier program back.

### Common result format

- A reply is one text item of JSON, at most 16,000 characters (`READ_CAP`), with `cut: true` when something was left out and, for a list, a `cursor` for the rest.
- A cursor is tied to the revision it was made at and to the read that made it. Used after the revision changed it is `REVISION_CONFLICT`; used for another read it is `INVALID_OPERATION`.
- A refusal is a tool result with `isError: true` and `{ "problems": [...] }`, at most 20 problems. It is never a protocol error. A store that throws, a browser that dies and an input of the wrong type each come back as a refusal, not as a crashed server.
- Each problem has a stable `code`, a `message`, and where they apply `nodeId`, `path`, `allowed`, `rule` and `op` (the index of the operation in the batch). On a folder site it also has `file`, `line` and `column`.
- Input schemas are loose on purpose. `plan` and `apply` accept a list of objects that each have an `op` name; core decides what is valid. An agent learns each operation's arguments from `catalogue`.

## Full editing API (`--full`)

| Tool        | Input                                                                                              | Output                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describe`  | none                                                                                               | versions, site name and revision, ceilings, the read cap, required node count, text range, folder or host-supplied                                  |
| `read`      | `what` (`site`, `page`, `node`, `search`) with its arguments, `cursor`                             | rows, revision, `cut`, `cursor`                                                                                                                     |
| `catalogue` | `what` (`guide`, `kinds`, `operations`, `recipes`, `blocks`, `sources`, `effects`), `id`, `cursor` | rows, `cut`, `cursor`                                                                                                                               |
| `plan`      | `baseRevision`, `ops`, `key`?                                                                      | `revision`, `counts`, `roots`, `changed`, `pages`, `notes`; or the refusal. Saves nothing                                                           |
| `apply`     | `baseRevision`, `key`, `ops`                                                                       | the new `revision` and `from`, with the same fields as `plan` and a `hint`; or the refusal                                                          |
| `measure`   | `pages`, `widths`, `classes`, `since`, `cursor`                                                    | `revision`, `measured`, `findings` (merged rows), `incomplete`, `blocked`, `skipped`, and `fixed` and `unchecked` when `since` is given             |
| `diff`      | `from`, `to` (default: the head), `cursor`                                                         | the added, removed, moved and changed nodes and the affected pages, `cut`, `cursor`                                                                 |
| `restore`   | `to`, `baseRevision`, `key`                                                                        | the new revision, with the same fields as `plan`; or the refusal                                                                                    |
| `build`     | none                                                                                               | counts and lists of the manifest's pages, scripts and styles, and its build hash; `UNSUPPORTED_CAPABILITY` when the host passes no `build` function |

### `describe`

Returns `framework`, `schema` (document version), `pluginApi`, `measureProfile`, `site`, `name`, `revision`, `ceilings` (the page budgets, 2,000 nodes, 12 levels of nesting, 200 operations per batch, 1,000,000 characters per request), `readCap`, `required` (how many nodes are required), `textRange` (or null), `folder` (true for a folder site) and `out`. Call it first.

### `read`

- `what: "site"`: the site outline, one row per page and component with node counts, the styles and fonts, the text range and the required count.
- `what: "page"`: one row per node of the tree named by `page` (a page id) or `tree` (`"header"`, `"footer"` or `{ "component": id }`), with `depth` and `from` to choose a subtree. A row is `{ id, kind, depth, name?, hidden?, block?, required?, text?, children? }` in depth-first order: `depth` 0 is the outlined root, `name` is left out when it is the id or the kind's label, `hidden`, `required` and `children` when empty, false or 0, and `text` is cut to 60 characters.
- `what: "node"`: one node by `id` in `page` or `tree`, without its children, and a block root's settings.
- `what: "search"`: `text` (case-insensitive substring), `kind` and `block` (exact); all the given conditions must hold.

No read returns the whole document. On a site at the 2,000-node limit every reply stays within the cap and paging reaches every node.

### `catalogue`

What can be built, composition first. `what` is read in this order:

- `guide`: rows of plain sentences on composing a section (layering with `behind` and `front`, gradients, display type, shapes, reuse, measure and repair). Read it first.
- `kinds`: one string per kind, `kind(role): setting, setting`. `id=<kind>` gives the kind in full, with each setting's `hint` where it has one (the grammar of a shape's `geometry`, `fill` and `stroke`).
- `operations`: one string per operation, `name(field:type, field?:type)`, and a `legend` for the long types (`T` tree, `N` node, `L` layer, `U` object whose null unsets, `V` block setting value). `id=<operation>` gives its fields and an example.
- `recipes`: ready batches, rows `{ recipe, name, guide, ops }` where `ops` is a count. `id=<recipe>` gives the batch itself, with its first operation aimed at the first page of the site. Recipes are `hero`, `split`, `cta-band`, `buttons`, `divider` and `card` (which ends with `makeComponent`). `hero` sets its text beside a drawing, `split` is a two-column section, and `hero`, `split` and `cta-band` hold their content in an inner column of max width 1120 with 80 px of side padding, so none trips the design findings. They use only site colours, add nodes without fixed ids (except `card`'s) and are accepted by `plan` as they stand.
- `blocks`: rows `{ block, name, category, looks, guide }`, finished examples to insert, restyle or copy. `id=<block>` gives the settings and a ready insert.
- `sources`: each source with its fields. `id` adds a first sample row.
- `effects`: `{name,tier}` for each registered motion preset. Detail returns each numeric setting's `min`, `max` and `default`. With a site, it looks for a compatible authored owner on a page, in the header or in the footer (for example, text for a letter split). `example` is a `setMotion` operation using default settings. Without a site, self-only effects use the empty site's home root. If a suitable owner cannot be selected, `requires` describes the target to supply. Discovery uses the targets checked at registration; `plan` checks the actual invocation and site rules.
- `rise` accepts `distance` from 0 to 100 pixels (default 16). The catalogue tier is a minimum: a `load` rise uses CSS, while `enter-view` needs the timeline. A simple `press` on a rendered native button uses CSS `:active` (hold Space); a plain block or link needs the host to track a held key. The host leaves link navigation, form submission and click actions to the control.

`id` returns one entry; the `guide` has none. Every registered block, look, source, effect and kind appears. The five lists `guide`, `kinds`, `operations`, `recipes` and `blocks` together are the first read, capped at 10,500 characters on the starter registry. An unknown recipe or effect id is `INVALID_OPERATION` at `id`, with the available ids.

### `plan` and `apply`

A batch is a list of up to 200 operations, at most 1,000,000 characters of JSON, made from a known `baseRevision`. `plan` runs it on a copy, validates once at the end, and returns what it would do. `apply` does the same and saves the result as the next revision, whole or not at all.

`key` makes a retry safe. The same key with the same content applies once and returns the first result; the same key with other content is `KEY_CONFLICT`. `apply` requires a key; `plan` does not.

A reply holds `counts`, `roots` (created nodes whose parent was not created in the batch, as `"<tree>:<id>"`, where tree is a page id, `header`, `footer` or `component:<id>`), `changed` the same way (each at most 20, with `more` counting the rest), `pages` and `notes`. `apply` adds `hint: "All ids: read, or diff(from, to)."`; there is no `created` list.

Refusals an agent should expect:

| Code                                                                                                       | Meaning                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPERATION`                                                                                        | the request or one operation is malformed or names something that does not exist; `op` is the index. The whole batch is refused                                                                                |
| `INVALID_DOCUMENT`, `INVALID_NODE`, `UNKNOWN_KIND`, `UNKNOWN_BLOCK`, `UNKNOWN_SOURCE`, `UNKNOWN_COMPONENT` | the result would not validate; `nodeId`, `path` and `allowed` say where and what is allowed                                                                                                                    |
| `POLICY_VIOLATION`                                                                                         | a rule refused it: `required`, `textRange` or `protected` (see below)                                                                                                                                          |
| `REVISION_CONFLICT`                                                                                        | the head is not `baseRevision`, including after a hand edit. Read again and plan again                                                                                                                         |
| `KEY_CONFLICT`                                                                                             | the key was used for another request                                                                                                                                                                           |
| `SOURCE_CONFLICT`                                                                                          | a file changed between the plan and the write. Nothing was written                                                                                                                                             |
| `RESOURCE_LIMIT_EXCEEDED`                                                                                  | more than 200 operations, a request over 1,000,000 characters, or a reply that could not be made to fit                                                                                                        |
| `UNSUPPORTED_CAPABILITY`                                                                                   | the store does not hold that revision, or the site cannot be built here                                                                                                                                        |
| `FETCH_FAILED`                                                                                             | a font or icon could not be fetched (a network error, a 404, a reply that is too big, a file Culm will not store): `op` and the family or icon name say which. The revision is unchanged. Send the batch again |

### `measure`

Renders the pages in Chrome and reports what is wrong with them in a form an agent can act on.

- `pages`: page ids (default: every page that is on). `widths`: any of 1280, 834, 390. `classes`: 1, 2 or 3 (default 1 and 2).
- Class 1 is a compile problem (`invalid`). Class 2 is a defect: `off-screen`, `overflow`, `h-scroll`, `overlap`, `contrast`, `tap-target`, and for shapes `shape-covers` (a front shape over required text), `shape-complex` and `raw-colour` (a `#` colour in a shape). Class 3 is taste: `column`, `alignment`, `symmetry`, `rhythm`, `empty-band`, `line-length`, `heading-order`, `duplicate-heading`, `stacked-row`, `phone-order`.
- The profile is version 1: widths 1280, 834 and 390, themes light and dark, each direction the site's languages declare, the default state of each part. What it does not cover is listed in `skipped`.
- The MCP reply merges findings by page, check and nodes: a row is `{ page, check, nodes, at, message, fix?, file?, line? }`, where `at` lists the cells as `"1280"`, with ` dark` and ` rtl` added when not light and left to right. `fix` is advice for a class 2 finding. `culm measure` and the core `Report` keep one finding per cell, with `theme`, `dir`, `observed`, `expected` and a `key`; on a folder site a finding names a file and line from its first node.
- `since` is a revision. `findings` then holds the still-failing rows and the new ones (`new: true`), `fixed` the rows no longer present, and `unchecked` a count. A repair is confirmed when its row is in `fixed` and no row is new.
- Chrome is found from `--chrome` or `CULM_CHROME`, then a Chromium already installed by `npx playwright install chromium`, then the system Chrome. Missing, the result is `MEASUREMENT_INCOMPLETE` naming those three ways. A page that could not be measured is listed in `incomplete`; a request the bundle could not answer is in `blocked`.
- On a folder site, `measure` drops an asset or font link that points outside the project without saying so, while `culm check` refuses it as a `POLICY_VIOLATION` and exits 1. After an agent measures, run `culm check` to see those links.
- A `cursor` continues the report this server just made. It holds one report in memory, and a cursor for one it no longer holds is refused: run `measure` again without a cursor.

Measure never downloads a browser and never contacts an address outside the compiled bundle.

### `diff` and `restore`

`diff` compares two revisions the store holds and lists the nodes added, removed, moved and changed, each in its own list, with the paths of changed fields and the pages affected. It is also what `apply` points to for ids it cut from its reply.

`restore` makes an earlier revision the new head, keeping the history. On a folder site it writes the stored file contents back, so comments and layout return exactly. It needs `baseRevision` and a `key`. A revision older than the 200 a folder keeps is `UNSUPPORTED_CAPABILITY`.

### `build`

Builds the site to its output folder and summarises the manifest. It is the same build as `culm build`, run on the files as they are now.

## Server instructions

The server states its working order once, in the `instructions` of its initialize result (the constant `INSTRUCTIONS`): read `catalogue guide` once (it carries the setup batch and the shortest shape batch); set the design in one batch with `setLook`, `setFonts` and `addPage` (a Google family goes in `setFonts` as `{ google: "Lato", weights: [400, 700] }` and is then named `up:lato`; an icon may be any Iconify `set:name`); compose each section from kinds with `add`, `setStyle` and `setProps`, giving every section a decorative shape or a recipe (`hero`, `split`, `cta-band`, `card`, `divider`, `buttons`); send many operations in one `apply` and skip `plan` for routine batches; save a repeated section with `makeComponent`; end with `measure` and repair what it reports. The one-pass rule: fix each finding once on each node; if the same finding comes back on that node, try the other way its fix names once, then move on.

## What `protect` refuses

`allow` is the hook a product uses to add its own refusals; it runs on every operation, in `plan`, `apply` and `restore`. `culm mcp` passes `protect`, and a host process can pass it too. It refuses two things, each as `POLICY_VIOLATION`:

- taking the mark `required` off a node that has it (`setRequired` with `false` or `null`), rule `protected`;
- removing the site's text size range or widening it, rule `textRange`.

Core's own rules refuse the rest, with no hook needed: a node marked `required` cannot be removed, hidden on any layout, emptied or shrunk below the range, and the same holds for its parent, its page, and a part of a component that an instance overrides. Together these mean an agent cannot delete required content. It also cannot get around the rule in the same batch: a `setRequired` and a `remove` in one batch is refused when `protect` is on.

So a repair cannot fix a clipped title by removing it, hiding it or shrinking it below the allowed size. It has to make the title fit.

## The local port

`culm mcp --port n` opens the SDK's HTTP transport with three checks on every request. All three must pass, or the request is answered 403 (a repeated `Host` header is 400).

1. **Address.** The listener binds `127.0.0.1` and there is no option to bind another address.
2. **`Host`.** The header must be `127.0.0.1:<port>` or `localhost:<port>` with the chosen port. This stops a web page that rebinds a name to the local machine.
3. **`Origin`.** A request that carries any `Origin` header is refused. Browsers send one; command-line clients and agent runners do not.

On top of those, the server requires a random token (32 bytes, new on every start) in the `Authorization: Bearer <token>` header. It is printed to standard error when the server starts, because standard output carries the protocol:

```text
MCP token: 9f2c...
MCP listening on http://127.0.0.1:3333/
```

The token is not a sign-in and identifies nobody. It exists so that another program on the same machine cannot call `apply` by guessing the port. The server keeps one session per client, so an editor can reconnect. A request body is limited to 8 MiB.

## What this does not do

- No accounts, no identity, no audit of who called. A revision records that it came from Culm (or from a hand edit), not from whom.
- No remote access. There is no option that listens beyond standard input and output or the local machine.
- `protect` is a rule for callers that use the tools. It does not stop a caller that can write the files (see "What this does not protect" in [folder-sites.md](folder-sites.md)).

## Fonts, icons, borders and aliases

- `setFonts` takes `"sys:sans"`, a catalogue name or `{ google: "Lato", weights: [400, 700] }` (weights 100 to 900; family letters, digits and spaces). On a folder site `plan` and `apply` fetch the latin subset from Google Fonts into `fonts/<slug>/` (the slug is the family in lower case with dashes); a look then names it `up:lato`. A failed fetch is `FETCH_FAILED` and changes nothing.
- An `icon` or `button` icon name is a built-in name (`star`) or an Iconify `set:name` such as `lucide:camera`. On a folder site the SVG is fetched into `assets/icons/<set>/` with the set's licence. Only sets licensed MIT, Apache-2.0, ISC, CC-BY-3.0 or CC-BY-4.0 are accepted (`POLICY_VIOLATION`, rule `icon-licence`). A batch fetches at most 60 icons, counting only icons not already held, and at most 4 font families; more is `RESOURCE_LIMIT_EXCEEDED`.
- Aliases, rewritten by `plan` before checking: `align` on a text is `textAlign`; `display: "none"` in a layer is `hidden: true`, and `display` with another value is `hidden: false` there (an explicit `hidden` wins); a style `radius` on a rect shape moves to its `geometry.radius` (a radius already there wins). A value with no mapping is refused with a hint.
- Borders: `border` and `borderTop`, `borderRight`, `borderBottom`, `borderLeft` take `{ width, color }` (style optional, solid by default); `borderWidth` takes a number or four numbers; `borderColor` takes a colour name. Width is 0 to 64.
- `menu` takes `foldOn: "phone"`: on a phone the links fold into a button that opens them (native `details`, no script).
