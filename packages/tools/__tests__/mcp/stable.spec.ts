import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRegistry, emptySite, type Data } from '@culmjs/core'
import { memoryStore } from '@culmjs/core/ops'
import starter, { LOOK } from '@culmjs/starter'
import { createMcpServer } from '../../src/mcp/server.ts'

const data: Data = { rows: {} }
async function connect() {
  const registry = createRegistry()
  registry.use(starter)
  const store = memoryStore({ s: emptySite('Ada', LOOK) })
  const server = createMcpServer({ store, registry, site: 's', data })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args })
    return (r.content as { text: string }[])[0]!.text
  }
  return { client, call }
}

test('tools/list is byte-identical between two calls and between two servers', async () => {
  const a = await connect()
  const b = await connect()
  const one = JSON.stringify(await a.client.listTools())
  assert.equal(JSON.stringify(await a.client.listTools()), one)
  assert.equal(JSON.stringify(await b.client.listTools()), one)
})

test('each catalogue list reply is byte-identical at revisions 0 and 1 of a site whose first page did not change; the starter blocks list is at most 1,500 characters', async () => {
  const { call } = await connect()
  const before = {} as Record<string, string>
  for (const what of [
    'guide',
    'kinds',
    'operations',
    'recipes',
    'blocks',
    'sources',
  ])
    before[what] = await call('catalogue', { what })
  assert.ok(before.blocks!.length <= 1500, `${before.blocks!.length}`)
  const r = JSON.parse(
    await call('apply', {
      baseRevision: 0,
      key: 'k1',
      ops: [{ op: 'setSite', name: 'Other' }],
    }),
  )
  assert.equal(r.revision, 1)
  for (const what of Object.keys(before))
    assert.equal(await call('catalogue', { what }), before[what], what)
})

// Decision 13: the 2d `catalogue operations` reply, 10,500 characters, is the whole first read.
test('the five list replies guide, kinds, operations, recipes and blocks on the starter registry total at most 10,500 characters', async () => {
  const { call } = await connect()
  let total = 0
  for (const what of ['guide', 'kinds', 'operations', 'recipes', 'blocks'])
    total += (await call('catalogue', { what })).length
  assert.ok(total <= 10500, `${total}`)
})

test('the tools README states the real tool counts', async () => {
  const count = async (jsonOps: boolean, sections = false) => {
    const registry = createRegistry()
    registry.use(starter)
    const server = createMcpServer({
      store: memoryStore({ s: emptySite('Ada', LOOK) }),
      registry,
      site: 's',
      data,
      jsonOps,
      sections,
    })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0' })
    await Promise.all([server.connect(b), client.connect(a)])
    return (await client.listTools()).tools.length
  }
  const readme = readFileSync(
    new URL('../../README.md', import.meta.url),
    'utf8',
  )
  assert.match(readme, new RegExp(`serve ${await count(true)} JSON tools`))
  assert.match(readme, new RegExp(`all ${await count(false)} tools`))
  assert.match(
    readme,
    new RegExp(`--sections serves ${await count(true, true)} tools`),
  )
})
