# The MCP server

`@culmjs/tools` ships a Model Context Protocol server, so an agent can read a Culm site, change it, measure it and build it without any code of its own. It is built on the official SDK, `@modelcontextprotocol/sdk` 1.32.2, and has nine tools.

The server has no accounts and no identity. It does not sign anyone in and does not know who is calling. The one secret it uses is a random token on the local port, which keeps other programs on the same machine out (see "The local port").

For the folder the server works on, see [folder-sites.md](folder-sites.md). For the operations a tool takes, see "Changing a site" in [overview.md](overview.md).

## Starting it

```sh
culm mcp                    # standard input and output
culm mcp --port 3333        # also a local port, with a token
culm mcp --chrome /path/to/chrome
```

`culm mcp` speaks the protocol on standard input and output, and writes nothing else to standard output. Run it from the project folder. A host that starts it as a child process, such as an editor or an agent runner, needs no port.

`--port n` also opens the SDK's HTTP transport on `127.0.0.1:n`. The server then runs until standard input ends (or it gets SIGINT or SIGTERM), so a host that closes the pipe stops it, port included. `--chrome` and `CULM_CHROME` name the Chrome that `measure` opens.

`culm mcp` refuses to start (exit 1, problems on standard error) when `culm.json`, a file in `blocks/` or a field declaration in `data/` has a problem, because no registry can be built. Any other problem in the files does not stop it: every tool answers with the located problems as a refusal until the files load again.

A host process builds the same server over its own storage:

```ts
import { createMcpServer, protect } from '@culmjs/tools'

const server = createMcpServer({
  store, // a SiteStore: memoryStore, fileStore, or your own
  registry,
  site: 'main', // the store's name for the site
  data, // rows for data sources
  allow: protect, // the default guard; your own `Allow` also works
  // browser, executable, out, locate, pageFile, build, folder: all optional
})
```

`createMcpServer` returns an unconnected SDK `Server`. Connect it to a transport yourself. `build` is `UNSUPPORTED_CAPABILITY` unless you pass a `build` function.

## Every reply

- A reply is one text item of JSON, at most 16,000 characters (`READ_CAP`), with `cut: true` when something was left out and, for a list, a `cursor` for the rest.
- A cursor is tied to the revision it was made at and to the read that made it. Used after the revision changed it is `REVISION_CONFLICT`; used for another read it is `INVALID_OPERATION`.
- A refusal is a tool result with `isError: true` and `{ "problems": [...] }`, at most 20 problems. It is never a protocol error. A store that throws, a browser that dies and an input of the wrong type each come back as a refusal, not as a crashed server.
- Each problem has a stable `code`, a `message`, and where they apply `nodeId`, `path`, `allowed`, `rule` and `op` (the index of the operation in the batch). On a folder site it also has `file`, `line` and `column`.
- Input schemas are loose on purpose. `plan` and `apply` accept a list of objects that each have an `op` name; core decides what is valid. An agent learns each operation's arguments from `catalogue`.

## The tools

| Tool        | Input                                                                  | Output                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describe`  | none                                                                   | versions, site name and revision, ceilings, the read cap, required node count, text range, folder or host-supplied                                  |
| `read`      | `what` (`site`, `page`, `node`, `search`) with its arguments, `cursor` | rows, revision, `cut`, `cursor`                                                                                                                     |
| `catalogue` | `what` (`kinds`, `blocks`, `sources`, `operations`), `id`, `cursor`    | entries, `cut`, `cursor`                                                                                                                            |
| `plan`      | `baseRevision`, `ops`, `key`?                                          | `revision`, counts, created and changed ids, pages affected, notes; or the refusal. Saves nothing                                                   |
| `apply`     | `baseRevision`, `key`, `ops`                                           | the new `revision` and `from`, with the same fields as `plan`; or the refusal                                                                       |
| `measure`   | `pages`, `widths`, `classes`, `since`, `cursor`                        | the report's findings, `cut`, `cursor`, and the comparison when `since` is given                                                                    |
| `diff`      | `from`, `to` (default: the head), `cursor`                             | the added, removed, moved and changed nodes and the affected pages, `cut`, `cursor`                                                                 |
| `restore`   | `to`, `baseRevision`, `key`                                            | the new revision, with the same fields as `plan`; or the refusal                                                                                    |
| `build`     | none                                                                   | counts and lists of the manifest's pages, scripts and styles, and its build hash; `UNSUPPORTED_CAPABILITY` when the host passes no `build` function |

### `describe`

Returns `framework`, `schema` (document version), `pluginApi`, `measureProfile`, `site`, `name`, `revision`, `ceilings` (the page budgets, 2,000 nodes, 12 levels of nesting, 200 operations per batch, 1,000,000 characters per request), `readCap`, `required` (how many nodes are required), `textRange` (or null), `folder` (true for a folder site) and `out`. Call it first.

### `read`

- `what: "site"`: the site outline, one row per page and component with node counts, the styles and fonts, the text range and the required count.
- `what: "page"`: one row per node of the tree named by `page` (a page id) or `tree` (`"header"`, `"footer"` or `{ "component": id }`), with `depth` and `from` to choose a subtree. A row has the node's parent, index, hidden layouts, block of origin, required mark and an 80-character preview.
- `what: "node"`: one node by `id` in `page` or `tree`, without its children, and a block root's settings.
- `what: "search"`: `text` (case-insensitive substring), `kind` and `block` (exact); all the given conditions must hold.

No read returns the whole document. On a site at the 2,000-node limit every reply stays within the cap and paging reaches every node.

### `catalogue`

What can be built. `kinds`, `blocks` (with looks and settings and a ready insert operation), `sources` (with fields and a first sample row) and `operations` (each of the 26, with its arguments and an example). `id` returns one entry. Every registered block, look, source and kind appears, and a batch built only from what the catalogue states is accepted.

### `plan` and `apply`

A batch is a list of up to 200 operations, at most 1,000,000 characters of JSON, made from a known `baseRevision`. `plan` runs it on a copy, validates once at the end, and returns what it would do. `apply` does the same and saves the result as the next revision, whole or not at all.

`key` makes a retry safe. The same key with the same content applies once and returns the first result; the same key with other content is `KEY_CONFLICT`. `apply` requires a key; `plan` does not.

Replies carry counts, and the first created and changed ids, pages and notes up to the cap. `diff(from, to)` lists the rest, and the reply says so in `hint`.

Refusals an agent should expect:

| Code                                                                                                       | Meaning                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPERATION`                                                                                        | the request or one operation is malformed or names something that does not exist; `op` is the index. The whole batch is refused |
| `INVALID_DOCUMENT`, `INVALID_NODE`, `UNKNOWN_KIND`, `UNKNOWN_BLOCK`, `UNKNOWN_SOURCE`, `UNKNOWN_COMPONENT` | the result would not validate; `nodeId`, `path` and `allowed` say where and what is allowed                                     |
| `POLICY_VIOLATION`                                                                                         | a rule refused it: `required`, `textRange` or `protected` (see below)                                                           |
| `REVISION_CONFLICT`                                                                                        | the head is not `baseRevision`, including after a hand edit. Read again and plan again                                          |
| `KEY_CONFLICT`                                                                                             | the key was used for another request                                                                                            |
| `SOURCE_CONFLICT`                                                                                          | a file changed between the plan and the write. Nothing was written                                                              |
| `RESOURCE_LIMIT_EXCEEDED`                                                                                  | more than 200 operations, a request over 1,000,000 characters, or a reply that could not be made to fit                         |
| `UNSUPPORTED_CAPABILITY`                                                                                   | the store does not hold that revision, or the site cannot be built here                                                         |

### `measure`

Renders the pages in Chrome and reports what is wrong with them in a form an agent can act on.

- `pages`: page ids (default: every page that is on). `widths`: any of 1280, 834, 390. `classes`: 1, 2 or 3 (default 1 and 2).
- Class 1 is a compile problem (`invalid`). Class 2 is a defect: `off-screen`, `overflow`, `h-scroll`, `overlap`, `contrast`, `tap-target`. Class 3 is taste: `column`, `alignment`, `symmetry`, `rhythm`, `empty-band`, `line-length`, `heading-order`, `duplicate-heading`, `stacked-row`, `phone-order`.
- The profile is version 1: widths 1280, 834 and 390, themes light and dark, each direction the site's languages declare, the default state of each part. What it does not cover is listed in `skipped`.
- A finding has `check`, `class`, `page`, `width`, `theme`, `dir`, `nodes`, `observed`, `expected`, `message` and a `key`. On a folder site it also has `file`, `line` and `column`, from its first node, or the page's file when no node can be placed. A finding on a short-form part is at the short form's line.
- `since` is a revision. The reply then adds `was` (each finding of that revision, with `fixed`, `present`, `unobservable` or `unchecked`) and `added` (findings that are new). A repair is confirmed when its finding is `fixed` and `added` is empty.
- Chrome is found from `--chrome` or `CULM_CHROME`, then a Chromium already installed by `npx playwright install chromium`, then the system Chrome. Missing, the result is `MEASUREMENT_INCOMPLETE` naming those three ways. A page that could not be measured is listed in `incomplete`; a request the bundle could not answer is in `blocked`.
- A `cursor` continues the report this server just made. It holds one report in memory, and a cursor for one it no longer holds is refused: run `measure` again without a cursor.

Measure never downloads a browser and never contacts an address outside the compiled bundle.

### `diff` and `restore`

`diff` compares two revisions the store holds and lists the nodes added, removed, moved and changed, each in its own list, with the paths of changed fields and the pages affected. It is also what `apply` points to for ids it cut from its reply.

`restore` makes an earlier revision the new head, keeping the history. On a folder site it writes the stored file contents back, so comments and layout return exactly. It needs `baseRevision` and a `key`. A revision older than the 200 a folder keeps is `UNSUPPORTED_CAPABILITY`.

### `build`

Builds the site to its output folder and summarises the manifest. It is the same build as `culm build`, run on the files as they are now.

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
