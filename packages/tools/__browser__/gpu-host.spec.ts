import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import {
  applySetting,
  compilePage,
  compileSubtree,
  checkShader,
  type CustomEffect,
  type ShaderSettings,
  createRegistry,
  insertBlock,
} from '@culmjs/core'
import starter, { STYLES } from '@culmjs/starter'
import { scenes } from '../__tests__/fixtures/motion-scenes.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'
import { DEMO_PLUGIN, node, siteWith, text } from '../../core/__tests__/kit.ts'
import { mist } from '../__tests__/fixtures/shader.ts'
import { sources } from '../../../scripts/gpu-spike/shaders.ts'
import { DomUtils, parseDocument } from 'htmlparser2'

const active = `document.querySelectorAll('[data-gpu-painted]').length`
const first = `document.querySelector('section')`
const paint =
  'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))'
async function wait(p: Page, condition: string) {
  const ok = await p.evaluate(`(async()=>{for(let n=0;n<250;n++){
    if(${condition})return true;await new Promise(r=>setTimeout(r,20))
  }return false})()`)
  if (!ok)
    assert.fail(
      `${condition}: ${JSON.stringify(await p.evaluate(`({...window.obs,widths:[...new Set(window.obs?.widths)],painted:${active},reduce:matchMedia('(prefers-reduced-motion: reduce)').matches})`))} ${p.errors.join('; ')}`,
    )
}

// Installed through DevTools while both owners are still far away. All
// instrumentation stays outside HTML/SRI/CSP and the two priced programs.
function probe(mode: string) {
  const worker = `
    let gl;const get=OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext=function(...args){
      gl=${mode === 'acquire' ? 'null' : 'get.apply(this,args)'};
      const ext=gl?.getExtension('WEBGL_debug_renderer_info');
      postMessage({context:gl?gl.getParameter(gl.VERSION):'absent',renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)});
      if(gl && ${mode === 'fast'}){
        const set=gl.viewport.bind(gl);let previous='';
        gl.viewport=(...args)=>{set(...args);const vp=Array.from(gl.getParameter(gl.VIEWPORT));
          if(previous!==vp.join()){previous=vp.join();postMessage({viewport:vp})}}
      }
      if(gl && ${mode === 'stall'}){
        const extension=gl.getExtension.bind(gl),param=gl.getProgramParameter.bind(gl);
        gl.getExtension=k=>k==='KHR_parallel_shader_compile'?{COMPLETION_STATUS_KHR:37297}:extension(k);
        gl.getProgramParameter=(p,k)=>k===37297?false:param(p,k)
      }
      return gl
    };
    addEventListener('message',e=>{if(e.data==='lose'){e.stopImmediatePropagation();gl.getExtension('WEBGL_lose_context').loseContext()}});`
  return `(()=>{
    const mode=${JSON.stringify(mode)},prefix=${JSON.stringify(worker)};
    window.obs={workers:0,canvases:0,urls:0,revoked:0,transfers:0,terminated:0,contexts:[],widths:[],main:0,frames:0,start:0,end:0};
    const createElement=Document.prototype.createElement;Document.prototype.createElement=function(tag,...args){if(tag==='canvas')obs.canvases++;return createElement.call(this,tag,...args)};
    if(mode==='missing')window.WebGL2RenderingContext=undefined;
    if(mode==='save')Object.defineProperty(navigator.connection,'saveData',{value:true,writable:true});
    if(mode==='denied')Object.defineProperty(window,'localStorage',{get(){throw Error('unavailable')}});
    if(mode==='slow'||mode==='denied'||mode==='fast'){
      const raf=requestAnimationFrame.bind(window);let t=100;window.interval=mode==='denied'?120:1;
      window.requestAnimationFrame=f=>raf(()=>{
        if(mode==='slow' && interval===120){
          window.dispatchEvent(new Event('scroll'));
          document.querySelector('section').style.paddingBottom=(obs.frames%2?40:41)+'px'
        }
        f(t+=interval)
      })
    }
    const transfer=HTMLCanvasElement.prototype.transferControlToOffscreen;
    HTMLCanvasElement.prototype.transferControlToOffscreen=function(){obs.transfers++;if(mode==='transfer')throw Error();return transfer.call(this)};
    const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){obs.main++;return get.apply(this,args)};
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=b=>{obs.urls++;return create(b)};URL.revokeObjectURL=u=>{obs.revoked++;revoke(u)};
    window.Blob=class extends Blob{constructor(parts,opts){
      if(opts?.type==='text/javascript'&&mode==='blob')throw Error();super(opts?.type==='text/javascript'?[prefix,...parts]:parts,opts)
    }};
    window.Worker=class extends Worker{constructor(...args){
      obs.workers++;if(mode==='constructor')throw Error();super(...args);window.lastWorker=this;obs.start=performance.now();
      this.addEventListener('message',e=>{if(e.data?.viewport){e.stopImmediatePropagation();(obs.viewports??=[]).push(e.data.viewport)}else if(e.data?.context){e.stopImmediatePropagation();obs.contexts.push(e.data.context);obs.renderer=e.data.renderer}else if(e.data===1 && !obs.ready)obs.ready=performance.now()-obs.start})
    } postMessage(msg,...args){if(mode==='post')throw Error();if(Array.isArray(msg)){obs.widths.push(msg[0]);obs.frames++;obs.regions=msg[2]}super.postMessage(msg,...args)}
      terminate(){obs.terminated++;obs.end=performance.now();super.terminate()}
    };
  })()`
}

// Sample the compositor, not the drawing buffer. The opaque link patch includes its label.
async function pixels(p: Page) {
  const png = Buffer.from(await p.screenshot()).toString('base64')
  return p.evaluate<string[]>(`(async()=>{
    const img=await createImageBitmap(new Blob([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))]));
    const ctx=new OffscreenCanvas(img.width,img.height).getContext('2d');ctx.drawImage(img,0,0);
    const r=document.querySelector('section a').getBoundingClientRect();
    return [[200,15,16,4],[200,415,16,4],[8,850,4,4],[r.x+8,r.y+8,r.width-16,r.height-16]].map(
      ([x,y,w,h])=>Array.from(ctx.getImageData(x,y,w,h).data).join(','))
  })()`)
}

test('two production starter heroes share one worker context behind the unchanged foreground', async t => {
  const registry = createRegistry({ gpu: { enabled: true } })
  registry.use(starter)
  const doc = await scenes.control()
  doc.styles = STYLES
  const heroes = [0, 1].map(i => {
    const block = insertBlock(registry, 'hero', 'plain', `hero${i}`)
    assert.ok(block.ok)
    const set = applySetting(registry, block.root, 'buttonLink', {
      url: '#plate',
    })
    assert.ok(set.ok)
    set.root.motion = {
      gpu: 'contours',
      trigger: 'enter-view',
      settings: { speed: i + 1 },
      ...(i === 0 && { poster: 'poster.svg' }),
    }
    if (i === 1) (set.root.style!.base ??= {}).bg = '#c8aa90'
    return set.root
  })
  doc.pages[0].root.children!.unshift(...heroes)
  const options = {
    registry,
    links: { page: (s: string) => s, file: (s: string) => `/local/${s}?v=2` },
  }
  const built = compilePage(doc, 'home', options)
  assert.ok(built.ok, JSON.stringify(built.problems))
  assert.deepEqual(built.problems, [])
  const competing = structuredClone(doc)
  competing.pages[0].root.children![0].style!.base!.bgImage = 'ordinary'
  const posterPages = new Map<string, string>()
  for (const [suffix, availableMedia] of [
    ['', undefined],
    ['-present', new Set(['/local/ordinary', '/local/poster.svg'])],
    ['-missing', new Set(['/local/ordinary'])],
  ] as const) {
    const resolved = { ...options, availableMedia }
    for (const mode of ['live', 'edit'] as const) {
      const c = compilePage(competing, 'home', { ...resolved, mode })
      assert.ok(c.ok, JSON.stringify(c.problems))
      posterPages.set('/poster-' + mode + suffix, c.html)
    }
    const sub = compileSubtree(competing, 'home', heroes[0].id, resolved)
    assert.ok(sub.ok)
    posterPages.set(
      '/poster-sub' + suffix,
      `<style>${sub.pageCss}${sub.css}</style><main class="s-site">${sub.html}</main>`,
    )
  }
  doc.pages[0].root.children!.unshift({
    ...node('spacer', 'box'),
    style: { base: { height: { n: 1800, unit: 'px' } } },
  })
  const far = compilePage(doc, 'home', options)
  assert.ok(far.ok)
  assert.deepEqual(far.problems, [])
  const mixed = structuredClone(doc)
  mixed.customEffects = [mist]
  const near = mixed.pages[0].root.children![0]
  near.children = [text('neartitle', 'Static scene')]
  near.motion = { trigger: 'enter-view', gpu: 'mist' }
  mixed.header.children = [
    {
      ...node('strip', 'column', [text('striptitle', 'Strip')]),
      motion: { trigger: 'enter-view', gpu: 'contours' },
    },
  ]
  const mixedPage = compilePage(mixed, 'home', options)
  assert.ok(mixedPage.ok, JSON.stringify(mixedPage.problems))
  delete near.motion
  const stripPage = compilePage(mixed, 'home', options)
  assert.ok(stripPage.ok)
  let requests = 0
  const server = createServer((req, res) => {
    if (req.url === '/_culm/gpu.js') {
      requests++
      res
        .setHeader('content-type', 'text/javascript')
        .end(built.assets![0].content)
    } else if (req.url === '/local/poster.svg?v=2')
      res
        .setHeader('content-type', 'image/svg+xml')
        .end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>',
        )
    else if (req.url === '/local/ordinary?v=2')
      res
        .setHeader('content-type', 'image/svg+xml')
        .end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
        )
    else if (req.url === '/favicon.ico') res.writeHead(204).end()
    else
      res
        .setHeader('content-type', 'text/html')
        .end(
          posterPages.get(req.url!) ??
            (req.url === '/mixed'
              ? mixedPage.html
              : req.url === '/far'
                ? far.html
                : built.html),
        )
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  t.after(() => b.browser.close())
  const p = await b.browser.newPage()
  t.after(() => p.close())
  await p.unblock()
  await p.setViewport(1280, 900)
  await p.setScripts(false)
  assert.ok((await p.goto(origin, 10000)).ok)
  const poster = await pixels(p)
  assert.ok(poster[0].startsWith('18,52,86,255,'))
  assert.ok(poster[1].startsWith('200,170,144,255,'))
  await p.setScripts(true)
  await p.setReducedMotion(false)
  assert.ok((await p.goto(origin, 10000)).ok)
  await wait(p, `${active}===2`)
  const live = await pixels(p)
  for (const i of [0, 1]) assert.notEqual(live[i], poster[i])
  assert.deepEqual(live.slice(2), poster.slice(2))
  await new Promise(r => setTimeout(r, 180))
  const later = await pixels(p)
  for (const i of [0, 1]) assert.notEqual(later[i], live[i])
  t.diagnostic(
    JSON.stringify({
      browser: b.browser.version,
      samples: [poster, live, later].map(p =>
        p.slice(0, 3).map(s => s.split(',').slice(0, 3).map(Number)),
      ),
    }),
  )
  assert.equal(
    await p.evaluate(`document.querySelectorAll('canvas').length`),
    1,
  )
  assert.ok(
    await p.evaluate(
      `(()=>{const a=document.querySelector('section a'),r=a.getBoundingClientRect();return a===document.elementFromPoint(r.x+10,r.y+10)})()`,
    ),
  )
  await p.tab()
  assert.ok(
    await p.evaluate(
      `document.activeElement===document.querySelector('section a')`,
    ),
  )
  await p.key('Enter', true)
  await p.key('Enter', false)
  assert.equal(await p.evaluate('location.hash'), '#w-plate')
  assert.deepEqual(p.errors, [])

  const scroll = `${first}.scrollIntoView()`
  await t.test(
    'explicit poster beats an ordinary bgImage in live, edit and a fragment',
    async () => {
      await p.setScripts(false)
      try {
        for (const route of posterPages.keys()) {
          assert.ok((await p.goto(origin + route, 10000)).ok)
          assert.match(
            await p.evaluate<string>(
              `getComputedStyle(${first}).backgroundImage`,
            ),
            route.endsWith('-missing')
              ? /\/local\/ordinary\?v=2/
              : /\/local\/poster.svg\?v=2/,
          )
          const loaded = await p.evaluate<string[]>(
            `performance.getEntriesByType('resource').filter(e=>e.name.includes('/local/')).map(e=>new URL(e.name).pathname)`,
          )
          assert.ok(
            loaded.includes(
              route.endsWith('-missing')
                ? '/local/ordinary'
                : '/local/poster.svg',
            ),
          )
          if (route.endsWith('-missing'))
            assert.ok(!loaded.includes('/local/poster.svg'))
          if (route === '/poster-live-missing')
            assert.ok((await pixels(p))[0].startsWith('255,0,0,255,'))
          else if (route.startsWith('/poster-live'))
            assert.deepEqual(await pixels(p), poster)
        }
      } finally {
        await p.setScripts(true)
      }
    },
  )
  await t.test(
    'real body count respects the display slot at the ceiling',
    async () => {
      const edge = structuredClone(competing)
      const pin = node('pin', 'box', [text('pintext', 'Pinned note')])
      pin.motion = { trigger: 'scroll', pinPx: 400, effect: 'rise' }
      edge.pages[0].root.children!.push(pin)
      const filler = node('filler', 'column', [])
      edge.pages[0].root.children!.push(filler)
      const page = () => {
        const c = compilePage(edge, 'home', options)
        assert.ok(c.ok)
        assert.deepEqual(c.problems, [])
        return c
      }
      const count = (html: string) =>
        DomUtils.getElementsByTagName(
          '*',
          DomUtils.getElementsByTagName('body', parseDocument(html))[0]
            .children,
        ).length
      for (let i = count(page().html); i < 1999; i++)
        filler.children!.push(node(`fill${i}`, 'box'))
      const fits = page()
      posterPages.set('/edge', fits.html)
      assert.equal(count(fits.html), 1999)
      assert.ok((await p.goto(origin + '/edge', 10000)).ok)
      await wait(p, `${active}===2`)
      assert.equal(
        await p.evaluate(`document.body.querySelectorAll('*').length`),
        2000,
      )
      // Even a reserved slot may have been consumed by another live feature.
      await p.setReducedMotion(true)
      assert.ok((await p.goto(origin + '/edge', 10000)).ok)
      await p.evaluate(probe('slot'))
      await p.evaluate(`document.body.append(document.createElement('div'))`)
      await p.setReducedMotion(false)
      await wait(
        p,
        `performance.getEntriesByName(location.origin+'/_culm/gpu.js').length===1`,
      )
      await p.evaluate(paint)
      assert.deepEqual(
        await p.evaluate(
          `[document.body.querySelectorAll('*').length,obs.canvases,obs.workers]`,
        ),
        [2000, 0, 0],
      )
      filler.children!.push(node('fulla', 'box'), node('fullb', 'box'))
      const full = page()
      posterPages.set('/full', full.html)
      assert.equal(count(full.html), 2000)
      requests = 0
      assert.ok((await p.goto(origin + '/full', 10000)).ok)
      await p.evaluate(paint)
      assert.deepEqual(
        await p.evaluate(
          `[document.body.querySelectorAll('*').length,document.querySelectorAll('canvas').length]`,
        ),
        [2000, 0],
      )
      assert.equal(requests, 0)
    },
  )
  await t.test(
    'a heading covering the leading corner leaves drawable exposed background below',
    async () => {
      const hero = node('unpad', 'box', [
        text('caption', 'Ordinary heading', {
          props: { level: 'h1', runs: [{ text: 'Ordinary heading' }] },
        }),
        text('blurb', 'A short paragraph.'),
      ])
      hero.motion = { trigger: 'enter-view', gpu: 'contours' }
      hero.style = {
        base: {
          height: { n: 400, unit: 'px' },
          bg: '#c8aa90',
          position: 'relative',
        },
      }
      const c = compilePage(siteWith([hero]), 'home', options)
      assert.ok(c.ok, JSON.stringify(c.problems))
      assert.deepEqual(c.problems, [])
      posterPages.set('/unpad', c.html)
      await p.setReducedMotion(true)
      assert.ok((await p.goto(origin + '/unpad', 10000)).ok)
      await p.evaluate(`window.hero=document.querySelector('[data-gpu-run]')`)
      const pt = await p.evaluate<{ x: number; y: number }>(
        `(()=>{const r=hero.getBoundingClientRect();return {x:r.left+25,y:r.top+250}})()`,
      )
      const clip = { ...pt, w: 20, h: 10 }
      assert.ok(
        await p.evaluate(
          `(()=>{const r=hero.getBoundingClientRect();return r.height===400 && document.elementFromPoint(r.x+1,r.y+1)!==hero && document.elementFromPoint(r.x+25,r.y+250)===hero})()`,
        ),
      )
      const plain = Buffer.from(await p.screenshot(clip))
      await p.setReducedMotion(false)
      await wait(p, `${active}===1`)
      assert.notDeepEqual(Buffer.from(await p.screenshot(clip)), plain)
      await p.evaluate(
        `hero.firstElementChild.style.cssText='position:absolute;inset:0;background:#568877;z-index:1;margin:0'`,
      )
      await wait(p, `${active}===0`)
      const covered = Buffer.from(await p.screenshot(clip))
      await p.setReducedMotion(true)
      assert.deepEqual(Buffer.from(await p.screenshot(clip)), covered)
      await p.setReducedMotion(false)
    },
  )
  await t.test(
    'a tall owner on a DPR 2 phone keeps its coordinates and frames after quality rises',
    async () => {
      const spacer = node('space', 'box')
      spacer.style = { base: { height: { n: 1800, unit: 'px' } } }
      const section = (id: string, height: number) => {
        const h = node(id, 'column', [
          text(id + 'start', 'Start'),
          text(id + 'end', 'End'),
        ])
        h.style = {
          base: {
            height: { n: height, unit: 'px' },
            padding: [16, 16, 16, 16],
            justify: 'between',
            bg: '#c8aa90',
          },
        }
        h.motion = {
          gpu: 'contours',
          trigger: 'enter-view',
          settings: { speed: 0 },
        }
        return h
      }
      const c = compilePage(
        siteWith([
          spacer,
          section('tall', 1800),
          section('short', 400),
          { ...spacer, id: 'tail' },
        ]),
        'home',
        options,
      )
      assert.ok(c.ok, JSON.stringify(c.problems))
      assert.deepEqual(c.problems, [])
      posterPages.set('/tall', c.html)
      await p.setViewport(390, 844, 2)
      try {
        assert.ok((await p.goto(origin + '/tall', 10000)).ok)
        await p.evaluate(probe('fast'))
        await p.evaluate(
          `window.tall=document.querySelector('[data-gpu-run]');tall.scrollIntoView()`,
        )
        assert.deepEqual(
          await p.evaluate(
            `[innerWidth,innerHeight,devicePixelRatio,tall.getBoundingClientRect().height]`,
          ),
          [390, 844, 2, 1800],
        )
        await wait(p, `obs.widths.includes(390)`)
        const full = (width: number) =>
          Math.floor(Math.sqrt((1048576 * width) / 844))
        await wait(p, `obs.widths.includes(${full(390)}) && ${active}===1`)
        const frames = await p.evaluate<number>('obs.frames')
        await wait(
          p,
          `obs.frames>=${frames + 10} && obs.widths.slice(-10).every(w=>w===${full(390)})`,
        )
        // Sample the actually displayed shader against owner-local UV (speed=0).
        async function verifySample(x: number, y: number) {
          const png = Buffer.from(await p.screenshot()).toString('base64')
          const [r, g, b, expected] = await p.evaluate<number[]>(`(async()=>{
          const image=await createImageBitmap(new Blob([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))]));
          const ctx=new OffscreenCanvas(image.width,image.height).getContext('2d');ctx.drawImage(image,0,0);
          const [r,g,b]=ctx.getImageData(${x}*2,${y}*2,1,1).data, rect=tall.getBoundingClientRect();
          const u=(${x}-rect.left)/rect.width,v=(rect.bottom-${y})/rect.height;
          return [r,g,b,255*(.6+.2*Math.sin(24*u+Math.sin(9*v)))]
        })()`)
          assert.ok(
            r === g && g === b && Math.abs(r - expected) < 3,
            JSON.stringify([r, g, b, expected]),
          )
        }
        await verifySample(120, 620)
        await p.evaluate(`scrollBy(0,1450)`)
        await wait(p, `obs.regions.length===2 && ${active}===2`)
        await verifySample(120, 150)
        await p.evaluate(`tall.style.height='1900px'`)
        await p.setViewport(430, 844, 2)
        await wait(
          p,
          `obs.widths.at(-1)===${full(430)} && obs.regions.length===2 && ${active}===2`,
        )
        await verifySample(120, 150)
        await p.setViewport(2800, 320, 2)
        await p.evaluate('tall.scrollIntoView()')
        await wait(p, `obs.viewports.at(-1)[2]===2048 && ${active}===1`)
        assert.ok(
          await p.evaluate(
            `obs.viewports.every(([x,y,w,h])=>x===0&&y===0&&w<=2048&&h<=2048&&w*h<=1048576)`,
          ),
        )
        assert.equal(await p.evaluate('obs.contexts.length'), 1)
        t.diagnostic(
          JSON.stringify(
            await p.evaluate(`({viewports:obs.viewports,regions:obs.regions})`),
          ),
        )
      } finally {
        await p.setViewport(1280, 900)
      }
    },
  )
  await t.test(
    'a near static header does not load distant heroes; a checked custom owner earns its own single request',
    async () => {
      posterPages.set('/strip', stripPage.html)
      requests = 0
      assert.ok((await p.goto(origin + '/strip', 10000)).ok)
      await p.evaluate(paint)
      assert.equal(requests, 0)
      await p.evaluate(scroll)
      await wait(
        p,
        `performance.getEntriesByName(location.origin+'/_culm/gpu.js').length===1`,
      )
      assert.equal(requests, 1)
      requests = 0
      assert.ok((await p.goto(origin + '/mixed', 10000)).ok)
      await wait(
        p,
        `performance.getEntriesByName(location.origin+'/_culm/gpu.js').length===1`,
      )
      assert.equal(requests, 1)
      assert.ok(
        await p.evaluate(
          `document.querySelector('[data-gpu-run="custom"]').getBoundingClientRect().top<innerHeight && ${first}.getBoundingClientRect().top>innerHeight`,
        ),
      )
    },
  )
  await t.test(
    'builtin owners keep their authored border and text shadow while their backgrounds paint',
    async () => {
      const page = compilePage(
        siteWith(
          ['border', 'shadow'].map((id, i) => ({
            ...node(id, 'box', [
              text(
                id + 'title',
                'Field notes',
                i
                  ? {
                      style: {
                        base: {
                          bg: '#ffffff',
                          textShadow: { x: 1, y: 1, blur: 2, color: '#000000' },
                        },
                      },
                    }
                  : {},
              ),
            ]),
            style: {
              base: {
                height: { n: 160, unit: 'px' },
                bg: '#123456',
                ...(!i && { border: { width: 2, color: '#ffffff' } }),
              },
            },
            motion: {
              trigger: 'enter-view',
              gpu: 'contours',
              settings: { speed: 0 },
            },
          })),
        ),
        'home',
        options,
      )
      assert.ok(page.ok)
      assert.deepEqual(page.problems, [])
      posterPages.set('/decorated', page.html)
      await p.setReducedMotion(true)
      assert.ok((await p.goto(origin + '/decorated', 10000)).ok)
      const clips = [
        { x: 30, y: 0, w: 30, h: 2 },
        { x: 2, y: 161, w: 100, h: 12 },
        { x: 80, y: 130, w: 20, h: 4 },
        { x: 80, y: 290, w: 20, h: 4 },
      ]
      const sample = async () => {
        const pixels = []
        for (const clip of clips)
          pixels.push(Buffer.from(await p.screenshot(clip)))
        return pixels
      }
      const fallback = await sample()
      await p.setReducedMotion(false)
      await wait(p, `${active}===2`)
      const live = await sample()
      assert.deepEqual(live.slice(0, 2), fallback.slice(0, 2))
      for (const i of [2, 3]) assert.notDeepEqual(live[i], fallback[i])
    },
  )
  for (const issue of ['pinned', 'witness', 'mixed witness', 'blocked']) {
    await t.test(issue, async sub => {
      let path = ''
      if (issue === 'mixed witness') {
        // Same builtin foreground, next to a genuinely running unreviewed
        // neighbour. Keep both 400px owners on an exact display grid.
        const doc = structuredClone(competing)
        doc.customEffects = [mist]
        doc.pages[0].root.children![1].motion = {
          trigger: 'enter-view',
          gpu: 'mist',
        }
        const page = compilePage(doc, 'home', options)
        assert.ok(page.ok)
        assert.deepEqual(page.problems, [])
        path = '/witness-mixed'
        posterPages.set(path, page.html)
        await p.setViewport(1280, 800)
        sub.after(() => p.setViewport(1280, 900))
      }
      await p.setReducedMotion(false)
      assert.ok((await p.goto(origin + path, 10000)).ok)
      await wait(p, `${active}===2`)
      if (issue === 'pinned') {
        await p.evaluate(
          `const f=document.createElement('form');f.style.cssText='position:absolute;top:2400px';const b=document.createElement('button');b.type='submit';b.textContent='Submit';b.style.cssText='position:fixed;top:100px;left:320px;width:120px;height:48px;background:transparent;z-index:5';f.append(b);document.body.append(f)`,
        )
        assert.ok(
          await p.evaluate(
            `document.querySelector('form').getBoundingClientRect().top>innerHeight && document.elementFromPoint(330,110).type==='submit'`,
          ),
        )
        await wait(
          p,
          `${active}===1 && !${first}.hasAttribute('data-gpu-painted')`,
        )
        const clip = { x: 320, y: 100, w: 120, h: 48 }
        const actual = Buffer.from(await p.screenshot(clip))
        await p.setReducedMotion(true)
        await wait(p, `${active}===0`)
        assert.deepEqual(actual, Buffer.from(await p.screenshot(clip)))
      } else if (issue.endsWith('witness')) {
        await p.evaluate(
          `const s=${first};s.style.overflow='visible';const heading=s.querySelector('h1');for(const e of s.querySelectorAll('[data-gpu-content]'))if(e!==heading)e.style.visibility='hidden';heading.style.cssText='position:fixed;left:16px;top:410px;font-size:16px;line-height:20px;z-index:5';`,
        )
        await wait(p, `!${first}.hasAttribute('data-gpu-painted')`)
        await wait(p, `${active}===1`)
        await p.evaluate(`heading.style.top='395px'`)
        assert.ok(
          await p.evaluate(
            `(()=>{const r=document.createRange();r.selectNodeContents(heading);const b=r.getBoundingClientRect(),end=${first}.getBoundingClientRect().bottom;return b.top<end && (b.top+b.bottom)/2>end})()`,
          ),
        )
        await wait(p, `${first}.hasAttribute('data-gpu-painted')`)
        await p.evaluate(`heading.style.top='100px'`)
        await wait(p, `${first}.hasAttribute('data-gpu-painted')`)
      } else {
        await p.evaluate(`${first}.parentElement.style.opacity='.5'`)
        await wait(p, `${active}===0`)
        await p.evaluate(
          `window.scans=0;const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){if(this.matches('section'))scans++;return rect.call(this)}`,
        )
        await p.evaluate(
          `(async()=>{for(let i=0;i<90;i++){document.body.dataset.unrelated=String(i);await new Promise(r=>requestAnimationFrame(r))}})()`,
        )
        const scans = await p.evaluate<number>('scans')
        assert.ok(
          scans <= 20,
          `${scans} blocked owner measurements across 90 unrelated mutations`,
        )
        t.diagnostic(
          `${scans} blocked owner measurements across 90 display opportunities`,
        )
        await p.evaluate(`${first}.parentElement.style.opacity='1'`)
        await wait(p, `${active}===2`)
      }
    })
  }
  for (const mode of [
    'compose',
    'resize',
    'reduce',
    'save',
    'missing',
    'acquire',
    'stall',
    'loss',
    'blob',
    'constructor',
    'transfer',
    'post',
    'denied',
    'slow',
  ]) {
    await t.test(mode, async () => {
      requests = 0
      await p.setReducedMotion(mode === 'reduce')
      assert.ok((await p.goto(origin + '/far', 10000)).ok)
      await p.evaluate(probe(mode))
      const loader = built.scripts.find(s => s.name === 'gpuLoader')!.code
      await p.evaluate(loader) // duplicate entry while both heroes are still far away
      await p.evaluate(paint)
      assert.equal(requests, 0)
      if (mode === 'resize') {
        // One pixel beyond the preload margin; neither zero-size marker may
        // wake the host after scrolling inside the margin until it expands.
        await p.evaluate('scrollTo(0,699)')
        await p.evaluate(paint)
        assert.equal(requests, 0)
        await p.evaluate(
          `for(const e of document.querySelectorAll('section')){e.dataset.saved=e.style.cssText;e.style.cssText+=';height:0;min-height:0;padding:0;overflow:hidden'};${scroll}`,
        )
        await p.evaluate(paint)
        assert.equal(requests, 0)
        await p.evaluate(
          `for(const e of document.querySelectorAll('section'))e.style.cssText=e.dataset.saved`,
        )
      }
      await p.evaluate(scroll)
      await p.evaluate(paint)
      if (mode === 'reduce' || mode === 'save') {
        assert.equal(requests, 0)
        assert.equal(await p.evaluate(`obs.workers`), 0)
        assert.deepEqual(await pixels(p), poster)
        if (mode === 'save')
          await p.evaluate(
            `navigator.connection.saveData=false;navigator.connection.dispatchEvent(new Event('change'))`,
          )
        else await p.setReducedMotion(false)
        await wait(p, `${active}===2`)
        if (mode === 'save')
          await p.evaluate(
            `navigator.connection.saveData=true;navigator.connection.dispatchEvent(new Event('change'))`,
          )
        else await p.setReducedMotion(true)
        await wait(p, `${active}===0`)
      } else {
        await wait(
          p,
          `performance.getEntriesByName(location.origin+'/_culm/gpu.js').length===1`,
        )
        if (
          mode === 'compose' ||
          mode === 'loss' ||
          mode === 'slow' ||
          mode === 'resize'
        ) {
          await wait(p, `${active}===2`)
          assert.match(
            await p.evaluate<string>('obs.contexts.join()'),
            /^WebGL 2\.0/,
          )
          assert.equal(await p.evaluate('obs.contexts.length'), 1)
          assert.equal(await p.evaluate('obs.widths[0]'), 320)
          if (mode === 'loss') {
            await p.evaluate(`lastWorker.postMessage('lose')`)
          } else if (mode === 'slow') {
            await wait(
              p,
              `obs.widths.includes(${Math.floor(1280 * Math.sqrt(1048576 / (1280 * 900)))})`,
            )
            await p.evaluate(`window.interval=120`)
          } else if (mode === 'resize') {
            await p.evaluate(
              `void Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:5})`,
            )
            await p.setViewport(960, 720)
            await wait(p, 'obs.widths.includes(480)')
            await p.evaluate(
              `void Object.defineProperty(window,'devicePixelRatio',{value:1})`,
            )
            await p.setViewport(1280, 900)
            await wait(p, `${active}===2`)
            await p.evaluate(
              `Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))`,
            )
            await wait(p, `${active}===0`)
            const paused = await p.evaluate('obs.frames')
            await p.evaluate(paint)
            assert.equal(await p.evaluate('obs.frames'), paused)
            await p.evaluate(
              `delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`,
            )
            await wait(p, `${active}===2`)
            await p.setReducedMotion(true)
          } else {
            await p.evaluate(built.assets![0].content) // external entry twice
            t.diagnostic(
              JSON.stringify(
                await p.evaluate(
                  `({context:obs.contexts,renderer:obs.renderer,firstFrameMs:obs.ready})`,
                ),
              ),
            )
            assert.deepEqual(
              await p.evaluate(
                `[obs.transfers,obs.workers,obs.contexts.length,document.querySelectorAll('canvas').length]`,
              ),
              [1, 1, 1, 1],
            )
            const canvas = 'document.querySelector("canvas")'
            assert.deepEqual(
              await p.evaluate(
                `[${canvas}.tabIndex,${canvas}.getAttribute('aria-hidden'),getComputedStyle(${canvas}).pointerEvents]`,
              ),
              [-1, 'true', 'none'],
            )
            // A transparent sticky form remains at y=0 as the second hero scrolls under it.
            await p.evaluate(
              `const f=document.createElement('form');f.style.cssText='position:sticky;top:0;width:240px;height:40px;z-index:2';f.append(document.createElement('input'));${first}.before(f);window.scrollBy(0,440)`,
            )
            await wait(p, `${active}===0`)
            assert.ok(
              await p.evaluate(
                `document.querySelector('form').getBoundingClientRect().top===0`,
              ),
            )
            const liveForm = Buffer.from(
              await p.screenshot({
                x: 0,
                y: await p.evaluate<number>('scrollY'),
                w: 240,
                h: 40,
              }),
            )
            await p.setReducedMotion(true)
            await wait(p, `${active}===0`)
            assert.deepEqual(
              Buffer.from(
                await p.screenshot({
                  x: 0,
                  y: await p.evaluate<number>('scrollY'),
                  w: 240,
                  h: 40,
                }),
              ),
              liveForm,
            )
            await p.evaluate(
              `document.querySelector('form').remove();${scroll}`,
            )
            await p.setReducedMotion(false)
            await wait(p, `${active}===2`)
            assert.deepEqual(
              await p.evaluate(
                '[obs.canvases,obs.transfers,obs.workers,obs.contexts.length]',
              ),
              [1, 1, 1, 1],
            )
            const saved = await p.evaluate<string>(`${first}.style.cssText`)
            for (const style of [
              'opacity:.5',
              'transform:translateX(5px)',
              'clip-path:inset(5px)',
              'height:0;min-height:0;padding:0;overflow:hidden',
            ]) {
              await p.evaluate(
                `${first}.style.cssText+=${JSON.stringify(';' + style)}`,
              )
              await wait(p, `!${first}.hasAttribute('data-gpu-painted')`)
              await p.evaluate(
                `${first}.style.cssText=${JSON.stringify(saved)}`,
              )
              await wait(p, `${active}===2`)
            }
            await p.evaluate(
              `${first}.parentElement.style.backgroundColor='white'`,
            )
            await wait(p, `${active}===0`)
            await p.evaluate(
              `${first}.parentElement.style.backgroundColor='';${first}.firstElementChild.style.opacity=0`,
            )
            await wait(
              p,
              `${active}===1 && !${first}.hasAttribute('data-gpu-painted')`,
            )
            await p.evaluate(
              `${first}.firstElementChild.style.opacity='';window.scrollTo(0,0)`,
            )
            await wait(p, `${active}===0`)
            await p.evaluate(paint)
            const frames = await p.evaluate('obs.frames')
            await p.evaluate(paint)
            assert.equal(await p.evaluate('obs.frames'), frames)
            await p.evaluate(scroll)
            await wait(p, `${active}===2`)
            await p.setReducedMotion(true)
          }
        }
        if (
          ['acquire', 'stall', 'loss', 'post', 'slow', 'denied'].includes(mode)
        )
          await wait(p, 'obs.terminated>0 && !document.querySelector("canvas")')
        await p.evaluate(paint)
        assert.equal(requests, 1)
        assert.equal(await p.evaluate('obs.main'), 0)
        if (mode === 'acquire')
          assert.deepEqual(await p.evaluate('obs.contexts'), ['absent'])
        if (mode === 'missing') assert.equal(await p.evaluate('obs.workers'), 0)
        else if (mode === 'transfer' || mode === 'blob')
          assert.equal(await p.evaluate('obs.transfers'), 1)
        else assert.equal(await p.evaluate('obs.workers'), 1)
        if (mode === 'stall') {
          const ms = await p.evaluate<number>('obs.end-obs.start')
          assert.ok(ms >= 1480 && ms < 3000, `${ms} ms`)
        }
      }
      assert.equal(await p.evaluate('obs.urls===obs.revoked'), true)
      if (mode === 'slow') await p.evaluate(`${first}.style.paddingBottom=''`)
      assert.deepEqual(await pixels(p), poster)
      if (mode === 'compose') {
        await p.evaluate(`dispatchEvent(new PageTransitionEvent('pagehide'))`)
        await wait(p, 'obs.terminated===1 && !document.querySelector("canvas")')
        await p.evaluate(built.assets![0].content)
        assert.equal(await p.evaluate('obs.canvases'), 1)
      }
      assert.deepEqual(p.errors, [])
      if (mode === 'slow') {
        assert.deepEqual(await p.evaluate('Object.keys(localStorage)'), [
          'culm:slow:contours-v1',
        ])
        assert.ok(
          await p.evaluate(
            'obs.widths.lastIndexOf(320)>obs.widths.lastIndexOf(640) && obs.widths.lastIndexOf(640)>obs.widths.lastIndexOf(Math.max(...obs.widths))',
          ),
        )
        assert.ok((await p.goto(origin + '/far', 10000)).ok)
        await p.evaluate(probe('next'))
        await p.evaluate(scroll)
        await wait(
          p,
          `performance.getEntriesByName(location.origin+'/_culm/gpu.js').length===1`,
        )
        await p.evaluate(paint)
        assert.equal(await p.evaluate('obs.workers'), 0)
        assert.deepEqual(await pixels(p), poster)
      }
    })
  }
})

test('the real mixed page pays for one host for builtin and checked custom owners; modules remain inert', async t => {
  const doc = await scenes.mixed()
  const registry = createRegistry({
    gpu: {
      enabled: true,
      approvedWasmPlugins: [{ name: 'demo', version: 1 }],
      reviewed: [mist],
    },
  })
  registry.use({
    ...DEMO_PLUGIN,
    effects: [
      {
        ...mist,
        name: 'field',
        tier: 3,
        wasm: { abi: 'field-v1', bytesBase64: 'AAE=' },
      },
    ],
  })
  doc.customEffects = [mist]
  for (const name of ['contours', 'mist', 'field']) {
    doc.pages[0].root.children!.push({
      ...node(name, 'column', [text(name + 'caption', 'Field notes')]),
      motion: { trigger: 'enter-view', gpu: name },
    })
  }
  const c = compilePage(doc, 'home', { registry })
  assert.ok(c.ok)
  assert.deepEqual(c.problems, [])
  assert.deepEqual(
    c.scripts.map(s => s.name),
    ['base', 'states', 'timeline', 'gpuLoader'],
  )
  const host = Buffer.byteLength(c.assets![0].content),
    inline = Buffer.byteLength(c.scripts.map(s => s.code).join(';'))
  assert.equal(c.stats.scriptBytes.gpuHost, host)
  assert.equal(
    Object.values(c.stats.scriptBytes).reduce((a, b) => a + b),
    inline + host,
  )
  assert.equal(host, 9513)
  assert.equal(host + inline, 17429)
  assert.equal(c.html.match(/"builtin":/g)?.length, 1)
  assert.deepEqual(
    [...c.html.matchAll(/ data-gpu-run="([^"]+)"/g)].map(m => m[1]),
    ['1', 'custom', 'custom'],
  )
  assert.doesNotMatch(c.assets![0].content, /readPixels|fetch\(|XMLHttpRequest/)
  t.diagnostic(
    JSON.stringify({ host, inline, shared: inline + host, stats: c.stats }),
  )
})

test('checker-approved GLSL links on a real WebGL2 driver with the typed inputs and opaque wrapper', async t => {
  const fixtures: [string, ShaderSettings][] = [
    [
      sources.contours,
      { speed: { type: 'number', min: 0, max: 2, default: 1 } },
    ],
    [sources.mist, {}],
    [
      'float tone(vec2 p){return texture(u_noise,p).r;} vec4 shade(vec2 uv){vec2 p=(uv+u_pointer)/u_resolution;return vec4(mix(u_set_tint,vec3(tone(p)),clamp(u_scroll,0.0,1.0)),1.0);}',
      { tint: { type: 'color', default: '#123456' } },
    ],
  ]
  for (const [source, settings] of fixtures)
    assert.ok(checkShader(source, settings).ok)
  const b = await openBrowser()
  assert.ok(b.ok)
  t.after(() => b.browser.close())
  const p = await b.browser.newPage()
  t.after(() => p.close())
  // No page host: this independent qualification never draws or admits page programs.
  const results = await p.evaluate<string[]>(`(()=>{
    const gl=new OffscreenCanvas(1,1).getContext('webgl2');if(!gl)return ['no WebGL2'];
    const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,'#version 300 es\\n'+src);gl.compileShader(s);return s};
    const vs=shader(gl.VERTEX_SHADER,'out vec2 uv;void main(){uv=vec2(0.0);gl_Position=vec4(0,0,0,1);}');
    return ${JSON.stringify(fixtures)}.map(([source,settings])=>{
      const uniforms=Object.entries(settings).map(([key,s])=>'uniform '+(s.type==='number'?'float':'vec3')+' u_set_'+key+';').join('');
      const fs=shader(gl.FRAGMENT_SHADER,'precision highp float;in vec2 uv;out vec4 c;uniform float u_time,u_scroll;uniform vec2 u_resolution,u_pointer;uniform sampler2D u_noise;'+uniforms+source+'\\nvoid main(){c=vec4(shade(uv).rgb,1.0);}');
      const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      return gl.getProgramParameter(program,gl.LINK_STATUS)?'linked':gl.getShaderInfoLog(fs)+gl.getProgramInfoLog(program);
    })
  })()`)
  assert.deepEqual(results, Array(fixtures.length).fill('linked'))
})

test('a custom shader ending in a line comment cannot switch off the builtin on the same page', async t => {
  const tail: CustomEffect = {
    name: 'tail',
    source: 'vec4 shade(vec2 uv){return vec4(uv,0.0,1.0);} // end',
    settings: {},
  }
  const registry = createRegistry({ gpu: { enabled: true, reviewed: [tail] } })
  registry.use(starter)
  const doc = await scenes.control()
  doc.customEffects = [tail]
  doc.pages[0].root.children!.unshift(
    ...['contours', 'tail'].map(gpu => ({
      ...node(gpu, 'box', [text(gpu + 'caption', 'Field notes')]),
      style: {
        base: {
          height: { n: 160, unit: 'px' as const },
          bg: '#123456' as const,
        },
      },
      motion: { trigger: 'enter-view' as const, gpu },
    })),
  )
  const c = compilePage(doc, 'home', { registry })
  assert.ok(c.ok, JSON.stringify(c.problems))
  const server = createServer((req, res) => {
    if (req.url === '/_culm/gpu.js')
      res.setHeader('content-type', 'text/javascript').end(c.assets![0].content)
    else if (req.url === '/favicon.ico') res.writeHead(204).end()
    else res.setHeader('content-type', 'text/html').end(c.html)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  t.after(() => b.browser.close())
  const p = await b.browser.newPage()
  t.after(() => p.close())
  await p.unblock()
  await p.setViewport(1280, 900)
  await p.setReducedMotion(false)
  assert.ok(
    (
      await p.goto(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        10000,
      )
    ).ok,
  )
  await wait(p, `${active}===2`)
  assert.deepEqual(p.errors, [])
})
