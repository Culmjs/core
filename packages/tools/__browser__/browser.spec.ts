import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { openBrowser, type Browser } from '../src/measure/browser.ts'
import { decodePng } from '../src/measure/png.ts'
import { BASE_SCRIPT, STATES_SCRIPT } from '@culmjs/core/scripts'

const left = (what = 'culm-chrome-') => {
  const dirs = readdirSync(tmpdir()).filter(d => d.startsWith(what))
  let procs = ''
  try {
    procs = execFileSync('pgrep', ['-f', what]).toString()
  } catch {
    // pgrep exits 1 when nothing matches
  }
  return { dirs, procs }
}

let browser: Browser
let hits = 0
let server: Server
let outside: string
before(async () => {
  server = createServer((_, res) => {
    hits++
    res.end('x')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  outside = `http://127.0.0.1:${(server.address() as { port: number }).port}/pic.png`
  const o = await openBrowser()
  assert.ok(o.ok, o.ok ? '' : JSON.stringify(o.problems))
  browser = o.browser
})
after(async () => {
  await browser?.close()
  server?.close()
})

const HTML = (body: string) => ({
  type: 'text/html',
  body: `<!doctype html><body style="margin:0">${body}`,
})

test('the browser says which Chrome it is', () => {
  assert.match(browser.version, /Chrome\/\d+\./)
  console.log('browser used:', browser.version)
})

test('a page is answered from memory, a request it does not answer fails and is listed, and nothing reaches the network', async () => {
  const page = await browser.newPage()
  try {
    const seen: string[] = []
    await page.answer(async url => {
      seen.push(url)
      return url === 'https://site.culm.invalid/p'
        ? HTML(
            `<h1 id=t>hi</h1><img src="${outside}"><script>document.title='ran'</script>`,
          )
        : undefined
    })
    assert.deepEqual(await page.goto('https://site.culm.invalid/p', 5000), {
      ok: true,
    })
    assert.equal(await page.evaluate('document.title'), 'ran')
    assert.deepEqual(page.blocked, [outside])
    assert.ok(
      seen.includes(outside),
      'the answer was asked about the outside image',
    )
    assert.equal(hits, 0)
  } finally {
    await page.close()
  }
})

test('a frame by an outside address is blocked too, and the page has no WebRTC or socket', async () => {
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url === 'https://site.culm.invalid/f'
        ? HTML(`<iframe src="${outside}"></iframe>`)
        : undefined,
    )
    await page.goto('https://site.culm.invalid/f', 5000)
    assert.deepEqual(page.blocked, [outside])
    assert.equal(hits, 0)
    assert.equal(
      await page.evaluate('typeof RTCPeerConnection + typeof WebSocket'),
      'undefinedundefined',
    )
  } finally {
    await page.close()
  }
})

test("the window width and the colour scheme are the page's", async () => {
  const page = await browser.newPage()
  try {
    await page.answer(async () => HTML(''))
    await page.goto('https://site.culm.invalid/', 5000)
    await page.setViewport(390, 900)
    await page.setScheme('dark')
    assert.equal(await page.evaluate('innerWidth'), 390)
    assert.equal(
      await page.evaluate('matchMedia("(prefers-color-scheme: dark)").matches'),
      true,
    )
    await page.setScheme('light')
    assert.equal(
      await page.evaluate('matchMedia("(prefers-color-scheme: dark)").matches'),
      false,
    )
  } finally {
    await page.close()
  }
})

test('a screenshot of a clip beyond the window decodes to the page colours', async () => {
  const page = await browser.newPage()
  try {
    await page.answer(async () =>
      HTML('<div style="height:2000px;background:#123456"></div>'),
    )
    await page.goto('https://site.culm.invalid/', 5000)
    await page.setViewport(300, 400)
    const img = decodePng(
      await page.screenshot({ x: 0, y: 1500, w: 100, h: 60 }),
    )
    assert.equal(img.width, 100)
    assert.equal(img.height, 60)
    assert.deepEqual([...img.rgba.subarray(0, 4)], [0x12, 0x34, 0x56, 255])
  } finally {
    await page.close()
  }
})

test('a script error in evaluate rejects, and a page that never loads is not ok', async () => {
  const page = await browser.newPage()
  try {
    await page.answer(async () => HTML(''))
    await page.goto('https://site.culm.invalid/', 5000)
    await assert.rejects(page.evaluate('nope.nope'), /nope/)
    const slow = await browser.newPage()
    await slow.answer(async () => new Promise(() => {}))
    const r = await slow.goto('https://site.culm.invalid/', 300)
    assert.equal(r.ok, false)
    assert.match(r.problem ?? '', /300 ms/)
    await slow.close()
  } finally {
    await page.close()
  }
})

/** A local server that counts TCP connections, not requests: a preconnect would count. */
async function counting() {
  let connections = 0
  const srv = createServer((_, res) => res.end('x'))
  srv.on('connection', () => connections++)
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/o`
  return { url, count: () => connections, close: () => srv.close() }
}
const settle = () => new Promise(r => setTimeout(r, 600))

test('a popup to an outside address is closed, listed, and never connects', async () => {
  const out = await counting()
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url === 'https://site.culm.invalid/p'
        ? HTML(`<script>window.open(${JSON.stringify(out.url)})</script>`)
        : undefined,
    )
    await page.goto('https://site.culm.invalid/p', 5000)
    await settle()
    assert.equal(out.count(), 0)
    assert.ok(
      page.blocked.some(b => b.includes(out.url)),
      JSON.stringify(page.blocked),
    )
  } finally {
    await page.close()
    out.close()
  }
})

test('a window opened by a click or a form, not by script, is closed and listed too', async () => {
  const out = await counting()
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url === 'https://site.culm.invalid/a'
        ? HTML(
            `<a target=_blank href="${out.url}">x</a><form target=_blank action="${out.url}"></form><script>document.querySelector('a').click();document.querySelector('form').submit()</script>`,
          )
        : undefined,
    )
    await page.goto('https://site.culm.invalid/a', 5000)
    await settle()
    assert.equal(out.count(), 0)
    const popups = page.blocked.filter(b => b === 'a window opened by the page')
    assert.ok(popups.length >= 2, JSON.stringify(page.blocked))
  } finally {
    await page.close()
    out.close()
  }
})

test('a dedicated worker runs, and what it fetches outside is listed and never connects', async () => {
  const out = await counting()
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url === 'https://site.culm.invalid/d'
        ? HTML(
            `<script>const w=new Worker(URL.createObjectURL(new Blob(["postMessage('up');fetch('${out.url}').catch(()=>{})"])));w.onmessage=e=>{document.title=e.data}</script>`,
          )
        : undefined,
    )
    await page.goto('https://site.culm.invalid/d', 5000)
    await settle()
    assert.equal(await page.evaluate('document.title'), 'up')
    assert.equal(out.count(), 0)
    assert.ok(page.blocked.includes(out.url), JSON.stringify(page.blocked))
  } finally {
    await page.close()
    out.close()
  }
})

test('a popup that keeps its opener (a named target) does not freeze the page, and is listed', async () => {
  const out = await counting()
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url === 'https://site.culm.invalid/n'
        ? HTML(
            `<a target=foo href="${out.url}">x</a><script>document.querySelector('a').click()</script>`,
          )
        : undefined,
    )
    const t = Date.now()
    assert.deepEqual(await page.goto('https://site.culm.invalid/n', 5000), {
      ok: true,
    })
    assert.equal(await page.evaluate('1+1'), 2)
    assert.ok(Date.now() - t < 4000)
    await settle()
    assert.equal(out.count(), 0)
    assert.ok(page.blocked.length >= 1, JSON.stringify(page.blocked))
  } finally {
    await page.close()
    out.close()
  }
})

for (const kind of ['prefetch', 'prerender'] as const)
  test(`a speculation rules ${kind} to an outside address never connects`, async () => {
    const out = await counting()
    const page = await browser.newPage()
    try {
      const rules = JSON.stringify({
        [kind]: [
          { source: 'list', urls: [out.url] },
          { source: 'document', where: { href_matches: '*' } },
        ],
      })
      await page.answer(async url =>
        url === 'https://site.culm.invalid/r'
          ? HTML(
              `<a href="${out.url}">x</a><script type="speculationrules">${rules}</script>`,
            )
          : undefined,
      )
      await page.goto('https://site.culm.invalid/r', 5000)
      await page.evaluate(
        `document.body.append(Object.assign(document.createElement('script'),{type:'speculationrules',textContent:${JSON.stringify(rules)}}))`,
      )
      await settle()
      await settle()
      assert.equal(out.count(), 0)
    } finally {
      await page.close()
      out.close()
    }
  })

for (const [name, body] of [
  ['a script with the same text', (r: string) => `<script>${r}</script>`],
  [
    'a text/plain script with the same text',
    (r: string) => `<script type=text/plain>${r}</script>`,
  ],
  [
    'a running script that copies a text/plain script into new rules',
    (r: string) =>
      `<script type=text/plain id=p>${r}</script><script>document.body.append(Object.assign(document.createElement('script'),{type:'speculationrules',textContent:document.getElementById('p').textContent}))</script>`,
  ],
] as const)
  test(`speculation rules allowed by ${name} are refused and never connect`, async () => {
    const out = await counting()
    const page = await browser.newPage()
    try {
      const rules = JSON.stringify({
        prerender: [{ source: 'list', urls: [out.url] }],
        prefetch: [{ source: 'list', urls: [out.url + '2'] }],
      })
      const rulesTag = name.includes('copies')
        ? ''
        : `<script type=speculationrules>${rules}</script>`
      await page.answer(async url =>
        url === 'https://site.culm.invalid/c'
          ? HTML(
              `<script>window.v=0;addEventListener('securitypolicyviolation',()=>window.v++)</script>${body(rules)}${rulesTag}`,
            )
          : undefined,
      )
      await page.goto('https://site.culm.invalid/c', 5000)
      await settle()
      await settle()
      assert.equal(out.count(), 0)
      assert.ok((await page.evaluate<number>('window.v')) >= 1)
    } finally {
      await page.close()
      out.close()
    }
  })

test("core's compiled script runs under the page policy, with CRLF line ends too", async () => {
  const page = await browser.newPage()
  try {
    await page.answer(async () =>
      HTML(
        `<script>${BASE_SCRIPT};${STATES_SCRIPT}</script><script>\r\nwindow.crlf=1\r\n</script>`,
      ),
    )
    await page.goto('https://site.culm.invalid/', 5000)
    assert.equal(await page.evaluate('document._r'), 1)
    assert.equal(await page.evaluate('window.crlf'), 1)
  } finally {
    await page.close()
  }
})

test('a shared worker that fetches an outside address is answered by the page, listed, and never connects', async () => {
  const out = await counting()
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url === 'https://site.culm.invalid/w'
        ? HTML(
            `<script>new SharedWorker(URL.createObjectURL(new Blob(['fetch(${JSON.stringify(out.url)}).catch(()=>{})'])))</script>`,
          )
        : undefined,
    )
    await page.goto('https://site.culm.invalid/w', 5000)
    await settle()
    assert.equal(out.count(), 0)
    assert.ok(page.blocked.includes(out.url), JSON.stringify(page.blocked))
  } finally {
    await page.close()
    out.close()
  }
})

test('a service worker registration never connects, and what it would fetch is listed', async () => {
  const out = await counting()
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url === 'https://site.culm.invalid/s'
        ? HTML(
            `<script>navigator.serviceWorker.register('/sw.js').catch(()=>{})</script>`,
          )
        : url === 'https://site.culm.invalid/sw.js'
          ? {
              type: 'text/javascript',
              body: `fetch(${JSON.stringify(out.url)}).catch(()=>{})`,
            }
          : undefined,
    )
    await page.goto('https://site.culm.invalid/s', 5000)
    await settle()
    assert.equal(out.count(), 0)
    assert.ok(
      page.blocked.includes(out.url) ||
        page.blocked.some(b => b.endsWith('/sw.js')),
      JSON.stringify(page.blocked),
    )
  } finally {
    await page.close()
    out.close()
  }
})

test('errors lists a console error, an uncaught exception and a failed request, and nothing else', async () => {
  const page = await browser.newPage()
  try {
    await page.answer(async url =>
      url.endsWith('/p')
        ? HTML(
            `<h1>ok</h1><script>console.log('fine');console.error('bad thing');setTimeout(() => { throw new Error('boom') }, 0)</script><script src="/missing.js"></script>`,
          )
        : { status: 404, type: 'text/plain', body: 'no' },
    )
    await page.goto('https://site.culm.invalid/p', 5000)
    await page.evaluate('new Promise(r => setTimeout(r, 100))')
    assert.equal(page.errors.length, 3, JSON.stringify(page.errors))
    assert.ok(page.errors.some(e => e === 'bad thing'))
    assert.ok(page.errors.some(e => e.includes('boom')))
    assert.ok(page.errors.some(e => e.includes('missing.js')))
  } finally {
    await page.close()
  }
})

test('setScripts(false) stops the page script and setScripts(true) runs it again', async () => {
  const page = await browser.newPage()
  try {
    await page.answer(async () =>
      HTML("<h1>hi</h1><script>document.title='ran'</script>"),
    )
    await page.setScripts(false)
    await page.goto('https://site.culm.invalid/p', 5000)
    assert.equal(await page.evaluate('document.title'), '')
    assert.equal(
      await page.evaluate('document.querySelector("h1").textContent'),
      'hi',
    )
    await page.setScripts(true)
    await page.goto('https://site.culm.invalid/p', 5000)
    assert.equal(await page.evaluate('document.title'), 'ran')
  } finally {
    await page.close()
  }
})

test('unblock lets a page with no answer reach a local server and keep EventSource', async () => {
  const sse = createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: hello\n\n')
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<body><script>new EventSource('/events').onmessage = e => { document.body.dataset.got = e.data }</script>`,
      )
    }
  })
  await new Promise<void>(r => sse.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(sse.address() as { port: number }).port}/`
  const blocked = await browser.newPage()
  const page = await browser.newPage()
  try {
    // without `unblock` the page has no EventSource
    await blocked.goto(url, 5000)
    assert.equal(await blocked.evaluate('typeof EventSource'), 'undefined')
    await page.unblock()
    assert.deepEqual(await page.goto(url, 5000), { ok: true })
    assert.equal(await page.evaluate('typeof EventSource'), 'function')
    await page.evaluate(
      'new Promise(r => { const t = setInterval(() => document.body.dataset.got && (clearInterval(t), r()), 20) })',
    )
    assert.equal(await page.evaluate('document.body.dataset.got'), 'hello')
  } finally {
    await page.close()
    await blocked.close()
    sse.closeAllConnections()
    sse.close()
  }
})

test('a second answer replaces the first, and a call after Chrome has gone fails at once', async () => {
  const page = await browser.newPage()
  await page.answer(async () => HTML('first'))
  await page.answer(async () => HTML('second'))
  await page.goto('https://site.culm.invalid/', 5000)
  assert.equal(await page.evaluate('document.body.textContent'), 'second')
  await page.close()
  const o = await openBrowser()
  assert.ok(o.ok)
  await o.browser.close()
  const t = Date.now()
  await assert.rejects(o.browser.newPage())
  assert.ok(Date.now() - t < 2000)
})

test('closing leaves no Chrome and no profile folder', async () => {
  // only the profile this run creates: another run's folder, or the shared browser's, is not this test's to judge
  const before = left().dirs
  const o = await openBrowser()
  assert.ok(o.ok)
  const mine = left().dirs.filter(d => !before.includes(d))
  assert.equal(mine.length, 1, JSON.stringify(mine))
  await o.browser.close()
  assert.ok(!left().dirs.includes(mine[0]!))
  assert.equal(left(mine[0]).procs, '')
})
