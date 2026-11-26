import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply, restore } from '@culmjs/core/ops'
import type { SiteStore } from '@culmjs/core/ops'
import type { Registry, SiteDocument } from '@culmjs/core'
import { storeContract } from '../../../core/__tests__/ops/storeContract.ts'
import { text, twoPages } from '../../../core/__tests__/kit.ts'
import { loadFiles, readProject } from '../../src/folder/load.ts'
import { loadPlugins } from '../../src/folder/plugins.ts'
import { fileEdits } from '../../src/folder/write.ts'
import {
  fileStore,
  KEPT_REVISIONS,
  LOCK_STALE_MS,
} from '../../src/folder/store.ts'

const made: string[] = []
after(async () => {
  for (const d of made.splice(0)) await rm(d, { recursive: true, force: true })
})

type Opts = { after?(step: number): void; now?(): number }
const SITE = 'site'

/** Writes `doc` as a folder with the writer, starting from an empty project. */
async function project(doc: SiteDocument) {
  const dir = await mkdtemp(join(tmpdir(), 'culm-store-'))
  made.push(dir)
  const empty = new Map([
    ['culm.json', '{\n  "plugins": [],\n  "out": "dist"\n}\n'],
    [
      'site.json',
      JSON.stringify({ name: doc.name, look: doc.look, pages: [] }, null, 2) +
        '\n',
    ],
  ])
  const { registry } = await loadPlugins(dir, empty)
  const loaded = await loadFiles(empty, registry)
  assert.ok(loaded.doc, JSON.stringify(loaded.problems))
  const edits = fileEdits(loaded.doc, doc, loaded, registry)
  assert.deepEqual(edits.problems, [])
  for (const [f, t] of [...empty, ...Object.entries(edits.write)]) {
    await mkdir(dirname(join(dir, f)), { recursive: true })
    await writeFile(join(dir, f), t)
  }
  return { dir, registry }
}
async function open(doc: SiteDocument, options?: Opts) {
  const { dir, registry } = await project(doc)
  return { dir, registry, store: await fileStore(dir, registry, options) }
}

storeContract('file', async doc => {
  const { dir, registry } = await project(doc)
  return { store: await fileStore(dir, registry), site: SITE, registry }
})

const T = { page: 'home' }
const set = (id: string, words: string, tree: { page: string } = T) => ({
  op: 'setText',
  tree,
  id,
  text: words,
})
const req = (base: number, key: string, ops: unknown[]) =>
  ({ site: SITE, baseRevision: base, key, ops }) as Parameters<typeof apply>[2]
const headOf = async (store: SiteStore) => {
  const h = await store.head(SITE)
  assert.ok('revision' in h, JSON.stringify(h))
  return h
}
const codeOf = (r: Awaited<ReturnType<typeof apply>>) => {
  assert.ok(!r.ok)
  return r.problems[0].code
}
/** Every file under `dir` (relative path) with its text and mtime. */
function snap(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) Object.assign(out, snap(dir, p), { [`${p}/`]: '' })
    else
      out[p] =
        readFileSync(join(dir, p), 'utf8') +
        '@' +
        statSync(join(dir, p)).mtimeMs
  }
  return out
}
const two = () =>
  twoPages([text('t1', 'One')], [text('a1', 'Two')], { name: 'Ada' })
const both = (base: number, key: string) =>
  req(base, key, [set('t1', 'A'), set('a1', 'B', { page: 'about' })])

for (const step of [5, 6, 7, 8])
  test(`a crash after step ${step} leaves the folder wholly old or wholly new`, async () => {
    let crash = false
    const { dir, registry, store } = await open(two(), {
      after: n => {
        if (crash && n === step) throw new Error('crash')
      },
    })
    const r0 = (await headOf(store)).revision
    const old = await readProject(dir)
    crash = true
    await assert.rejects(apply(store, registry, both(r0, 'k')), /crash/)
    const fresh = await fileStore(dir, registry)
    const files = await readProject(dir)
    const result = await fresh.replay(SITE, 'k')
    if (step === 8) {
      assert.notDeepEqual(files, old)
      assert.ok(result?.result.ok)
      assert.equal((await headOf(fresh)).revision, r0 + 1)
      assert.equal(files.get('pages/home.json')?.includes('"A"'), true)
      assert.equal(files.get('pages/about.json')?.includes('"B"'), true)
    } else {
      assert.deepEqual(files, old)
      assert.equal(result, undefined)
      assert.equal((await headOf(fresh)).revision, r0)
    }
    const left = readdirSync(join(dir, '.culm'))
    assert.ok(!left.includes('journal.json'))
    assert.ok(!left.includes('lock'))
    const head = Number(readFileSync(join(dir, '.culm/head'), 'utf8'))
    for (const f of readdirSync(join(dir, '.culm/revisions')))
      assert.ok(Number.parseInt(f, 10) <= head, f)
    // the batch can be sent again
    const again = await apply(fresh, registry, both(head, 'k2'))
    assert.ok(again.ok)
  })

const hand = (
  dir: string,
  from: string,
  to: string,
  file = 'pages/home.json',
) => {
  const p = join(dir, file)
  const t = readFileSync(p, 'utf8')
  assert.ok(t.includes(from), from)
  writeFileSync(p, t.replace(from, to))
}

test('a hand edit becomes one outside revision on the next apply, and that apply is REVISION_CONFLICT', async () => {
  const { dir, registry, store } = await open(two())
  const r0 = (await headOf(store)).revision
  assert.ok(
    (await apply(store, registry, req(r0, 'a', [set('t1', 'Mine')]))).ok,
  )
  hand(dir, 'Mine', 'Hand')
  const seen = await headOf(store)
  assert.equal(seen.revision, r0 + 1, 'head does not record the edit')
  const r = await apply(
    store,
    registry,
    req(r0 + 1, 'b', [set('a1', 'X', { page: 'about' })]),
  )
  assert.equal(codeOf(r), 'REVISION_CONFLICT')
  const now = await headOf(store)
  assert.equal(now.revision, r0 + 2)
  const rec = JSON.parse(
    readFileSync(join(dir, `.culm/revisions/${r0 + 2}.json`), 'utf8'),
  )
  assert.equal(rec.by, 'outside')
  assert.equal(await store.replay(SITE, 'b'), undefined)
  assert.deepEqual(await store.get(SITE, r0 + 2), now.doc)
  const ok = await apply(
    store,
    registry,
    req(r0 + 2, 'b', [set('a1', 'X', { page: 'about' })]),
  )
  assert.ok(ok.ok && ok.revision === r0 + 3)
})

test('several hand saves between two batches are one outside revision', async () => {
  const { dir, registry, store } = await open(two())
  const r0 = (await headOf(store)).revision
  assert.ok(
    (await apply(store, registry, req(r0, 'a', [set('t1', 'Mine')]))).ok,
  )
  hand(dir, 'Mine', 'H1')
  hand(dir, 'H1', 'H2')
  hand(dir, 'Two', 'H3', 'pages/about.json')
  assert.equal(
    codeOf(await apply(store, registry, req(r0 + 1, 'b', [set('t1', 'Z')]))),
    'REVISION_CONFLICT',
  )
  assert.equal((await headOf(store)).revision, r0 + 2)
  assert.deepEqual(
    readdirSync(join(dir, '.culm/revisions')).sort(),
    [r0, r0 + 1, r0 + 2].map(n => `${n}.json`),
  )
})

test('check, build and head write nothing to .culm/', async () => {
  const { dir, registry, store } = await open(two())
  const r0 = (await headOf(store)).revision
  assert.ok((await apply(store, registry, req(r0, 'a', [set('t1', 'A')]))).ok)
  const before = snap(join(dir, '.culm'))
  hand(dir, '"A"', '"Hand"') // an unrecorded hand edit is not recorded by reading
  const s = await fileStore(dir, registry)
  await headOf(s)
  await s.get(SITE, r0)
  await s.get(SITE, -1)
  await s.replay(SITE, 'a')
  await headOf(store)
  assert.deepEqual(snap(join(dir, '.culm')), before)
  // and a folder that never had a history stays without one
  const plain = await project(two())
  const s2 = await fileStore(plain.dir, plain.registry)
  await headOf(s2)
  await s2.get(SITE, 5)
  await s2.replay(SITE, 'k')
  assert.ok(!readdirSync(plain.dir).includes('.culm'))
})

test('a file that changed between plan and write is SOURCE_CONFLICT and nothing is written', async () => {
  let dir = ''
  let on = false
  const o = await open(two(), {
    after: n => {
      if (on && n === 2) {
        on = false
        hand(dir, '"One"', '"Late"')
      }
    },
  })
  dir = o.dir
  const r0 = (await headOf(o.store)).revision
  on = true
  const r = await apply(o.store, o.registry, req(r0, 'k', [set('t1', 'A')]))
  assert.equal(codeOf(r), 'SOURCE_CONFLICT')
  const t = readFileSync(join(dir, 'pages/home.json'), 'utf8')
  assert.ok(t.includes('"Late"') && !t.includes('"A"'))
  assert.equal(await o.store.replay(SITE, 'k'), undefined)
  assert.ok(!readdirSync(join(dir, '.culm')).includes('journal.json'))
  assert.ok(!readdirSync(join(dir, '.culm')).includes('lock'))
})

test('a second process holding the lock makes commit wait and then succeed', async () => {
  const { dir, registry, store } = await open(two())
  const r0 = (await headOf(store)).revision
  mkdirSync(join(dir, '.culm'), { recursive: true })
  writeFileSync(
    join(dir, '.culm/lock'),
    JSON.stringify({ pid: process.pid, time: Date.now() }),
  )
  const t0 = Date.now()
  setTimeout(() => void rm(join(dir, '.culm/lock')), 300)
  const r = await apply(store, registry, req(r0, 'k', [set('t1', 'A')]))
  assert.ok(r.ok)
  assert.ok(Date.now() - t0 >= 250, 'it waited')
  assert.ok(!readdirSync(join(dir, '.culm')).includes('lock'))
})

test('a stale lock is taken over by exactly one of two contenders', async () => {
  const NOW = 1_700_000_000_000
  const log: string[] = []
  const hook = (name: string) => (n: number) => {
    if (n === 1) log.push(`in ${name}`)
    if (n === 9) log.push(`out ${name}`)
  }
  const { dir, registry } = await project(two())
  mkdirSync(join(dir, '.culm'), { recursive: true })
  writeFileSync(
    join(dir, '.culm/lock'),
    JSON.stringify({ pid: process.pid, time: NOW - LOCK_STALE_MS - 1000 }),
  )
  const a = await fileStore(dir, registry, { now: () => NOW, after: hook('a') })
  const b = await fileStore(dir, registry, { now: () => NOW, after: hook('b') })
  const r0 = (await headOf(a)).revision
  const [x, y] = await Promise.all([
    apply(a, registry, req(r0, 'ka', [set('t1', 'A')])),
    apply(b, registry, req(r0, 'kb', [set('t1', 'B')])),
  ])
  assert.deepEqual([x.ok, y.ok].sort(), [false, true])
  assert.equal(codeOf(x.ok ? y : x), 'REVISION_CONFLICT')
  assert.equal(log.length, 4, log.join())
  assert.equal(log[0].slice(3), log[1].slice(4), `no overlap: ${log.join()}`)
  assert.ok(log[0].startsWith('in') && log[1].startsWith('out'))
  assert.ok(!readdirSync(join(dir, '.culm')).includes('lock'))
})

let grown: Promise<{
  dir: string
  registry: Registry
  store: SiteStore
  r0: number
}>
const grow = () =>
  (grown ??= (async () => {
    const o = await open(two())
    const r0 = (await headOf(o.store)).revision
    for (let i = 0; i < KEPT_REVISIONS + 1; i++) {
      const r = await apply(
        o.store,
        o.registry,
        req(r0 + i, `k${i}`, [set('t1', `v${i}`)]),
      )
      assert.ok(r.ok, `${i}`)
      if (i === KEPT_REVISIONS - 1) {
        // 200 commits and the first revision: 201 records, the oldest goes
        assert.equal(await o.store.get(SITE, r0), undefined)
        assert.ok(await o.store.get(SITE, r0 + 1))
      }
    }
    return { ...o, r0 }
  })())

test('revision 201 prunes the oldest and its unshared blobs; restore to it is UNSUPPORTED_CAPABILITY', async () => {
  const { dir, registry, store, r0 } = await grow()
  const recs = readdirSync(join(dir, '.culm/revisions'))
  assert.equal(recs.length, KEPT_REVISIONS)
  const kept = new Set<string>()
  for (const f of recs)
    for (const h of Object.values(
      JSON.parse(readFileSync(join(dir, '.culm/revisions', f), 'utf8'))
        .files as Record<string, string>,
    ))
      kept.add(h)
  assert.deepEqual(
    readdirSync(join(dir, '.culm/blobs')).sort(),
    [...kept].sort(),
  )
  assert.equal(await store.get(SITE, r0 + 1), undefined)
  assert.ok(await store.get(SITE, r0 + 2))
  const head = await headOf(store)
  const r = await restore(store, registry, {
    site: SITE,
    to: r0 + 1,
    baseRevision: head.revision,
    key: 'rr',
  })
  assert.equal(codeOf(r), 'UNSUPPORTED_CAPABILITY')
})

test('a key of a pruned revision is treated as new', async () => {
  const { store, registry } = await grow()
  assert.equal(await store.replay(SITE, 'k0'), undefined)
  assert.ok(await store.replay(SITE, 'k1'))
  const head = await headOf(store)
  const r = await apply(
    store,
    registry,
    req(head.revision, 'k0', [set('t1', 'again')]),
  )
  assert.ok(r.ok && r.revision === head.revision + 1)
})

test('a deleted .culm/ starts at a number higher than any earlier one', async () => {
  const { dir, registry } = await project(two())
  const s1 = await fileStore(dir, registry, { now: () => 1_000_000_000_000 })
  const r0 = (await headOf(s1)).revision
  assert.equal(r0, 1_000_000_000)
  assert.ok((await apply(s1, registry, req(r0, 'a', [set('t1', 'A')]))).ok)
  assert.ok((await apply(s1, registry, req(r0 + 1, 'b', [set('t1', 'B')]))).ok)
  await rm(join(dir, '.culm'), { recursive: true })
  const s2 = await fileStore(dir, registry, { now: () => 1_000_000_100_000 })
  const n = (await headOf(s2)).revision
  assert.ok(n > r0 + 2, `${n}`)
  assert.equal(await s2.replay(SITE, 'a'), undefined)
  assert.ok((await apply(s2, registry, req(n, 'c', [set('t1', 'C')]))).ok)
  assert.equal((await headOf(s2)).revision, n + 1)
})

test('files that do not load: head returns located problems and records nothing', async () => {
  const { dir, registry, store } = await open(two())
  const r0 = (await headOf(store)).revision
  assert.ok((await apply(store, registry, req(r0, 'a', [set('t1', 'A')]))).ok)
  const before = snap(join(dir, '.culm'))
  writeFileSync(join(dir, 'pages/about.json'), '{ "id": ')
  const h = await store.head(SITE)
  assert.ok('problems' in h && h.problems.length > 0)
  assert.equal((h.problems[0] as { file?: string }).file, 'pages/about.json')
  const r = await apply(store, registry, req(r0 + 1, 'b', [set('t1', 'B')]))
  assert.ok(!r.ok)
  const s = await fileStore(dir, registry)
  assert.ok('problems' in (await s.head(SITE)))
  assert.deepEqual(snap(join(dir, '.culm')), before)
})

test('get(revision) returns the document of that revision with comments ignored and without touching the disk', async () => {
  const { dir, registry, store } = await open(two())
  const first = await headOf(store)
  assert.ok(
    (await apply(store, registry, req(first.revision, 'a', [set('t1', 'A')])))
      .ok,
  )
  const second = await headOf(store)
  const p = join(dir, 'pages/home.json')
  writeFileSync(p, '// a note by hand\n' + readFileSync(p, 'utf8'))
  assert.equal(
    codeOf(
      await apply(store, registry, req(second.revision, 'b', [set('t1', 'B')])),
    ),
    'REVISION_CONFLICT',
  )
  const outside = await headOf(store)
  assert.deepEqual(outside.doc, second.doc, 'a comment changes no document')
  assert.deepEqual(await store.get(SITE, outside.revision), second.doc)
  // the project files are gone; the revisions are not
  for (const f of ['pages', 'pieces', 'blocks', 'data'])
    await rm(join(dir, f), { recursive: true, force: true })
  await rm(join(dir, 'site.json'))
  const s = await fileStore(dir, registry)
  assert.deepEqual(await s.get(SITE, first.revision), first.doc)
  assert.deepEqual(await s.get(SITE, second.revision), second.doc)
  assert.deepEqual(readdirSync(dir).sort(), ['.culm', 'culm.json'])
})

// Review Focus 5
const damages: [string, (dir: string, head: number) => string][] = [
  [
    'head empty',
    dir => (writeFileSync(join(dir, '.culm/head'), ''), '.culm/head'),
  ],
  [
    'head not a number',
    dir => (writeFileSync(join(dir, '.culm/head'), 'abc\n'), '.culm/head'),
  ],
  [
    'a revision record that does not parse',
    (dir, head) => (
      writeFileSync(join(dir, `.culm/revisions/${head}.json`), '{ "files": '),
      `.culm/revisions/${head}.json`
    ),
  ],
  [
    'head deleted while revisions exist',
    dir => (rmSync(join(dir, '.culm/head')), '.culm/head'),
  ],
  [
    'a non-head record that does not parse',
    (dir, head) => (
      writeFileSync(join(dir, `.culm/revisions/${head - 1}.json`), 'nope'),
      `.culm/revisions/${head - 1}.json`
    ),
  ],
  [
    'a blob missing',
    (dir, head) => {
      const rec = JSON.parse(
        readFileSync(join(dir, `.culm/revisions/${head}.json`), 'utf8'),
      ) as { files: Record<string, string> }
      const h = rec.files['pages/home.json']
      rmSync(join(dir, '.culm/blobs', h))
      return `.culm/blobs/${h}`
    },
  ],
]
for (const [damage, hurt] of damages)
  test(`${damage}: head returns a problem naming the file, and nothing is rewritten`, async () => {
    const { dir, registry, store } = await open(two())
    const r0 = (await headOf(store)).revision
    assert.ok((await apply(store, registry, req(r0, 'a', [set('t1', 'A')]))).ok)
    const file = hurt(dir, r0 + 1)
    const before = snap(join(dir, '.culm'))
    const s = await fileStore(dir, registry)
    const h = await s.head(SITE)
    assert.ok('problems' in h, JSON.stringify(h))
    assert.equal((h.problems[0] as { file?: string }).file, file)
    assert.match(h.problems[0].message, /delete \.culm\//)
    assert.equal(await s.get(SITE, r0), undefined)
    const r = await apply(s, registry, req(r0 + 1, 'b', [set('t1', 'B')]))
    assert.ok(!r.ok)
    assert.deepEqual(snap(join(dir, '.culm')), before)
  })

const commented = async (dir: string) => {
  const about = join(dir, 'pages/about.json')
  writeFileSync(
    about,
    '// about note\n' + readFileSync(about, 'utf8').replace(/\n  /g, '\n\t'),
  )
  const home = join(dir, 'pages/home.json')
  writeFileSync(
    home,
    readFileSync(home, 'utf8').replace('"One"', '"One" /* keep */'),
  )
}

test('restore after removePage writes the stored files back, comments and tabs included', async () => {
  const { dir, registry, store } = await open(two())
  await commented(dir)
  const n = (await headOf(store)).revision
  const atN = await readProject(dir)
  const r = await apply(
    store,
    registry,
    req(n, 'a', [{ op: 'removePage', page: 'about' }]),
  )
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(!(await readProject(dir)).has('pages/about.json'))
  const rr = await restore(store, registry, {
    site: SITE,
    to: n,
    baseRevision: n + 1,
    key: 'b',
  })
  assert.ok(rr.ok, JSON.stringify(rr))
  assert.deepEqual(await readProject(dir), atN)
  const head = await headOf(store)
  assert.equal(head.revision, n + 2)
  assert.deepEqual(await store.get(SITE, n + 2), await store.get(SITE, n))
})

test('a store that outlives the deletion of .culm/ never restarts at an old number', async () => {
  const { dir, registry } = await project(two())
  const store = await fileStore(dir, registry, { now: () => 1_000_000_000_000 })
  const r0 = (await headOf(store)).revision
  assert.ok((await apply(store, registry, req(r0, 'a', [set('t1', 'A')]))).ok)
  await rm(join(dir, '.culm'), { recursive: true })
  const n = (await headOf(store)).revision
  assert.ok(n > r0 + 1, `${n}`)
  assert.equal(
    (await headOf(store)).revision,
    n,
    'the number holds until the first commit',
  )
  const old = await apply(store, registry, req(r0, 'b', [set('t1', 'B')]))
  assert.equal(codeOf(old), 'REVISION_CONFLICT')
  assert.ok((await apply(store, registry, req(n, 'c', [set('t1', 'C')]))).ok)
})

test('the first batch on a folder with no history is REVISION_CONFLICT when the files changed since head', async () => {
  const { dir, registry, store } = await open(two())
  const n = (await headOf(store)).revision
  hand(dir, '"One"', '"Hand"')
  const r = await apply(store, registry, req(n, 'a', [set('t1', 'Z')]))
  assert.equal(codeOf(r), 'REVISION_CONFLICT')
  assert.ok(
    readFileSync(join(dir, 'pages/home.json'), 'utf8').includes('"Hand"'),
  )
  assert.ok(!existsSync(join(dir, '.culm/head')))
})

test('a lock left by a dead process is taken over by recovery', async () => {
  let crash = false
  const { dir, registry, store } = await open(two(), {
    after: n => {
      if (crash && n === 6) throw new Error('crash')
    },
  })
  const r0 = (await headOf(store)).revision
  const old = await readProject(dir)
  crash = true
  await assert.rejects(apply(store, registry, both(r0, 'k')), /crash/)
  // the failed commit now rolls itself back, so plant what a killed process would leave
  writeFileSync(
    join(dir, '.culm/journal.json'),
    JSON.stringify({ paths: ['site.json'] }),
  )
  writeFileSync(
    join(dir, '.culm/lock'),
    JSON.stringify({ pid: 99_999_999, time: Date.now(), token: 'dead' }),
  )
  const again = await fileStore(dir, registry)
  assert.deepEqual(await readProject(dir), old)
  assert.ok(!readdirSync(join(dir, '.culm')).includes('lock'))
  assert.ok(!readdirSync(join(dir, '.culm')).includes('journal.json'))
  assert.equal((await headOf(again)).revision, r0)
})

for (const withRecord of [false, true])
  test(`an interrupted first commit (${withRecord ? 'blobs and a record' : 'blobs only'}, no head) is recovered`, async () => {
    const { dir, registry } = await project(two())
    const old = await readProject(dir)
    mkdirSync(join(dir, '.culm/blobs'), { recursive: true })
    mkdirSync(join(dir, '.culm/revisions'), { recursive: true })
    const files: Record<string, string> = {}
    for (const [p, t] of old) {
      if (p === 'data') continue
      const h = createHash('sha256').update(t).digest('hex')
      writeFileSync(join(dir, '.culm/blobs', h), t)
      files[p] = h
    }
    if (withRecord)
      writeFileSync(
        join(dir, '.culm/revisions/5.json'),
        JSON.stringify({ files, by: 'culm', time: 1 }),
      )
    const store = await fileStore(dir, registry)
    const h = await headOf(store)
    assert.deepEqual(await readProject(dir), old)
    assert.ok(!readdirSync(join(dir, '.culm')).includes('head'))
    const r = await apply(
      store,
      registry,
      req(h.revision, 'k', [set('t1', 'A')]),
    )
    assert.ok(r.ok, JSON.stringify(r))
    assert.equal((await headOf(store)).revision, h.revision + 1)
  })

test('a revision record that names a path outside the project is damage; restore writes nothing', async () => {
  const { dir, registry, store } = await open(two())
  const n = (await headOf(store)).revision
  assert.ok((await apply(store, registry, req(n, 'a', [set('t1', 'A')]))).ok)
  const recFile = join(dir, '.culm', 'revisions', `${n}.json`)
  const rec = JSON.parse(readFileSync(recFile, 'utf8'))
  rec.files['../evil.json'] = Object.values<string>(rec.files)[0]
  writeFileSync(recFile, JSON.stringify(rec))
  const r = await restore(store, registry, {
    site: SITE,
    to: n,
    baseRevision: n + 1,
    key: 'b',
  })
  assert.ok(!r.ok, JSON.stringify(r))
  assert.ok(
    JSON.stringify(r.problems).includes(`.culm/revisions/${n}.json`),
    JSON.stringify(r.problems),
  )
  assert.ok(!existsSync(join(dir, '..', 'evil.json')))
  rmSync(join(dir, '..', 'evil.json'), { force: true })
})

test('a commit that throws while writing files leaves the last good site in the same store', async () => {
  let crash = true
  const { dir, registry, store } = await open(two(), {
    after: n => {
      if (crash && n === 6) {
        crash = false
        throw new Error('disk full')
      }
    },
  })
  const r0 = (await headOf(store)).revision
  const before = readFileSync(join(dir, 'site.json'), 'utf8')
  const batch = (key: string) =>
    req(r0, key, [{ op: 'addPage', title: 'About2', slug: '/about2' }])
  await assert.rejects(apply(store, registry, batch('k')), /disk full/)
  const h = await store.head(SITE)
  assert.ok('revision' in h, JSON.stringify(h))
  assert.equal(h.revision, r0)
  assert.equal(readFileSync(join(dir, 'site.json'), 'utf8'), before)
  assert.equal(existsSync(join(dir, 'pages/about2.json')), false)
  assert.equal(existsSync(join(dir, '.culm/journal.json')), false)
  const again = await apply(store, registry, batch('k2'))
  assert.ok(again.ok)
  assert.equal((await headOf(store)).revision, r0 + 1)
})
