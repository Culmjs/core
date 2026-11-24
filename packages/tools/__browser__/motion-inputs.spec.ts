import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { buildSync } from 'esbuild'
import {
  compilePage,
  TIMELINE_SCRIPT,
  type Node,
  type Step,
} from '@culmjs/core'
import {
  node,
  text,
  sampleRegistry,
  siteWith,
} from '../../core/__tests__/kit.ts'
import { openBrowser, type Browser, type Page } from '../src/measure/browser.ts'

let browser: Browser
async function launch(executable?: string) {
  const r = await openBrowser({ executable })
  assert.ok(r.ok, JSON.stringify(r))
  return r.browser
}
before(async () => {
  browser = await launch()
})
after(async () => {
  await browser?.close()
})

const fade: Step = {
  target: 'children',
  durationMs: 1000,
  from: { opacity: 0 },
  to: { opacity: 1 },
}
const geometry = `
  html,body{margin:0;scroll-behavior:auto;overflow-anchor:none}
  [data-id=before],[data-id=after]{height:1800px}
  [data-id=panel]{height:900px;display:grid;place-content:center}
  [data-id=gauge]{width:min(80vw,800px);height:8px;transform-origin:left center}
  [data-id=owner]{width:100%}
`
function html(nodes: Node[], css = '') {
  const r = compilePage(siteWith(nodes), 'home', {
    registry: sampleRegistry(),
    mode: 'measure',
  })
  assert.ok(r.ok, JSON.stringify(r.problems))
  return r.html.replace('</head>', `<style>${geometry}${css}</style></head>`)
}
const scrollScene = (owner: Node) => [
  node('before', 'box'),
  owner,
  node('after', 'box'),
]
// The instrumented preview entry differs from the shipped entry only in exposing
// an AbortSignal. All regular fixtures execute the unmodified, priced script.
const preview = buildSync({
  stdin: {
    resolveDir: import.meta.dirname,
    contents: `import {hostMotion} from '../../core/src/scripts/motionHost.ts';
    window.install=()=>hostMotion(document,window,controller.signal); window.controller=new AbortController;install()`,
  },
  bundle: true,
  write: false,
  minify: true,
  target: 'es2017',
}).outputFiles[0].text
const audit = `<script>
  window.get=id=>document.querySelector('[data-id="'+id+'"]');
  const raf=requestAnimationFrame.bind(window);
  window.tick=()=>new Promise(r=>raf(()=>raf(()=>raf(r))));
  window.at=async y=>{scrollTo(0,y);await new Promise(r=>raf(()=>raf(r)));if(scrollY!==y)throw Error('wrong scroll '+scrollY)};
  window.frames=new Set;window.peak=0;window.calls=0;
  window.requestAnimationFrame=f=>{const id=raf(t=>{frames.delete(id);f(t)});
    frames.add(id);peak=Math.max(peak,frames.size);calls++;return id};
  const cancel=cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame=id=>{frames.delete(id);cancel(id)};
  window.storageCalls=0;
  for(const name of ['localStorage','sessionStorage']){
    const d=Object.getOwnPropertyDescriptor(window,name);
    Object.defineProperty(window,name,{...d,get(){storageCalls++;return d.get.call(this)}})
  }
  window.observers=new Set;
  // Count live, signal-bound DOM subscriptions (all input/visibility/media
  // listeners of the preview are installed this way). Exclude our own hooks.
  const listen=EventTarget.prototype.addEventListener;
  window.subs=0;
  EventTarget.prototype.addEventListener=function(k,f,o){
    if(o?.signal&&!o.signal.aborted){subs++;listen.call(o.signal,'abort',()=>subs--,{once:true})}
    return listen.call(this,k,f,o)
  };
  const IO=IntersectionObserver;
  window.IntersectionObserver=class extends IO{
    observe(el){observers.add(this);super.observe(el)}
    disconnect(){observers.delete(this);super.disconnect()}
  };
</script>`
async function fixture(
  source: string,
  run: (page: Page) => Promise<void>,
  {
    width = 1280,
    engine = browser,
    setup = '',
    scripts = true,
    touch = false,
  } = {},
) {
  const page = await engine.newPage()
  const url = 'https://site.culm.invalid/'
  try {
    await page.answer(async u =>
      u === url
        ? {
            type: 'text/html',
            body: source.replace('</head>', `${audit}${setup}</head>`),
          }
        : undefined,
    )
    await page.setViewport(width, 900)
    if (touch) await page.setTouch(true)
    if (!scripts) await page.setScripts(false)
    assert.ok((await page.goto(url, 15000)).ok)
    await run(page)
    if (scripts) assert.equal(await page.evaluate('storageCalls'), 0)
    assert.deepEqual(page.blocked, [])
    assert.deepEqual(page.errors, [])
  } finally {
    await page.close()
  }
}
const near = (actual: number, expected: number, tolerance = 0.05) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} vs ${expected} (±${tolerance})`,
  )

for (const width of [1280, 390])
  test(`frozen orange panel, 2H / H travel, at ${width}×900`, async t => {
    const panel = node('panel', 'box', [
      text('label', 'Waterline'),
      node('gauge', 'box'),
    ])
    const owner = node('owner', 'box', [
      { ...text('hidden', 'Unused'), style: { base: { hidden: true } } },
      panel,
    ])
    // The visible authored child follows both a generated pattern and a hidden sibling.
    owner.props = { pattern: { tile: 'dots', color: 'brand', strength: 20 } }
    owner.motion = {
      trigger: 'scroll',
      pinPx: 900,
      steps: [
        {
          ...fade,
          target: { id: 'gauge' },
          from: { scaleX: 0 },
          to: { scaleX: 1 },
        },
      ],
    }
    await fixture(
      html(scrollScene(owner)),
      async p => {
        const rows = await p.evaluate<number[][]>(`(async()=>{
      const rows=[];for(const y of [1800,2250,2700,2732,2250,1800]){
        await at(y);const line=get('gauge').getBoundingClientRect();
        rows.push([scrollY,get('panel').getBoundingClientRect().top,line.left,line.width])
      }return rows})()`)
        t.diagnostic(JSON.stringify(rows))
        const full = width === 1280 ? 800 : 312
        rows.forEach(([, top, left, w], i) => {
          near(top, i === 3 ? -32 : 0, 2)
          near(left, width === 1280 ? 240 : 39, 2)
          near(w, full * [0, 0.5, 1, 1, 0.5, 0][i], 2)
        })
      },
      { width },
    )
  })

test('short inline pin stays visible for all 500 px and releases outside its original owner box', async () => {
  const label = text('label', 'Reed', {
    props: { level: 'span', runs: [{ text: 'Reed' }] },
  })
  const owner = node('owner', 'box', [label])
  owner.motion = {
    trigger: 'scroll',
    pinPx: 500,
    steps: [
      { ...fade, target: 'self', from: { opacity: 1 }, to: { opacity: 1 } },
    ],
  }
  await fixture(html(scrollScene(owner)), async p => {
    const rows = await p.evaluate<
      number[]
    >(`(async()=>{const rows=[];for(const y of [1800,2050,2300,2332,1925]){
      await at(y); rows.push(get('label').getBoundingClientRect().top)
    }return rows})()`)
    rows.forEach((top, i) => near(top, rows[0] + (i === 3 ? -32 : 0), 2))
  })
})

const drawDoc = () => {
  const path = node('drawing', 'shape')
  path.props = {
    geometry: { type: 'path', d: 'M0 50H100', view: [100, 100] },
    fill: 'none',
    stroke: { color: 'ink', width: 2, dash: [4, 2] },
  }
  const panel = node('panel', 'box', [path])
  const owner = node('owner', 'box', [panel])
  owner.motion = {
    trigger: 'scroll',
    pinPx: 500,
    steps: [
      {
        ...fade,
        target: { id: 'drawing', part: 'path' },
        from: { draw: 0 },
        to: { draw: 1 },
      },
    ],
  }
  return html(scrollScene(owner), '[data-id=drawing]{width:100px;height:100px}')
}
test('a clipped pin paints its visual child through release, with auto or explicit owner height', async () => {
  for (const height of ['auto', '100px']) {
    const panel = node('panel', 'box', [text('label', 'Pinned')])
    const owner = node('owner', 'box', [panel])
    owner.motion = {
      trigger: 'scroll',
      pinPx: 500,
      steps: [
        { ...fade, target: 'self', from: { opacity: 1 }, to: { opacity: 1 } },
      ],
    }
    await fixture(
      html(
        scrollScene(owner),
        `[data-id=owner]{height:${height};overflow:hidden}[data-id=panel]{height:100px}`,
      ),
      async p => {
        for (const y of [2050, 2300, 2332, 1925]) {
          await p.evaluate(`at(${y})`)
          assert.deepEqual(
            await p.evaluate(`[
          get('panel').contains(document.elementFromPoint(10,40)),
          get('after').getBoundingClientRect().top+scrollY]`),
            [true, 2400],
          )
        }
      },
    )
  }
})
test('a resized offscreen fixed-height pin still reserves exactly its travel for later content', async () => {
  const owner = node('owner', 'box', [node('panel', 'box')])
  owner.motion = {
    trigger: 'scroll',
    pinPx: 500,
    steps: [{ ...fade, target: 'self' }],
  }
  await fixture(
    html(scrollScene(owner), '[data-id=owner],[data-id=panel]{height:50vh}'),
    async p => {
      for (const h of [900, 600, 800]) {
        await p.setViewport(1280, h)
        await p.evaluate('tick()')
        assert.equal(
          await p.evaluate(`get('after').getBoundingClientRect().top+scrollY`),
          1800 + h / 2 + 500,
        )
      }
    },
  )
})

test('500 px pin, calibrated direct path, reverse and live preference cleanup', async t => {
  await fixture(drawDoc(), async p => {
    const rows = await p.evaluate<number[][]>(`(async()=>{
      const path=get('drawing').querySelector('path'),rows=[];
      for(const y of [1800,2050,2300,2332,1925]){
        await at(y);const cs=getComputedStyle(path);
        rows.push([get('panel').getBoundingClientRect().top,
          1-parseFloat(cs.strokeDashoffset)/parseFloat(cs.strokeDasharray),
          parseFloat(cs.strokeDasharray)/(path.pathLength.baseVal||path.getTotalLength()),
          get('after').getBoundingClientRect().top+y])
      }return rows})()`)
    t.diagnostic(JSON.stringify(rows))
    rows.forEach(([top, progress, dash, end], i) => {
      near(top, i === 3 ? -32 : 0, 2)
      near(progress, [0, 0.5, 1, 1, 0.25][i])
      near(dash, 1)
      near(end, 3200, 2)
    })
    await p.setScheme('dark')
    await p.setReducedMotion(true)
    await p.evaluate('tick()')
    assert.deepEqual(
      await p.evaluate(`(()=>{
      const el=get('drawing').querySelector('path');return [el.getAnimations().length,
        el.getAttribute('pathLength'),getComputedStyle(el).strokeDasharray,
        get('after').getBoundingClientRect().top+scrollY-2700,observers.size,frames.size]})()`),
      [0, null, '4px, 2px', 0, 0, 0],
    )
    await p.setReducedMotion(false)
    await p.evaluate('tick()')
    assert.deepEqual(
      await p.evaluate(`[matchMedia('(prefers-color-scheme:dark)').matches,
      get('drawing').querySelector('path').getAnimations().length]`),
      [true, 1],
    )
  })
})

test('path drawing respects a pre-calibrated SVG length and restores exact inline dash styles', async () => {
  const source = drawDoc().replace(
    TIMELINE_SCRIPT,
    () => `
    const path=get('drawing').querySelector('path');path.setAttribute('pathLength',25);
    path.style.cssText='stroke-dasharray:3px 7px;stroke-dashoffset:2px';
    window.original=path.outerHTML;${preview}`,
  )
  await fixture(source, async p => {
    await p.evaluate('at(2050)')
    assert.deepEqual(
      await p.evaluate(`(()=>{const p=get('drawing').querySelector('path'),s=getComputedStyle(p);
      const active=[p.getTotalLength(),s.strokeDasharray,s.strokeDashoffset];controller.abort();
      return [...active,p.outerHTML===original,getComputedStyle(p).strokeDasharray]})()`),
      [100, '25px', '12.5px', true, '3px, 7px'],
    )
  })
})

for (const width of [1280, 390])
  test(`frozen one-shot marker at ${width}×900`, async () => {
    const owner = text('marker', 'Reed notches', {
      motion: {
        trigger: 'enter-view',
        steps: [
          {
            ...fade,
            target: 'self',
            from: { xPx: 0 },
            to: { xPx: 500 },
            ease: 'ease-out',
            durationMs: 500,
          },
        ],
      },
    })
    await fixture(
      html(
        scrollScene(owner),
        `html{overflow-x:clip}[data-id=marker]{width:360px;height:48px;margin-left:${width === 390 ? -240 : 24}px}`,
      ),
      async p => {
        const [before, readings, settled, same] = await p.evaluate<
          [number, number[], number, boolean]
        >(`(async()=>{
      const el=get('marker');const before=el.getBoundingClientRect().left;
      await at(1200);const a=el.getAnimations()[0];a.pause();
      const readings=[0,250,500].map(ms=>{a.currentTime=ms;return el.getBoundingClientRect().left});
      a.finish();await at(0);await at(1200);return [before,readings,el.getBoundingClientRect().left,el.getAnimations()[0]===a]
    })()`)
        const start = width === 390 ? -240 : 24
        near(before, start, 2)
        readings.forEach((x, i) => near(x, start + [0, 375, 500][i], 2))
        near(settled, start + 500, 2)
        assert.ok(same)
      },
      { width },
    )
  })

const fallbackDoc = () => {
  const owner = node('owner', 'box', [text('a', 'A'), text('b', 'B')])
  owner.motion = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    steps: [fade],
  }
  return html(scrollScene(owner), '[data-id=owner]{height:300px}')
}
test('a scrollport suppresses only its own native branch; capture nested scroll and resize', async () => {
  const inner = node('owner', 'box', [text('a', 'A')])
  inner.motion = {
    trigger: 'scroll',
    scrollFallback: 'timeline',
    steps: [fade],
  }
  const wrap = node('wrap', 'box', [
    node('before', 'box'),
    inner,
    node('after', 'box'),
  ])
  wrap.style = { base: { overflow: 'scroll-y' } }
  const outside = text('out', 'Outside', {
    motion: {
      trigger: 'scroll',
      scrollFallback: 'timeline',
      steps: [{ ...fade, target: 'self' }],
    },
  })
  await fixture(
    html(
      [outside, wrap],
      '[data-id=before]{height:800px}[data-id=wrap]{height:500px}[data-id=owner]{height:300px}',
    ),
    async p => {
      for (const height of [900, 600]) {
        await p.setViewport(1280, height)
        for (const y of [800, 600]) {
          await p.evaluate(`get('wrap').scrollTop=${y};tick()`)
          const [actual, expected, host, native, eligible] = await p.evaluate<
            [number, number, boolean, boolean, boolean]
          >(`(()=>{
          const r=get('owner').getBoundingClientRect();
          return [+getComputedStyle(get('a')).opacity,(innerHeight-r.top)/(innerHeight+r.height),
          get('a').getAnimations().some(a=>!(a instanceof CSSAnimation)),CSS.supports('animation-timeline:view()'),
          get('out').getAnimations()[0] instanceof CSSAnimation]})()`)
          near(actual, expected)
          assert.ok(host)
          assert.equal(native, eligible)
        }
      }
    },
  )
})
test(
  'optional compat: same unpinned owner in genuine native and WAAPI-only engines',
  {
    skip:
      !process.env.CULM_COMPAT_CHROME &&
      'set CULM_COMPAT_CHROME to a local Chromium lacking view()',
  },
  async t => {
    const compat = await launch(process.env.CULM_COMPAT_CHROME)
    try {
      const source = fallbackDoc(),
        results: number[][] = []
      await fixture(source, first =>
        fixture(
          source,
          async second => {
            const capabilities = `[CSS.supports('animation-timeline:view()'),CSS.supports('animation-timeline:scroll()'),!!Element.prototype.animate]`
            assert.deepEqual(
              await Promise.all(
                [first, second].map(p => p.evaluate(capabilities)),
              ),
              [
                [true, true, true],
                [false, false, true],
              ],
            )
            for (const [p, engine, native] of [
              [first, browser, true],
              [second, compat, false],
            ] as const) {
              const samples = await p.evaluate<
                number[]
              >(`(async()=>{const rows=[];
          for(const y of [900,1200,1500,1800,2100,1200]){await at(y);
            rows.push(+getComputedStyle(get('a')).opacity)}return rows})()`)
              assert.deepEqual(
                await p.evaluate(
                  `get('a').getAnimations().map(a=>a instanceof CSSAnimation)`,
                ),
                [native],
              )
              t.diagnostic(`${engine.version}: ${samples}`)
              samples.forEach((v, i) =>
                near(v, [0, 0.25, 0.5, 0.75, 1, 0.25][i]),
              )
              results.push(samples)
            }
          },
          { engine: compat },
        ),
      )
      results[0].forEach((v, i) => near(v, results[1][i]))
    } finally {
      await compat.close()
    }
  },
)

const pointerDoc = (extra: Node[] = []) => {
  const owner = node('owner', 'box', [text('a', 'A'), text('b', 'B')])
  owner.motion = { trigger: 'pointer-x', steps: [{ ...fade, staggerMs: 500 }] }
  return html(
    [owner, ...extra, node('after', 'box')],
    '[data-id=owner]{width:200px;margin-left:100px}',
  )
}
test('pointer-x seeks two ordered targets on one clock; one frame per burst across owners', async () => {
  const second = text('second', 'Second', {
    motion: {
      trigger: 'scroll',
      steps: [{ ...fade, target: 'self', staggerMs: 1 }],
    },
  })
  const source = pointerDoc([second]).replace(TIMELINE_SCRIPT, () => preview)
  await fixture(source, async p => {
    const result = await p.evaluate(`(async()=>{
      await tick();const o=get('owner'),el=get('a'),rect=o.getBoundingClientRect();
      const move=x=>o.dispatchEvent(new PointerEvent('pointermove',{clientX:x,bubbles:true}));
      const sample=()=>[el,get('b')].map(e=>+getComputedStyle(e).opacity);
      const installed=subs;install();await tick();const duplicate=subs-installed;
      const rows=[];for(const f of [0,.5,1,0]){for(let i=0;i<20;++i){move(rect.left+f*rect.width);dispatchEvent(new Event('scroll'))}
        await tick();rows.push(sample())}
      move(rect.right);controller.abort();const stopped=calls;
      move(rect.left);dispatchEvent(new Event('scroll'));await tick();
      return [rows,peak,duplicate,subs,frames.size,observers.size,document.getAnimations().length,calls-stopped]})()`)
    assert.deepEqual(result, [
      [
        [0, 0],
        [0.75, 0.25],
        [1, 1],
        [0, 0],
      ],
      1,
      0,
      0,
      0,
      0,
      0,
      0,
    ])
  })
})
test('coarse pointer and missing measurement/WAAPI/observer leave the normal layout', async () => {
  await fixture(
    pointerDoc(),
    async p => {
      assert.ok(await p.evaluate(`matchMedia('(pointer:coarse)').matches`))
      await p.evaluate(
        `tick().then(()=>{get('owner').dispatchEvent(new PointerEvent('pointermove',{clientX:1}));return tick()})`,
      )
      assert.deepEqual(
        await p.evaluate(
          `[get('a').getAnimations().length,+getComputedStyle(get('a')).opacity]`,
        ),
        [0, 1],
      )
    },
    { touch: true },
  )
  for (const setup of [
    `Element.prototype.animate=undefined`,
    `window.IntersectionObserver=undefined`,
    `Element.prototype.getBoundingClientRect=undefined`,
    `document.write('<style>[data-id=owner]{width:0!important}</style>')`,
  ])
    await fixture(
      pointerDoc(),
      async p => {
        await p.evaluate(
          `tick().then(()=>{get('owner').dispatchEvent(new PointerEvent('pointermove',{clientX:1}));return tick()})`,
        )
        assert.deepEqual(
          await p.evaluate(
            `[document.getAnimations().length,+getComputedStyle(get('a')).opacity]`,
          ),
          [0, 1],
        )
      },
      { setup: `<script>${setup}</script>` },
    )
})

test('Tab reaches both links in source order, with the pinned enhancement on or scripts disabled', async () => {
  const links = ['first', 'second'].map(id => ({
    ...node(id, 'button'),
    props: { label: id, link: { url: '#' } },
  }))
  const owner = node('owner', 'box', [node('panel', 'box', links)])
  owner.motion = {
    trigger: 'scroll',
    pinPx: 500,
    steps: [{ ...fade, target: { id: 'first' } }],
  }
  for (const scripts of [true, false])
    await fixture(
      html([owner]),
      async p => {
        const focus = () =>
          p.evaluate(`document.activeElement.getAttribute('data-id')`)
        await p.tab()
        assert.equal(await focus(), 'first')
        await p.tab()
        assert.equal(await focus(), 'second')
      },
      { scripts },
    )
})

test(
  'optional compat: a real background tab suspends and resamples on foreground',
  {
    skip:
      !process.env.CULM_COMPAT_CHROME &&
      'set CULM_COMPAT_CHROME to the tabbed compatibility browser',
  },
  async () => {
    const engine = await launch(process.env.CULM_COMPAT_CHROME)
    const timed = text('timed', 'Reading', {
      motion: {
        trigger: 'load',
        steps: [{ ...fade, target: 'self', staggerMs: 1, durationMs: 10000 }],
      },
    })
    try {
      await fixture(
        pointerDoc([timed]),
        async p => {
          await p.evaluate('tick()')
          const other = await engine.newPage()
          try {
            assert.deepEqual(
              await p.evaluate(
                `[document.hidden,get('timed').getAnimations()[0].playState]`,
              ),
              [true, 'paused'],
            )
            assert.deepEqual(
              await p.evaluate(`(()=>{const n=calls;get('owner').dispatchEvent(new PointerEvent('pointermove',{clientX:200}));
          scrollTo(0,5);dispatchEvent(new Event('scroll'));return [frames.size,calls-n]})()`),
              [0, 0],
            )
          } finally {
            await other.close()
          }
          await p.evaluate('tick()')
          assert.deepEqual(
            await p.evaluate(
              `[document.hidden,get('timed').getAnimations()[0].playState,+getComputedStyle(get('a')).opacity]`,
            ),
            [false, 'running', 0.75],
          )
        },
        { engine },
      )
    } finally {
      await engine.close()
    }
  },
)

test('offscreen and hidden time tracks pause; hidden input resamples once on return', async () => {
  const timed = text('timed', 'Timed', {
    motion: {
      trigger: 'load',
      steps: [{ ...fade, target: 'self', durationMs: 10000, staggerMs: 1 }],
    },
  })
  const scroll = text('scroll', 'Scroll', {
    motion: {
      trigger: 'scroll',
      steps: [{ ...fade, target: 'self', staggerMs: 1 }],
    },
  })
  await fixture(html([timed, scroll, node('after', 'box')]), async p => {
    const result = await p.evaluate(`(async()=>{
      await tick();const a=get('timed').getAnimations()[0];
      await at(800);const off=a.playState, t=a.currentTime, n=calls;
      dispatchEvent(new Event('scroll'));await tick();const quiet=a.currentTime===t && calls===n;
      await at(0);const on=a.playState;
      Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
      const hidden=a.playState;await at(10);const reads=calls;
      dispatchEvent(new Event('scroll'));await tick();const suspended=calls===reads;
      delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));await tick();
      const rect=get('scroll').getBoundingClientRect();
      return [off,quiet,on,hidden,suspended,a.playState,+getComputedStyle(get('scroll')).opacity,(900-rect.top)/(900+rect.height)]
    })()`)
    const [off, quiet, on, hidden, suspended, resumed, value, expected] =
      result as [
        string,
        boolean,
        string,
        string,
        boolean,
        string,
        number,
        number,
      ]
    assert.deepEqual(
      [off, quiet, on, hidden, suspended, resumed],
      ['paused', true, 'running', 'paused', true, 'running'],
    )
    near(value, expected)
  })
})

test('a state can reveal an initially zero-sized owner and activate its timeline', async () => {
  const owner = text('owner', 'Shown', {
    state: [{ name: 'mode', values: 'on-off', initial: 'off' }],
    style: {
      base: { hidden: true },
      when: [{ state: 'mode', is: 'on', decl: { hidden: false } }],
    },
    motion: {
      trigger: { state: 'mode', is: 'on' },
      steps: [
        {
          ...fade,
          target: 'self',
          staggerMs: 1,
          from: { opacity: 0.25 },
          to: { opacity: 0.25 },
        },
      ],
    },
  })
  await fixture(html([owner]), async p => {
    assert.deepEqual(
      await p.evaluate(`(async()=>{
      const el=get('owner');await tick();const before=el.getBoundingClientRect().width;
      el.dataset.sMode='on';await tick();return [before,el.getAnimations().length,+getComputedStyle(el).opacity]})()`),
      [0, 1, 0.25],
    )
  })
})

test('when a pointer owner collapses, restore its normal rendering until measurable again', async () => {
  await fixture(pointerDoc(), async p => {
    assert.deepEqual(
      await p.evaluate(`(async()=>{
      const el=get('owner'),a=get('a');await tick();
      el.dispatchEvent(new PointerEvent('pointermove',{clientX:200}));await tick();
      const first=+getComputedStyle(a).opacity;el.style.width='0px';dispatchEvent(new Event('resize'));await tick();
      const zero=[a.getAnimations().length,+getComputedStyle(a).opacity];
      el.style.width='200px';dispatchEvent(new Event('resize'));await tick();
      return [first,zero,+getComputedStyle(a).opacity]})()`),
      [0.75, [0, 1], 0.75],
    )
  })
})
