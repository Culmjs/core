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
  sampleRegistry,
  siteWith,
  text,
} from '../../core/__tests__/kit.ts'
import { openBrowser, type Browser, type Page } from '../src/measure/browser.ts'
import { decodePng } from '../src/measure/png.ts'
import { instrumentedPolicy } from '../__tests__/fixtures/instrumentedPolicy.ts'

let browser: Browser
before(async () => {
  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  browser = b.browser
})
after(() => browser?.close())

const reveal: Step = {
  target: 'letters',
  mask: true,
  staggerMs: 42,
  durationMs: 1000,
  ease: 'expo-out',
  from: { xPercent: 105 },
  to: { xPercent: 0 },
}
const fade: Step = {
  target: 'lines',
  from: { opacity: 0 },
  to: { opacity: 1 },
  durationMs: 100,
  staggerMs: 20,
}
const heading = (s: string, steps = [reveal]) =>
  text('reed', '', {
    props: { level: 'h2', runs: [{ text: s }] },
    motion: { trigger: 'enter-view', steps },
  })
const url = 'https://site.culm.invalid/'
async function fixture(
  nodes: Node[],
  run: (p: Page) => Promise<void>,
  {
    width = 390,
    reduced = false,
    scripts = true,
    setup = '',
    css = '',
    live = false,
    preview = false,
  } = {},
) {
  const r = compilePage(siteWith(nodes), 'home', {
    registry: sampleRegistry(),
    mode: live ? 'live' : 'measure',
  })
  assert.ok(r.ok, JSON.stringify(r.problems))
  const source = preview
    ? r.html.replace(
        TIMELINE_SCRIPT,
        () =>
          buildSync({
            stdin: {
              resolveDir: import.meta.dirname,
              contents: `
      import {hostMotion} from '../../core/src/scripts/motionHost.ts';
      import {splitText} from '../../core/src/scripts/motionText.ts';
      window.split=splitText;window.controller=new AbortController;
      hostMotion(document,window,controller.signal)`,
            },
            bundle: true,
            write: false,
            minify: true,
            target: 'es2017',
          }).outputFiles[0].text,
      )
    : r.html
  const html = source.replace(
    '</head>',
    () => `<style>html,body{margin:0} [data-id=space],[data-id=end]{height:1800px}h2{font:32px/1.2 Arial;margin:0}${css}</style>
    <script>window.tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    window.h=()=>document.querySelector('h2');
    window.tracks=()=>h().getAnimations({subtree:true}).filter(a=>!(a instanceof CSSAnimation));${setup}</script></head>`,
  )
  const p = await browser.newPage()
  try {
    await p.answer(async u =>
      u === url
        ? { type: 'text/html', body: instrumentedPolicy(html) }
        : u === url + 'favicon.ico'
          ? { type: 'image/x-icon', body: '' }
          : undefined,
    )
    await p.setViewport(width, 900)
    await p.setReducedMotion(reduced)
    await p.setScripts(scripts)
    assert.ok((await p.goto(url, 15000)).ok)
    await run(p)
    assert.deepEqual(p.blocked, [])
    assert.deepEqual(p.errors, [])
  } finally {
    await p.close()
  }
}
const near = (a: number, b: number, tolerance: number) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b} (±${tolerance})`)

const byState = (words: string, steps: Step[]) => {
  const h = heading(words, steps)
  h.motion!.trigger = { state: 'mode', is: 'on' }
  h.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  return h
}
const neutral: Step = {
  ...fade,
  target: 'letters',
  from: { opacity: 1 },
  to: { opacity: 1 },
}

test('bidi paint positions survive splitting or static fallback in pure and mixed directional runs', async t => {
  for (const [s, dir] of [
    ['שלום עולם', 'ltr'],
    ['Reed (אבג) 42', 'ltr'],
    ['שלום A12 • עולם', 'rtl'],
  ]) {
    await fixture(
      [byState(s, [neutral])],
      async p => {
        const read = () =>
          p.evaluate<number[]>(`(()=>{
        const r=document.createRange(),w=document.createTreeWalker(h(),4),xs=[];
        for(let n;n=w.nextNode();)for(const {index,segment} of new Intl.Segmenter().segment(n.data)){
          if(!segment.trim())continue;r.setStart(n,index);r.setEnd(n,index+segment.length);xs.push(r.getBoundingClientRect().left)
        }return xs})()`)
        const before = await read()
        await p.evaluate(
          `window.original=h().firstChild;h().dataset.sMode='on';tick()`,
        )
        const after = await read()
        t.diagnostic(JSON.stringify({ s, dir, before, after }))
        assert.equal(after.length, before.length)
        after.forEach((x, i) => near(x, before[i], 1))
        assert.deepEqual(await p.names('heading'), [s])
        await p.evaluate(`h().dataset.sMode='off';tick()`)
        assert.equal(await p.evaluate('h().firstChild===original'), true)
      },
      { css: `h2{direction:${dir}}` },
    )
  }
})

test('decoration paint and focused link identity survive direct and propagated underlines', async t => {
  for (const [sel, mask] of [
    ['h2 a', false],
    ['h2', false],
    ['h2 a', true],
  ] as const) {
    const h = byState('', [{ ...neutral, mask }])
    h.props = {
      level: 'h2',
      runs: [{ text: 'Reed Ledger', link: { url: '#reed' } }],
    }
    await fixture(
      [h],
      async p => {
        await p.tab()
        await p.evaluate('window.link=h().querySelector("a")')
        const ink = async () => {
          const img = decodePng(
            await p.screenshot({ x: 0, y: 0, w: 390, h: 60 }),
          )
          let n = 0
          for (let i = 0; i < img.rgba.length; i += 4)
            if (
              img.rgba[i] > 180 &&
              img.rgba[i + 1] < 70 &&
              img.rgba[i + 2] < 70
            )
              n++
          return n
        }
        const counts = []
        for (const mode of ['off', 'on', 'off']) {
          await p.evaluate(`h().dataset.sMode='${mode}';tick()`)
          assert.deepEqual(
            await p.evaluate(
              `[document.activeElement===link,h().querySelector('a')===link,link.hash]`,
            ),
            [true, true, '#w-reed'],
          )
          assert.deepEqual(await p.names('link'), ['Reed Ledger'])
          counts.push(await ink())
        }
        t.diagnostic(JSON.stringify({ sel, mask, counts }))
        assert.ok(counts[0] > 300)
        near(counts[1], counts[0], counts[0] * 0.05)
        assert.equal(counts[2], counts[0])
      },
      {
        css: `h2 a{color:black;text-decoration:none;outline:none}${sel}{text-decoration:underline solid red 3px;text-underline-offset:2px}`,
      },
    )
  }
})

test('reflow retains fixed effect order and retimes its onset after changing line count', async t => {
  for (const settled of [false, true]) {
    const child = byState('Reed ledger for the waterline', [
      { ...fade, target: settled ? 'letters' : 'lines', staggerMs: 80 },
      {
        ...fade,
        target: 'self',
        from: { opacity: 0.4 },
        to: { opacity: 0.4 },
        durationMs: 1000,
      },
    ])
    child.motion!.trigger = 'load'
    const box = node('box', 'box', [child])
    box.state = child.state
    delete child.state
    box.motion = {
      trigger: { state: 'mode', is: 'on' },
      steps: [
        {
          ...fade,
          target: { id: 'reed' },
          from: { opacity: 0.8 },
          to: { opacity: 0.8 },
        },
        { ...fade, target: 'self' },
      ],
    }
    await fixture([box], async p => {
      await p.evaluate(`(async()=>{await tick();window.fixed=h().getAnimations()[0];
      tracks().forEach(a=>${settled ? 'a.finish()' : 'a.currentTime=650'});window.box=h().parentElement;box.dataset.sMode='on';await tick()})()`)
      const read = () =>
        p.evaluate<
          number[]
        >(`[+getComputedStyle(h()).opacity,+h().getAnimations().includes(fixed),
      fixed.effect.getTiming().delay,Number(fixed.currentTime),tracks().filter(a=>a.effect.target!==h()).length]`)
      const before = await read()
      await p.setViewport(settled ? 300 : 220, 900)
      await p.evaluate('tick()')
      const during = await read()
      await p.evaluate(`box.dataset.sMode='off';tick()`)
      const after = await read()
      t.diagnostic(JSON.stringify({ before, during, after }))
      near(before[0], 0.8, 0.001)
      near(during[0], 0.8, 0.001)
      near(after[0], 0.4, 0.001)
      assert.equal(during[1], 1)
      assert.ok(during[3] >= before[3])
      if (settled) assert.equal(await p.evaluate('fixed.playState'), 'finished')
      else {
        assert.ok(during[2] > before[2])
        assert.ok(during[4] > before[4])
      }
    })
  }
})

const retryAudit = `window.watches=new Set;window.attempts=0;
    const walk=document.createTreeWalker.bind(document);document.createTreeWalker=(...args)=>{attempts++;return walk(...args)};
    window.ResizeObserver=class extends ResizeObserver{observe(e){watches.add(this);super.observe(e)}disconnect(){watches.delete(this);super.disconnect()}}`

test('wrap fallback retries on metric changes only and releases watches on reduce and abort', async t => {
  const h = byState('waterlogged reeds', [fade])
  await fixture(
    [h],
    async p => {
      await p.evaluate(
        `window.original=h().firstChild;h().dataset.sMode='on';tick()`,
      )
      const snap = () =>
        p.evaluate<number[]>(
          `[tracks().length,h().childElementCount,+(h().firstChild===original),watches.size,attempts]`,
        )
      const samples = [await snap()]
      for (const w of [68, 390, 68]) {
        await p.setViewport(w, 900)
        await p.evaluate('tick()')
        samples.push(await snap())
        const work = await p.evaluate('attempts')
        await p.evaluate(`tick().then(tick)`)
        assert.equal(await p.evaluate('attempts'), work)
      }
      t.diagnostic(JSON.stringify(samples))
      assert.deepEqual(
        samples.map(r => r[0]),
        [1, 0, 1, 0],
      )
      assert.deepEqual(samples[1].slice(1, 3), [0, 1])
      await p.setReducedMotion(true)
      await p.evaluate('tick()')
      assert.equal((await snap())[3], 0)
      await p.setReducedMotion(false)
      await p.evaluate('tick()')
      await p.evaluate('controller.abort()')
      const last = await snap()
      await p.setViewport(390, 900)
      await p.evaluate(
        `document.fonts.dispatchEvent(new Event('loadingdone'));tick()`,
      )
      assert.deepEqual(last.slice(0, 4), [0, 0, 1, 0])
      assert.deepEqual(await snap(), last)
    },
    {
      preview: true,
      css: 'h2{overflow-wrap:anywhere}',
      setup: retryAudit,
    },
  )
})

test('settled entrance survives a reduced-motion remount that initially refuses the split', async t => {
  await fixture(
    [
      node('space', 'box'),
      heading('waterlogged reeds', [fade]),
      node('end', 'box'),
    ],
    async p => {
      await p.evaluate(`window.original=h().firstChild;
        window.sample=()=>{const a=tracks()[0];return a?[a.playState,a.currentTime,+getComputedStyle(a.effect.target).opacity]:null};
        scrollTo(0,1200);tick()`)
      await p.evaluate(`tracks()[0].finished.then(()=>true)`)
      const settled = ['finished', 100, 1]
      assert.deepEqual(await p.evaluate('sample()'), settled)
      const staticDom = () =>
        p.evaluate(
          `[tracks().length,h().childElementCount,h().firstChild===original,h().textContent,getComputedStyle(h()).opacity]`,
        )
      const originalDom = [0, 0, true, 'waterlogged reeds', '1']
      await p.setReducedMotion(true)
      await p.evaluate('tick()')
      assert.deepEqual(await staticDom(), originalDom)
      await p.setViewport(68, 900)
      await p.setReducedMotion(false)
      await p.evaluate('tick()')
      assert.deepEqual(await staticDom(), originalDom)
      // Sample in the mutation microtask of the first successful acquisition,
      // before a fresh entrance could play through to a misleading final frame.
      await p.evaluate(`window.first=null;const observer=new MutationObserver(()=>{
        if(tracks().length){window.recovered=tracks()[0];window.first=sample();observer.disconnect()}
      });observer.observe(h(),{childList:true,subtree:true})`)
      await p.setViewport(390, 900)
      await p.evaluate('tick()')
      const first = await p.evaluate('first')
      t.diagnostic(JSON.stringify({ first }))
      assert.deepEqual(first, settled)
      await p.evaluate(
        `(async()=>{scrollTo(0,0);await tick();scrollTo(0,1200);await tick()})()`,
      )
      assert.deepEqual(
        await p.evaluate(`[tracks()[0]===recovered,sample(),h().textContent]`),
        [true, settled, 'waterlogged reeds'],
      )
      await p.setReducedMotion(true)
      await p.evaluate('tick()')
      assert.deepEqual(await staticDom(), originalDom)
    },
    { css: 'h2{overflow-wrap:anywhere}' },
  )
})

test('a refused inline split sleeps at native width and retries once per real resize', async t => {
  const reed = byState('שלום עולם', [
    neutral,
    { ...fade, target: 'self', from: { xPx: 0 }, to: { xPx: 40 } },
  ])
  reed.props!.level = 'span'
  for (const preview of [false, true])
    await fixture(
      [node('shell', 'box', [reed])],
      async p => {
        await p.evaluate(
          `window.original=h().firstChild;h().dataset.sMode='on'`,
        )
        const idle = () =>
          p.evaluate<
            number[]
          >(`(async()=>{const samples=[];for(let i=1;i<=34;i++){
      await new Promise(requestAnimationFrame);if([4,19,34].includes(i))samples.push(attempts)
    }return samples})()`)
        const counts = await idle()
        t.diagnostic(JSON.stringify({ preview, counts }))
        assert.deepEqual(counts, [1, 1, 1])
        const state = () =>
          p.evaluate(`[getComputedStyle(h()).display,h().clientWidth,h().firstChild===original,
      h().childElementCount,h().hasAttribute('data-cm-on'),tracks().length,watches.size,attempts]`)
        const expected = ['inline', 0, true, 0, false, 0]
        // Text metrics and the self-x scene's neutral layout each have a watch.
        assert.deepEqual(await state(), [...expected, 2, 1])
        await p.setViewport(300, 900)
        assert.deepEqual(await idle(), [2, 2, 2])
        await p.setReducedMotion(true)
        await p.evaluate('tick()')
        await p.setViewport(390, 900)
        await p.evaluate('tick()')
        assert.deepEqual(await state(), [...expected, 0, 2])
        if (preview) {
          await p.setReducedMotion(false)
          await p.evaluate('tick()')
          assert.deepEqual(await state(), [...expected, 2, 3])
          await p.evaluate('controller.abort()')
          await p.setViewport(300, 900)
          await p.evaluate(
            `document.fonts.dispatchEvent(new Event('loadingdone'));tick()`,
          )
          assert.deepEqual(await state(), [...expected, 0, 3])
        }
      },
      {
        preview,
        css: '[data-id=shell]{display:block;direction:ltr}',
        setup: `${retryAudit};window.h=()=>document.querySelector('[data-id=reed]')`,
      },
    )
})

for (const width of [1280, 390])
  test(`actual masked effect11 trajectory at ${width}×900`, async t => {
    const space = {
      ...node('space', 'box'),
      style: { base: { height: { n: 1800, unit: 'px' as const } } },
    }
    await fixture(
      [space, heading('Reed Ledger'), { ...space, id: 'end' }],
      async p => {
        assert.equal(await p.evaluate(`h().childElementCount`), 0)
        await p.evaluate(`scrollTo(0,910);tick()`)
        const result = await p.evaluate<{
          glyphs: string[]
          clipped: boolean[]
          delays: number[]
          starts: number
          ends: number[]
          rows: number[][]
          onsets: number[]
          widths: number[]
          tops: number[]
        }>(`(async()=>{
      const aa=tracks();await Promise.all(aa.map(a=>a.ready));
      const el=aa.map(a=>a.effect.target), box=e=>e.getBoundingClientRect(), masks=el.map(e=>e.parentElement);
      const read=ms=>{aa.forEach(a=>{a.pause();a.currentTime=ms});return el.map((e,i)=>(box(e).left-box(masks[i]).left)/box(e).width)};
      const starts=new Set(aa.map(a=>a.startTime)).size;
      const rows=[0,100,500,1378].map(read);
      const frames=Array.from({length:26},(_,i)=>read(i*1000/60));
      return {starts,rows,delays:aa.map(a=>a.effect.getTiming().delay),ends:aa.map(a=>a.effect.getComputedTiming().endTime),
        widths:masks.map(e=>box(e).width),tops:masks.map(e=>box(e).top),
        glyphs:el.map(e=>e.textContent),clipped:masks.map(m=>getComputedStyle(m).overflowX==='hidden'),
        onsets:el.map((_,i)=>frames.findIndex(f=>f[i]<1.049))}})()`)
        t.diagnostic(`${browser.version} ${JSON.stringify(result)}`)
        assert.equal(result.glyphs.join(''), 'ReedLedger')
        assert.ok(result.clipped.every(Boolean))
        assert.equal(new Set(result.tops).size, 1)
        assert.ok(new Set(result.widths).size > 1)
        assert.equal(result.starts, 1)
        assert.deepEqual(
          result.delays,
          result.glyphs.map((_, i) => i * 42),
        )
        assert.equal(Math.max(...result.ends), 1378)
        const expected = [
          [1.05, 1.05, 1.05, 1.05, 1.05],
          [0.525, 0.70241, 0.93978, 1.05, 1.05],
          [0.03281, 0.0439, 0.05874, 0.07858, 0.45075],
          [0, 0, 0, 0, 0],
        ]
        for (const [j, row] of result.rows.entries())
          for (const [k, i] of [0, 1, 2, 3, 9].entries())
            near(row[i], expected[j][k], 0.05)
        result.rows[3].forEach(v => near(v, 0, 0.001))
        result.onsets.forEach((v, i) =>
          near(v, [1, 3, 6, 8, 11, 13, 16, 18, 21, 23][i], 1),
        )
      },
      { width, live: true },
    )
  })

test('public groups/restore and preview abort keep the original nodes even with queued reflow', async () => {
  const h = heading('Cafe\u0301 👩‍🚀')
  h.motion!.trigger = { state: 'mode', is: 'on' }
  h.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  await fixture(
    [h],
    async p => {
      assert.deepEqual(
        await p.evaluate(`(async()=>{
      const n=h().firstChild,out=[];
      for(const unit of ['letters','words','lines']){
        const s=split(h(),unit,true);out.push(s.groups.map(g=>g.map(e=>e.textContent)));
        s.restore();s.restore();if(h().firstChild!==n)throw Error('lost original node')
      }
      h().dataset.sMode='on';await tick();out.push(tracks().length);
      h().style.width='300px';document.fonts.dispatchEvent(new Event('loadingdone'));
      controller.abort();await tick();
      return [...out,h().firstChild===n,h().childElementCount,tracks().length]})()`),
        [
          [['C'], ['a'], ['f'], ['e\u0301'], ['👩‍🚀']],
          [['Cafe\u0301'], ['👩‍🚀']],
          [['Cafe\u0301 👩‍🚀']],
          5,
          true,
          0,
          0,
        ],
      )
    },
    { preview: true },
  )
})

test('rich text keeps native names, links, whitespace, visual lines and original nodes through active reflow and replay', async t => {
  const h = heading('', [
    fade,
    { ...reveal, from: { opacity: 0.5 }, to: { opacity: 1 } },
  ])
  h.motion!.trigger = { state: 'mode', is: 'on' }
  h.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  h.props = {
    level: 'h2',
    runs: [
      { text: 'Cafe\u0301 👩‍🚀  starts the ' },
      { text: 'weekly ledger', link: { url: '#reed' } },
      { text: ' with many quiet reeds', style: { italic: true } },
      { br: true },
      { text: 'Next entry' },
    ],
  }
  const next = text('next', '', {
    props: { level: 'p', runs: [{ text: 'After', link: { url: '#next' } }] },
  })
  await fixture([h, next], async p => {
    const ax = async () => [await p.names('heading'), await p.names('link')]
    const baseline = await ax()
    assert.ok(
      baseline[0].some(name =>
        name.includes('Cafe\u0301 👩‍🚀 starts the weekly ledger'),
      ),
    )
    assert.deepEqual(baseline[1], ['weekly ledger', 'After'])
    await p.evaluate(
      `window.orig=h().innerHTML;window.content=h().textContent;window.link=h().querySelector('a');window.old=[...h().childNodes];`,
    )
    // Independent visual read of the actually rendered characters, before
    // enhancement and at its neutral geometry (these particular tracks fade).
    const rows = () =>
      p.evaluate<string[]>(`(()=>{
      const walker=document.createTreeWalker(h(),4),r=document.createRange(),rows=[];
      let top;for(let n;n=walker.nextNode();){
        for(const {segment,index} of new Intl.Segmenter().segment(n.data)){
          if(!segment.trim())continue;
          r.setStart(n,index);r.setEnd(n,index+segment.length);
          const y=r.getBoundingClientRect().top;
          if(top===undefined||Math.abs(y-top)>4)rows.push('');
          top=y;rows[rows.length-1]+=segment;
        }
      }return rows})()`)
    const originalRows = await rows()
    const tabOrder = async () => {
      await p.tab()
      assert.equal(await p.evaluate(`document.activeElement===link`), true)
      await p.tab()
      assert.equal(await p.evaluate(`document.activeElement.hash`), '#w-next')
      // Start a fresh sequential navigation at the top of the document.
      await p.evaluate(`h().tabIndex=-1;h().focus()`)
    }
    await tabOrder()
    const lines = async () =>
      p.evaluate<number[]>(
        `[...new Set(tracks().filter(a=>a.effect.getTiming().duration===100).map(a=>a.effect.getTiming().delay))]`,
      )
    const activate = () => p.evaluate(`h().dataset.sMode='on';tick()`)
    await activate()
    const phone = await lines()
    assert.ok(phone.length > 2, JSON.stringify(phone))
    assert.deepEqual(await rows(), originalRows)
    const members = await p.evaluate<string[]>(
      `tracks().filter(a=>a.effect.getTiming().duration===1000).map(a=>a.effect.target.textContent)`,
    )
    assert.ok(members.includes('e\u0301') && members.includes('👩‍🚀'))
    assert.deepEqual(await ax(), baseline)
    assert.deepEqual(
      await p.evaluate(
        `[h().textContent===content,h().querySelector('a')===link,link.hash,link.closest('[aria-hidden=true]')===null]`,
      ),
      [true, true, '#w-reed', true],
    )
    await tabOrder()
    await p.evaluate('tracks().forEach(a=>a.currentTime=650)')
    await p.setViewport(1280, 900)
    await p.evaluate('tick()')
    const desktop = await lines()
    assert.equal(desktop.length, 2)
    assert.ok(
      await p.evaluate(`Math.max(...tracks().map(a=>a.currentTime))>=650`),
    )
    assert.ok(phone.length > desktop.length)
    const count = await p.evaluate(`h().querySelectorAll('*').length`)
    // Reflow inside the same viewport, then a font change at constant width.
    await p.evaluate(`h().style.width='390px';tick()`)
    assert.deepEqual(await lines(), phone)
    await p.evaluate(`h().style.fontSize='16px';tick()`)
    assert.ok((await lines()).length < phone.length)
    await p.evaluate(`h().removeAttribute('style');tick()`)
    assert.equal(await p.evaluate(`h().querySelectorAll('*').length`), count)
    for (const action of ['off', 'reduce']) {
      if (action === 'off') await p.evaluate(`h().dataset.sMode='off';tick()`)
      else {
        await p.setReducedMotion(true)
        await p.evaluate('tick()')
      }
      assert.deepEqual(
        await p.evaluate(
          `[h().innerHTML===orig,old.every((n,i)=>n===h().childNodes[i]),tracks().length]`,
        ),
        [true, true, 0],
      )
      assert.deepEqual(await ax(), baseline)
      await tabOrder()
      if (action === 'off') await activate()
    }
    t.diagnostic(
      JSON.stringify({
        baseline,
        phone,
        desktop,
        originalRows,
        members: members.length,
      }),
    )
  })
})

test('each mask clips only its requested block; releasing and reacquiring rebuilds one set of members', async () => {
  const h = heading('Reed', [
    { ...reveal, ease: 'linear', staggerMs: 0, durationMs: 100 },
    {
      ...reveal,
      mask: false,
      durationMs: 100,
      staggerMs: 0,
      from: { xPx: 20 },
      to: { xPx: 40 },
    },
  ])
  h.motion!.trigger = 'press'
  await fixture([h], async p => {
    const sample = () =>
      p.evaluate(`(async()=>{
      h().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));await tick();
      const aa=tracks();const e=aa.find(a=>a.effect.target.textContent==='R').effect.target;
      const rows=[50,150,50].map(t=>{aa.forEach(a=>{a.pause();a.currentTime=t});return getComputedStyle(e.parentElement).overflowX});
      h().dispatchEvent(new KeyboardEvent('keyup',{key:'Enter'}));return [...rows,h().innerHTML]})()`)
    for (let i = 0; i < 2; i++)
      assert.deepEqual(await sample(), ['hidden', 'visible', 'hidden', 'Reed'])
  })
})

test('two owners compete for the actual page cap, including stationary masks; exact fit is accepted', async t => {
  const h = heading('Reed Ledger')
  h.motion!.trigger = { state: 'mode', is: 'on' }
  h.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  const other = { ...h, id: 'second' }
  await fixture([h, other], async p => {
    const result = await p.evaluate<number[]>(`(async()=>{
      const second=document.querySelector('[data-id=second]'), count=()=>document.getElementsByTagName('*').length;
      const before=count();h().dataset.sMode='on';await tick();const cost=count()-before;
      h().dataset.sMode='off';await tick();
      for(let i=0,n=2000-before-cost;i<n;i++)document.head.append(document.createElement('meta'));
      h().dataset.sMode='on';second.dataset.sMode='on';await tick();
      return [cost,count(),tracks().length,second.childElementCount]})()`)
    assert.ok(result[0] >= 20)
    t.diagnostic(
      JSON.stringify({ addedElements: result[0], pageElements: result[1] }),
    )
    assert.deepEqual(result.slice(1), [2000, 10, 0])
  })
})

test('a scoped fixed target and an independently split heading retain their effects through state replay', async () => {
  const h = heading('Reed Ledger', [
    reveal,
    { ...fade, target: 'self', from: { scale: 1 }, to: { scale: 2 } },
  ])
  h.motion!.trigger = 'load'
  const box = node('box', 'box', [h, text('still', 'Still')])
  box.state = [{ name: 'mode', values: 'on-off', initial: 'off' }]
  box.motion = {
    trigger: { state: 'mode', is: 'on' },
    steps: [
      { ...fade, target: { id: 'reed' }, from: { yPx: 0 }, to: { yPx: 60 } },
      { ...fade, target: 'self', from: { opacity: 1 }, to: { opacity: 1 } },
    ],
  }
  await fixture([box], async p => {
    assert.deepEqual(
      await p.evaluate(`(async()=>{
      await tick();const original=tracks().find(a=>a.effect.target.textContent==='R');
      const b=document.querySelector('[data-id=box]'),still=document.querySelector('[data-id=still]'),out=[];
      for(const mode of ['on','off','on']){
        b.dataset.sMode=mode;await tick();
        const fixed=h().getAnimations().find(a=>a.effect.getKeyframes().some(f=>f.translate));
        if(fixed){fixed.pause();fixed.currentTime=50}
        out.push([getComputedStyle(h()).translate,tracks().includes(original),still.getAnimations().length]);
      }return out})()`),
      [
        ['0px 30px', true, 0],
        ['none', true, 0],
        ['0px 30px', true, 0],
      ],
    )
  })
})

test('mixed word/letter/fixed blocks share a reversible full clock without double-adding repeated axes', async () => {
  const x = (target: Step['target'], from: number, to: number): Step => ({
    target,
    from: { xPx: from },
    to: { xPx: to },
    durationMs: 100,
  })
  const h = heading('AB CD', [
    { ...x('letters', 0, 10), staggerMs: 10 },
    { ...x('words', 0, 20), staggerMs: 20 },
    x('self', 0, 30),
    { ...x('letters', 20, 40), delayMs: 50 },
  ])
  h.motion!.trigger = 'pointer-x'
  await fixture(
    [h],
    async p => {
      const rows = await p.evaluate<number[][]>(`(async()=>{
      const out=[];await tick();for(const time of [130,250,350,400,450,500,250]){
        const r=h().getBoundingClientRect();
        h().dispatchEvent(new PointerEvent('pointermove',{clientX:(time/500)*390,pointerType:'mouse'}));await tick();
        const m=tracks().map(a=>a.effect.target),sample=e=>parseFloat(getComputedStyle(e).translate)||0;
        out.push([Number(tracks()[0]?.currentTime), sample(h()),sample(m.find(e=>e.textContent==='AB')),sample(m.find(e=>e.textContent==='A'))]);
      }return out})()`)
      const expected = [
        [130, 0, 0, 10],
        [250, 0, 20, 10],
        [350, 30, 20, 10],
        [400, 30, 20, 20],
        [450, 30, 20, 30],
        [500, 30, 20, 40],
        [250, 0, 20, 10],
      ]
      rows.forEach((row, i) =>
        row.forEach((v, j) => near(v, expected[i][j], 1.5)),
      )
    },
    { css: 'h2{width:390px}' },
  )
})

for (const mode of ['long', 'page', 'segmenter', 'reduced', 'js-off'])
  test(`static split fallback: ${mode}`, async () => {
    const s = mode === 'long' ? 'a'.repeat(2001) : 'Reed Ledger'
    const h = heading(s)
    h.motion!.trigger = 'load'
    await fixture(
      [h],
      async p => {
        if (mode !== 'js-off')
          await p.evaluate('document.fonts.ready.then(tick)')
        assert.deepEqual(
          await p.evaluate(
            `(()=>{const h=document.querySelector('h2');return [h.textContent,h.childElementCount,h.getAnimations({subtree:true}).length]})()`,
          ),
          [s, 0, 0],
        )
      },
      {
        scripts: mode !== 'js-off',
        reduced: mode === 'reduced',
        setup:
          mode === 'segmenter'
            ? 'Intl.Segmenter=undefined'
            : mode === 'page'
              ? `for(let i=0;i<1980;i++)document.head.append(document.createElement('meta'))`
              : '',
      },
    )
  })

test('letter boxes cannot break contextual shaping or bisect a grapheme across styled runs', async () => {
  for (const runs of [
    [{ text: 'سلام' }],
    [{ text: 'Cafe' }, { text: '\u0301', style: { italic: true } }],
  ]) {
    const h = heading('')
    h.props = { level: 'h2', runs }
    h.motion!.trigger = 'load'
    await fixture([h], async p => {
      await p.evaluate('tick()')
      assert.deepEqual(await p.evaluate(`[h().textContent,tracks().length]`), [
        runs.map(r => r.text).join(''),
        0,
      ])
    })
  }
})
