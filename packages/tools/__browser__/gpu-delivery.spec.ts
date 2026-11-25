import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { compilePage } from '@culmjs/core'
import { parse } from 'jsonc-parser'
import { buildSite } from '../src/build/bundle.ts'
import { startDev } from '../src/dev/server.ts'
import { openProject } from '../src/folder/project.ts'
import { openBrowser, type Page } from '../src/measure/browser.ts'
import { measureAnswers } from '../src/measure/run.ts'
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
        assert.equal(
          await p.evaluate(`document.querySelectorAll('canvas').length`),
          0,
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
        '/',
        async () => assert.fail('Not a folder asset'),
        { n: 0 },
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
