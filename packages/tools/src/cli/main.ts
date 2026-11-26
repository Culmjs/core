import { access, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { parse as parseJsonc } from 'jsonc-parser'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildSite, fileHashes } from '../build/bundle.ts'
import { media, readAsset, refusal } from '../folder/files.ts'
import { startDev } from '../dev/server.ts'
import { expandShortForm } from '../folder/write.ts'
import { fileStore, withFolderLock, writeAtomic } from '../folder/store.ts'
import { loadFolder } from '../folder/load.ts'
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
import { renderImage, type RenderInput } from '../render/render.ts'
import { isObj } from '../shared.ts'
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
  init <folder> [--blank] [--from folder]
                               write a new bakery site (or minimal single-page site with --blank)
  dev [--port n]               serve the site, recompile on save (default port 4321)
  build                        write the compiled site to the output folder
  check [--chrome path] [--classes 1,2,3]
                               validate, then measure every page in Chrome
  expand <file> <id>           rewrite the short form <id> in <file> as its nodes
  render [spec.json | page] --out <file>
                               export a standalone node/page/shape as PNG, WebP, or SVG
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
  // ponytail: one extra load per tool call; read again only on a changed revision or file hash if that costs.
  const kept = await fileStore(cwd, project.registry)
  let map = loaded.map
  let data = loaded.data
  const store: typeof kept = {
    ...kept,
    async head(site) {
      const h = await kept.head(site)
      if ('doc' in h) {
        const now = await loadFolder(cwd, project.registry)
        map = now.map
        data = now.data
      }
      return h
    },
  }
  return {
    store,
    registry: project.registry,
    site: 'site',
    get data() {
      return data
    },
    allow: protect,
    folder: true,
    cwd,
    images: project.config.images,
    executable,
    // the hashes of assets/ and fonts/, read again for each measure
    files: () => fileHashes(cwd),
    // a Google family or generated image a batch names is fetched once into fonts/ or assets/gen/
    fetch: (ops: unknown[], doc: SiteDocument, offline?: boolean) =>
      fetchFor(
        cwd,
        doc,
        ops,
        offline
          ? {
              ...fetchOptions,
              images: project.config.images,
              offline: true,
              get: () => Promise.reject(new Error('no network for a replay')),
            }
          : { images: project.config.images, ...fetchOptions },
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
        blank: { type: 'boolean' },
        classes: { type: 'string' },
        out: { type: 'string' },
        id: { type: 'string' },
        size: { type: 'string' },
        scale: { type: 'string' },
        format: { type: 'string' },
        transparent: { type: 'boolean' },
        dark: { type: 'boolean' },
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
    {
      args: number | [number, number]
      port?: true
      chrome?: true
      from?: true
      blank?: true
      classes?: true
      render?: true
    }
  > = {
    dev: { args: 0, port: true },
    build: { args: 0 },
    check: { args: 0, chrome: true, classes: true },
    expand: { args: 2 },
    render: { args: [0, 1], chrome: true, render: true },
    schema: { args: 0 },
    mcp: { args: 0, port: true, chrome: true },
    init: { args: 1, from: true, blank: true },
  }
  const want = command ? wants[command] : undefined
  if ((values.full || values['json-ops']) && command !== 'mcp')
    return usage('--json-ops and --full are for culm mcp.')
  if (values.full && values['json-ops'])
    return usage('Choose either --json-ops or --full.')
  if (!command || !want)
    return usage(command ? `Unknown command "${command}".` : undefined)
  const [minArgs, maxArgs] = Array.isArray(want.args)
    ? want.args
    : [want.args, want.args]
  if (args.length < minArgs || args.length > maxArgs)
    return usage(
      minArgs === maxArgs
        ? `culm ${command} takes ${minArgs} argument${minArgs === 1 ? '' : 's'}.`
        : `culm ${command} takes ${minArgs} to ${maxArgs} arguments.`,
    )
  if (values.port !== undefined && !want.port)
    return usage(`culm ${command} has no --port.`)
  if (values.chrome !== undefined && !want.chrome)
    return usage(`culm ${command} has no --chrome.`)
  if (values.from !== undefined && !want.from)
    return usage(`culm ${command} has no --from.`)
  if (values.blank && !want.blank)
    return usage(`culm ${command} has no --blank.`)
  if (values.classes !== undefined && !want.classes)
    return usage(`culm ${command} has no --classes.`)
  for (const flag of [
    'out',
    'id',
    'size',
    'scale',
    'format',
    'transparent',
    'dark',
  ] as const)
    if (values[flag] !== undefined && !want.render)
      return usage(`culm ${command} has no --${flag}.`)
  let classes: (1 | 2 | 3)[] | undefined
  if (values.classes !== undefined) {
    const parts = values.classes
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (!parts.length || parts.some(p => !['1', '2', '3'].includes(p)))
      return usage(
        `--classes expects 1, 2 or 3 separated by commas, not "${values.classes}".`,
      )
    classes = [...new Set(parts.map(Number))].sort() as (1 | 2 | 3)[]
  }
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
      const r = await init(resolve(cwd, args[0]!), {
        from: values.from,
        blank: values.blank,
      })
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

  if (command === 'render') {
    const outPath = values.out
    if (!outPath) return usage('culm render requires --out <file>.')
    let scale: number | undefined
    if (values.scale !== undefined) {
      scale = /^[1-4]$/.test(values.scale) ? Number(values.scale) : NaN
      if (!Number.isInteger(scale))
        return usage('--scale must be 1, 2, 3, or 4.')
    }
    if (
      values.format !== undefined &&
      !['png', 'webp', 'svg'].includes(values.format)
    )
      return usage('--format must be png, webp, or svg.')
    try {
      const target = args[0]
      const isFile =
        target !== undefined &&
        (/\.(jsonc?)$/i.test(target) ||
          (await access(resolve(cwd, target)).then(
            () => true,
            () => false,
          )))
      const hasProject = await access(join(cwd, 'culm.json')).then(
        () => true,
        () => false,
      )
      const project = hasProject ? await openProject(cwd) : undefined
      if (project && !isFile && project.loaded.problems.length) {
        show(project.loaded.problems)
        return 1
      }
      let spec: RenderInput = {
        out: outPath,
        ...(values.id ? { id: values.id } : {}),
        ...(values.size ? { size: values.size } : {}),
        ...(scale ? { scale } : {}),
        ...(values.format
          ? { format: values.format as 'png' | 'webp' | 'svg' }
          : {}),
        ...(values.transparent ? { transparent: true } : {}),
        ...(values.dark ? { dark: true } : {}),
      }
      if (isFile) {
        const raw = await readFile(resolve(cwd, target!), 'utf8')
        const parsedSpec = parseJsonc(raw)
        if (!isObj(parsedSpec)) {
          err(`${target} must be a JSON object.\n`)
          return 1
        }
        const fromFile: RenderInput =
          typeof parsedSpec.kind === 'string'
            ? { node: parsedSpec }
            : (parsedSpec as RenderInput)
        spec = {
          ...fromFile,
          ...spec,
          out: outPath,
        }
      } else if (target) {
        spec.page = target
      }
      const res = await renderImage(spec, {
        cwd,
        containInDir: Boolean(hasProject),
        doc: project?.loaded.doc,
        registry: project?.registry,
        data: project?.loaded.data,
        fonts: project?.held.fonts,
        icons: project?.held.icons,
        assets: p => readAsset(cwd, p),
        executable: values.chrome,
        images: project?.config.images,
      })
      if (!res.ok) {
        show(res.problems)
        return res.problems.some(p => p.code === 'MEASUREMENT_INCOMPLETE')
          ? 2
          : 1
      }
      for (const f of res.findings) err(`${formatLocated(f)}\n`)
      out(
        `Rendered ${res.out ?? outPath} (${res.format}, ${res.width}x${res.height}@${res.scale}x, ${res.bytes} bytes, ${res.findings.length} findings)\n`,
      )
      return res.findings.length ? 1 : 0
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
      const res = await withFolderLock(cwd, async () => {
        const fresh = await loadFolder(cwd, project.registry)
        if (!fresh.doc || fresh.problems.length)
          return { problems: fresh.problems }
        const trees: TreeRef[] = [
          'header',
          'footer',
          ...fresh.doc.pages.map(p => ({ page: p.id })),
          ...fresh.doc.components.map(c => ({ component: c.id })),
        ]
        const origin = trees
          .map(t => fresh.map.origin(t, id))
          .find(o => o?.file === rel && o.form === 'short')
        const text = fresh.files.find(f => f.path === rel)?.text
        const next =
          origin && text !== undefined
            ? expandShortForm(text, origin.path, project.registry, rel)
            : undefined
        if (next === undefined) {
          return {
            problems: [
              {
                code: 'INVALID_OPERATION' as const,
                message: `"${id}" is not a short form in ${rel}.`,
                file: rel,
              },
            ],
          }
        }
        await writeAtomic(cwd, rel, next)
        return { problems: [] as Located[] }
      })
      if (res.problems.length) {
        show(res.problems)
        return 1
      }
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
        ...(classes ? { classes } : {}),
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
