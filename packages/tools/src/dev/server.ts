import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { compileSite, policyMeta } from '@culmjs/core'
import { fontProblems, slugProblems } from '../build/bundle.ts'
import { inside, media, refusal, resolveFile } from '../folder/files.ts'
import { openProject } from '../folder/project.ts'
import type { Located } from '../folder/plugins.ts'
import { authoringSchema } from '../schema/authoring.ts'
import {
  MIME,
  deploymentPolicy,
  mediaAddresses,
  NO_SCRIPTS,
} from '../shared.ts'
import { CLIENT_SCRIPT } from './client.ts'

const PAUSE_MS = 50
const clientHash = `'sha256-${createHash('sha256').update(CLIENT_SCRIPT).digest('base64')}'`

/**
 * Serves the project on 127.0.0.1 (no other address, no option). Pages come from the last good compile held in memory; a save that
 * does not compile leaves them as they are and sends `problems`, a good one swaps them in whole and sends `reload`.
 */
export async function startDev(
  dir: string,
  options: { port?: number } = {},
): Promise<{
  url: string
  port: number
  address: string
  close(): Promise<void>
}> {
  const root = resolve(dir)
  let pages = new Map<string, string>() // `/` or `/slug` -> html
  let assets = new Map<string, string>()
  let policy = `script-src ${clientHash}; worker-src 'none'`
  let assetPolicy = NO_SCRIPTS
  let problems: Located[] = []
  let outDir = resolve(root, 'dist')
  const clients = new Set<ServerResponse>()
  const send = (res: ServerResponse, event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const broadcast = (event: string, data: unknown) =>
    clients.forEach(c => send(c, event, data))

  /** The text of every source file and the size and time of every asset and font: the same twice means the save left nothing to show. */
  const stamp = async (files: { path: string; text: string }[]) => {
    const media: string[] = []
    for (const d of ['assets', 'fonts'])
      for (const n of await readdir(join(root, d), { recursive: true }).catch(
        () => [],
      ))
        await stat(join(root, d, n)).then(
          st => media.push(`${d}/${n} ${st.size} ${st.mtimeMs}`),
          () => {},
        )
    return JSON.stringify([files.map(f => [f.path, f.text]), media.sort()])
  }
  let last = ''

  async function reload(): Promise<void> {
    try {
      const project = await openProject(root)
      const now = await stamp(project.loaded.files)
      // the file system may report one save in two bursts more than the pause apart; the second finds nothing new
      const same = now === last
      last = now
      if (same) return
      outDir = resolve(root, project.config.out)
      // the schema follows the registry (blocks/, culm.json); the watcher ignores this file
      const schema = `${JSON.stringify(authoringSchema(project.registry), null, 2)}\n`
      const schemaFile = join(root, 'culm.schema.json')
      if ((await readFile(schemaFile, 'utf8').catch(() => '')) !== schema)
        await writeFile(schemaFile, schema)
      const { loaded } = project
      let next: Map<string, string> | undefined
      let found: Located[] = [...loaded.problems]
      if (loaded.doc && !found.length) {
        const files = await media(root)
        const site = compileSite(loaded.doc, {
          registry: project.registry,
          data: loaded.data,
          links: project.links,
          availableMedia: mediaAddresses(files.hashes),
          fonts: project.held.fonts,
          icons: project.held.icons,
        })
        found = [
          ...slugProblems(loaded.doc, loaded),
          ...site.problems.map(p => loaded.map.locateProblem(p)),
          ...[...files.refused].map(([rel, why]) => refusal(rel, why)),
          ...fontProblems(site.files, files.hashes, loaded),
        ]
        if (!found.length) {
          const content = new Map(site.files.map(f => [f.path, f.content]))
          const production = deploymentPolicy(site)
          const devPolicy = production.replace(
            'script-src ',
            `script-src ${clientHash} `,
          )
          content.delete('_headers')
          next = new Map(
            site.manifest.pages.map(({ path }) => {
              const html = content
                .get(path)!
                .replace(policyMeta(production), policyMeta(devPolicy))
              content.delete(path)
              return [
                path === 'index.html'
                  ? '/'
                  : `/${path.slice(0, -'/index.html'.length)}`,
                html,
              ]
            }),
          )
          policy = devPolicy
          assetPolicy = production
          assets = content
        }
      }
      if (!found.length && !loaded.doc)
        found = [
          {
            code: 'INVALID_DOCUMENT',
            message: 'The project could not be loaded.',
          },
        ]
      problems = found
      if (next) pages = next
    } catch (e) {
      problems = [
        {
          code: 'INVALID_DOCUMENT',
          message: `The project could not be read: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]
    }
    if (problems.length) broadcast('problems', problems)
    else broadcast('reload', {})
  }

  let timer: NodeJS.Timeout | undefined
  let chain: Promise<void> = Promise.resolve()
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      chain = chain.then(reload)
    }, PAUSE_MS)
  }
  await reload() // the first load; its event goes to nobody
  const ignored = (name: string) => {
    const p = resolve(root, name)
    const top = name.split(/[\\/]/)[0]
    return (
      top === '.culm' ||
      top === 'node_modules' ||
      name === 'culm.schema.json' ||
      p === outDir ||
      inside(outDir, p)
    )
  }
  let watcher: FSWatcher | undefined = watch(
    root,
    { recursive: true },
    (_e, name) => {
      if (name && !ignored(name.toString())) schedule()
    },
  )
  watcher.on('error', () => {})

  const page = (html: string) => {
    const at = html.lastIndexOf('</body>')
    const tag = `<script>${CLIENT_SCRIPT}</script>`
    return at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at)
  }
  const end = (res: ServerResponse, status: number, body = '') =>
    res
      .writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      .end(body || (status === 404 ? 'Not found' : 'Refused'))

  async function file(res: ServerResponse, base: string, rest: string) {
    // the same rule as build and check, on every request: a link can change while dev runs
    const real = await resolveFile(root, base, rest)
    if (!real) return end(res, 404)
    try {
      res
        .writeHead(200, {
          'content-type':
            MIME[extname(real).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': assetPolicy,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-cache',
        })
        .end(await readFile(real))
    } catch {
      end(res, 404)
    }
  }

  const server = createServer((req, res) => {
    const host = req.headers.host
    const port = (server.address() as { port: number }).port
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      return end(res, 403)
    if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405)
    const raw = (req.url ?? '/').split(/[?#]/)[0]!
    if (raw === '/__culm/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': culm\n\n')
      clients.add(res)
      res.on('close', () => clients.delete(res))
      if (problems.length) send(res, 'problems', problems)
      return
    }
    let path: string
    try {
      path = decodeURIComponent(raw)
    } catch {
      return end(res, 404)
    }
    if (path.includes('\0')) return end(res, 404)
    if (path === '/_headers') return end(res, 404)
    if (path.startsWith('/_culm/')) {
      const js = assets.get(path.slice(1))
      if (js === undefined) return end(res, 404)
      return void res
        .writeHead(200, {
          'content-type': MIME['.js']!,
          'content-security-policy': assetPolicy,
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
        })
        .end(js)
    }
    for (const [prefix, base] of [
      ['/assets/', 'assets'],
      ['/_fonts/', 'fonts'],
    ] as const)
      if (path.startsWith(prefix))
        return void file(res, base, path.slice(prefix.length))
    const slug = path.length > 1 ? path.replace(/\/+$/, '') : path
    const html = pages.get(slug)
    if (html !== undefined)
      return void res
        .writeHead(200, {
          'content-type': MIME['.html']!,
          'content-security-policy': policy,
          'cache-control': 'no-cache',
        })
        .end(page(html))
    if (pages.size === 0)
      return void res
        .writeHead(503, {
          'content-type': MIME['.html']!,
          'content-security-policy': policy,
        })
        .end(
          page(
            `<!doctype html>${policyMeta(policy)}<title>Culm</title><body>The project has problems.</body>`,
          ),
        )
    end(res, 404)
  })

  await new Promise<void>((ok, bad) => {
    server.once('error', bad)
    server.listen(options.port ?? 4321, '127.0.0.1', ok)
  }).catch(e => {
    watcher?.close()
    throw e
  })
  const { port, address } = server.address() as {
    port: number
    address: string
  }
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    address,
    async close() {
      clearTimeout(timer)
      watcher?.close()
      watcher = undefined
      await chain
      clients.forEach(c => c.end())
      clients.clear()
      server.closeAllConnections()
      await new Promise<void>(ok => server.close(() => ok()))
    },
  }
}
