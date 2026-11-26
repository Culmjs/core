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

`init` creates an editable 4-page bakery starter (or pass `--blank` for a minimal single-page starter). `dev` previews it locally and reloads on save. Run `npx culm check` to validate and measure pages in Chrome, or `npx culm build` in the site folder to write the site to `dist/`.

## Benchmarks: Culm vs. Astro & GSAP

We benchmarked **Culm** against **Astro 7.4.13** (ordinary CSS) across 4 editorial briefs and **Culm Stage 3 Motion** against **Astro + GSAP 3.15.1 (`ScrollTrigger`)** across 4 scroll/motion choreography briefs (`codex-cli 0.171.0`, `gpt-6.1-terra`, low reasoning, host skills disabled; 16 live sessions total, headless Chromium `156.0.8078.4`).

### Agentic Build Cost, Time & Runtime Performance (4 Briefs per Arm)

| Measure                                                    |              Culm (Static) |      Astro 7.4.13 (Static) |      Culm Motion (Stage 3) |        Astro + GSAP 3.15.1 |
| ---------------------------------------------------------- | -------------------------: | -------------------------: | -------------------------: | -------------------------: |
| Functional passes (desktop & phone)                        |                      `4/4` |                      `4/4` |                      `4/4` |                      `4/4` |
| Motion + JS-off + reduced-motion gate                      |                          — |                          — |                      `4/4` |                      `3/4` |
| Total input tokens (4 sites)                               |                  `483,591` |                  `612,624` |                  `375,538` |                  `402,260` |
| ↳ Fresh input tokens                                       |                   `52,999` |                   `76,944` |                   `49,010` |                   `27,092` |
| ↳ Cached input reads                                       |                  `430,592` |                  `535,680` |                  `326,528` |                  `375,168` |
| Total output tokens (`reasoning`)                          |           `13,362` (`101`) |           `21,224` (`637`) |           `12,689` (`169`) |           `22,585` (`518`) |
| Agent build time (median / mean)                           |      `68.29 s` / `75.19 s` |    `119.80 s` / `120.41 s` |      `71.13 s` / `73.49 s` |    `114.81 s` / `115.50 s` |
| Cost (cache-aware, total / per site)¹                      |      `$0.1413` / `$0.0353` |      `$0.2098` / `$0.0524` |      `$0.1288` / `$0.0322` |      `$0.1588` / `$0.0397` |
| Cost (uncached, total / per site)²                         |      `$0.5504` / `$0.1376` |      `$0.7188` / `$0.1797` |      `$0.4389` / `$0.1097` |      `$0.5152` / `$0.1288` |
| Cost (frontier tier, total / per site)³                    |      `$0.3737` / `$0.0934` |      `$0.5385` / `$0.1346` |      `$0.3310` / `$0.0828` |      `$0.3873` / `$0.0968` |
| Refused MCP writes / Shell calls                           |                  `5` / `0` |                 `0` / `42` |                  `1` / `0` |                 `0` / `27` |
| Static CLI export (median)                                 |                  `0.220 s` |                  `0.441 s` |                  `0.220 s` |                  `0.420 s` |
| Shipped raw JS bytes (median)                              |                    `581 B` |                      `0 B` |                  `8,768 B` |                `113,762 B` |
| Brotli-5 wire transfer / HTTP reqs (median)                |            `3,981 B` (`1`) |            `3,803 B` (`2`) |            `8,154 B` (`1`) |           `47,537 B` (`3`) |
| Desktop FCP / LCP / Load (`1280×900`, `1×`)                |     `24.0 / 24.0 / 8.3 ms` |     `40.0 / 40.0 / 8.4 ms` |    `26.0 / 26.0 / 13.6 ms` |    `38.0 / 38.0 / 38.5 ms` |
| Mobile FCP / LCP / Load (`390×844`, `4×` CPU, `150ms` RTT) | `214.0 / 214.0 / 213.9 ms` | `426.0 / 426.0 / 342.1 ms` | `218.0 / 218.0 / 224.8 ms` | `442.0 / 442.0 / 588.0 ms` |

¹ **Cache-aware rates** (per 1M tokens): `$1.00` fresh input, `$0.05` cached read, `$1.25` cache write, `$5.00` output.  
² **Uncached sensitivity**: `$1.00` all input, `$5.00` output.  
³ **Frontier tier**: `$2.50` fresh input, `$0.25` cached read, `$10.00` output.

### Controlled Motion Engine Benchmark: Culm Stage 3 vs. GSAP 3.15.1 (`ScrollTrigger`)

Median of 5 cold Chromium runs per scene across identical layout geometry (`native` CSS `view()` opacity scroll, `box` 500 px `enter-view` travel, `panel` 900 px pinned `scaleX` scrub, `type` 10-letter masked stagger `expo-out`):

| Scene    | Engine / Tier                   |      Raw JS |    Brotli (Reqs) | Mobile Load / Cold JS | Sweep Script (Desk / Mob `4×`) | Sweep Layout (Desk / Mob) |   Heap (Desk / Mob) |
| -------- | ------------------------------- | ----------: | ---------------: | --------------------: | -----------------------------: | ------------------------: | ------------------: |
| `native` | **Culm** (Tier-1 CSS `view()`)  |     `304 B` |  `2,282 B` (`1`) |     `204.6 / 0.72 ms` |               `1.53 / 1.00 ms` |          `0.00 / 0.00 ms` | `1,075 / 1,075 KiB` |
| `native` | **GSAP 3.15.1 + ScrollTrigger** | `118,275 B` | `46,443 B` (`3`) |    `575.0 / 19.45 ms` |               `8.88 / 8.92 ms` |          `0.29 / 0.13 ms` | `1,826 / 1,827 KiB` |
| `box`    | **Culm** (Tier-2 WAAPI Host)    |   `8,490 B` |  `6,675 B` (`1`) |     `212.5 / 4.21 ms` |               `0.72 / 1.26 ms` |          `0.05 / 0.04 ms` | `1,223 / 1,223 KiB` |
| `box`    | **GSAP 3.15.1 + ScrollTrigger** | `118,254 B` | `46,569 B` (`3`) |    `571.4 / 16.97 ms` |               `5.81 / 5.79 ms` |          `0.00 / 0.00 ms` | `1,811 / 1,824 KiB` |
| `panel`  | **Culm** (Tier-2 WAAPI Host)    |   `8,490 B` |  `6,665 B` (`1`) |     `216.1 / 6.39 ms` |               `5.33 / 2.79 ms` |          `0.00 / 0.00 ms` | `1,330 / 1,329 KiB` |
| `panel`  | **GSAP 3.15.1 + ScrollTrigger** | `118,272 B` | `46,495 B` (`3`) |    `593.3 / 27.72 ms` |               `7.84 / 8.84 ms` |          `0.36 / 0.95 ms` | `1,951 / 1,946 KiB` |
| `type`   | **Culm** (Tier-2 WAAPI Host)    |   `8,490 B` |  `6,667 B` (`1`) |     `210.0 / 3.65 ms` |              `6.15 / 20.62 ms` |          `0.19 / 0.81 ms` | `1,299 / 1,299 KiB` |
| `type`   | **GSAP 3.15.1 + ScrollTrigger** | `118,626 B` | `46,598 B` (`3`) |    `574.2 / 20.45 ms` |              `10.73 / 6.34 ms` |          `0.00 / 0.00 ms` | `2,345 / 2,344 KiB` |

_(In the 16-site blind visual judging study with `gpt-6.2-astra`, Culm scored `17.875/20` mean vs. Astro's `19.375/20`, winning 0 pairs, tying 2, and losing 6.)_

**[See every per-brief measurement, screenshot gallery, and prior visual trial details →](docs/comparison/README.md)**

## Connect an agent

Configure a stdio MCP server in your agent host: **command** `<site>/node_modules/.bin/culm`, **arguments** `["mcp"]`, **working directory** the folder containing `culm.json`.

| Tool       | Purpose                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describe` | Get the revision and pages; optionally request a small editable example.                                                                                  |
| `write`    | Apply up to 32 ordered JSON edits (`insert`, `update`, `move`, `remove`, `theme`, `addPage`, `removePage`, `setPage`); target chrome with `page: "header" | "footer"`. |
| `find`     | List sections or look up the node to change.                                                                                                              |
| `measure`  | Check the rendered layout in Chromium, including at phone width.                                                                                          |
| `render`   | Export a node, page section, or standalone visual spec as checked PNG, WebP or SVG.                                                                       |
| `build`    | Export the checked site.                                                                                                                                  |

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

`culm mcp --full` exposes the general editing API, including source import (HTML/CSS, literal JSX and JSONC), catalogue, plan/apply, diff and restore. Existing integrations that call these tools directly should use `--full`. Programmatic `createMcpServer` hosts retain the full interface by default; pass `jsonOps: true` for the six authoring tools.

## Packages and documentation

- [`@culmjs/core`](docs/overview.md): document model, validation, operations and deterministic static compilation.
- [`@culmjs/starter`](packages/starter/README.md): site template, styles and editable registered blocks.
- [`@culmjs/tools`](docs/folder-sites.md): CLI, folder storage, dev server, browser measurement and [MCP authoring reference](docs/mcp.md).

## Development

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run format-check`. `npm run test:browser` runs the browser integration suite; set `CULM_CHROME` if Chromium is not automatically found. `npm run check:layers` and `npm run check:terms` validate the core package boundaries.

[MIT licence](LICENSE) · [Brand assets](docs/brand)
