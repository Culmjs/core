import { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { READ_CAP } from '@culmjs/core/ops'
import { folderMcpOptions } from '../../src/cli/main.ts'
import { openProject } from '../../src/folder/project.ts'
import { createMcpServer } from '../../src/mcp/server.ts'

const closers: (() => Promise<void>)[] = []
after(async () => {
  for (const c of closers) await c()
})

/** An SDK client over a server that serves the folder the way `culm mcp` does. */
export async function serve(dir: string, executable?: string) {
  const project = await openProject(dir)
  const server = createMcpServer(
    await folderMcpOptions(dir, project, executable),
  )
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  closers.push(() => client.close())
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args })
    const content = r.content as { type: string; text: string }[]
    assert.equal(content.length, 1)
    assert.ok(content[0]!.text.length <= READ_CAP)
    return {
      error: r.isError === true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: JSON.parse(content[0]!.text) as any,
    }
  }
  return { call, project }
}

/** Every file of the project folder (not `.culm/`) with its text. */
export async function files(
  dir: string,
  rel = '',
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.name === '.culm') continue
    if (e.isDirectory()) Object.assign(out, await files(dir, p))
    else out[p] = await readFile(join(dir, p), 'utf8')
  }
  return out
}
/** The 1-based line of the first line holding `needle`. */
export const lineOf = (text: string, needle: string) =>
  text.split('\n').findIndex(l => l.includes(needle)) + 1
