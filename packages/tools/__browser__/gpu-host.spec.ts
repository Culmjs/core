import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import {
  applySetting,
  compilePage,
  createRegistry,
  insertBlock,
} from '@culmjs/core'
import starter, { STYLES } from '@culmjs/starter'
import { scenes } from '../__tests__/fixtures/motion-scenes.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'
import { DEMO_PLUGIN, node, text } from '../../core/__tests__/kit.ts'
import { mist } from '../__tests__/fixtures/shader.ts'

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
    window.obs={workers:0,urls:0,revoked:0,transfers:0,terminated:0,contexts:[],widths:[],main:0,frames:0,start:0,end:0};
    if(mode==='missing')window.WebGL2RenderingContext=undefined;
    if(mode==='save')Object.defineProperty(navigator.connection,'saveData',{value:true,writable:true});
    if(mode==='denied')Object.defineProperty(window,'localStorage',{get(){throw Error('unavailable')}});
    if(mode==='slow'||mode==='denied'){
      const raf=requestAnimationFrame.bind(window);let t=100;window.interval=mode==='slow'?1:120;
      window.requestAnimationFrame=f=>raf(()=>f(t+=interval))
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
      this.addEventListener('message',e=>{if(e.data?.context){e.stopImmediatePropagation();obs.contexts.push(e.data.context);obs.renderer=e.data.renderer}else if(e.data===1 && !obs.ready)obs.ready=performance.now()-obs.start})
    } postMessage(msg,...args){if(mode==='post')throw Error();if(Array.isArray(msg)){obs.widths.push(msg[0]);obs.frames++}super.postMessage(msg,...args)}
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
  doc.pages[0].root.children!.unshift({
    ...node('spacer', 'box'),
    style: { base: { height: { n: 1800, unit: 'px' } } },
  })
  const far = compilePage(doc, 'home', options)
  assert.ok(far.ok)
  assert.deepEqual(far.problems, [])
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
    else if (req.url === '/favicon.ico') res.writeHead(204).end()
    else
      res
        .setHeader('content-type', 'text/html')
        .end(req.url === '/far' ? far.html : built.html)
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
          `for(const e of document.querySelectorAll('section'))e.style.cssText='height:0;min-height:0;padding:0;overflow:hidden';${scroll}`,
        )
        await p.evaluate(paint)
        assert.equal(requests, 0)
        await p.evaluate(
          `for(const e of document.querySelectorAll('section'))e.style.cssText=''`,
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
        await wait(p, `obs.terminated===1`)
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
            await wait(p, 'obs.terminated===1')
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
            for (const style of [
              'opacity:.5',
              'transform:translateX(5px)',
              'clip-path:inset(5px)',
              'height:0;min-height:0;padding:0;overflow:hidden',
            ]) {
              await p.evaluate(
                `${first}.style.cssText=${JSON.stringify(style)}`,
              )
              await wait(p, `!${first}.hasAttribute('data-gpu-painted')`)
              await p.evaluate(`${first}.style.cssText=''`)
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
          [
            'acquire',
            'stall',
            'loss',
            'post',
            'slow',
            'denied',
            'compose',
            'resize',
          ].includes(mode)
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
        else if (mode !== 'compose')
          assert.equal(await p.evaluate('obs.workers'), 1)
        if (mode === 'stall') {
          const ms = await p.evaluate<number>('obs.end-obs.start')
          assert.ok(ms >= 1480 && ms < 3000, `${ms} ms`)
        }
      }
      assert.equal(await p.evaluate('obs.urls===obs.revoked'), true)
      assert.deepEqual(await pixels(p), poster)
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

test('the real mixed page pays for the entire worker once alongside inert site and module declarations', async t => {
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
  assert.ok(host <= 6144 && host + inline <= 20000)
  assert.equal(c.html.match(/"builtin":/g)?.length, 1)
  assert.doesNotMatch(
    c.assets![0].content,
    /readPixels|fetch\(|WebAssembly|XMLHttpRequest/,
  )
  t.diagnostic(
    JSON.stringify({ host, inline, shared: inline + host, stats: c.stats }),
  )
})
