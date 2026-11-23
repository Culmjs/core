<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/culm-logo-reverse.svg">
    <img src="docs/brand/culm-logo.svg" alt="Culm" width="340">
  </picture>
</h1>

Culm is a local JavaScript framework for building static websites with an agent. A site is an editable document. The agent writes custom sections, Culm validates the changes, and the compiler produces HTML and CSS. Pages need no framework runtime or hydration.

## Start a site from this checkout

Requires Node.js 22.18 or later. From the repository root:

```sh
npm ci
npm run pack:all
node packages/tools/bin/culm.js init my-site --from .pack
cd my-site
npm install
npx culm dev
```

`init` creates an editable starter site. `dev` previews it locally and reloads on save. Run `npx culm build` in the site folder to write the site to `dist/`; serve that folder with any static host.

## Connect an agent

Configure a stdio MCP server in your agent host: **command** `<site>/node_modules/.bin/culm`, **arguments** `["mcp"]`, **working directory** the folder containing `culm.json`.

| Tool       | Purpose                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `describe` | Get the revision and pages; optionally request a small editable example.                        |
| `write`    | Apply up to 32 ordered JSON edits atomically: `insert`, `update`, `move`, `remove`, or `theme`. |
| `find`     | List sections or look up the node to change.                                                    |
| `measure`  | Check the rendered layout in Chromium, including at phone width.                                |
| `build`    | Export the checked site.                                                                        |

For example, this `write` appends a section to `home`. Replace `baseRevision` with the revision returned by `describe`.

```json
{
  "baseRevision": 0,
  "page": "home",
  "ops": [
    {
      "op": "insert",
      "node": {
        "kind": "column",
        "id": "studio",
        "children": [
          {
            "kind": "text",
            "id": "studiotitle",
            "level": "h1",
            "text": "Open studio",
            "style": { "size": 160 },
            "phone": { "size": 62 }
          },
          { "kind": "text", "text": "Visit us on Saturdays." }
        ]
      }
    }
  ]
}
```

To change that title, send `{"op":"update","id":"studiotitle","text":"Studio hours"}` in the next `write` at the returned revision. You can compose original sections from nodes, including paths, strokes and gradients; starter blocks are optional.

`culm mcp --full` exposes the general editing API, including source import (HTML/CSS, literal JSX and JSONC), catalogue, plan/apply, diff and restore. Existing integrations that call these tools directly should use `--full`. Programmatic `createMcpServer` hosts retain the full interface by default; pass `jsonOps: true` for the five authoring tools.

## Packages and documentation

- [`@culmjs/core`](docs/overview.md): document model, validation, operations and deterministic static compilation.
- [`@culmjs/starter`](packages/starter/README.md): site template, styles and editable registered blocks.
- [`@culmjs/tools`](docs/folder-sites.md): CLI, folder storage, dev server, browser measurement and [MCP authoring reference](docs/mcp.md).

## Development

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run format-check`. `npm run test:browser` runs the browser integration suite; set `CULM_CHROME` if Chromium is not automatically found. `npm run check:layers` and `npm run check:terms` validate the core package boundaries.

[MIT licence](LICENSE) · [Brand assets](docs/brand)
