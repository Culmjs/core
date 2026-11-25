import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CustomEffect } from '@culmjs/core'
import { candidateCompiler } from '../../../scripts/gpu-flash/compiler.ts'
import { node, siteWith, text } from '../../core/__tests__/kit.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'
const { compilePage, createRegistry } = await candidateCompiler()

const reviewed: CustomEffect = {
  name: 'wash',
  settings: {
    tint: { type: 'color', default: '#ff0000' },
    bias: { type: 'number', min: 0, max: 1, default: 0 },
  },
  source: 'vec4 shade(vec2 uv){return vec4(u_set_tint,1.0);}',
}
const changed = {
  ...reviewed,
  source:
    'vec4 shade(vec2 uv){float n=texture(u_noise,vec2(0.1)).r;if(u_pointer.x>0.0){return vec4(vec3(float(n>0.0 && u_pointer.x<2.0 && u_resolution.x>0.0 && u_scroll==0.0)),0.0);}return vec4(u_set_tint+u_set_bias*n,0.0);}',
}
const decode = (code: number) =>
  code / 255 <= 0.04045
    ? code / 255 / 12.92
    : ((code / 255 + 0.055) / 1.055) ** 2.4
const encode = (v: number) =>
  Math.round(
    255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
  )

async function sample(p: Page) {
  const png = Buffer.from(await p.screenshot()).toString('base64')
  return p.evaluate<number[][]>(`(async()=>{
    const pic=await createImageBitmap(new Blob([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))]));
    const ctx=new OffscreenCanvas(pic.width,pic.height).getContext('2d');ctx.drawImage(pic,0,0);
    return [...document.querySelectorAll('[data-culm-gpu]')].map(el=>{const r=el.getBoundingClientRect();
      return Array.from(ctx.getImageData(r.x+20,r.bottom-10,1,1).data)})})()`)
}

test('changed reviewed shader: independently limited composited owners, resume and reset', async t => {
  const registry = createRegistry({
    gpu: { enabled: true, reviewed: [reviewed] },
  })
  const doc = siteWith(
    (['#383838', '#707070'] as const).map((bg, i) => ({
      ...node('hero' + i, 'box', [text('caption' + i, 'Caption')]),
      style: { base: { bg, height: { n: 120, unit: 'px' } } },
      motion: {
        gpu: 'wash',
        trigger: 'enter-view',
        settings: { tint: i ? '#000000' : '#ff0000' },
      },
    })),
    { customEffects: [changed] },
  )
  const c = compilePage(doc, 'home', { registry })
  assert.ok(c.ok, JSON.stringify(c.problems))
  const dir = await mkdtemp(join(tmpdir(), 'culm-limiter-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'scene.html')
  await writeFile(file, c.html)
  const b = await openBrowser()
  assert.ok(b.ok)
  t.after(() => b.browser.close())
  for (const hz of [30, 60, 120]) {
    const p = await b.browser.newPage()
    try {
      await p.unblock()
      await p.setScripts(false)
      await p.setViewport(360, 400)
      assert.ok((await p.goto(pathToFileURL(file).href, 10000)).ok)
      await p.setScripts(true)
      const poster = await sample(p)
      assert.deepEqual(poster, [
        [56, 56, 56, 255],
        [112, 112, 112, 255],
      ])
      // Scripts were disabled at navigation. Step the real compiled host via CDP;
      // avoid both a test hook in its bundle and a timer-dependent pixel assertion.
      await p.evaluate(`window.paint=()=>new Promise(r=>{const f=window.nativeRaf;f(()=>f(()=>f(r)))});window.nativeRaf=requestAnimationFrame.bind(window);
        window.framesDone=0;window.Worker=class extends Worker{constructor(...a){super(...a);this.addEventListener('message',e=>{window.ack=e.data;if(e.data===1)framesDone++})}};
        window.rafQ=[];window.requestAnimationFrame=f=>rafQ.push(f);window.tick=t=>{const q=rafQ.splice(0);q.forEach(f=>f(t))};
        document.getElementById('culm-gpu').observed=true`)
      await p.setReducedMotion(false)
      await p.evaluate(c.assets![0].content)
      let clock = 100
      const step = async (ms: number) => {
        const before = await p.evaluate<number>('framesDone')
        await p.evaluate(`tick(${(clock += ms)})`)
        assert.ok(
          await p.evaluate(
            `(async()=>{for(let i=0;i<100;i++){if(framesDone>${before})return true;if(window.ack===-1)break;await new Promise(r=>setTimeout(r,5))}return false})()`,
          ),
          `no completed checked draw at ${hz} Hz: ${p.errors}`,
        )
        await p.evaluate('paint()')
      }
      await step(0)
      await step(1000 / hz)
      assert.equal(
        await p.evaluate(
          `document.querySelectorAll('[data-gpu-painted]').length`,
        ),
        2,
      )
      const first = await sample(p)
      let prev = poster
      for (let frame = 0; frame < 6; frame++) {
        if (frame >= 4)
          await p.evaluate(
            `dispatchEvent(new PointerEvent('pointermove',{clientX:${frame - 3}}))`,
          )
        if (frame) await step(1000 / hz)
        const colors = frame ? await sample(p) : first
        for (const [i, rgba] of colors.entries()) {
          for (let k = 0; k < 3; k++) {
            const a = decode(prev[i][k]),
              target =
                frame >= 4 ? Number(frame === 4) : Number(i === 0 && k === 0)
            const cap = (0.25 * Math.min(33, 1000 / hz)) / 1000
            const expected = encode(
              a + Math.max(-cap, Math.min(cap, target - a)),
            )
            assert.equal(
              rgba[k],
              expected,
              JSON.stringify({ hz, frame, i, k, prev, colors }),
            )
          }
          assert.equal(rgba[3], 255)
        }
        prev = colors
      }
      await p.evaluate(
        `dispatchEvent(new PointerEvent('pointermove',{clientX:0}))`,
      )
      await p.evaluate(
        `Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));`,
      )
      assert.deepEqual(await sample(p), poster)
      await p.evaluate(
        `delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`,
      )
      await step(60000)
      await step(1000 / hz)
      assert.deepEqual(await sample(p), first)
      await p.evaluate(`dispatchEvent(new PageTransitionEvent('pagehide'))`)
      assert.deepEqual(await sample(p), poster)
      t.diagnostic(JSON.stringify({ hz, poster, first, last: prev }))
      assert.deepEqual(p.errors, [])
    } finally {
      await p.close()
    }
  }
})

test('review belongs to the exact snapshot; an arbitrary registry predicate cannot grant it', () => {
  const reg = createRegistry({ gpu: { enabled: true, reviewed: [reviewed] } })
  for (const [d, registry, expected] of [
    [reviewed, reg, true],
    [changed, reg, false],
    [
      changed,
      { ...reg, gpu: { enabled: true, isReviewed: () => true } },
      false,
    ],
  ] as const) {
    const c = compilePage(
      siteWith(
        [
          {
            ...node('h', 'box', [text('t', 'Title')]),
            motion: { gpu: 'wash', trigger: 'enter-view' },
          },
        ],
        { customEffects: [d] },
      ),
      'home',
      { registry },
    )
    assert.ok(c.ok)
    const payload = JSON.parse(c.html.match(/id="culm-gpu">([^<]+)</)![1])
    assert.equal(!!payload.definitions[0].reviewed, expected)
  }
})

test('unaltered SRI loader presents an exact reviewed solid and a limited solid together', async t => {
  const registry = createRegistry({
    gpu: { enabled: true, reviewed: [reviewed] },
  })
  const custom = { ...changed, name: 'unreviewed' }
  const c = compilePage(
    siteWith(
      ['wash', 'unreviewed'].map((gpu, i) => ({
        ...node('panel' + i, 'box', [text('label' + i, 'Notes')]),
        style: { base: { bg: '#383838', height: { n: 120, unit: 'px' } } },
        motion: { gpu, trigger: 'enter-view', settings: { tint: '#808080' } },
      })),
      { customEffects: [reviewed, custom] },
    ),
    'home',
    { registry },
  )
  assert.ok(c.ok)
  assert.deepEqual(
    c.problems.map(x => x.path),
    ['gpuHostScript'],
  )
  let requests = 0
  const server = createServer((req, res) => {
    if (req.url === '/_culm/gpu.js') {
      requests++
      res.setHeader('Content-Type', 'text/javascript').end(c.assets![0].content)
    } else if (req.url === '/')
      res.setHeader('Content-Type', 'text/html').end(c.html)
    else res.writeHead(204).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  const b = await openBrowser()
  assert.ok(b.ok)
  t.after(() => b.browser.close())
  const p = await b.browser.newPage()
  t.after(() => p.close())
  await p.unblock()
  await p.setViewport(360, 400)
  await p.setReducedMotion(true)
  assert.ok(
    (
      await p.goto(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        10000,
      )
    ).ok,
  )
  assert.equal(requests, 0)
  await p.setReducedMotion(false)
  assert.ok(
    await p.evaluate(
      `(async()=>{for(let i=0;i<200;i++){if(document.querySelectorAll('[data-gpu-painted]').length===2)return true;await new Promise(r=>setTimeout(r,5))}return false})()`,
    ),
  )
  assert.equal(requests, 1)
  const [direct, limited] = await sample(p)
  assert.deepEqual(direct, [128, 128, 128, 255])
  assert.ok(limited[0] >= 56 && limited[0] < 128, JSON.stringify(limited))
  assert.deepEqual(p.errors, [])
})

test('patterned first exposure, mixed trusted regions, nonfinite channels, allocation failure and resolution resampling', async t => {
  const registry = createRegistry({ gpu: { enabled: true } })
  const bad: CustomEffect = {
    name: 'arithmetic',
    settings: { zero: { type: 'number', default: 0, min: 0, max: 1 } },
    source:
      'vec4 shade(vec2 uv){return vec4(1.0/u_set_zero,u_set_zero/u_set_zero,1.0,0.0);}',
  }
  const dir = await mkdtemp(join(tmpdir(), 'culm-poster-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const tile = join(dir, 'tile.svg')
  await writeFile(
    tile,
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><defs><pattern id="p" width="30" height="120" patternUnits="userSpaceOnUse"><rect width="30" height="120" fill="#eee"/><rect x="15" width="15" height="120" fill="#804020"/></pattern></defs><rect width="360" height="120" fill="url(#p)"/></svg>',
  )
  const compiled = compilePage(
    siteWith(
      ['arithmetic', 'contours'].map((gpu, i) => ({
        ...node('h' + i, 'box', [text('t' + i, 'Title')]),
        style: { base: { bg: '#000000', height: { n: 120, unit: 'px' } } },
        motion: {
          gpu,
          trigger: 'enter-view',
          ...(!i && { poster: 'tile.svg' }),
        },
      })),
      { customEffects: [bad] },
    ),
    'home',
    { registry, links: { page: s => s, file: () => tile } },
  )
  assert.ok(compiled.ok)
  const file = join(dir, 'scene.html')
  await writeFile(file, compiled.html)
  const b = await openBrowser()
  assert.ok(b.ok)
  t.after(() => b.browser.close())
  for (const fail of [true, false]) {
    const p = await b.browser.newPage()
    try {
      await p.unblock()
      await p.setScripts(false)
      await p.setViewport(360, 400)
      assert.ok((await p.goto(pathToFileURL(file).href, 10000)).ok)
      await p.setScripts(true)
      await p.setReducedMotion(false)
      await p.evaluate(`window.hero=document.querySelector('[data-culm-gpu]');
        window.paint=(()=>{const f=requestAnimationFrame;return ()=>new Promise(r=>f(()=>f(()=>f(r))))})();
        let f,seq=0,time=100;window.requestAnimationFrame=g=>{f=g;return 1};
        window.Worker=class extends Worker{constructor(...a){super(...a);this.addEventListener('message',e=>{if(e.data===1)seq++})}};
        if(${fail})window.Blob=class extends Blob{constructor(parts,opts){super(opts?.type==='text/javascript'?['WebGL2RenderingContext.prototype.createTexture=()=>null;',...parts]:parts,opts)}};
        window.ticks=async(n,dt=1000/60)=>{for(let i=0;i<n;i++){const prev=seq;if(!f)throw Error('no scheduled frame');const cb=f;f=null;cb(time+=dt);await new Promise((r,j)=>{let deadline=performance.now()+2000;function wait(){if(seq>prev||!document.querySelector('canvas'))r();else if(performance.now()>deadline)j(Error('frame timeout'));else setTimeout(wait,1)}wait()})}}`)
      const poster = await sample(p)
      assert.deepEqual(poster[0], [128, 64, 32, 255])
      await p.evaluate(compiled.assets![0].content)
      await p.evaluate('ticks(1)')
      assert.deepEqual(await sample(p), poster)
      if (fail) {
        assert.equal(
          await p.evaluate(
            `document.querySelectorAll('[data-gpu-painted],canvas').length`,
          ),
          0,
        )
        continue
      }
      await p.evaluate('ticks(3)')
      assert.equal(
        await p.evaluate(`hero.hasAttribute('data-gpu-painted')`),
        false,
      )
      const early = await sample(p)
      assert.notDeepEqual(early[1], poster[1])
      early[0]
        .slice(0, 3)
        .forEach((v, k) => assert.ok(Math.abs(v - poster[0][k]) <= 2))
      await p.evaluate('ticks(548)')
      const dark = await sample(p)
      assert.ok(
        dark[0].slice(0, 3).every(c => c <= 2),
        JSON.stringify(dark),
      )
      await p.evaluate('ticks(12)')
      assert.equal(
        await p.evaluate(`hero.hasAttribute('data-gpu-painted')`),
        true,
      )
      const active = await sample(p)
      assert.deepEqual(active[0].slice(0, 2), [0, 0])
      assert.ok(active[0][2] > 0 && active[0][2] < 100, JSON.stringify(active))
      // Force a backing resolution change without changing the CSS layout.
      await p.evaluate(
        `void Object.defineProperty(window,'devicePixelRatio',{value:2,configurable:true});`,
      )
      await p.evaluate('ticks(1)')
      const resized = await sample(p)
      assert.equal(resized[0][2], encode(decode(active[0][2]) + 0.25 / 60))
      // A blocked neighbour does not reset this displayed history, and should
      // not inherit the slow decision for the only remaining visible effect.
      await p.evaluate(
        `hero.nextElementSibling.style.transform='translateX(1px)'`,
      )
      await p.evaluate('ticks(1)')
      assert.equal(
        (await sample(p))[0][2],
        encode(decode(resized[0][2]) + 0.25 / 60),
      )
      await p.evaluate('ticks(24,120)')
      assert.equal(
        await p.evaluate(
          `document.querySelectorAll('canvas,[data-gpu-painted]').length`,
        ),
        0,
      )
      assert.ok(
        await p.evaluate(
          `Object.keys(localStorage).length===1 && Object.keys(localStorage)[0].includes('arithmetic')`,
        ),
      )
      await p.evaluate(`hero.nextElementSibling.style.transform=''`)
      assert.deepEqual(await sample(p), poster)
      await p.setScripts(false)
      assert.ok((await p.goto(pathToFileURL(file).href, 10000)).ok)
      await p.setScripts(true)
      await p.evaluate(compiled.assets![0].content)
      assert.ok(
        await p.evaluate(
          `(async()=>{for(let n=0;n<100;n++){if(document.querySelectorAll('[data-gpu-painted]').length===1)return true;await new Promise(r=>setTimeout(r,10))}return false})()`,
        ),
      )
      const remembered = await sample(p)
      assert.deepEqual(remembered[0], poster[0])
      assert.notDeepEqual(remembered[1], poster[1])
      t.diagnostic(JSON.stringify({ poster, early, dark, active, resized }))
      assert.deepEqual(p.errors, [])
    } finally {
      await p.close()
    }
  }
})
