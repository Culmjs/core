import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRegistry, emptySite } from '@culmjs/core'
import { memoryStore } from '@culmjs/core/ops'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { inspectImageBytes } from '../src/image/generate.ts'
import { createMcpServer } from '../src/mcp/server.ts'
import { openBrowser, type Browser } from '../src/measure/browser.ts'
import { decodePng } from '../src/measure/png.ts'
import { renderImage } from '../src/render/render.ts'
import { LOOK } from '../../core/__tests__/kit.ts'

let browser: Browser
const dirs: string[] = []

before(async () => {
  const opened = await openBrowser()
  assert.ok(opened.ok, opened.ok ? '' : JSON.stringify(opened.problems))
  browser = opened.browser
})

after(async () => {
  await browser?.close()
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })))
})

async function makeDir() {
  const d = await mkdtemp(join(tmpdir(), 'culm-render-browser-'))
  dirs.push(d)
  return d
}

test('renderImage exports PNG (@1x, @2x), WebP, and transparent alpha PNG verified by decodePng', async () => {
  const dir = await makeDir()

  // 1. Standalone 1200x630 OG card as PNG @1x and @2x
  const ogNode = {
    kind: 'box',
    id: 'og',
    style: {
      width: 'fill',
      height: 'fill',
      bg: 'deep',
      color: 'on-deep',
      padding: 64,
      overflow: 'clip',
    },
    children: [
      {
        kind: 'shape',
        placement: { mode: 'behind' },
        contours: { seed: 11, bands: 10 },
        style: { width: 'fill', height: 'fill', opacity: 0.35 },
      },
      {
        kind: 'column',
        style: { gap: 20 },
        children: [
          {
            kind: 'text',
            level: 'h1',
            text: 'Low-Token Graphics',
            style: { size: 64, weight: 800, color: 'on-deep' },
          },
          {
            kind: 'box',
            style: { width: 540, bg: 'bg', padding: 16, radius: 12 },
            children: [
              {
                kind: 'shape',
                chart: {
                  chart: 'area',
                  series: [{ values: [15, 42, 38, 74, 92], color: 'brand' }],
                },
                style: { width: 'fill', height: 180 },
              },
            ],
          },
        ],
      },
    ],
  }
  const png1 = await renderImage(
    { out: 'out/og.png', node: ogNode, size: 'og', scale: 1 },
    { cwd: dir, browser },
  )
  assert.equal(png1.ok, true, JSON.stringify(png1))
  if (png1.ok) {
    assert.deepEqual(png1.findings, [])
    const img = decodePng(await readFile(join(dir, 'out/og.png')))
    assert.equal(img.width, 1200)
    assert.equal(img.height, 630)
  }

  const png2 = await renderImage(
    { out: 'out/og2x.png', node: ogNode, size: '600x315', scale: 2 },
    { cwd: dir, browser },
  )
  assert.equal(png2.ok, true, JSON.stringify(png2))
  if (png2.ok) {
    const img2 = decodePng(await readFile(join(dir, 'out/og2x.png')))
    assert.equal(img2.width, 1200)
    assert.equal(img2.height, 630)
  }

  // 2. WebP output
  const webp = await renderImage(
    { out: 'out/og.webp', node: ogNode, size: '600x315', format: 'webp' },
    { cwd: dir, browser },
  )
  assert.equal(webp.ok, true, JSON.stringify(webp))
  const webpBytes = await readFile(join(dir, 'out/og.webp'))
  assert.equal(inspectImageBytes(webpBytes)?.ext, 'webp')

  // 3. Transparent alpha channel verification (corner pixel alpha === 0, center non-zero)
  const alphaRes = await renderImage(
    {
      out: 'out/badge.png',
      size: '200x200',
      transparent: true,
      node: {
        kind: 'shape',
        id: 'dot',
        geometry: { type: 'ellipse' },
        fill: 'brand',
        style: { width: 100, height: 100, margin: 50 },
      },
    },
    { cwd: dir, browser },
  )
  assert.equal(alphaRes.ok, true, JSON.stringify(alphaRes))
  const alphaImg = decodePng(await readFile(join(dir, 'out/badge.png')))
  assert.equal(alphaImg.rgba[3], 0, 'corner pixel must be transparent')
  const centerIdx = (100 * alphaImg.width + 100) * 4
  assert.equal(alphaImg.rgba[centerIdx + 3], 255, 'center pixel must be opaque')
})

test('MCP render clips an existing site node by id and reports contrast findings automatically', async () => {
  const dir = await makeDir()
  const store = memoryStore({ s: emptySite('RenderSite', LOOK) })
  const server = createMcpServer({
    store,
    registry: createRegistry(),
    site: 's',
    data: { rows: {} },
    browser,
    cwd: dir,
    jsonOps: true,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  try {
    const wr = await client.callTool({
      name: 'write',
      arguments: {
        baseRevision: 0,
        page: 'home',
        ops: [
          {
            op: 'insert',
            node: {
              kind: 'box',
              id: 'card',
              style: { width: 420, padding: 24, bg: '#ffffff' },
              children: [
                {
                  kind: 'text',
                  id: 'faint',
                  text: 'Low contrast text',
                  style: { color: '#f4f4f4', size: 16 },
                },
              ],
            },
          },
        ],
      },
    })
    assert.equal(wr.isError, undefined, JSON.stringify(wr))

    const clipped = await client.callTool({
      name: 'render',
      arguments: {
        out: 'assets/card.png',
        page: 'home',
        id: 'card',
        size: '800x600',
      },
    })
    assert.equal(clipped.isError, undefined, JSON.stringify(clipped))
    const json = JSON.parse((clipped.content as { text: string }[])[0]!.text)
    assert.equal(json.width, 420)
    assert.ok(
      json.findings.some((f: { check: string }) => f.check === 'contrast'),
      `expected contrast finding, got ${JSON.stringify(json.findings)}`,
    )
    const png = decodePng(await readFile(join(dir, 'assets/card.png')))
    assert.equal(png.width, 420)
  } finally {
    await client.close()
  }
})
