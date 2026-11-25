import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import {
  BUDGETS,
  compilePage,
  compileSite,
  compileSubtree,
  createRegistry,
  memoryStore,
  type SiteDocument,
} from '@culmjs/core'
import { createMcpServer } from '@culmjs/tools'
import { openBrowser, type Browser, type Page } from '../src/measure/browser.ts'
import { scenes } from '../__tests__/fixtures/motion-scenes.ts'
import { connectClient } from '../__tests__/mcp/serve.ts'

// Offline observations transcribed from docs/motion/references.md (not from
// the compiler or its easing functions). Compare viewport geometry in live HTML.
const registry = createRegistry()
const capture = process.env.CULM_MOTION_FRAMES
let browser: Browser
before(async () => {
  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  browser = b.browser
  if (capture) await mkdir(capture, { recursive: true })
})
after(() => browser?.close())

function compiled(doc: SiteDocument, mode: 'live' | 'edit' = 'live') {
  const r = compilePage(doc, 'home', { registry, mode })
  assert.ok(r.ok, JSON.stringify(r.problems))
  assert.deepEqual(r.problems, [])
  return r
}
async function visit(
  scene: keyof typeof scenes,
  width: number,
  run: (p: Page) => Promise<void>,
  fallback?: 'reduced' | 'off',
  engine = browser,
) {
  const { html } = compiled(await scenes[scene]())
  const p = await engine.newPage()
  const url = 'https://site.culm.invalid/'
  try {
    await p.setViewport(width, 900)
    await p.setReducedMotion(fallback === 'reduced')
    await p.setScripts(fallback !== 'off')
    await p.answer(async u =>
      u === url ? { type: 'text/html', body: html } : undefined,
    )
    assert.ok((await p.goto(url, 15000)).ok)
    await run(p)
    assert.deepEqual(p.blocked, [])
    assert.deepEqual(p.errors, [])
  } finally {
    await p.close()
  }
}
const at = async (p: Page, y: number) => {
  await p.evaluate(
    `scrollTo(0,${y});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))`,
  )
  assert.equal(await p.evaluate('scrollY'), y)
}
const frame = async (p: Page, name: string) => {
  if (capture)
    await writeFile(join(capture, name + '.png'), await p.screenshot())
}
const near = (a: number, b: number, tolerance: number, sample: string) =>
  assert.ok(
    Math.abs(a - b) <= tolerance,
    `${sample}: observed ${a}, reference ${b} ±${tolerance}`,
  )
const plate = `document.getElementById('w-plate')`
const seek = (p: Page, ms: number) =>
  p.evaluate(
    `for(const a of document.getAnimations()){a.pause();a.currentTime=${ms}}`,
  )

for (const width of [1280, 390]) {
  test(`public marker / ${width}×900: crossing, eased trip and re-entry`, async t => {
    await visit('box', width, async p => {
      const start = width === 1280 ? 24 : -240
      const sample = () =>
        p.evaluate<number[]>(
          `(()=>{const el=${plate},r=el.getBoundingClientRect();return [parseFloat(getComputedStyle(el).translate)||0,r.left,r.width,r.height]})()`,
        )
      await at(p, 899)
      assert.deepEqual(await sample(), [0, start, 360, 48])
      assert.equal(await p.evaluate(`${plate}.getAnimations().length`), 0)
      await at(p, 900)
      assert.equal(await p.evaluate(`${plate}.getAnimations().length`), 1)
      assert.equal(
        await p.evaluate(
          `${plate}.getAnimations()[0].effect.getComputedTiming().endTime`,
        ),
        500,
      )
      await at(p, 1200)
      for (const [ms, dx] of [
        [0, 0],
        [250, 375],
        [500, 500],
      ]) {
        await seek(p, ms)
        const [x, left] = await sample()
        near(x, dx, 2, `${ms} ms translation`)
        near(left, start + dx, 2, `${ms} ms left`)
        t.diagnostic(`${ms} ms: ${x} / ${left}`)
        await frame(p, `box-${width}-${ms}ms`)
      }
      await p.evaluate(
        `(async()=>{const a=${plate}.getAnimations()[0];a.currentTime=499;a.play();await a.finished})()`,
      )
      await at(p, 0)
      await at(p, 1200)
      const [x, left] = await sample()
      near(x, 500, 2, 'second crossing translation')
      near(left, start + 500, 2, 'second crossing left')
      t.diagnostic(`second crossing: ${x} / ${left}`)
    })
  })
  test(`public Waterline / ${width}×900: pin, release and reverse`, async t => {
    await visit('panel', width, async p => {
      const full = width === 1280 ? 800 : 312
      for (const [i, y] of [1800, 2250, 2700, 2732, 2250, 1800].entries()) {
        await at(p, y)
        const [top, left, w, h] = await p.evaluate<number[]>(
          `(()=>{const panel=document.querySelector('article'),r=panel.lastElementChild.getBoundingClientRect();return [panel.getBoundingClientRect().top,r.left,r.width,r.height]})()`,
        )
        const progress = [0, 0.5, 1, 1, 0.5, 0][i]
        near(top, i === 3 ? -32 : 0, 2, `stop ${i} top`)
        near(left, width === 1280 ? 240 : 39, 2, `stop ${i} left`)
        near(w, full * progress, 2, `stop ${i} width`)
        near(w / full, progress, 0.05, `stop ${i} progress`)
        assert.equal(h, 8)
        t.diagnostic(`${y}: ${top} / ${left} / ${w}`)
        if (i < 4)
          await frame(
            p,
            `codepen-${width}-${['start', 'half', 'end', 'release'][i]}`,
          )
      }
    })
  })
  test(`public Reed Ledger / ${width}×900: masked offsets and onset frames`, async t => {
    await visit('type', width, async p => {
      await at(p, 899)
      assert.equal(await p.evaluate('document.getAnimations().length'), 0)
      await at(p, 910)
      // Measure the displacement inside each mask, in DOM reading order,
      // not a predicted matrix or a compiler-generated keyframe.
      const glyphs = `Array.from(document.querySelector('h2').querySelectorAll('*')).filter(e=>e.getAnimations().length)`
      const ratios = `(${glyphs}).map(g=>{const r=g.getBoundingClientRect();return (r.left-g.parentElement.getBoundingClientRect().left)/r.width})`
      assert.deepEqual(
        await p.evaluate(`[
        (${glyphs}).map(g=>g.textContent).join(''),document.querySelector('h2').textContent,
        (${glyphs}).every(g=>getComputedStyle(g.parentElement).overflowX==='hidden'),
        new Set((${glyphs}).map(g=>g.getBoundingClientRect().top)).size]`),
        ['ReedLedger', 'Reed Ledger', true, 1],
      )
      assert.equal(
        await p.evaluate(
          `Math.max(...document.getAnimations().map(a=>a.effect.getComputedTiming().endTime))`,
        ),
        1378,
      )
      const phone = width === 390
      const expected = [
        [1.05, 1.05, 1.05, 1.05, 1.05],
        [0.525, 0.70241, phone ? 0.93977 : 0.93978, 1.05, 1.05],
        [0.03281, 0.0439, 0.05874, phone ? 0.07859 : 0.07858, 0.45075],
        [0, 0, 0, 0, 0],
      ]
      for (const [i, ms] of [0, 100, 500, 1378].entries()) {
        await seek(p, ms)
        const all = await p.evaluate<number[]>(ratios)
        const sample = [all[0], all[1], all[2], all[3], all[9]]
        sample.forEach((d, j) =>
          near(
            d / 1.05,
            expected[i][j] / 1.05,
            0.05,
            `${ms} ms glyph ${[0, 1, 2, 3, 9][j]}`,
          ),
        )
        if (ms === 1378) all.forEach(d => near(d, 0, 0.001, 'settled'))
        t.diagnostic(`${ms} ms: ${sample.map(d => d.toFixed(5)).join(' ')}`)
      }
      const onsets = await p.evaluate<
        number[]
      >(`(()=>{const out=Array(10).fill(-1);for(let n=0;n<=25;n++){
        for(const a of document.getAnimations())a.currentTime=n*1000/60;
        ${ratios}.forEach((d,i)=>{if(out[i]<0 && d<1.049)out[i]=n})
      }return out})()`)
      onsets.forEach((n, i) =>
        near(n, [1, 3, 6, 8, 11, 13, 16, 18, 21, 23][i], 1, `onset ${i}`),
      )
      t.diagnostic(`onsets: ${onsets}`)
      // Photo composition only: center AFTER measuring the relative crossing.
      if (capture) {
        await p.evaluate(
          `document.querySelector('h2').scrollIntoView({block:'center'})`,
        )
        const scrollY = await p.evaluate<number>('scrollY')
        t.diagnostic(`photo scrollY: ${scrollY}`)
        await writeFile(
          join(capture, `codrops-${width}.json`),
          JSON.stringify({ scrollY, browser: browser.version }),
        )
        for (const ms of [0, 100, 500, 1378]) {
          await seek(p, ms)
          await frame(p, `codrops-${width}-${ms}ms`)
        }
      }
    })
  })
}

for (const width of [1280, 390])
  for (const fallback of ['off', 'reduced'] as const)
    test(`scripts ${fallback === 'off' ? 'disabled' : 'enabled, reduced motion'} / ${width}×900: read and navigate each plate`, async () => {
      for (const [scene, title, second] of [
        ['box', 'Traverse', ''],
        ['panel', 'Soundings', 'Waterline'],
        ['type', 'Specimens', 'Reed Ledger'],
      ] as const)
        await visit(
          scene,
          width,
          async p => {
            assert.deepEqual(
              await p.names('heading'),
              second ? [title, second] : [title],
            )
            assert.deepEqual(await p.names('link'), ['Jump to plate'])
            await p.tab()
            assert.equal(
              await p.evaluate(`document.activeElement.hash`),
              '#w-plate',
            )
            await p.evaluate(`document.activeElement.click()`)
            assert.equal(await p.evaluate('location.hash'), '#w-plate')
            if (fallback === 'reduced')
              await at(p, await p.evaluate<number>('scrollY'))
            assert.equal(await p.evaluate('document.getAnimations().length'), 0)
            if (scene === 'box')
              assert.equal(
                await p.evaluate(`${plate}.getBoundingClientRect().left`),
                width === 390 ? -240 : 24,
              )
            if (scene === 'panel')
              assert.equal(
                await p.evaluate(
                  `document.querySelector('article').lastElementChild.getBoundingClientRect().width`,
                ),
                width === 390 ? 312 : 800,
              )
            if (scene === 'type')
              assert.deepEqual(
                await p.evaluate(
                  `[${plate}.childElementCount,${plate}.textContent]`,
                ),
                [0, second],
              )
            await p.tab()
            assert.equal(
              await p.evaluate(`document.activeElement.tagName`),
              'SUMMARY',
            )
            await p.evaluate(`document.activeElement.click()`)
            assert.ok(
              await p.evaluate(
                `document.querySelector('details').open && document.querySelector('details p').getBoundingClientRect().height>0`,
              ),
            )
            assert.match(
              await p.evaluate<string>(
                `document.querySelector('details').innerText`,
              ),
              /Marks are read from the bank/,
            )
          },
          fallback,
        )
    })

test('pre-stage control bytes, script-free editor and the shipped feature mixes', async t => {
  const plain = await scenes.control()
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  // Preserve the original goldens (pre-motion commit a1ca779). Removing only
  // the two delivery policy artifacts must recover the *entire* previous result.
  const meta = /<meta http-equiv="Content-Security-Policy" content="[^"]+">/
  const control = compiled(plain)
  const site = compileSite(plain, { registry })
  assert.equal(
    sha(control.html.replace(meta, '')),
    '4ff9ed130a08642ffa6aa1f1432c1800b46a3cf0399f399d0f5d504a4039280f',
  )
  assert.equal(
    sha(
      JSON.stringify({
        ...site,
        files: site.files
          .filter(f => f.path !== '_headers')
          .map(f => ({ ...f, content: f.content.replace(meta, '') })),
      }),
    ),
    '660831b70bae58b111b4d5aa97e005547e07d6f38fe9361d4c8de9e16d784109',
  )
  assert.equal(
    sha(control.html),
    'b39ca828d10fb1cf164dbff24e9681e9d5e3ad28349be717532385b92201979a',
  )
  assert.equal(
    sha(JSON.stringify(site)),
    '29b2058b5a78dcbe5d1877f8c27d78a53f53b347784df9c3f92b3e738c90edeb',
  )
  for (const scene of [
    'box',
    'panel',
    'type',
    'control',
    'native',
    'mixed',
  ] as const) {
    const doc = await scenes[scene]()
    const edit = compiled(doc, 'edit')
    const part = compileSubtree(doc, 'home', 'plate', { registry })
    assert.ok(part.ok)
    assert.deepEqual(edit.scripts, [])
    assert.doesNotMatch(
      edit.html + part.html + part.css + part.pageCss,
      /<script\b|data-culm-motion|@keyframes cm-/,
    )
    const { stats, html } = compiled(doc)
    const { base, states, timeline = 0 } = stats.scriptBytes
    const actual = Buffer.byteLength(html.match(/<script>(.*?)<\/script>/s)![1])
    assert.equal(actual, base + states + timeline)
    if (scene === 'native' || scene === 'control')
      assert.deepEqual([timeline, states, actual], [0, 0, 304])
    else assert.ok(timeline > 0 && timeline <= BUDGETS.timelineScript)
    if (scene === 'mixed') assert.deepEqual([base, states], [688, 1963])
    assert.ok(actual <= BUDGETS.sharedScripts)
    t.diagnostic(
      `${scene}: ${base}+${states}+${timeline}=${actual}; CSS ${stats.styleBytes}; elements ${stats.elements}; depth ${stats.depth}`,
    )
  }
})

test('measure reports the actual over-budget CSS on a timeline page', async t => {
  const doc = await scenes.type()
  // Many distinct, valid rules, below the node limit. The host has a fixed
  // size; do not monkey-patch it or any limit to manufacture a script overage.
  for (let i = 0; i < 350; i++)
    doc.pages[0].root.children!.push({
      id: `swatch${i}`,
      name: 'Swatch',
      kind: 'box',
      slot: {},
      style: {
        base: { height: { n: i + 1, unit: 'px' }, bg: '#254238', padding: i },
      },
    })
  const r = compilePage(doc, 'home', { registry, mode: 'measure' })
  assert.ok(r.ok)
  const n = Buffer.byteLength(r.css)
  const call = await connectClient(
    createMcpServer({
      site: 'fen',
      store: memoryStore({ fen: doc }),
      registry,
      browser,
      data: { rows: {} },
    }),
  )
  const described = await call('describe')
  assert.equal(described.error, false)
  const limits = described.json.ceilings.page
  assert.deepEqual(
    [limits.timelineScript, limits.sharedScripts, limits.css],
    [8192, 20000, 16000],
  )
  assert.ok(n > limits.css)
  assert.deepEqual(
    r.problems.map(p => [p.code, p.path]),
    [['RESOURCE_LIMIT_EXCEEDED', 'css']],
  )
  const report = await call('measure', { widths: [1280], classes: [1] })
  assert.equal(report.error, false)
  assert.deepEqual(report.json.incomplete, [])
  assert.deepEqual(report.json.blocked, [])
  assert.deepEqual(report.json.findings, [
    {
      page: 'home',
      check: 'invalid',
      nodes: [],
      at: ['1280'],
      message: `css is ${n}, the ceiling is 16000`,
    },
  ])
  t.diagnostic(report.json.findings[0].message)
})

test('public CSS-only scroll: native view timeline or ordinary static text on older Chrome', async t => {
  const compat = process.env.CULM_COMPAT_CHROME
    ? await openBrowser({ executable: process.env.CULM_COMPAT_CHROME })
    : undefined
  if (compat) assert.ok(compat.ok, JSON.stringify(compat))
  try {
    for (const engine of compat ? [browser, compat.browser] : [browser])
      await visit(
        'native',
        390,
        async p => {
          const native = await p.evaluate<boolean>(
            `CSS.supports('animation-timeline:view()')`,
          )
          if (compat) assert.equal(native, engine === browser)
          // Half passage (owner center meets viewport center), safely away from
          // range endpoints. CSS-only default is fully legible without view().
          await p.evaluate(`${plate}.scrollIntoView({block:'center'})`)
          await at(p, await p.evaluate<number>('scrollY'))
          const opacity = await p.evaluate<number>(
            `+getComputedStyle(${plate}).opacity`,
          )
          near(opacity, native ? 0.7 : 1, 0.05, 'half passage opacity')
          assert.equal(
            await p.evaluate(`${plate}.getAnimations().length`),
            native ? 1 : 0,
          )
          t.diagnostic(
            `${engine.version} / view(): ${native} / opacity ${opacity}`,
          )
        },
        undefined,
        engine,
      )
  } finally {
    if (compat) await compat.browser.close()
  }
})
