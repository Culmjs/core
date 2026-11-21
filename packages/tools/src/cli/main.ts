import { access, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildSite, fileHashes } from '../build/bundle.ts'
import { startDev } from '../dev/server.ts'
import { expandShortForm } from '../folder/write.ts'
import { fileStore } from '../folder/store.ts'
import { openProject, type Project } from '../folder/project.ts'
import type { Located } from '../folder/plugins.ts'
import { runMeasure } from '../measure/run.ts'
import { createMcpServer } from '../mcp/server.ts'
import { listenLocal } from '../mcp/http.ts'
import { protect } from '../mcp/protect.ts'
import { authoringSchema } from '../schema/authoring.ts'
import { formatLocated } from './print.ts'

export interface Io {
  /** The project folder; default: the working folder. */
  cwd?: string
  out?: (text: string) => void
  err?: (text: string) => void
}

const USAGE = `Usage: culm <command> [options]

Commands:
  dev [--port n]               serve the site, recompile on save (default port 4321)
  build                        write the compiled site to the output folder
  check [--chrome path]        validate, then measure every page in Chrome
  expand <file> <id>           rewrite the short form <id> in <file> as its nodes
  schema                       write culm.schema.json in the project folder
  mcp [--port n] [--chrome path]
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
  const wants: Record<string, { args: number; port?: true; chrome?: true }> = {
    dev: { args: 0, port: true },
    build: { args: 0 },
    check: { args: 0, chrome: true },
    expand: { args: 2 },
    schema: { args: 0 },
    mcp: { args: 0, port: true, chrome: true },
  }
  const want = command ? wants[command] : undefined
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
  let port: number | undefined
  if (values.port !== undefined) {
    port = /^\d{1,5}$/.test(values.port) ? Number(values.port) : NaN
    if (!(port <= 65535))
      return usage(
        `--port needs a number from 0 to 65535, not "${values.port}".`,
      )
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
    if (command === 'schema') {
      await writeFile(
        join(cwd, 'culm.schema.json'),
        `${JSON.stringify(authoringSchema(project.registry), null, 2)}\n`,
      )
      out('Wrote culm.schema.json\n')
      return 0
    }
    if (loaded.problems.length) {
      show(loaded.problems)
      return 1
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
      const trees = [
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
      const report = await runMeasure({
        doc: loaded.doc!,
        registry: project.registry,
        data: loaded.data,
        revision: 0,
        executable: values.chrome,
        files: await fileHashes(cwd),
        assets: p => readFile(join(cwd, p)).catch(() => undefined),
      })
      for (const f of report.findings) {
        const at = loaded.map.locate({ page: f.page }, f.nodes[0] ?? '')
        err(`${formatLocated({ ...f, ...at })}\n`)
      }
      for (const i of report.incomplete)
        err(`${i.page}: ${formatLocated(i.problem)}\n`)
      out(
        `Measured ${report.measured.length} cells: ${report.findings.length} findings, ${report.incomplete.length} not measured.\n`,
      )
      return report.incomplete.length ? 2 : report.findings.length ? 1 : 0
    }

    // mcp: the folder's own store, so every change is a revision on disk
    const options = {
      store: await fileStore(cwd, project.registry),
      registry: project.registry,
      site: 'site',
      data: loaded.data,
      allow: protect,
      folder: true,
      executable: values.chrome,
      locate: <P extends Parameters<typeof loaded.map.locateProblem>[0]>(
        p: P,
      ) => loaded.map.locateProblem(p),
      // the folder may have changed since the server started
      build: async () => buildSite(await openProject(cwd)),
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
