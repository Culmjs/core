import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { openBrowser, type Browser } from '../src/measure/browser.ts'
import { decodePng } from '../src/measure/png.ts'

const left = () => {
  const dirs = readdirSync(tmpdir()).filter(d => d.startsWith('culm-chrome-'))
  let procs = ''
  try {
    procs = execFileSync('pgrep', ['-f', 'culm-chrome-']).toString()
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

test('closing leaves no Chrome and no profile folder', async () => {
  const o = await openBrowser()
  assert.ok(o.ok)
  await o.browser.close()
  await browser.close()
  assert.deepEqual(left(), { dirs: [], procs: '' })
})
