import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

// A request of 1,000,000 characters written as \uXXXX escapes is about 6 MB; core's own limit refuses what is too long.
const MAX_BODY = 8 * 1024 * 1024

const body = async (req: IncomingMessage): Promise<unknown> => {
  const parts: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new Error('too large')
    parts.push(c as Buffer)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

/**
 * Serves MCP on 127.0.0.1 behind Host, Origin and bearer-token checks.
 * Session mode: a Server connects to one transport and a stateless transport
 * is single-use, so each `initialize` without a session id gets its own
 * transport and its own `make()` Server; later requests route by session id.
 */
export async function listenLocal(
  make: () => Server,
  port: number,
  log: (line: string) => void = line => process.stderr.write(`${line}\n`),
): Promise<{ port: number; token: string; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex')
  const want = Buffer.from(`Bearer ${token}`)
  const sessions = new Map<string, StreamableHTTPServerTransport>()
  const servers = new Set<Server>()
  let bound = 0

  const http = createServer(async (req, res) => {
    const refuse = (status: number) =>
      res.writeHead(status, { 'content-type': 'text/plain' }).end('Refused')
    const hosts = req.rawHeaders.filter(
      (h, i) => i % 2 === 0 && h.toLowerCase() === 'host',
    )
    if (hosts.length > 1) return refuse(400)
    const host = req.headers.host
    const got = Buffer.from(req.headers.authorization ?? '')
    const ok =
      (host === `127.0.0.1:${bound}` || host === `localhost:${bound}`) &&
      req.headers.origin === undefined &&
      got.length === want.length &&
      timingSafeEqual(got, want)
    if (!ok) return refuse(403)

    try {
      const sid = req.headers['mcp-session-id']
      if (typeof sid === 'string') {
        const t = sessions.get(sid)
        if (!t) return refuse(404)
        return await t.handleRequest(req, res)
      }
      if (req.method !== 'POST') return refuse(400)
      const parsed = await body(req)
      if (!isInitializeRequest(parsed)) return refuse(400)
      const t: StreamableHTTPServerTransport =
        new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => void sessions.set(id, t),
          maxRequestBodySize: MAX_BODY,
        })
      const server = make()
      servers.add(server)
      t.onclose = () => {
        if (t.sessionId) sessions.delete(t.sessionId)
        servers.delete(server)
      }
      try {
        await server.connect(t)
        await t.handleRequest(req, res, parsed)
      } finally {
        // a failed initialize, or a throw, opened no session: nothing else will close this transport
        if (!t.sessionId) await t.close().catch(() => {})
      }
    } catch {
      if (!res.headersSent) refuse(400)
      else res.end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, '127.0.0.1', () => {
      bound = (http.address() as { port: number }).port
      resolve()
    })
  })
  log(`MCP token: ${token}`)

  return {
    port: bound,
    token,
    async close() {
      http.closeAllConnections()
      await Promise.all([
        new Promise<void>(r => http.close(() => r())),
        ...[...servers].map(s => s.close()),
      ])
    },
  }
}
