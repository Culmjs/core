import { access, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildSite, fileHashes } from '../build/bundle.ts'
import { media, readAsset, refusal } from '../folder/files.ts'
import { startDev } from '../dev/server.ts'
import { expandShortForm } from '../folder/write.ts'
import { fileStore } from '../folder/store.ts'
import { parseFile } from '../folder/jsonc.ts'
import { isObj } from '../shared.ts'
import type { Problem, SiteDocument, TreeRef } from '@culmjs/core'
import { fetchFor, type FetchOptions } from '../folder/fetch.ts'
import { readHeld } from '../folder/held.ts'
import { openProject, type Project } from '../folder/project.ts'
import type { Located } from '../folder/plugins.ts'
import { runMeasure } from '../measure/run.ts'
import { createMcpServer } from '../mcp/server.ts'
import { listenLocal } from '../mcp/http.ts'
import { protect } from '../mcp/protect.ts'
import { authoringSchema } from '../schema/authoring.ts'
import { locateFinding } from '../folder/locateFinding.ts'
import { formatLocated } from './print.ts'
import { init } from './init.ts'

export interface Io {
  /** The project folder; default: the working folder. */
  cwd?: string
  out?: (text: string) => void
  err?: (text: string) => void
}

const USAGE = `Usage: culm <command> [options]

Commands:
  init <folder> [--from folder]
                               write a new bakery site into a new or empty folder
  dev [--port n]               serve the site, recompile on save (default port 4321)
  build                        write the compiled site to the output folder
  check [--chrome path]        validate, then measure every page in Chrome
  expand <file> <id>           rewrite the short form <id> in <file> as its nodes
  schema                       write culm.schema.json in the project folder
  mcp [--port n] [--chrome path] [--json-ops | --full]
                               JSON authoring by default; --full exposes the low-level tools
                               serve the site to an agent over standard input and
                               output; --port also opens a local port with a token

Exit codes: 0 done, 1 problems or findings, 2 wrong usage or no browser.
--chrome (or CULM_CHROME) names the Chrome or Chromium that measuring opens.
`

const stdout = (text: string) => void process.stdout.write(text)
const stderr = (text: string) => void process.stderr.write(text)

/** Resolves on the first of SIGINT, SIGTERM and `also`. */
const untilStopped = (also: Promise<unknown> = new Promise(() => {})) =>
  new Promise<void>(done => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      done()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    void also.then(stop)
  })

/**
 * The options `culm mcp` serves a folder with. The map and the data are read again whenever the store reads the folder, so a later
 * change, by a batch or by hand, is located and used as it is now. Exported so the journey tests serve a folder the same way.
 */
export async function folderMcpOptions(
  cwd: string,
  project: Project,
  executable?: string,
  fetchOptions?: FetchOptions,
) {
  const { loaded } = project
  let map = loaded.map
  let data = loaded.data
  const store = await fileStore(cwd, project.registry, {
    onHead(now) {
      map = now.map
      data = now.data
      // Installed plugins and their registry are fixed for this MCP session.
      // A later opt-out must not leave that registry's GPU grant usable.
      if (project.registry.gpu?.enabled) {
        const text = now.files.find(f => f.path === 'culm.json')?.text ?? ''
        const config = parseFile(text, 1).value
        if (
          !isObj(config) ||
          !isObj(config.features) ||
          config.features.gpu !== true
        )
          return {
            code: 'UNSUPPORTED_CAPABILITY',
            file: 'culm.json',
            path: 'features.gpu',
            message:
              'GPU support is no longer enabled. Reopen the folder session to use its current configuration.',
          }
      }
    },
  })
  return {
    store,
    registry: project.registry,
    site: 'site',
    get data() {
      return data
    },
    allow: protect,
    folder: true,
    executable,
    // the hashes of assets/ and fonts/, read again for each measure
    files: () => fileHashes(cwd),
    // a Google family a batch names is fetched once into fonts/ (the hosts are a parameter so tests can point at a local fake)
    fetch: (ops: unknown[], doc: SiteDocument, offline?: boolean) =>
      fetchFor(
        cwd,
        doc,
        ops,
        offline
          ? {
              ...fetchOptions,
              get: () => Promise.reject(new Error('no network for a replay')),
            }
          : fetchOptions,
      ),
    held: () => readHeld(cwd),
    assets: (p: string) => readAsset(cwd, p),
    // a problem the store already located stays as it is
    locate: <P extends Problem>(p: P): P =>
      (p as { file?: string }).file ? p : (map.locateProblem(p) as P),
    pageFile: (id: string) => map.pageFile(id),
    // the folder may have changed since the server started
    build: async () => buildSite(await openProject(cwd)),
  }
}

export async function main(argv: string[], io: Io = {}): Promise<number> {
  const cwd = resolve(io.cwd ?? process.cwd())
  const out = io.out ?? stdout
  const err = io.err ?? stderr
  const usage = (why?: string) => {
    err(`${why ? `${why}\n\n` : ''}${USAGE}`)
    return 2
  }
  const show = (problems: Located[]) =>
    problems.forEach(p => err(`${formatLocated(p)}\n`))

  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean' },
        port: { type: 'string' },
        chrome: { type: 'string' },
        full: { type: 'boolean' },
        'json-ops': { type: 'boolean' },
        from: { type: 'string' },
      },
    })
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e))
  }
  const { values, positionals } = parsed
  if (values.help) {
    out(USAGE)
    return 0
  }
  const [command, ...args] = positionals
  const wants: Record<
    string,
    { args: number; port?: true; chrome?: true; from?: true }
  > = {
    dev: { args: 0, port: true },
    build: { args: 0 },
    check: { args: 0, chrome: true },
    expand: { args: 2 },
    schema: { args: 0 },
    mcp: { args: 0, port: true, chrome: true },
    init: { args: 1, from: true },
  }
  const want = command ? wants[command] : undefined
  if ((values.full || values['json-ops']) && command !== 'mcp')
    return usage('--json-ops and --full are for culm mcp.')
  if (values.full && values['json-ops'])
    return usage('Choose either --json-ops or --full.')
  if (!command || !want)
    return usage(command ? `Unknown command "${command}".` : undefined)
  if (args.length !== want.args)
    return usage(
      `culm ${command} takes ${want.args} argument${want.args === 1 ? '' : 's'}.`,
    )
  if (values.port !== undefined && !want.port)
    return usage(`culm ${command} has no --port.`)
  if (values.chrome !== undefined && !want.chrome)
    return usage(`culm ${command} has no --chrome.`)
  if (values.from !== undefined && !want.from)
    return usage(`culm ${command} has no --from.`)
  let port: number | undefined
  if (values.port !== undefined) {
    port = /^\d{1,5}$/.test(values.port) ? Number(values.port) : NaN
    if (!(port <= 65535))
      return usage(
        `--port needs a number from 0 to 65535, not "${values.port}".`,
      )
  }

  if (command === 'init') {
    try {
      const r = await init(resolve(cwd, args[0]!), { from: values.from })
      if (!r.ok) return (r.problems.forEach(p => err(`${p.message}\n`)), 1)
      const dir = args[0]!
      const shown = /^[\w@%+=:,./-]+$/.test(dir)
        ? dir
        : `'${dir.replaceAll("'", `'\\''`)}'`
      out(
        `Wrote ${r.files.length} files to ${dir}\nNext: cd ${shown} && npm install && npx culm dev\n`,
      )
      return 0
    } catch (e) {
      err(`${e instanceof Error ? e.message : String(e)}\n`)
      return 1
    }
  }

  try {
    const exists = await access(join(cwd, 'culm.json')).then(
      () => true,
      () => false,
    )
    if (!exists) {
      show([
        {
          code: 'INVALID_DOCUMENT',
          message: 'culm.json is missing: this is not a Culm project folder.',
          file: 'culm.json',
        },
      ])
      return 1
    }
    if (command === 'dev') {
      const s = await startDev(cwd, port === undefined ? {} : { port })
      out(`Serving ${s.url}\n`)
      await untilStopped()
      await s.close()
      return 0
    }

    const project: Project = await openProject(cwd)
    const { loaded } = project
    // a plug-in, a block file or a data field that fails leaves no registry to serve; any other problem is the agent's to see, located
    const registryProblem = (p: Located) =>
      p.file === 'culm.json' ||
      p.file?.startsWith('blocks/') ||
      p.file?.startsWith('data/')
    if (
      command === 'mcp' || command === 'schema'
        ? loaded.problems.some(registryProblem)
        : loaded.problems.length
    ) {
      show(loaded.problems)
      return 1
    }

    if (command === 'schema') {
      await writeFile(
        join(cwd, 'culm.schema.json'),
        `${JSON.stringify(authoringSchema(project.registry), null, 2)}\n`,
      )
      out('Wrote culm.schema.json\n')
      return 0
    }
    if (command === 'build') {
      const r = await buildSite(project)
      if (!r.ok) return (show(r.problems), 1)
      out(`Built ${r.files.length} files to ${r.out}\n`)
      return 0
    }

    if (command === 'expand') {
      const [file, id] = args as [string, string]
      const rel = relative(cwd, resolve(cwd, file)).split(sep).join('/')
      const doc = loaded.doc!
      const trees: TreeRef[] = [
        'header',
        'footer',
        ...doc.pages.map(p => ({ page: p.id })),
        ...doc.components.map(c => ({ component: c.id })),
      ]
      const origin = trees
        .map(t => loaded.map.origin(t, id))
        .find(o => o?.file === rel && o.form === 'short')
      const text = loaded.files.find(f => f.path === rel)?.text
      const next =
        origin && text !== undefined
          ? expandShortForm(text, origin.path, project.registry, rel)
          : undefined
      if (next === undefined) {
        show([
          {
            code: 'INVALID_OPERATION',
            message: `"${id}" is not a short form in ${rel}.`,
            file: rel,
          },
        ])
        return 1
      }
      await writeFile(join(cwd, rel), next)
      out(`Expanded ${id} in ${rel}\n`)
      return 0
    }

    if (command === 'check') {
      const { refused, hashes } = await media(cwd)
      if (refused.size) {
        show([...refused].map(([rel, why]) => refusal(rel, why)))
        return 1
      }
      const report = await runMeasure({
        doc: loaded.doc!,
        registry: project.registry,
        data: loaded.data,
        revision: 0,
        executable: values.chrome,
        files: hashes,
        fonts: project.held.fonts,
        icons: project.held.icons,
        assets: p => readAsset(cwd, p),
      })
      for (const f of report.findings)
        err(
          `${formatLocated(
            locateFinding(
              f,
              p => loaded.map.locateProblem(p) as typeof p,
              id => loaded.map.pageFile(id),
            ),
          )}\n`,
        )
      for (const i of report.incomplete)
        err(`${i.page}: ${formatLocated(i.problem)}\n`)
      out(
        `Measured ${report.measured.length} cells: ${report.findings.length} findings, ${report.incomplete.length} not measured.\n`,
      )
      return report.incomplete.length ? 2 : report.findings.length ? 1 : 0
    }

    const options = {
      ...(await folderMcpOptions(cwd, project, values.chrome)),
      jsonOps: !values.full,
    }
    const local =
      port === undefined
        ? undefined
        : await listenLocal(
            () => createMcpServer(options),
            port,
            line => err(`${line}\n`),
          )
    if (local) err(`MCP listening on http://127.0.0.1:${local.port}/\n`)
    const server = createMcpServer(options)
    await server.connect(new StdioServerTransport())
    await untilStopped(new Promise(r => process.stdin.once('end', r)))
    await server.close()
    await local?.close()
    return 0
  } catch (e) {
    err(`${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
}
