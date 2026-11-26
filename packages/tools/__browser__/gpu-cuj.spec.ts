import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from 'jsonc-parser'
import { BUDGETS, type GpuEffectDef } from '@culmjs/core'
import { main, folderMcpOptions } from '../src/cli/main.ts'
import { openProject } from '../src/folder/project.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'
import { createMcpServer } from '../src/mcp/server.ts'
import { copyFixture } from '../__tests__/fixtures.ts'
import { connectClient, files } from '../__tests__/mcp/serve.ts'

const frame =
  'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))'

async function wait(page: Page, condition: string) {
  const ok = await page.evaluate(
    `(async()=>{for(let i=0;i<200;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,20))}return false})()`,
  )
  if (!ok) {
    const info = await page.evaluate(
      `JSON.stringify([...document.querySelectorAll('[data-culm-gpu]')].map(e=>({run:e.dataset.gpuRun,painted:e.hasAttribute('data-gpu-painted'),rect:e.getBoundingClientRect(),bg:getComputedStyle(e).backgroundColor})))`,
    )
    assert.fail(`${condition}: ${info} ${page.errors.join('; ')}`)
  }
}

const section = (
  id: string,
  title: string,
  opts: { inRow?: boolean; accent?: boolean } = {},
) => ({
  id,
  kind: 'column',
  name: id,
  style: {
    base: {
      bg: '#e5e9ef',
      height: { n: 180, unit: 'px' },
      padding: 24,
      ...(opts.inRow
        ? { width: { n: 48, unit: '%' } }
        : { maxWidth: { n: 1120, unit: 'px' } }),
      ...(opts.accent && { border: { width: 2, color: '#2255aa' } }),
    },
    ...(opts.inRow && { phone: { width: { n: 100, unit: '%' } } }),
    dark: { bg: '#1e242b' },
  },
  children: [
    {
      id: `${id}h`,
      kind: 'text',
      name: 'Heading',
      props: { level: 'h2', runs: [{ text: title }] },
      style: {
        base: { color: '#111111', size: 24 },
        dark: { color: '#f5f5f5' },
      },
    },
  ],
})

test('CUJ 5: GPU and WASM authoring via MCP, CLI check/build, CSP enforcement, and reduced-motion delivery', async t => {
  const dir = await copyFixture('site-basic')
  await Promise.all(
    ['menu.json', 'about.json'].map(f => rm(join(dir, 'pages', f))),
  )
  await writeFile(join(dir, 'culm.json'), '{"features":{"gpu":true}}\n')
  const sitePath = join(dir, 'site.json')
  const siteDoc = parse(await readFile(sitePath, 'utf8'))
  siteDoc.pages = ['home.json']
  siteDoc.header = {
    id: 'hdr',
    kind: 'row',
    name: 'Site header',
    style: { base: { padding: 24 } },
    children: [
      {
        id: 'brandtxt',
        kind: 'text',
        name: 'Brand',
        props: { level: 'p', runs: [{ text: 'Studio' }] },
      },
    ],
  }
  siteDoc.footer = {
    ...siteDoc.footer,
    style: { base: { padding: 24 } },
  }
  await writeFile(sitePath, JSON.stringify(siteDoc, null, 2) + '\n')

  const homePath = join(dir, 'pages/home.json')
  const home = parse(await readFile(homePath, 'utf8'))
  home.root.style = { base: { padding: 24, gap: 24 } }
  home.root.children = [
    {
      id: 'hero',
      kind: 'text',
      name: 'Title',
      props: { level: 'h1', runs: [{ text: 'GPU Studio' }] },
    },
    {
      id: 'duo',
      kind: 'row',
      name: 'Featured pair',
      style: { base: { gap: 24 }, phone: { direction: 'column' } },
      children: [
        section('sec1', 'Contours panel', { inRow: true, accent: true }),
        section('sec2', 'Ripple field panel', { inRow: true }),
      ],
    },
    section('sec3', 'Custom mist panel'),
  ]
  await writeFile(homePath, JSON.stringify(home, null, 2) + '\n')

  const project = await openProject(dir)
  assert.deepEqual(project.loaded.problems, [])
  const call = await connectClient(
    createMcpServer(await folderMcpOptions(dir, project)),
  )

  const desc = await call('describe')
  assert.equal(desc.error, false)
  const baseRevision = desc.json.revision as number

  const effects = await call('catalogue', { what: 'effects' })
  assert.equal(effects.error, false)
  const effectNames = effects.json.rows.map((r: { name: string }) => r.name)
  assert.ok(effectNames.includes('contours'))
  assert.ok(effectNames.includes('ripple_field'))

  // Custom shaders cannot reference private u_field; refusal leaves disk untouched.
  const beforeDisk = await files(dir)
  const badCustom = await call('apply', {
    baseRevision,
    key: 'bad-field',
    ops: [
      {
        op: 'addCustomEffect',
        effect: {
          name: 'mist',
          source: 'vec4 shade(vec2 uv){return vec4(texture(u_field,uv).r);}',
          settings: {},
        },
      },
    ],
  })
  assert.equal(badCustom.error, true)
  assert.equal(badCustom.json.problems[0].rule, 'shader.input')
  assert.deepEqual(await files(dir), beforeDisk)
  assert.equal((await call('describe')).json.revision, baseRevision)

  // Add valid custom shader mist and attach all three effects in one transaction.
  const applied = await call('apply', {
    baseRevision,
    key: 'attach-gpu-all',
    ops: [
      {
        op: 'addCustomEffect',
        effect: {
          name: 'mist',
          source:
            'vec4 shade(vec2 uv){return vec4(mix(u_set_tint,vec3(0.4+0.2*sin(uv.x*8.0+u_time)),0.5),1.0);}',
          settings: { tint: { type: 'color', default: '#335577' } },
        },
      },
      {
        op: 'setMotion',
        tree: { page: 'home' },
        id: 'sec1',
        motion: { trigger: 'enter-view', gpu: 'contours' },
      },
      {
        op: 'setMotion',
        tree: { page: 'home' },
        id: 'sec2',
        motion: { trigger: 'enter-view', gpu: 'ripple_field' },
      },
      {
        op: 'setMotion',
        tree: { page: 'home' },
        id: 'sec3',
        motion: { trigger: 'enter-view', gpu: 'mist' },
      },
    ],
  })
  assert.equal(applied.error, false, JSON.stringify(applied.json))

  // CLI check and build succeed with zero problems/findings.
  let cliOut = ''
  let cliErr = ''
  const checkCode = await main(['check'], {
    cwd: dir,
    out: s => (cliOut += s),
    err: s => (cliErr += s),
  })
  assert.equal(checkCode, 0, `${cliOut}\n${cliErr}`)
  assert.match(cliOut, /: 0 findings, 0 not measured\./)

  cliOut = ''
  cliErr = ''
  const buildCode = await main(['build'], {
    cwd: dir,
    out: s => (cliOut += s),
    err: s => (cliErr += s),
  })
  assert.equal(buildCode, 0, `${cliOut}\n${cliErr}`)

  const dist = join(dir, 'dist')
  const ripple = project.registry.effect('ripple_field') as GpuEffectDef
  const expectedSha = createHash('sha256')
    .update(Buffer.from(ripple.wasm!.bytesBase64, 'base64'))
    .digest('hex')
  assert.equal(
    expectedSha,
    '9c670ad9c22f68c14e778bcb41c1f947c84e862fae4cd4e98bac65724f97ee11',
  )
  const manifest = JSON.parse(
    await readFile(join(dist, 'culm-manifest.json'), 'utf8'),
  )
  assert.deepEqual(manifest.wasmModules, [
    {
      name: 'ripple_field',
      sha256: expectedSha,
      bytes: 382,
      transportBytes: 512,
      pages: ['home'],
    },
  ])
  const homeScriptsTotal = manifest.scripts
    .filter((s: { pages: string[] }) => s.pages.includes('home'))
    .reduce((sum: number, s: { bytes: number }) => sum + s.bytes, 0)
  assert.ok(homeScriptsTotal <= BUDGETS.sharedScripts)

  const [indexHtml, gpuJs, headers] = await Promise.all([
    readFile(join(dist, 'index.html'), 'utf8'),
    readFile(join(dist, '_culm/gpu.js'), 'utf8'),
    readFile(join(dist, '_headers'), 'utf8'),
  ])
  const policy = headers.split('Content-Security-Policy: ')[1].trim()
  assert.match(policy, /worker-src blob:/)
  assert.match(policy, /'wasm-unsafe-eval'/)

  let hostRequests = 0
  const server = createServer((req, res) => {
    const url = req.url?.split('?')[0] ?? '/'
    if (url === '/')
      res
        .writeHead(200, {
          'content-type': 'text/html',
          'content-security-policy': policy,
        })
        .end(indexHtml)
    else if (url === '/_culm/gpu.js') {
      hostRequests++
      res
        .writeHead(200, {
          'content-type': 'text/javascript',
          'cache-control': 'no-store',
        })
        .end(gpuJs)
    } else if (url === '/favicon.ico') res.writeHead(204).end()
    else res.writeHead(404).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  t.after(() => b.browser.close())

  // Standard motion context loads /_culm/gpu.js once and paints all 3 owners.
  const std = await b.browser.newPage()
  await std.setViewport(1200, 800)
  await std.setReducedMotion(false)
  assert.ok((await std.goto(origin, 5000)).ok)
  await wait(std, `document.querySelectorAll('[data-gpu-painted]').length===3`)
  for (let i = 0; i < 3; i++) await std.evaluate(frame)
  assert.equal(hostRequests, 1)
  assert.equal(
    await std.evaluate<number>(
      `document.querySelectorAll('[data-gpu-painted]').length`,
    ),
    3,
  )
  assert.deepEqual(std.errors, [])
  await std.close()

  // Reduced motion never requests /_culm/gpu.js and leaves all headings static.
  hostRequests = 0
  const reduced = await b.browser.newPage()
  await reduced.setViewport(1200, 800)
  await reduced.setReducedMotion(true)
  assert.ok((await reduced.goto(origin, 5000)).ok)
  for (let i = 0; i < 4; i++) await reduced.evaluate(frame)
  assert.equal(hostRequests, 0)
  assert.equal(
    await reduced.evaluate<number>(
      `document.querySelectorAll('[data-gpu-painted],canvas').length`,
    ),
    0,
  )
  assert.deepEqual(
    await reduced.evaluate<string[]>(
      `[...document.querySelectorAll('h2')].map(e=>e.innerText)`,
    ),
    ['Contours panel', 'Ripple field panel', 'Custom mist panel'],
  )
  assert.deepEqual(reduced.errors, [])
  await reduced.close()
})
