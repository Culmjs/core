import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

/**
 * Serves `server` on 127.0.0.1 behind Host, Origin and bearer-token checks.
 * Session mode, one session: a Server connects to one transport, and a
 * stateless transport must be new for every request, so one stateful
 * transport carries the one client that initialises first.
 */
export async function listenLocal(
  server: Server,
  port: number,
  log: (line: string) => void = line => process.stderr.write(`${line}\n`),
): Promise<{ port: number; token: string; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex')
  const want = Buffer.from(`Bearer ${token}`)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(transport)

  const http = createServer((req, res) => {
    const host = req.headers.host
    const got = Buffer.from(req.headers.authorization ?? '')
    const ok =
      (host === `127.0.0.1:${bound}` || host === `localhost:${bound}`) &&
      req.headers.origin === undefined &&
      got.length === want.length &&
      timingSafeEqual(got, want)
    if (!ok) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden')
      return
    }
    transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  let bound = 0
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
        server.close(),
      ])
    },
  }
}
