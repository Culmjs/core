import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import wabt from 'wabt'
import {
  compileSite,
  createRegistry,
  type GpuEffectDef,
  type Node,
} from '@culmjs/core'
import { DEMO_PLUGIN, node, siteWith, text } from '../../core/__tests__/kit.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'

const owner = (id: string, gpu: string): Node => ({
  ...node(id, 'column', [text(`${id}title`, 'Real static content')]),
  style: { base: { bg: '#30343a', height: { n: 180, unit: 'px' } } },
  motion: { trigger: 'enter-view', gpu },
})

const frame =
  'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))'

async function wait(page: Page, condition: string) {
  const ok = await page.evaluate(
    `(async()=>{for(let i=0;i<200;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,20))}return false})()`,
  )
  assert.ok(ok, `${condition}: ${page.errors.join('; ')}`)
}

async function serveCompiled(
  files: { path: string; content: string }[],
  t: { after: (fn: () => unknown) => void },
) {
  const headers = files.find(f => f.path === '_headers')!.content
  const policy = headers.split('Content-Security-Policy: ')[1].trim()
  const byUrl = new Map<string, string>()
  for (const f of files) {
    if (f.path === '_headers') continue
    if (f.path === 'index.html') byUrl.set('/', f.content)
    else if (f.path.endsWith('/index.html'))
      byUrl.set('/' + f.path.slice(0, -'index.html'.length), f.content)
    else byUrl.set('/' + f.path, f.content)
  }
  const server = createServer((req, res) => {
    const url = req.url?.split('?')[0] ?? '/'
    const body = byUrl.get(url)
    if (body !== undefined) {
      const isJs = url.endsWith('.js')
      res
        .writeHead(200, {
          'content-type': isJs ? 'text/javascript' : 'text/html',
          ...(!isJs && { 'content-security-policy': policy }),
        })
        .end(body)
    } else if (url === '/favicon.ico') res.writeHead(204).end()
    else res.writeHead(404).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function sampleBoxPixels(page: Page, index: number) {
  const png = Buffer.from(await page.screenshot()).toString('base64')
  return page.evaluate<string>(
    `(async()=>{
      const img=await createImageBitmap(new Blob([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))]));
      const ctx=new OffscreenCanvas(img.width,img.height).getContext('2d');ctx.drawImage(img,0,0);
      const r=document.querySelectorAll('[data-culm-gpu]')[${index}].getBoundingClientRect();
      return Array.from(ctx.getImageData(Math.floor(r.left+4),Math.floor(r.top+36),Math.max(32,Math.floor(r.width-8)),Math.max(32,Math.floor(r.height-40))).data).join(',')
    })()`,
  )
}

async function watToBase64(wat: string) {
  const api = await wabt()
  const mod = api.parseWat('bad.wat', wat)
  try {
    mod.validate()
    const { buffer } = mod.toBinary({
      canonicalize_lebs: true,
      write_debug_names: false,
    })
    return Buffer.from(buffer).toString('base64')
  } finally {
    mod.destroy()
  }
}

test('ripple_field renders live R8 field animation in WebGL2 under emitted _headers CSP', async t => {
  const reg = createRegistry({ gpu: { enabled: true } })
  const doc = siteWith([owner('rip', 'ripple_field')])
  const site = compileSite(doc, { registry: reg })
  assert.deepEqual(site.problems, [])
  const origin = await serveCompiled(site.files, t)

  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  t.after(() => b.browser.close())
  const p = await b.browser.newPage()
  await p.setViewport(1000, 600)
  await p.setReducedMotion(false)
  assert.ok((await p.goto(origin, 5000)).ok)
  await wait(p, `document.querySelectorAll('[data-gpu-painted]').length===1`)

  const first = await sampleBoxPixels(p, 0)
  for (let i = 0; i < 6; i++) await p.evaluate(frame)
  const later = await sampleBoxPixels(p, 0)

  const uniqueChannels = new Set(first.split(','))
  assert.ok(
    uniqueChannels.size > 3,
    'ripple field should render shaded gradients',
  )
  assert.notEqual(later, first, 'ripple field pixels should animate over time')
  assert.deepEqual(p.errors, [])
})

test('bad WASM modules isolate cleanly to static fallback while sibling contours keeps painting', async t => {
  const shader =
    'vec4 shade(vec2 uv){return vec4(texture(u_field,uv).rgb,1.0);}'
  const badModules: [string, string][] = [
    ['corrupt', Buffer.from('not-wasm-bytes!!').toString('base64')],
    [
      'trap_step',
      await watToBase64(`(module
        (memory (export "memory") 1 1)
        (func (export "fieldPtr") (result i32) (i32.const 0))
        (func (export "reset"))
        (func (export "step") (param f32) (unreachable)))`),
    ],
    [
      'growable_mem',
      await watToBase64(`(module
        (memory (export "memory") 1 2)
        (func (export "fieldPtr") (result i32) (i32.const 0))
        (func (export "reset"))
        (func (export "step") (param f32)))`),
    ],
    [
      'oob_ptr',
      await watToBase64(`(module
        (memory (export "memory") 1 1)
        (func (export "fieldPtr") (result i32) (i32.const 64513))
        (func (export "reset"))
        (func (export "step") (param f32)))`),
    ],
  ]

  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  t.after(() => b.browser.close())

  for (const [label, bytesBase64] of badModules)
    await t.test(`isolates bad WASM module: ${label}`, async () => {
      const def: GpuEffectDef = {
        name: 'bad_field',
        tier: 3,
        source: shader,
        settings: {},
        wasm: { abi: 'field-v1', bytesBase64 },
      }
      const reg = createRegistry({
        gpu: {
          enabled: true,
          approvedWasmPlugins: [
            { name: DEMO_PLUGIN.name, version: DEMO_PLUGIN.version },
          ],
        },
      })
      reg.use({ ...DEMO_PLUGIN, effects: [def] })
      const doc = siteWith([
        owner('bad', 'bad_field'),
        owner('good', 'contours'),
      ])
      const site = compileSite(doc, { registry: reg })
      assert.deepEqual(site.problems, [])
      const origin = await serveCompiled(site.files, t)

      const p = await b.browser.newPage()
      await p.setViewport(1000, 600)
      await p.setReducedMotion(false)
      assert.ok((await p.goto(origin, 5000)).ok)
      await wait(
        p,
        `document.querySelectorAll('[data-gpu-painted]').length===1`,
      )
      for (let i = 0; i < 4; i++) await p.evaluate(frame)

      const painted = await p.evaluate<boolean[]>(
        `[...document.querySelectorAll('[data-culm-gpu]')].map(e=>e.hasAttribute('data-gpu-painted'))`,
      )
      assert.deepEqual(painted, [false, true])
      assert.equal(
        await p.evaluate<string>(
          `document.querySelector('[data-culm-gpu="0"]').innerText`,
        ),
        'Real static content',
      )
      assert.deepEqual(p.errors, [])
    })
})

test('browser CSP permits WebAssembly on ripple_field pages and blocks it on contours-only pages', async t => {
  const reg = createRegistry({ gpu: { enabled: true } })
  const wasmSite = compileSite(siteWith([owner('rip', 'ripple_field')]), {
    registry: reg,
  })
  const shaderSite = compileSite(siteWith([owner('con', 'contours')]), {
    registry: reg,
  })
  const wasmOrigin = await serveCompiled(wasmSite.files, t)
  const shaderOrigin = await serveCompiled(shaderSite.files, t)

  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  t.after(() => b.browser.close())

  const p = await b.browser.newPage()
  const probeWasm = `(()=>{try{new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0));return 'ok'}catch(e){return e.name}})()`

  assert.ok((await p.goto(wasmOrigin, 5000)).ok)
  assert.equal(await p.evaluate<string>(probeWasm), 'ok')
  assert.deepEqual(p.errors, [])

  assert.ok((await p.goto(shaderOrigin, 5000)).ok)
  assert.equal(await p.evaluate<string>(probeWasm), 'CompileError')
})
