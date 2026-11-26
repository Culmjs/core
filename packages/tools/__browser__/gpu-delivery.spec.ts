import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { compilePage, compileSite, createRegistry } from '@culmjs/core'
import { node, siteWith, text, twoPages } from '../../core/__tests__/kit.ts'
import { parse } from 'jsonc-parser'
import { DomUtils, parseDocument } from 'htmlparser2'
import { buildSite } from '../src/build/bundle.ts'
import { startDev } from '../src/dev/server.ts'
import { openProject } from '../src/folder/project.ts'
import { media, readAsset } from '../src/folder/files.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'
import { measureAnswers, runMeasure } from '../src/measure/run.ts'
import { copyFixture } from '../__tests__/fixtures.ts'
import { gpuFolder, invalid, motion } from '../__tests__/fixtures/shader.ts'

const frame = `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))`
async function wait(page: Page, condition: string) {
  assert.ok(
    await page.evaluate(
      `(async()=>{for(let i=0;i<150;i++){if(${condition})return true;await new Promise(r=>setTimeout(r,20))}return false})()`,
    ),
    `${condition}: ${page.errors.join('; ')}`,
  )
}
const asset = '/_culm/gpu.js'
test('the published, dev and isolated measurement pages deliver the SRI host under their actual policies', async t => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  const path = join(dir, 'pages/home.json')
  const doc = parse(await readFile(path, 'utf8'))
  doc.root.children = [
    {
      id: 'spacer',
      name: 'Space',
      kind: 'box',
      style: { base: { height: { n: 1800, unit: 'px' } } },
    },
    ...['first', 'second'].map(id => ({
      id,
      name: id,
      kind: 'column',
      motion,
      style: { base: { height: { n: 120, unit: 'px' }, bg: '#383838' } },
      children: [
        {
          id: id + 'line',
          name: 'Heading',
          kind: 'text',
          props: { runs: [{ text: 'Static heading' }] },
        },
      ],
    })),
  ]
  await writeFile(path, JSON.stringify(doc))
  const project = await openProject(dir)
  const build = await buildSite(project)
  assert.ok(build.ok, JSON.stringify(build))
  const [html, js, headers] = await Promise.all(
    ['index.html', asset.slice(1), '_headers'].map(f =>
      readFile(join(build.out, f), 'utf8'),
    ),
  )
  const policy = headers.split('Content-Security-Policy: ')[1].trim()
  const integrity = `sha256-${createHash('sha256').update(js).digest('base64')}`
  let requests = 0
  let corrupt = false
  const server = createServer((req, res) => {
    if (req.url === '/')
      res
        .writeHead(200, {
          'content-security-policy': policy,
          'content-type': 'text/html',
        })
        .end(html)
    else if (req.url === asset) {
      requests++
      res
        .writeHead(200, {
          'content-type': 'text/javascript',
          'cache-control': 'no-store',
        })
        .end(js + (corrupt ? ' /* changed bytes */' : ''))
    } else if (req.url === '/favicon.ico') res.writeHead(204).end()
    else res.writeHead(404).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise<void>(r => server.close(() => r())))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const b = await openBrowser()
  assert.ok(b.ok, JSON.stringify(b))
  t.after(() => b.browser.close())
  const scroll = `document.querySelector('[data-culm-gpu]').scrollIntoView()`
  for (const mode of ['reduce', 'save', 'allow', 'corrupt'])
    await t.test(`published: ${mode}`, async () => {
      const p = await b.browser.newPage()
      try {
        requests = 0
        corrupt = mode === 'corrupt'
        await p.setViewport(1000, 500)
        await p.setReducedMotion(mode === 'reduce')
        assert.ok((await p.goto(origin, 5000)).ok)
        assert.equal(
          await p.evaluate(`document.querySelector('[http-equiv]').content`),
          policy,
        )
        assert.ok(
          await p.evaluate(
            `document.querySelector('[data-culm-gpu]').getBoundingClientRect().top>1000`,
          ),
        )
        await p.evaluate(frame)
        assert.equal(requests, 0)
        // Observe the browser's actual element load/integrity-error after scrolling.
        await p.evaluate(
          `for(const ev of ['load','error']) document.addEventListener(ev,e=>{if(e.target.src===location.origin+'${asset}') window.hostEvent=ev},true)`,
        )
        if (mode === 'save')
          await p.evaluate(
            `Object.defineProperty(navigator,'connection',{value:{saveData:true}})`,
          )
        await p.evaluate(scroll)
        await p.evaluate(frame)
        if (mode === 'allow' || corrupt) {
          await wait(p, `window.hostEvent==='${corrupt ? 'error' : 'load'}'`)
          assert.equal(requests, 1)
          assert.equal(
            await p.evaluate(`document.querySelector('script[src]').integrity`),
            integrity,
          )
        } else assert.equal(requests, 0)
        if (mode === 'allow')
          await wait(
            p,
            `document.querySelectorAll('[data-gpu-painted]').length===2`,
          )
        assert.equal(
          await p.evaluate(`document.querySelectorAll('canvas').length`),
          Number(mode === 'allow'),
        )
        assert.equal(
          await p.evaluate(
            `document.querySelector('[data-culm-gpu]').innerText`,
          ),
          'Static heading',
        )
        if (!corrupt) assert.deepEqual(p.errors, [])
        if (mode === 'allow') {
          // Harmless sentinel with no policy hash: Chrome must actually enforce script-src.
          await p.evaluate(
            `document.addEventListener('securitypolicyviolation',e=>window.violation=e.effectiveDirective,{once:true}); const s=document.createElement('script');s.text='window.sentinel=1';document.head.append(s)`,
          )
          await wait(p, `window.violation==='script-src-elem'`)
          assert.equal(await p.evaluate(`Boolean(window.sentinel)`), false)
        }
      } finally {
        await p.close()
      }
    })
  await t.test(
    'measure: fixed same-origin asset only, sandbox and request interceptor retained',
    async () => {
      const r = compilePage(project.loaded.doc!, 'home', {
        registry: project.registry,
        data: project.loaded.data,
        mode: 'measure',
      })
      assert.ok(r.ok)
      const answer = measureAnswers(
        r,
        { slug: '/', on: true },
        async () => assert.fail('Not a folder asset'),
        { n: 0 },
        policy,
      )
      const url = 'https://site.culm.invalid'
      assert.equal((await answer(url + asset))?.body, js)
      for (const other of [
        url + '/_culm/absent.js',
        url + '/_headers',
        'https://elsewhere.invalid' + asset,
      ])
        assert.equal(await answer(other), undefined)
      const p = await b.browser.newPage()
      try {
        let loads = 0
        await p.answer(async u => {
          if (u === url + asset) loads++
          return answer(u)
        })
        await p.setReducedMotion(false)
        assert.ok((await p.goto(url, 5000)).ok)
        await p.evaluate(scroll)
        await wait(
          p,
          `performance.getEntriesByName('${url + asset}').length===1`,
        )
        assert.equal(loads, 1)
        assert.equal(
          await p.evaluate(
            `document.querySelector('[data-culm-gpu]').dataset.id`,
          ),
          'first',
        )
        assert.equal(await p.evaluate(`typeof WebSocket`), 'undefined')
        assert.deepEqual(p.blocked, [])
        assert.deepEqual(p.errors, [])
      } finally {
        await p.close()
      }
    },
  )
  await t.test(
    'dev: client receives actual last-good SSE problems under the additional exact hash',
    async () => {
      const dev = await startDev(dir, { port: 0 })
      const p = await b.browser.newPage()
      try {
        await p.unblock()
        await p.setReducedMotion(false)
        assert.ok((await p.goto(dev.url, 5000)).ok)
        await p.evaluate(scroll)
        await wait(
          p,
          `performance.getEntriesByName('${dev.url + asset}').length===1`,
        )
        await writeFile(join(dir, 'effects/mist.frag'), invalid)
        await wait(
          p,
          `document.getElementById('culm-dev-overlay')?.innerText.includes('shader')`,
        )
        assert.deepEqual(
          p.errors.filter(e => !e.includes('favicon.ico')),
          [],
        )
      } finally {
        await p.close()
        await dev.close()
      }
    },
  )
})

test('build, dev and a one-page measurement of a mixed site agree on media, page policy and asset response headers', async t => {
  const dir = await copyFixture('site-basic')
  await gpuFolder(dir, true)
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(
    join(dir, 'assets/note.html'),
    '<title>Note</title><p>A note.</p>',
  )
  const filename =
    process.platform === 'win32' ? 'figure#%.svg' : 'figure?#.svg'
  const figure = `/assets/${encodeURIComponent(filename)}?v=2#drawing`
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>'
  await writeFile(join(dir, 'assets', filename), svg)
  await writeFile(join(dir, 'assets/scene.svg'), svg)
  await writeFile(join(dir, 'assets/ordinary'), svg)
  const path = join(dir, 'pages/home.json'),
    home = parse(await readFile(path, 'utf8'))
  home.root.children = ['figure', 'absent'].map(id => ({
    id,
    name: id,
    kind: 'box',
    motion: {
      ...motion,
      gpu: 'contours',
      poster: id === 'figure' ? 'scene.svg' : 'missingposter.svg',
    },
    style: { base: { bgImage: 'ordinary', height: { n: 64, unit: 'px' } } },
    children: [
      {
        id: id + 'image',
        kind: 'image',
        name: 'Image',
        props:
          id === 'figure'
            ? { src: figure, alt: '' }
            : { assetId: id + '.svg', alt: '', fallback: 'Fallback' },
      },
    ],
  }))
  await writeFile(path, JSON.stringify(home))
  const project = await openProject(dir)
  const built = await buildSite(project)
  assert.ok(built.ok, JSON.stringify(built))
  const policy = (await readFile(join(built.out, '_headers'), 'utf8'))
    .split('Content-Security-Policy: ')[1]
    .trim()
  const html = await readFile(join(built.out, 'index.html'), 'utf8')
  assert.match(policy, /worker-src blob:/)
  assert.doesNotMatch(policy, /unsafe-/)
  const checkOwners = (html: string) => {
    assert.match(html, /src="\/assets\/absent.svg"/)
    assert.match(html, /\/assets\/scene.svg/)
    assert.doesNotMatch(html, /\/assets\/missingposter.svg/)
    const owners = DomUtils.findAll(
      e => 'data-culm-gpu' in e.attribs,
      parseDocument(html).children,
    )
    assert.equal(owners.length, 1)
    assert.equal(owners[0].attribs['data-culm-gpu'], '0')
    assert.equal(owners[0].attribs['data-gpu-run'], '1')
    assert.equal(
      DomUtils.getElementsByTagName('img', owners[0].children)[0].attribs.src,
      figure,
    )
  }
  await t.test('built inventory', () => checkOwners(html))
  assert.equal(await readFile(join(built.out, 'assets', filename), 'utf8'), svg)
  const paths = ['/assets/note.html', figure, asset]
  await t.test(
    'dev inventory and deployment headers on assets (without reload grant)',
    async () => {
      const dev = await startDev(dir, { port: 0 })
      try {
        for (const path of paths) {
          const r = await fetch(dev.url + path)
          assert.equal(r.status, 200)
          assert.equal(r.headers.get('content-security-policy'), policy, path)
          if (path === figure) assert.equal(await r.text(), svg)
        }
        const page = await fetch(dev.url)
        assert.notEqual(page.headers.get('content-security-policy'), policy)
        checkOwners(await page.text())
      } finally {
        await dev.close()
      }
    },
  )
  await t.test(
    'actual runMeasure uses all published routes even when probing just home',
    async () => {
      const b = await openBrowser()
      assert.ok(b.ok)
      const seen: {
        meta: string
        html: string
        headers: string[]
        imageWidth: number
        backgrounds: string[]
      }[] = []
      try {
        const result = await runMeasure({
          registry: project.registry,
          doc: project.loaded.doc!,
          data: project.loaded.data,
          revision: 0,
          files: (await media(dir)).hashes,
          assets: p => readAsset(dir, p),
          pages: ['home'],
          widths: [1280],
          themes: ['light'],
          browser: {
            ...b.browser,
            newPage: async () => {
              const page = await b.browser.newPage()
              return {
                ...page,
                goto: async (url, timeout) => {
                  const r = await page.goto(url, timeout)
                  seen.push(
                    await page.evaluate(
                      `(async()=>({meta:document.querySelector('[http-equiv]').content,html:document.body.innerHTML,imageWidth:document.querySelector('img[src="${figure}"]').naturalWidth,backgrounds:['figure','absent'].map(id=>getComputedStyle(document.querySelector('[data-id="'+id+'"]')).backgroundImage),headers:await Promise.all(${JSON.stringify(['/', ...paths])}.map(async path=>(await fetch(path)).headers.get('content-security-policy')))}))()`,
                    ),
                  )
                  return r
                },
              }
            },
          },
        })
        assert.deepEqual(result.incomplete, [])
        assert.equal(seen.length, 1)
        assert.equal(seen[0].meta, policy)
        assert.equal(seen[0].imageWidth, 10)
        assert.match(seen[0].backgrounds[0], /\/assets\/scene.svg"\)/)
        assert.match(seen[0].backgrounds[1], /\/assets\/ordinary"\)/)
        for (const h of seen[0].headers)
          assert.equal(h?.split(', ').at(-1), policy)
        assert.match(seen[0].headers[0], /sandbox allow-scripts/)
        checkOwners(seen[0].html)
      } finally {
        await b.browser.close()
      }
    },
  )
})

test('memory measurement distinguishes an omitted inventory from a known empty inventory', async t => {
  const hero = node('hero', 'box', [text('title', 'Field')])
  hero.motion = { trigger: 'enter-view', gpu: 'contours', poster: 'cover.svg' }
  const doc = siteWith([hero])
  const registry = createRegistry({ gpu: { enabled: true } })
  const b = await openBrowser()
  assert.ok(b.ok)
  t.after(() => b.browser.close())
  for (const files of [undefined, []]) {
    const requested: string[] = []
    const r = await runMeasure({
      doc,
      registry,
      files,
      revision: 0,
      data: { rows: {} },
      pages: ['home'],
      widths: [1280],
      themes: ['light'],
      browser: b.browser,
      assets: async path => {
        requested.push(path)
        return new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        )
      },
    })
    assert.deepEqual(r.incomplete, [])
    assert.deepEqual(requested, files ? [] : ['assets/cover.svg'])
  }
})

test('an explicitly measured draft runs its own joined state script under its page policy and sandbox', async () => {
  const registry = createRegistry()
  const draft = node('panel', 'column', [
    {
      ...node('switch', 'button'),
      props: { label: 'Toggle panel' },
      on: [{ on: 'click', do: { toggle: 'panel' } }],
    },
  ])
  draft.state = [{ name: 'panel', values: 'on-off', initial: 'off' }]
  const doc = twoPages([], [draft])
  doc.pages[1].on = false
  const site = compileSite(doc, { registry })
  assert.deepEqual(site.problems, [])
  const deployed = site.files
    .find(f => f.path === '_headers')!
    .content.split('Content-Security-Policy: ')[1]
    .trim()
  const standalone = compilePage(doc, 'about', { registry, mode: 'measure' })
  assert.ok(standalone.ok)
  assert.deepEqual(
    standalone.scripts.map(s => s.name),
    ['base', 'states'],
  )
  const hash = createHash('sha256')
    .update(standalone.scripts.map(s => s.code).join(';'))
    .digest('base64')
  const expected = `script-src 'sha256-${hash}'; worker-src 'none'`
  assert.ok(!deployed.includes(hash))
  const b = await openBrowser()
  assert.ok(b.ok)
  const seen: {
    before: string
    after: string
    meta: string
    page: string
    asset: string
  }[] = []
  try {
    const result = await runMeasure({
      registry,
      doc,
      data: { rows: {} },
      revision: 0,
      pages: ['about'],
      widths: [1280],
      themes: ['light'],
      assets: async p =>
        p === 'assets/note.html'
          ? new TextEncoder().encode('<p>Note</p>')
          : undefined,
      browser: {
        ...b.browser,
        newPage: async () => {
          const page = await b.browser.newPage()
          return {
            ...page,
            goto: async (url, timeout) => {
              const r = await page.goto(url, timeout)
              seen.push(
                await page.evaluate(`(async()=>{
            const holder=document.querySelector('[data-s-panel]'),before=holder.dataset.sPanel;
            document.querySelector('[data-id="switch"]').click();
            const policy=async url=>(await fetch(url)).headers.get('content-security-policy');
            return {before,after:holder.dataset.sPanel,meta:document.querySelector('[http-equiv]').content,page:await policy(location.pathname),asset:await policy('/assets/note.html')}
          })()`),
              )
              return r
            },
          }
        },
      },
    })
    assert.deepEqual(result.incomplete, [])
    assert.deepEqual(result.blocked, [])
    assert.equal(seen.length, 1)
    assert.deepEqual([seen[0].before, seen[0].after], ['off', 'on'])
    assert.equal(seen[0].meta, expected)
    assert.equal(seen[0].page.split(', ').at(-1), expected)
    assert.equal(seen[0].asset.split(', ').at(-1), deployed)
    assert.match(seen[0].page, /sandbox allow-scripts/)
    assert.match(seen[0].asset, /sandbox allow-scripts/)
  } finally {
    await b.browser.close()
  }
})
