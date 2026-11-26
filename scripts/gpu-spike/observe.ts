import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { type AddressInfo } from 'node:net'
import { BUDGETS } from '@culmjs/core'
import {
  openBrowser,
  type Page,
} from '../../packages/tools/src/measure/browser.ts'
import { dataScript, hostPath, type makePage, type Variant } from './pages.ts'
import { probe } from './probes.ts'
import { type Payload } from './shaders.ts'

type Pages = Record<Variant, Awaited<ReturnType<typeof makePage>>>
type Results = {
  context: [string, string, number, number][]
  draw: number[]
  upload: number[]
  readyMs: number
  terminated: number
}
const live = `document.querySelector('main').classList.contains('gpu-active')`
async function wait(p: Page, condition: string) {
  const ok = await p.evaluate(
    `(async()=>{for(let i=0;i<250;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,20))}return false})()`,
  )
  if (!ok)
    assert.fail(
      `Timed out: ${condition}; ${JSON.stringify(await p.evaluate('window.results'))}; ${p.errors}`,
    )
}
async function tick(p: Page, t: number, ack: number) {
  await p.evaluate(`advance(${t})`)
  await wait(p, `results.ack===${ack}`)
}
const linear = (b: number) =>
  b <= 10 ? b / 255 / 12.92 : ((b / 255 + 0.055) / 1.055) ** 2.4
const capture = process.env.CULM_GPU_FRAMES
function decode(png: Uint8Array) {
  // Decode the CDP composited PNG, not the worker's WebGL drawing buffer.
  return `const b=Uint8Array.from(atob('${Buffer.from(png).toString('base64')}'),c=>c.charCodeAt(0));
    const im=await createImageBitmap(new Blob([b],{type:'image/png'}));
    const c=new OffscreenCanvas(im.width,im.height).getContext('2d');c.drawImage(im,0,0);`
}
async function pixels(p: Page, points: number[][], name: string) {
  await p.evaluate('paint()')
  const png = await p.screenshot()
  if (capture) await writeFile(join(capture, `${name}.png`), png)
  const samples = await p.evaluate<number[][]>(`(async()=>{${decode(png)}
    return ${JSON.stringify(points)}.map(([x,y])=>Array.from(c.getImageData(x,y,1,1).data).slice(0,3));
  })()`)
  return { samples, sha256: createHash('sha256').update(png).digest('hex') }
}
export async function observe(pages: Pages) {
  const opened = await openBrowser()
  assert.ok(opened.ok, JSON.stringify(opened))
  const browser = opened.browser
  const requested: string[] = []
  // Loopback, rather than Page.answer's normal CSP (which disallows WASM).
  // Only the WASM fixtures opt into WASM code generation.
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    requested.push(url.pathname)
    if (url.pathname === hostPath) {
      res
        .writeHead(200, { 'content-type': 'text/javascript' })
        .end(pages.shader.lazyJs)
      return
    }
    const page = pages[url.pathname.slice(1) as Variant]
    if (!page || !Object.hasOwn(page, 'html')) {
      res.writeHead(404).end()
      return
    }
    const mode = url.searchParams.get('probe')
    let html = page.html
    if (mode === 'reversal')
      html = html.replace(
        /<script type="application\/json" id="fields">([\s\S]*?)<\/script>/,
        (_, raw: string) => {
          const payload: Payload = JSON.parse(raw)
          payload.sources.mist =
            'vec4 shade(vec2 uv){if(u_time<0.13)return vec4(1.0);return vec4(0.0,0.0,0.0,1.0);}'
          return dataScript(payload)
        },
      )
    if (mode === 'clock' || mode === 'timeout' || mode === 'reversal')
      html = html.replace(
        '</head>',
        () => probe(mode === 'timeout' ? mode : 'clock') + '</head>',
      )
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
    )
    if (page.lazyJs)
      scripts.push(
        `'sha256-${createHash('sha256').update(page.lazyJs).digest('base64')}'`,
      )
    const csp = `default-src 'none'; script-src ${scripts.join(' ')} ${page.wasm.length ? "'wasm-unsafe-eval'" : ''}; worker-src ${page.lazyJs ? 'blob:' : "'none'"}; style-src 'unsafe-inline'; img-src data:`
    res
      .writeHead(200, {
        'content-security-policy': csp,
        'content-type': 'text/html; charset=utf-8',
      })
      .end(html)
  })
  try {
    if (capture) await mkdir(capture, { recursive: true })
    await new Promise<void>((r, j) =>
      server.once('error', j).listen(0, '127.0.0.1', r),
    )
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    console.log('Browser:', browser.version)
    async function visit(
      route: string,
      test: (p: Page) => Promise<void>,
      reduced = false,
    ) {
      const p = await browser.newPage()
      try {
        requested.length = 0
        await p.unblock()
        await p.setViewport(1280, 900)
        await p.setScheme('light')
        await p.setReducedMotion(reduced)
        assert.ok((await p.goto(origin + route, 15000)).ok)
        await test(p)
        assert.deepEqual(p.errors, [])
      } finally {
        await p.close()
      }
    }
    const structureRows: Record<string, string | number>[] = []
    for (const [fixture, page] of Object.entries(pages)) {
      await visit('/' + fixture, async p => {
        const gpu = !!page.lazyJs
        if (gpu) await wait(p, live)
        // Uninstrumented page. The lazy <script> in <head> is not a body element.
        const active = await p.evaluate<{
          cssBytes: number
          bodyElements: number
          canvases: number
          domDepth: number
        }>(`(()=>{
          const depth=e=>1+Math.max(0,...Array.from(e.children,depth));
          const count=s=>document.body.querySelectorAll(s).length;
          return {
            cssBytes:Array.from(document.querySelectorAll('style')).reduce((n,e)=>n+new TextEncoder().encode(e.textContent).length,0),
            bodyElements:count('*'),canvases:count('canvas'),
            domDepth:depth(document.documentElement)
          }
        })()`)
        assert.equal(active.cssBytes, page.structure.cssBytes)
        assert.equal(active.canvases, Number(gpu))
        assert.equal(
          active.bodyElements,
          page.structure.bodyElements + active.canvases,
        )
        assert.ok(
          active.bodyElements <= BUDGETS.elements,
          `${fixture}: ${active.bodyElements} active body elements`,
        )
        assert.equal(requested.filter(u => u === hostPath).length, Number(gpu))
        structureRows.push({
          fixture,
          cssBytes: active.cssBytes,
          buildBodyElements: page.structure.bodyElements,
          canvases: active.canvases,
          activeBodyElements: active.bodyElements,
          logicalDepth: page.structure.logicalDepth,
          rawDomDepth: active.domDepth,
        })
      })
    }
    console.table(structureRows)
    const points = [
      [202, 16],
      [202, 416],
      [8, 850],
    ]
    const button = `document.querySelector('section a')`
    const linkClip = async (p: Page) => {
      const png = await p.screenshot()
      return p.evaluate<string>(`(async()=>{${decode(png)}
        const r=${button}.getBoundingClientRect();
        const patch=c.getImageData(Math.ceil(r.left)+8,Math.ceil(r.top)+8,Math.floor(r.width)-16,Math.floor(r.height)-16);
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',patch.data)),x=>x.toString(16).padStart(2,'0')).join('')
      })()`)
    }
    let poster!: Awaited<ReturnType<typeof pixels>>,
      link = ''
    await visit(
      '/shader?probe=clock',
      async p => {
        poster = await pixels(p, points, 'static')
        link = await linkClip(p)
        assert.equal(await p.evaluate(`document.querySelector('canvas')`), null)
        assert.ok(!requested.includes(hostPath))
      },
      true,
    )
    await visit('/shader?probe=clock', async p => {
      await wait(p, live)
      const t0 = 1000
      for (let i = 0; i < 10; i++) await tick(p, t0 + (i * 1000) / 60, 2 + i)
      const { samples: a } = await pixels(p, points, 'shader-60hz')
      await tick(p, t0 + (9 * 1000) / 60 + 33, 12)
      const { samples: b } = await pixels(p, points, 'shader-33ms')
      assert.notDeepEqual(a[0], poster.samples[0])
      assert.notDeepEqual(a[1], poster.samples[1])
      assert.notDeepEqual(a[0], a[1])
      assert.deepEqual(a[2], poster.samples[2])
      assert.equal(await linkClip(p), link)
      const delta = Math.abs(linear(b[1][0]) - linear(a[1][0]))
      // One rounding to nearest sRGB8; use the half-code bound around the
      // observed next code in linear light. Both patches are greyscale.
      const tolerance = Math.max(
        linear(b[1][0] + 0.5) - linear(b[1][0]),
        linear(b[1][0]) - linear(b[1][0] - 0.5),
      )
      assert.ok(
        delta > 0 && delta <= 0.25 * 0.033 + tolerance,
        `${delta} vs ${tolerance}`,
      )
      const plane = await p.evaluate(`[
        getComputedStyle(document.querySelector('.s-site')).backgroundColor,
        getComputedStyle(document.querySelector('main')).backgroundColor,
        getComputedStyle(document.querySelector('canvas')).pointerEvents,
        document.querySelectorAll('canvas').length,
        [...document.querySelectorAll('[data-field]')].map(e=>{const r=e.getBoundingClientRect();return [r.top,r.bottom]}),
        (()=>{const a=${button},r=a.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===a})()
      ]`)
      const r = await p.evaluate<Results>('results')
      assert.deepEqual(
        r.context.map(c => c.slice(2)),
        [[320, 225]],
      )
      assert.deepEqual(plane, [
        'rgb(246, 243, 232)',
        'rgb(246, 243, 232)',
        'none',
        1,
        [
          [0, 400],
          [400, 800],
        ],
        true,
      ])
      await p.tab()
      assert.equal(await p.evaluate(`document.activeElement===${button}`), true)
      await p.key('Enter', true)
      await p.key('Enter', false)
      assert.equal(await p.evaluate('location.hash'), '#w-plate')
      console.log(
        JSON.stringify({
          plane,
          context: r.context,
          readyMs: r.readyMs,
          poster,
          a,
          b,
          linkPatch: link,
          delta,
          linearPerSecond: delta / 0.033,
          tolerance,
        }),
      )
    })
    // One full-excursion reversal. No repeated unfiltered flash on any page.
    await visit('/shader?probe=reversal', async p => {
      await wait(p, live)
      const samples: number[] = []
      for (let i = 0; i < 8; i++) {
        await tick(p, 1000 + i * (1000 / 30), 2 + i)
        const {
          samples: [rgb],
        } = await pixels(p, [points[1]], `reversal-${i}`)
        assert.ok(rgb.every(c => c === rgb[0]))
        samples.push(rgb[0])
      }
      const deltas = samples
        .slice(1)
        .map((v, i) => linear(v) - linear(samples[i]))
      assert.ok(Math.min(...deltas) < 0 && Math.max(...deltas) > 0)
      const maxDelta = Math.max(...deltas.map(Math.abs))
      const high = Math.max(...samples)
      const rounding = linear(high + 0.5) - linear(high)
      assert.ok(maxDelta <= 0.25 * 0.033 + rounding)
      console.log(
        JSON.stringify({
          reversal: samples,
          maxDelta,
          peakObservedPerSecond: 30 * maxDelta,
          rounding,
        }),
      )
    })
    await visit('/wasm?probe=clock', async p => {
      await wait(p, live)
      for (let i = 0; i < 4; i++) await tick(p, 1000 + (i * 1000) / 60, i + 2)
      const r = await p.evaluate<Results>('results')
      assert.equal(r.upload.length, 5)
      assert.ok(new Set(r.upload).size > 1)
      const draws = r.upload.map((v, i) => {
        const [raw, limited, raw2, limited2] = r.draw.slice(i * 4, i * 4 + 4)
        assert.ok(Math.abs(raw - (0.15 * 255 + v * 0.75)) <= 1)
        assert.deepEqual([raw, limited], [raw2, limited2])
        return [v, raw, limited]
      })
      assert.ok(new Set(draws.map(d => d[2])).size > 1)
      const { samples: displayed } = await pixels(
        p,
        [
          [262, 318],
          [262, 718],
        ],
        'ripple',
      )
      assert.deepEqual(
        displayed,
        Array.from({ length: 2 }, () => Array(3).fill(draws.at(-1)![2])),
      )
      console.log(JSON.stringify({ fieldRawLimited: draws, displayed }))
      // Six consecutive slow display opportunities; the sixth must leave the poster.
      const last = 1000 + (3 * 1000) / 60
      for (let i = 1; i <= 5; i++) await tick(p, last + i * 120, 5 + i)
      await p.evaluate(`advance(${last + 6 * 120})`)
      await wait(p, `results.terminated>0 && !document.querySelector('canvas')`)
      assert.deepEqual(await pixels(p, points, 'slow-poster'), poster)
      console.log('slow: 6 × 120 ms → exact poster')
    })
    await visit('/shader?probe=timeout', async p => {
      await wait(p, 'results.terminated>0')
      const ms = await p.evaluate<number>('results.terminated')
      assert.ok(ms >= 1490 && ms < 3000)
      assert.equal(await p.evaluate(`document.querySelector('canvas')`), null)
      assert.deepEqual(await pixels(p, points, 'timeout-poster'), poster)
      console.log(`watchdog: ${ms} ms → exact poster`)
    })
  } finally {
    await browser.close()
    await new Promise<void>(r => server.close(() => r()))
  }
}
