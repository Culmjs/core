# @culmjs/tools

The `culm` command line and the tools behind it: a folder of JSON files becomes a Culm site.

## Commands

```
culm dev [--port n]                 serve the site on 127.0.0.1 (default port 4321), recompile on save
culm build                          write the compiled site to the output folder
culm check [--chrome path]          validate, then measure every page in Chrome
culm expand <file> <id>             rewrite the short form <id> in <file> as its nodes
culm schema                         write culm.schema.json in the project folder
culm mcp [--port n] [--chrome path] serve the site to an agent over standard input and output;
                                    --port also opens a local port with a token
```

Exit codes: 0 done, 1 problems or findings, 2 wrong usage or no browser. Run a command from the project folder (the one holding `culm.json`).

## Browser

`culm check` and the MCP `measure` tool drive Chrome or Chromium themselves over the DevTools protocol; no browser library is installed and nothing is downloaded. The browser is, in order: the `--chrome` option or `CULM_CHROME`, a Chromium that `npx playwright install chromium` left on disk, the system Chrome. With none of them a check reports `MEASUREMENT_INCOMPLETE` and names these three ways.

## Exports

`@culmjs/tools` exports nine names: `openProject`, `fileStore`, `loadFolder`, `buildSite`, `runMeasure`, `measureSince`, `authoringSchema`, `createMcpServer` and `protect`.

It needs `@culmjs/core` as a peer dependency. See `docs/folder-sites.md` and `docs/mcp.md` for the folder format and the agent tools.
