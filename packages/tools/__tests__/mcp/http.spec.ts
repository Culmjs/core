import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { memoryStore } from '@culmjs/core/ops'
import { kitRegistry, siteWith } from '../../../core/__tests__/kit.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { listenLocal } from '../../src/mcp/http.ts'

const closers: (() => Promise<void>)[] = []
after(async () => {
  for (const c of closers) await c()
})

async function start() {
  const server = createMcpServer({
    store: memoryStore({ s: siteWith() }),
    registry: kitRegistry(),
    site: 's',
    data: { rows: {} },
  })
  const lines: string[] = []
  const l = await listenLocal(server, 0, x => lines.push(x))
  closers.push(l.close)
  return { ...l, lines }
}

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
})

function send(
  port: number,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      res => {
        let text = ''
        res.on('data', d => (text += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      },
    )
    req.on('error', reject)
    req.end(INIT)
  })
}

test('the listening address is 127.0.0.1', async () => {
  const l = await start()
  const probe = http.createServer()
  // The port is taken on 127.0.0.1, and a request there reaches us.
  await assert.rejects(
    new Promise((_, rej) => {
      probe.once('error', rej)
      probe.listen(l.port, '127.0.0.1')
    }),
  )
  const r = await send(l.port, {
    host: `127.0.0.1:${l.port}`,
    authorization: `Bearer ${l.token}`,
  })
  assert.equal(r.status, 200)
})

test('a request with Host "evil.test" is 403', async () => {
  const l = await start()
  const r = await send(l.port, {
    host: 'evil.test',
    authorization: `Bearer ${l.token}`,
  })
  assert.equal(r.status, 403)
})

test('a request with Host "127.0.0.1:<other port>" is 403', async () => {
  const l = await start()
  const r = await send(l.port, {
    host: `127.0.0.1:${l.port + 1}`,
    authorization: `Bearer ${l.token}`,
  })
  assert.equal(r.status, 403)
})

test('a request with any Origin header is 403', async () => {
  const l = await start()
  for (const origin of ['http://evil.test', `http://127.0.0.1:${l.port}`, '']) {
    const r = await send(l.port, {
      host: `localhost:${l.port}`,
      origin,
      authorization: `Bearer ${l.token}`,
    })
    assert.equal(r.status, 403, `origin "${origin}"`)
  }
})

test('a request with no Authorization, and with a wrong token, is 403', async () => {
  const l = await start()
  const host = { host: `127.0.0.1:${l.port}` }
  assert.equal((await send(l.port, host)).status, 403)
  const wrong = [
    `Bearer ${'0'.repeat(64)}`,
    'Bearer short',
    `Bearer ${l.token}00`,
    l.token,
    `Basic ${l.token}`,
  ]
  for (const a of wrong) {
    const r = await send(l.port, { ...host, authorization: a })
    assert.equal(r.status, 403, a)
  }
})

test('a request with the right Host and token and no Origin lists the tools', async () => {
  const l = await start()
  const client = new Client({ name: 't', version: '0' })
  closers.push(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${l.port}/`), {
      requestInit: { headers: { authorization: `Bearer ${l.token}` } },
    }),
  )
  const { tools } = await client.listTools()
  assert.ok(tools.length > 0)
})

test('the token goes to the log function once and never to standard output', async () => {
  const written: string[] = []
  const orig = process.stdout.write
  process.stdout.write = ((c: string | Uint8Array) => {
    written.push(String(c))
    return true
  }) as typeof process.stdout.write
  let l
  try {
    l = await start()
  } finally {
    process.stdout.write = orig
  }
  assert.equal(l.token.length, 64)
  assert.match(l.token, /^[0-9a-f]{64}$/)
  assert.equal(l.lines.filter(x => x.includes(l.token)).length, 1)
  assert.equal(l.lines.length, 1)
  assert.ok(!written.join('').includes(l.token))
})

test('two servers get different tokens', async () => {
  const a = await start()
  const b = await start()
  assert.notEqual(a.token, b.token)
  assert.notEqual(a.port, b.port)
})

test('close ends the listener', async () => {
  const l = await start()
  await l.close()
  await assert.rejects(send(l.port, { authorization: `Bearer ${l.token}` }))
})
