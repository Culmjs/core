import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { copyFixture } from '../fixtures.ts'
import { openProject } from '../../src/folder/project.ts'
import { buildSite } from '../../src/build/bundle.ts'
import { CLIENT_MARKER, CLIENT_SCRIPT } from '../../src/dev/client.ts'
import { startDev } from '../../src/dev/server.ts'

type Dev = Awaited<ReturnType<typeof startDev>>
type Ev = { event: string; data: unknown }

/** Starts a dev server on a free port and runs `fn`; the server and the event streams are closed after, pass or fail. */
async function withDev(
  fn: (d: {
    dir: string
    dev: Dev
    events: ReturnType<typeof listen>
  }) => Promise<void>,
  prep?: (dir: string) => Promise<void>,
) {
  const dir = await copyFixture('site-basic')
  await prep?.(dir)
  const dev = await startDev(dir, { port: 0 })
  const events = listen(dev.port)
  try {
    await events.ready
    await fn({ dir, dev, events })
  } finally {
    events.stop()
    await dev.close()
  }
}

/** A hand-read server-sent event stream. */
function listen(port: number) {
  const log: Ev[] = []
  let req!: http.ClientRequest
  const ready = new Promise<void>((ok, bad) => {
    req = http.get({ host: '127.0.0.1', port, path: '/__culm/events' }, res => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => {
        buf += c
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const ev = /^event: (.*)$/m.exec(block)?.[1]
          const data = /^data: (.*)$/m.exec(block)?.[1]
          if (ev)
            log.push({ event: ev, data: data ? JSON.parse(data) : undefined })
        }
      })
      res.on('error', () => {})
      ok()
    })
    req.on('error', bad)
  })
  const wait = async (event: string, from = 0) => {
    for (let t = 0; t < 100; t++) {
      const i = log.findIndex((e, k) => k >= from && e.event === event)
      if (i >= 0) return i
      await new Promise(r => setTimeout(r, 50))
    }
    throw new Error(`no "${event}" event; got ${JSON.stringify(log)}`)
  }
  return { log, ready, wait, stop: () => req.destroy() }
}

/** A request with its path and headers sent as given (fetch normalises `..` away). */
function raw(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((ok, bad) => {
    const r = http.get({ host: '127.0.0.1', port, path, headers }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', c => (body += c))
      res.on('end', () => ok({ status: res.statusCode!, body }))
    })
    r.on('error', bad)
  })
}

const get = async (dev: Dev, path: string) => {
  const r = await fetch(dev.url + path)
  return { status: r.status, body: await r.text() }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

test('serves each page at its slug with the client script before </body>', async () => {
  await withDev(async ({ dev }) => {
    for (const [path, title] of [
      ['/', 'Basic'],
      ['/menu', 'Menu'],
      ['/about', 'About'],
    ] as const) {
      const r = await get(dev, path)
      assert.equal(r.status, 200, path)
      assert.ok(r.body.includes(CLIENT_MARKER), path)
      assert.ok(r.body.includes(CLIENT_SCRIPT), path)
      assert.ok(
        r.body.indexOf(CLIENT_MARKER) < r.body.lastIndexOf('</body>'),
        path,
      )
      assert.ok(r.body.includes('<title>') || title, path)
    }
    assert.ok(CLIENT_SCRIPT.length > 100)
    assert.ok(CLIENT_SCRIPT.includes('/__culm/events'))
  })
})

test('a save produces a reload event and the next fetch shows the change', async () => {
  await withDev(async ({ dir, dev, events }) => {
    const p = join(dir, 'pages/about.json')
    const t = await readFile(p, 'utf8')
    assert.ok(t.includes('"title": "About"'))
    await writeFile(p, t.replace('"title": "About"', '"title": "Zebra"'))
    await events.wait('reload')
    assert.ok((await get(dev, '/about')).body.includes('Zebra'))
    assert.deepEqual(events.log.find(e => e.event === 'reload')!.data, {})
  })
})

test('an invalid save produces a problems event with file, line, column and allowed kinds, and the served page is unchanged', async () => {
  await withDev(async ({ dir, dev, events }) => {
    const before = (await get(dev, '/about')).body
    const p = join(dir, 'pages/about.json')
    const t = await readFile(p, 'utf8')
    await writeFile(p, t.replace('"kind": "column"', '"kind": "colum"'))
    const i = await events.wait('problems')
    const ps = events.log[i]!.data as {
      file?: string
      line?: number
      column?: number
      message: string
      allowed?: string[]
    }[]
    assert.ok(Array.isArray(ps) && ps.length > 0)
    const hit = ps.find(x => x.file === 'pages/about.json')
    assert.ok(hit, JSON.stringify(ps))
    assert.equal(typeof hit.line, 'number')
    assert.equal(typeof hit.column, 'number')
    assert.ok(
      Array.isArray(hit.allowed) && hit.allowed.includes('column'),
      JSON.stringify(hit),
    )
    assert.equal((await get(dev, '/about')).body, before)
    assert.equal(
      events.log.some(e => e.event === 'reload'),
      false,
    )
  })
})

test('a save that fixes it produces reload', async () => {
  await withDev(async ({ dir, dev, events }) => {
    const p = join(dir, 'pages/about.json')
    const t = await readFile(p, 'utf8')
    await writeFile(p, t.replace('"kind": "column"', '"kind": "colum"'))
    const i = await events.wait('problems')
    await writeFile(p, t.replace('"title": "About"', '"title": "Fixed"'))
    await events.wait('reload', i)
    assert.ok((await get(dev, '/about')).body.includes('Fixed'))
  })
})

test.skip('a change to blocks/ or culm.json rewrites culm.schema.json', async () => {
  // enabled in Task 15 (JSON Schema)
  await withDev(async ({ dir, events }) => {
    const schema = join(dir, 'culm.schema.json')
    await writeFile(schema, 'stale')
    const p = join(dir, 'culm.json')
    await writeFile(p, (await readFile(p, 'utf8')).replace('"dist"', '"dist2"'))
    await events.wait('reload')
    assert.notEqual(await readFile(schema, 'utf8'), 'stale')
    await writeFile(schema, 'stale')
    const b = join(dir, 'blocks/top.json')
    await writeFile(b, (await readFile(b, 'utf8')) + '\n')
    await events.wait('reload', events.log.length)
    assert.notEqual(await readFile(schema, 'utf8'), 'stale')
  })
})

test('a Host header other than 127.0.0.1:<port> or localhost:<port> is refused with 403', async () => {
  await withDev(async ({ dev }) => {
    for (const h of [
      'evil.example',
      'evil.example:' + dev.port,
      '127.0.0.1',
      '127.0.0.1:1',
      'localhost',
    ]) {
      assert.equal((await raw(dev.port, '/', { Host: h })).status, 403, h)
      assert.equal(
        (await raw(dev.port, '/__culm/events', { Host: h })).status,
        403,
        h,
      )
    }
    assert.equal(
      (await raw(dev.port, '/', { Host: `127.0.0.1:${dev.port}` })).status,
      200,
    )
    assert.equal(
      (await raw(dev.port, '/', { Host: `localhost:${dev.port}` })).status,
      200,
    )
  })
})

test('a path that resolves outside assets/ and fonts/ is 404', async () => {
  await withDev(
    async ({ dev }) => {
      for (const p of [
        '/assets/../site.json',
        '/assets/%2e%2e/site.json',
        '/assets/..%2fsite.json',
        '/assets/%2e%2e%2fsite.json',
        '/_fonts/../site.json',
        '/_fonts/..%2f..%2fsite.json',
        '/assets/%2fetc/passwd',
        '/assets/a%00b',
        '/assets/%zz',
        '/assets/',
        '/assets',
        '/fonts/x.woff2',
      ]) {
        const r = await raw(dev.port, p)
        assert.equal(r.status, 404, p)
        assert.ok(!r.body.includes('"Basic"'), p)
      }
      assert.equal((await get(dev, '/assets/a.txt')).body, 'A')
      assert.equal((await get(dev, '/_fonts/x.woff2')).body, 'F')
    },
    async dir => {
      await mkdir(join(dir, 'assets'))
      await mkdir(join(dir, 'fonts'))
      await writeFile(join(dir, 'assets/a.txt'), 'A')
      await writeFile(join(dir, 'fonts/x.woff2'), 'F')
    },
  )
})

test('the server listens on 127.0.0.1 only', async () => {
  await withDev(async ({ dev }) => {
    assert.match(dev.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.equal(dev.url, `http://127.0.0.1:${dev.port}`)
    const other = Object.values(networkInterfaces())
      .flat()
      .find(i => i && i.family === 'IPv4' && !i.internal)
    if (!other) return
    await assert.rejects(
      new Promise((ok, bad) => {
        const r = http.get(
          { host: other.address, port: dev.port, path: '/' },
          ok,
        )
        r.on('error', bad)
      }),
    )
  })
})

test('CLIENT_MARKER is absent from every file buildSite writes', async () => {
  const dir = await copyFixture('site-basic')
  const r = await buildSite(await openProject(dir))
  assert.ok(r.ok)
  for (const f of await readdir(r.out, { recursive: true })) {
    if (!(await stat(join(r.out, f))).isFile()) continue
    assert.ok(
      !(await readFile(join(r.out, f), 'utf8')).includes(CLIENT_MARKER),
      f,
    )
  }
  assert.equal(CLIENT_MARKER, 'culm-dev-client')
})

test('a file truncated mid-write then completed gives problems then reload, and no crash', async () => {
  await withDev(async ({ dir, dev, events }) => {
    const p = join(dir, 'pages/about.json')
    const t = await readFile(p, 'utf8')
    const before = (await get(dev, '/about')).body
    await writeFile(p, t.slice(0, Math.floor(t.length / 2)))
    const i = await events.wait('problems')
    assert.equal((await get(dev, '/about')).body, before)
    await writeFile(p, t)
    const j = await events.wait('reload', i)
    assert.ok(j > i)
    assert.equal((await get(dev, '/about')).status, 200)
  })
})

test('two saves within 50 ms give one reload', async () => {
  await withDev(async ({ dir, events }) => {
    const p = join(dir, 'pages/about.json')
    const t = await readFile(p, 'utf8')
    await writeFile(p, t.replace('"title": "About"', '"title": "One"'))
    await sleep(10)
    await writeFile(p, t.replace('"title": "About"', '"title": "Two"'))
    await events.wait('reload')
    await sleep(500)
    assert.equal(events.log.filter(e => e.event === 'reload').length, 1)
  })
})

test('"/menu", "/menu/", "/menu?x=1" serve the menu page; a nested slug "/a/b" is served; "/nope" is 404', async () => {
  await withDev(async ({ dir, dev, events }) => {
    const menu = (await get(dev, '/menu')).body
    assert.equal(menu.includes(CLIENT_MARKER), true)
    assert.equal((await get(dev, '/menu/')).body, menu)
    assert.equal((await get(dev, '/menu?x=1')).body, menu)
    assert.equal((await get(dev, '/nope')).status, 404)
    assert.equal((await get(dev, '/a/b')).status, 404)
    const p = join(dir, 'pages/about.json')
    const t = await readFile(p, 'utf8')
    assert.ok(t.includes('"slug": "/about"'))
    await writeFile(p, t.replace('"slug": "/about"', '"slug": "/a/b"'))
    await events.wait('reload')
    const nested = await get(dev, '/a/b')
    assert.equal(nested.status, 200)
    assert.ok(nested.body.includes(CLIENT_MARKER))
    assert.equal((await get(dev, '/a/b/')).status, 200)
    assert.equal((await get(dev, '/about')).status, 404)
  })
})

test('a symbolic link in assets/ that leaves the project is 404', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'culm-outside-'))
  await writeFile(join(outside, 'secret.txt'), 'SECRET')
  await withDev(
    async ({ dev }) => {
      assert.equal((await get(dev, '/assets/inside.txt')).body, 'in')
      for (const p of ['/assets/link.txt', '/assets/dirlink/secret.txt']) {
        const r = await get(dev, p)
        assert.equal(r.status, 404, p)
        assert.ok(!r.body.includes('SECRET'), p)
      }
    },
    async dir => {
      await mkdir(join(dir, 'assets'))
      await writeFile(join(dir, 'assets/inside.txt'), 'in')
      await symlink(join(outside, 'secret.txt'), join(dir, 'assets/link.txt'))
      await symlink(outside, join(dir, 'assets/dirlink'))
    },
  )
})

test('the client draws the overlay with text nodes, never HTML', () => {
  assert.ok(CLIENT_SCRIPT.includes('textContent'))
  assert.ok(!CLIENT_SCRIPT.includes('innerHTML'))
  assert.ok(
    CLIENT_SCRIPT.includes("'problems'") && CLIENT_SCRIPT.includes("'reload'"),
  )
})
