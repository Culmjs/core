import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { copyFixture } from '../fixtures.ts'
import { openProject } from '../../src/folder/project.ts'
import { main } from '../../src/cli/main.ts'
import { formatLocated } from '../../src/cli/print.ts'
import * as tools from '../../src/index.ts'

/** Runs `main` in this process, with its own folder and its own output. */
async function run(args: string[], cwd: string) {
  let out = ''
  let err = ''
  const code = await main(args, {
    cwd,
    out: s => void (out += s),
    err: s => void (err += s),
  })
  return { code, out, err }
}

const childArgs = (...args: string[]) => [
  '--conditions=@culmjs/source',
  '--import',
  import.meta.resolve('tsx'),
  new URL('./culm.ts', import.meta.url).pathname,
  ...args,
]
/** The command as its own process; the folder is its working folder. */
function child(cwd: string, ...args: string[]) {
  const p = spawn(process.execPath, childArgs(...args), {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  const waiters: (() => void)[] = []
  p.stdout.on('data', d => ((out += d), waiters.forEach(w => w())))
  p.stderr.on('data', d => ((err += d), waiters.forEach(w => w())))
  const exit = new Promise<number | null>(r => p.on('close', c => r(c)))
  return {
    p,
    exit,
    get out() {
      return out
    },
    get err() {
      return err
    },
    /** Resolves with the first match of `re` in what the child wrote to `which`. */
    async until(which: 'out' | 'err', re: RegExp): Promise<RegExpExecArray> {
      const hit = () => re.exec(which === 'out' ? out : err)
      for (let i = 0; i < 600; i++) {
        const m = hit()
        if (m) return m
        await new Promise<void>(r => {
          waiters.push(r)
          setTimeout(r, 50)
        })
      }
      throw new Error(`no ${re} in ${which}: ${out} | ${err}`)
    },
  }
}

const pagesIn = async (dir: string) =>
  (await readdir(dir, { recursive: true })).filter(f => f.endsWith('.html'))

test('build: exit 0 and dist/ holds three pages; with a problem: exit 1 and file:line:column on standard error', async () => {
  const dir = await copyFixture('site-basic')
  const ok = await run(['build'], dir)
  assert.equal(ok.code, 0, ok.err)
  assert.equal((await pagesIn(join(dir, 'dist'))).length, 3)

  const bad = await copyFixture('site-basic')
  const file = join(bad, 'pages', 'home.json')
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      '"block": "hero"',
      '"block": "nope"',
    ),
  )
  const r = await run(['build'], bad)
  assert.equal(r.code, 1)
  assert.match(r.err, /^pages\/home\.json:\d+:\d+ \S+ .+/m)
  assert.equal(r.out, '')
})

test('schema: writes culm.schema.json in the project root', async () => {
  const dir = await copyFixture('site-basic')
  const r = await run(['schema'], dir)
  assert.equal(r.code, 0, r.err)
  const schema = JSON.parse(
    await readFile(join(dir, 'culm.schema.json'), 'utf8'),
  )
  assert.equal(typeof schema, 'object')
  const p = await openProject(dir)
  assert.deepEqual(schema, tools.authoringSchema(p.registry))
})

test('schema: a block whose settings hold null exits 1 with the file and line, not a TypeError', async () => {
  const dir = await copyFixture('site-basic')
  const file = join(dir, 'blocks/cards.json')
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      '"settings": [',
      '"settings": [\n    null,',
    ),
  )
  const r = await run(['schema'], dir)
  assert.equal(r.code, 1)
  assert.match(r.err, /^blocks\/cards\.json:\d+:\d+ /m)
  assert.doesNotMatch(r.err, /TypeError/)
})

test('expand pages/home.json hero1: the short form is now nodes and the folder loads to the same document', async () => {
  const dir = await copyFixture('site-basic')
  const before = (await openProject(dir)).loaded
  assert.ok(before.doc)
  const r = await run(['expand', 'pages/home.json', 'hero1'], dir)
  assert.equal(r.code, 0, r.err)
  const text = await readFile(join(dir, 'pages', 'home.json'), 'utf8')
  assert.match(text, /"id": "hero1",\s*"kind": "column"/, text)
  assert.ok(!text.includes('"titleSize": 64,\n        "nowrap"'), text)
  const after = (await openProject(dir)).loaded
  assert.deepEqual(after.problems, [])
  assert.deepEqual(after.doc, before.doc)
  // what is not a short form in that file is a problem, and the file stays as it is
  const again = await run(['expand', 'pages/home.json', 'hero1'], dir)
  assert.equal(again.code, 1)
  assert.match(again.err, /hero1/)
  assert.equal(await readFile(join(dir, 'pages', 'home.json'), 'utf8'), text)
})

test('expand site.json <header id>: the header short form is expanded and the folder loads to the same document', async () => {
  const dir = await copyFixture('site-basic')
  const before = (await openProject(dir)).loaded
  assert.ok(before.doc)
  const r = await run(['expand', 'site.json', before.doc.header.id], dir)
  assert.equal(r.code, 0, r.err)
  assert.doesNotMatch(
    await readFile(join(dir, 'site.json'), 'utf8'),
    /"header":\s*\{\s*"block": "top"\s*\}/,
  )
  const after = (await openProject(dir)).loaded
  assert.deepEqual(after.problems, [])
  assert.deepEqual(after.doc, before.doc)
})

test('dev --port 0: prints the address, serves, and closes on SIGINT', async () => {
  const dir = await copyFixture('site-basic')
  const c = child(dir, 'dev', '--port', '0')
  const m = await c.until('out', /http:\/\/127\.0\.0\.1:(\d+)/)
  const res = await fetch(`http://127.0.0.1:${m[1]}/`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /<html/i)
  c.p.kill('SIGINT')
  assert.equal(await c.exit, 0)
})

const protocol = (line: string) => {
  const v = JSON.parse(line) as { jsonrpc?: string }
  assert.equal(v.jsonrpc, '2.0', line)
  return v as { id?: number; result?: { tools?: { name: string }[] } }
}

test('mcp defaults to the five authoring tools over stdio, with no extra stdout', async () => {
  const dir = await copyFixture('site-basic')
  const c = child(dir, 'mcp')
  const send = (m: unknown) => c.p.stdin.write(`${JSON.stringify(m)}\n`)
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    },
  })
  await c.until('out', /"id":1/)
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  await c.until('out', /"id":2/)
  c.p.stdin.end()
  assert.equal(await c.exit, 0)
  const lines = c.out.split('\n').filter(Boolean)
  const msgs = lines.map(protocol)
  assert.deepEqual(
    msgs
      .find(m => m.id === 2)
      ?.result?.tools?.map(t => t.name)
      .sort(),
    ['build', 'describe', 'find', 'measure', 'render', 'write'],
  )
})

test('mcp --port 0: prints the token on standard error and refuses a request without it', async () => {
  const dir = await copyFixture('site-basic')
  const c = child(dir, 'mcp', '--port', '0')
  const tok = await c.until('err', /MCP token: ([0-9a-f]{64})/)
  const port = (await c.until('err', /http:\/\/127\.0\.0\.1:(\d+)/))[1]
  assert.ok(!c.out.includes(tok[1]!))
  const init = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    },
  })
  const post = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: init,
    })
  assert.equal((await post({})).status, 403)
  const ok = await post({ authorization: `Bearer ${tok[1]}` })
  assert.equal(ok.status, 200)
  await ok.text()
  c.p.kill('SIGINT')
  await c.exit
})

test('mcp --full passes protect: setRequired null through the tool is refused', async () => {
  const dir = await copyFixture('site-basic')
  const client = new Client({ name: 't', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: childArgs('mcp', '--full'),
      cwd: dir,
      stderr: 'ignore',
    }),
  )
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args })
      const text = (r.content as { text: string }[])[0]!.text
      return { error: r.isError === true, json: JSON.parse(text) }
    }
    const d = await call('describe', {})
    assert.equal(d.error, false)
    const base = d.json.revision as number
    const tree = { page: 'home' }
    const set = (required: boolean | null) => ({
      op: 'setRequired',
      tree,
      id: 'intro',
      required,
    })
    const on = await call('apply', {
      baseRevision: base,
      key: 'k1',
      ops: [set(true)],
    })
    assert.equal(on.error, false, JSON.stringify(on.json))
    const off = await call('plan', {
      baseRevision: on.json.revision ?? base + 1,
      ops: [set(null)],
    })
    assert.equal(off.error, true, JSON.stringify(off.json))
    assert.equal(off.json.problems[0].code, 'POLICY_VIOLATION')
    assert.equal(off.json.problems[0].rule, 'protected')
  } finally {
    await client.close()
  }
})

test('an unknown command and a missing argument: exit 2 and the usage text', async () => {
  const dir = await copyFixture('site-basic')
  for (const args of [
    ['frobnicate'],
    [],
    ['expand'],
    ['expand', 'pages/home.json'],
    ['dev', '--port', 'x'],
    ['build', '--nope'],
  ]) {
    const r = await run(args, dir)
    assert.equal(r.code, 2, args.join(' '))
    assert.match(r.err, /Usage: culm/)
    assert.equal(r.out, '')
  }
  const help = await run(['--help'], dir)
  assert.equal(help.code, 0)
  assert.match(help.out, /Usage: culm/)
})

test('run outside a project folder: one problem naming culm.json, exit 1', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'culm-empty-'))
  try {
    for (const cmd of ['build', 'check', 'schema', 'mcp']) {
      const r = await run([cmd], empty)
      assert.equal(r.code, 1, cmd)
      assert.equal(r.err.trim().split('\n').length, 1, r.err)
      assert.match(r.err, /culm\.json/)
    }
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})

test('check with no Chromium exits 2', async () => {
  const dir = await copyFixture('site-basic')
  const r = await run(['check', '--chrome', '/nonexistent/chrome'], dir)
  assert.equal(r.code, 2)
  assert.match(r.err, /MEASUREMENT_INCOMPLETE/)
  assert.match(r.err, /CULM_CHROME/)
})

test('check: a problem in the files is exit 1 before any browser is opened', async () => {
  const dir = await copyFixture('site-basic')
  const file = join(dir, 'pages', 'home.json')
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      '"block": "hero"',
      '"block": "nope"',
    ),
  )
  const r = await run(['check', '--chrome', '/nonexistent/chrome'], dir)
  assert.equal(r.code, 1)
  assert.match(r.err, /^pages\/home\.json:\d+:\d+ /m)
})

test('check: an asset linked outside the project is refused, exit 1 before any browser', async () => {
  const dir = await copyFixture('site-basic')
  const outside = await mkdtemp(join(tmpdir(), 'culm-outside-'))
  try {
    await writeFile(join(outside, 'x.png'), 'x')
    await mkdir(join(dir, 'assets'), { recursive: true })
    await symlink(join(outside, 'x.png'), join(dir, 'assets', 'x.png'))
    const r = await run(['check', '--chrome', '/nonexistent/chrome'], dir)
    assert.equal(r.code, 1)
    assert.match(r.err, /^assets\/x\.png:1:1 .*is refused/m)
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})

test('check exits 0 when the only findings are class 3, 1 for class 2, 2 for an incomplete cell', async () => {
  const dir = await copyFixture('site-basic')
  const exit = async (findings: number[], incomplete: unknown[] = []) =>
    await (async () => {
      let code = -1
      code = await main(['check'], {
        cwd: dir,
        out: () => {},
        err: () => {},
        measure: (async () => ({
          findings: findings.map(c => ({
            class: c,
            check: 'x',
            page: 'home',
            message: 'm',
            nodes: [],
          })),
          measured: [],
          incomplete,
        })) as never,
      })
      return code
    })()
  assert.equal(await exit([3]), 0)
  assert.equal(await exit([2]), 1)
  assert.equal(await exit([3, 2]), 1)
  assert.equal(
    await exit(
      [3],
      [
        {
          page: 'home',
          problem: { code: 'MEASUREMENT_INCOMPLETE', message: 'm' },
        },
      ],
    ),
    2,
  )
})

test('formatLocated: file:line:column, the code or the check, the message, then the allowed values', () => {
  assert.equal(
    formatLocated({
      code: 'INVALID_DOCUMENT',
      message: 'No.',
      file: 'a.json',
      line: 3,
      column: 5,
    }),
    'a.json:3:5 INVALID_DOCUMENT No.',
  )
  assert.equal(
    formatLocated({
      code: 'UNKNOWN_KIND',
      message: 'Pick one.',
      file: 'a.json',
      line: 1,
      column: 1,
      allowed: ['a', 'b', 'c'],
    }),
    'a.json:1:1 UNKNOWN_KIND Pick one.\n  allowed: a, b, c',
  )
  assert.equal(
    formatLocated({
      check: 'overflow',
      message: 'Too wide.',
      file: 'p.json',
      line: 9,
      column: 2,
    } as never),
    'p.json:9:2 overflow Too wide.',
  )
  assert.equal(
    formatLocated({ code: 'INVALID_DOCUMENT', message: 'No.' }),
    'INVALID_DOCUMENT No.',
  )
})

test('tools index exports exactly the ten names', () => {
  assert.deepEqual(Object.keys(tools).sort(), [
    'authoringSchema',
    'buildSite',
    'createMcpServer',
    'fileStore',
    'loadFolder',
    'measureSince',
    'openProject',
    'protect',
    'renderImage',
    'runMeasure',
  ])
})

test('mcp locates a problem in the files as they are now, after a change to them', async () => {
  const dir = await copyFixture('site-basic')
  const client = new Client({ name: 't', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: childArgs('mcp', '--full'),
      cwd: dir,
      stderr: 'ignore',
    }),
  )
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args })
      return JSON.parse((r.content as { text: string }[])[0]!.text)
    }
    const bad = (revision: number) =>
      call('plan', {
        baseRevision: revision,
        ops: [
          {
            op: 'setStyle',
            tree: { page: 'home' },
            id: 'intro',
            layer: 'base',
            decl: { size: 8 },
          },
        ],
      })
    const file = join(dir, 'pages', 'home.json')
    const lineOf = async () =>
      (await readFile(file, 'utf8'))
        .split('\n')
        .findIndex(l => l.includes('"size": 18')) + 1
    const { revision } = await call('describe', {})
    const first = await bad(revision)
    assert.equal(
      first.problems[0].file,
      'pages/home.json',
      JSON.stringify(first),
    )
    const was = await lineOf()
    assert.equal(first.problems[0].line, was)
    // lines are added above `intro` by hand
    const text = await readFile(file, 'utf8')
    await writeFile(
      file,
      text.replace(
        '"slug": "/",',
        `"slug": "/",\n${'    // more\n'.repeat(12)}`,
      ),
    )
    const now = await lineOf()
    assert.ok(now > was + 10)
    const { revision: next } = await call('describe', {})
    const second = await bad(next)
    assert.equal(second.problems[0].file, 'pages/home.json')
    assert.equal(second.problems[0].line, now)
  } finally {
    await client.close()
  }
})

test('check, build, dev, schema and expand create no .culm/', async () => {
  const dir = await copyFixture('site-basic')
  await run(['build'], dir)
  await run(['schema'], dir)
  await run(['expand', 'pages/home.json', 'hero1'], dir)
  await run(['check', '--chrome', '/nonexistent/chrome'], dir)
  const c = child(dir, 'dev', '--port', '0')
  await c.until('out', /http:\/\/127\.0\.0\.1:\d+/)
  c.p.kill('SIGINT')
  await c.exit
  assert.ok(!existsSync(join(dir, '.culm')))
})

test('mcp starts on a folder whose files have problems, and a tool returns them located', async () => {
  const dir = await copyFixture('site-basic')
  const file = join(dir, 'pages', 'home.json')
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(
      '"block": "hero"',
      '"block": "nope"',
    ),
  )
  const client = new Client({ name: 't', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: childArgs('mcp'),
      cwd: dir,
      stderr: 'ignore',
    }),
  )
  try {
    const r = await client.callTool({ name: 'describe', arguments: {} })
    assert.equal(r.isError, true)
    const j = JSON.parse((r.content as { text: string }[])[0]!.text)
    assert.equal(j.problems[0].file, 'pages/home.json')
  } finally {
    await client.close()
  }
})
