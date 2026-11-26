import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRegistry, emptySite } from '@culmjs/core'
import { memoryStore } from '@culmjs/core/ops'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { main } from '../../src/cli/main.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { LOOK } from '../../../core/__tests__/kit.ts'

const dirs: string[] = []
after(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })))
})

async function makeDir() {
  const d = await mkdtemp(join(tmpdir(), 'culm-render-unit-'))
  dirs.push(d)
  return d
}

test('MCP render exports standalone SVG without browser and blocks path escape', async () => {
  const dir = await makeDir()
  const store = memoryStore({ s: emptySite('R', LOOK) })
  const server = createMcpServer({
    store,
    registry: createRegistry(),
    site: 's',
    data: { rows: {} },
    cwd: dir,
    jsonOps: true,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  try {
    const res = await client.callTool({
      name: 'render',
      arguments: {
        out: 'assets/chart.svg',
        size: '800x400',
        node: {
          kind: 'shape',
          id: 'c1',
          chart: {
            chart: 'bar',
            labels: ['Mon', 'Tue', 'Wed'],
            series: [{ name: 'Runs', values: [4, 9, 7] }],
          },
        },
      },
    })
    assert.equal(res.isError, undefined, JSON.stringify(res))
    const json = JSON.parse((res.content as { text: string }[])[0]!.text)
    assert.equal(json.out, 'assets/chart.svg')
    assert.equal(json.format, 'svg')
    assert.equal(json.width, 800)
    assert.equal(json.height, 400)
    const svg = await readFile(join(dir, 'assets/chart.svg'), 'utf8')
    assert.match(
      svg,
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="800" height="400"/,
    )
    assert.equal(svg.includes('var(--s-'), false)

    // Path traversal outside cwd is refused
    const esc = await client.callTool({
      name: 'render',
      arguments: {
        out: '../outside.svg',
        node: { kind: 'shape', stamp: { text: 'SEAL' } },
      },
    })
    assert.equal(esc.isError, true)
    const errJson = JSON.parse((esc.content as { text: string }[])[0]!.text)
    assert.equal(errJson.problems[0].code, 'POLICY_VIOLATION')
  } finally {
    await client.close()
  }
})

test('CLI culm render works standalone outside a project folder for SVG specs', async () => {
  const dir = await makeDir()
  const specPath = join(dir, 'emblem.json')
  await writeFile(
    specPath,
    JSON.stringify({
      kind: 'shape',
      stamp: { text: 'STATIC · CHECKED · 2026', center: 'OK', teeth: 18 },
    }),
  )
  let out = ''
  let err = ''
  const code = await main(
    ['render', 'emblem.json', '--out', 'emblem.svg', '--size', 'icon'],
    {
      cwd: dir,
      out: s => void (out += s),
      err: s => void (err += s),
    },
  )
  assert.equal(code, 0, err)
  assert.match(out, /Rendered emblem\.svg \(svg, 512x512@1x/)
  const svg = await readFile(join(dir, 'emblem.svg'), 'utf8')
  assert.match(svg, /STATIC · CHECKED · 2026/)
  assert.match(svg, /width="512" height="512"/)
})
