import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
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
  const make = () =>
    createMcpServer({
      store: memoryStore({ s: siteWith() }),
      registry: kitRegistry(),
      site: 's',
      data: { rows: {} },
    })
  const lines: string[] = []
  const l = await listenLocal(make, 0, x => lines.push(x))
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
  const other = Object.values(os.networkInterfaces())
    .flat()
    .find(i => i && !i.internal && i.family === 'IPv4')
  if (other) {
    await assert.rejects(
      new Promise((res, rej) => {
        const s = net.connect(l.port, other.address, () => {
          s.destroy()
          res(0)
        })
        s.on('error', rej)
      }),
      { code: 'ECONNREFUSED' },
    )
  }
})

test('two Host headers are refused with 400', async () => {
  const l = await start()
  const status = await new Promise<number>((resolve, reject) => {
    const s = net.connect(l.port, '127.0.0.1', () =>
      s.write(
        `POST / HTTP/1.1\r\nHost: 127.0.0.1:${l.port}\r\nHost: 127.0.0.1:${l.port}\r\nAuthorization: Bearer ${l.token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
      ),
    )
    let t = ''
    s.on('data', d => (t += d))
    s.on('end', () => resolve(Number(t.split(' ')[1])))
    s.on('error', reject)
  })
  assert.equal(status, 400)
})

test('the default log writes the token to stderr and not stdout', async () => {
  const out: string[] = []
  const err: string[] = []
  const o = process.stdout.write
  const e = process.stderr.write
  process.stdout.write = ((c: string) => (out.push(String(c)), true)) as never
  process.stderr.write = ((c: string) => (err.push(String(c)), true)) as never
  let l
  try {
    l = await listenLocal(
      () =>
        createMcpServer({
          store: memoryStore({ s: siteWith() }),
          registry: kitRegistry(),
          site: 's',
          data: { rows: {} },
        }),
      0,
    )
  } finally {
    process.stdout.write = o
    process.stderr.write = e
  }
  closers.push(l.close)
  assert.ok(err.join('').includes(l.token))
  assert.ok(!out.join('').includes(l.token))
})

async function connectClient(l: { port: number; token: string }) {
  const client = new Client({ name: 't', version: '0' })
  closers.push(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${l.port}/`), {
      requestInit: { headers: { authorization: `Bearer ${l.token}` } },
    }),
  )
  return client
}

test('a client can close and a new one reconnect', async () => {
  const l = await start()
  const a = await connectClient(l)
  const n = (await a.listTools()).tools.length
  assert.equal(n, 11)
  await a.close()
  const b = await connectClient(l)
  assert.equal((await b.listTools()).tools.length, 11)
})

test('two clients at once both list tools', async () => {
  const l = await start()
  const [a, b] = [await connectClient(l), await connectClient(l)]
  assert.equal((await a.listTools()).tools.length, 11)
  assert.equal((await b.listTools()).tools.length, 11)
})

test('an unknown session id is refused', async () => {
  const l = await start()
  const r = await send(l.port, {
    host: `127.0.0.1:${l.port}`,
    authorization: `Bearer ${l.token}`,
    'mcp-session-id': 'nope',
  })
  assert.equal(r.status, 404)
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

test('a failed initialize leaves no server behind', async () => {
  let made = 0
  let closed = 0
  const l = await listenLocal(
    () => {
      const s = createMcpServer({
        store: memoryStore({ s: siteWith() }),
        registry: kitRegistry(),
        site: 's',
        data: { rows: {} },
      })
      made++
      s.onclose = () => void closed++
      return s
    },
    0,
    () => {},
  )
  closers.push(l.close)
  // no Accept header: the transport refuses with 406 and never opens a session
  const r = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: l.port,
        method: 'POST',
        path: '/',
        headers: {
          host: `127.0.0.1:${l.port}`,
          authorization: `Bearer ${l.token}`,
          'content-type': 'application/json',
        },
      },
      res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end(INIT)
  })
  assert.equal(r, 406)
  assert.equal(made, 1)
  assert.equal(closed, 1)
})

test('a request of 1,000,000 characters written with \\u escapes (about 6 MB) is not refused for its size', async () => {
  const l = await start()
  const client = await connectClient(l)
  const sessionId = (client.transport as { sessionId?: string }).sessionId
  assert.ok(sessionId)
  const big = '\\u0061'.repeat(1_000_000)
  const text = `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"describe","arguments":{"x":"${big}"}}}`
  assert.ok(text.length > 5_000_000)
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: l.port,
        method: 'POST',
        path: '/',
        headers: {
          host: `127.0.0.1:${l.port}`,
          authorization: `Bearer ${l.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
        },
      },
      res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end(text)
  })
  // the request is read whole; core's own limit then refuses the tool call, as a result of the call, not as a status
  assert.equal(status, 200)
})
