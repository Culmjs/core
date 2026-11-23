import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parse } from 'jsonc-parser'
import { openBrowser, type Page } from '../src/measure/browser.ts'
import { MIME } from '../src/shared.ts'
import { edit } from '../__tests__/cuj/kit.ts'

const run = promisify(execFile)
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const PACK = join(ROOT, '.pack')
const NETWORK =
  /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENETDOWN|network|offline|ENOTCACHED|only-if-cached/i

const cleanup: (() => Promise<unknown> | unknown)[] = []
after(async () => {
  for (const c of cleanup.splice(0).reverse())
    await Promise.resolve(c()).catch(() => {})
})

/** Polls `read` until `ok` accepts it; a page that is reloading, or not yet showing the change, is tried again. */
async function until<T>(
  what: string,
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  ms = 15000,
): Promise<T> {
  const end = Date.now() + ms
  let last: unknown
  while (Date.now() < end) {
    try {
      last = await read()
      if (ok(last as T)) return last as T
    } catch (e) {
      last = e instanceof Error ? e.message : e
    }
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error(
    `${what}: not seen within ${ms} ms; last: ${JSON.stringify(last)}`,
  )
}

const h1 = (p: Page) =>
  p.evaluate<string>("document.querySelector('h1')?.textContent ?? ''")
const heroButton = (p: Page) =>
  p.evaluate<string>(
    "getComputedStyle([...document.querySelectorAll('a,button')].find(e => e.textContent.trim() === 'See the menu')).backgroundColor",
  )
const order = (p: Page) =>
  p.evaluate<boolean>(
    "(t => t.indexOf('Find us on the corner') < t.indexOf('Today at the counter'))(document.body.innerText)",
  )

test('CUJ 4: a person edits a site by hand', async t => {
  // 1 the three packages, packed
  await run('npm', ['run', 'pack:all'], { cwd: ROOT })
  const work = await mkdtemp(join(tmpdir(), 'culm-cuj4-'))
  cleanup.push(() => rm(work, { recursive: true, force: true }))

  // 2 init with the unpacked tools: local workspace tarballs plus the external dependencies declared by the packed tools.
  const unpacked = join(work, 'unpacked')
  await mkdir(join(unpacked, 'node_modules/@culmjs'), { recursive: true })
  const packed = await readdir(PACK)
  for (const n of ['core', 'starter', 'tools']) {
    const tar = packed
      .sort()
      .find(f => f.startsWith(`culmjs-${n}-`) && f.endsWith('.tgz'))
    assert.ok(tar, `no tarball for ${n} in ${PACK}`)
    const dir = join(unpacked, 'node_modules/@culmjs', n)
    await mkdir(dir)
    await run('tar', [
      '-xzf',
      join(PACK, tar),
      '-C',
      dir,
      '--strip-components=1',
    ])
  }
  const toolsDir = join(unpacked, 'node_modules/@culmjs/tools')
  const manifest = JSON.parse(
    await readFile(join(toolsDir, 'package.json'), 'utf8'),
  )
  for (const n of Object.keys(manifest.dependencies)) {
    if (n.startsWith('@culmjs/')) continue
    const target = join(unpacked, 'node_modules', n)
    await mkdir(dirname(target), { recursive: true })
    await symlink(join(ROOT, 'node_modules', n), target)
  }
  const cwd = join(work, 'empty')
  await mkdir(cwd)
  const site = join(cwd, 'my-site')
  const culm = join(unpacked, 'node_modules/@culmjs/tools/bin/culm.js')
  await run('node', [culm, 'init', 'my-site', '--from', PACK], { cwd })
  assert.ok((await readdir(site)).includes('culm.json'))

  // 3 npm install: the cache or the network supplies the external dependencies
  try {
    await run(
      'npm',
      ['install', '--prefer-offline', '--no-audit', '--no-fund'],
      { cwd: site, timeout: 300000 },
    )
  } catch (e) {
    const text = `${(e as { stderr?: string }).stderr ?? ''} ${(e as Error).message}`
    if (NETWORK.test(text))
      return t.skip(
        `npm install needs the npm cache or the network for external dependencies, and has neither: ${text.slice(0, 200)}`,
      )
    throw e
  }

  // 4 npx culm dev, and the home page open in Chrome (nothing is intercepted: the page talks to the dev server)
  const dev: ChildProcess = spawn('npx', ['culm', 'dev', '--port', '0'], {
    cwd: site,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  cleanup.push(() => {
    try {
      process.kill(-dev.pid!, 'SIGTERM')
    } catch {
      // already gone
    }
  })
  let log = ''
  dev.stdout!.on('data', d => (log += d))
  dev.stderr!.on('data', d => (log += d))
  const url = (await until(
    'the dev server address',
    async () => /Serving (http:\/\/\S+)/.exec(log)?.[1],
    v => !!v,
  )) as string
  const o = await openBrowser({ executable: process.env.CULM_CHROME })
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  cleanup.push(() => o.browser.close())
  const page = await o.browser.newPage()
  await page.unblock()
  await page.setScheme('light')
  assert.deepEqual(await page.goto(`${url}/`, 15000), { ok: true })
  assert.equal(await h1(page), 'Bread, baked before sunrise')
  const brand = await heroButton(page)
  assert.equal(await order(page), false)

  // 5 three saves, each seen in the open page, with no reload from the test
  await edit(
    site,
    'pages/home.json',
    ['root', 'children', 0, 'title'],
    'Bread, baked before sunset',
  )
  await until(
    'the new heading',
    () => h1(page),
    v => v === 'Bread, baked before sunset',
  )
  const colours = parse(await readFile(join(site, 'site.json'), 'utf8')).styles
    .colors as { id: string }[]
  await edit(
    site,
    'site.json',
    ['styles', 'colors', colours.findIndex(c => c.id === 'brand'), 'value'],
    '#1d4ed8',
  )
  await until(
    'the new brand colour',
    () => heroButton(page),
    v => v === 'rgb(29, 78, 216)' && v !== brand,
  )
  const kids = parse(await readFile(join(site, 'pages/home.json'), 'utf8')).root
    .children
  await edit(
    site,
    'pages/home.json',
    ['root', 'children'],
    [kids[0], kids[2], kids[1], kids[3]],
  )
  await until(
    'the new order',
    () => order(page),
    v => v === true,
  )

  // 6 a kind that does not exist: the overlay names the file, the line and the allowed kinds; the last good page stays
  await edit(site, 'pages/home.json', ['root', 'kind'], 'bocks')
  const text = await readFile(join(site, 'pages/home.json'), 'utf8')
  const line =
    text.split('\n').findIndex(l => l.includes('"kind": "bocks"')) + 1
  const overlay = await until(
    'the overlay',
    () =>
      page.evaluate<string>(
        "document.getElementById('culm-dev-overlay')?.innerText ?? ''",
      ),
    v => v.length > 0,
  )
  assert.match(overlay, new RegExp(`pages/home\\.json:${line}\\b`), overlay)
  assert.match(overlay, /bocks/)
  const allowed = /Allowed: (.*)/.exec(overlay)?.[1] ?? ''
  for (const k of ['column', 'row', 'text', 'image', 'button'])
    assert.ok(allowed.split(', ').includes(k), `${k} in: ${allowed}`)
  assert.equal(await h1(page), 'Bread, baked before sunset')
  assert.equal(await order(page), true)

  // 7 the fix is shown, then the site is built and served by another server
  await edit(site, 'pages/home.json', ['root', 'kind'], 'column')
  await until(
    'the overlay going',
    () =>
      page.evaluate<boolean>("!document.getElementById('culm-dev-overlay')"),
    v => v,
  )
  await page.close()
  const built = await run('npx', ['culm', 'build'], { cwd: site })
  assert.match(built.stdout, /Built \d+ files/)
  const dist = join(site, 'dist')
  const files = (await readdir(dist, { recursive: true }))
    .filter(f => f.endsWith('index.html'))
    .sort()
  assert.equal(files.length, 4, files.join())

  const server: Server = createServer(async (req, res) => {
    const p = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0]!)
    if (p === '/favicon.ico') return void res.writeHead(204).end()
    const file = join(dist, p.endsWith('/') ? `${p}index.html` : p)
    if (!file.startsWith(dist)) return void res.writeHead(403).end()
    try {
      const body = await readFile(file)
      res
        .writeHead(200, {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        })
        .end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  cleanup.push(
    () =>
      new Promise(r => {
        server.close(r)
        server.closeAllConnections()
      }),
  )
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  const slugs: Record<string, string> = {}
  for (const f of await readdir(join(site, 'pages'))) {
    const d = parse(await readFile(join(site, 'pages', f), 'utf8'))
    slugs[d.slug] = d.root.children[0].title
  }
  assert.equal(Object.keys(slugs).length, 4)
  for (const scripts of [true, false]) {
    const view = await o.browser.newPage()
    await view.setScripts(scripts)
    for (const [slug, heading] of Object.entries(slugs)) {
      const where = `${base}${slug === '/' ? '/' : `${slug}/`}`
      const r = await fetch(where)
      assert.equal(
        r.status,
        200,
        `${where} ${scripts ? 'with' : 'without'} scripts`,
      )
      assert.deepEqual(await view.goto(where, 15000), { ok: true })
      const shown = await view.evaluate<{ text: string; visible: boolean }>(
        "(h => ({ text: h.textContent, visible: h.getClientRects().length > 0 && h.checkVisibility() }))(document.querySelector('h1'))",
      )
      assert.equal(shown.text, heading)
      assert.equal(shown.visible, true)
    }
    assert.deepEqual(
      view.errors,
      [],
      `console errors ${scripts ? 'with' : 'without'} scripts`,
    )
    await view.close()
  }
})
