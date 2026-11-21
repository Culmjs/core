import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Registry } from '@culmjs/core'
import type { ApplyResult, SiteStore } from '@culmjs/core/ops'
import { loadFiles, loadFolder } from './load.ts'
import type { Loaded } from './load.ts'
import type { Located } from './plugins.ts'
import { fileEdits } from './write.ts'

export const KEPT_REVISIONS = 200
export const LOCK_STALE_MS = 60_000

type Rec = {
  files: Record<string, string>
  by: 'culm' | 'outside'
  key?: string
  request?: string
  result?: ApplyResult
  time: number
}
type State =
  | { kind: 'fresh'; stale?: true }
  | { kind: 'ok'; revision: number; rec: Rec }
  | { kind: 'bad'; problem: Located }
type Refusal = {
  ok: false
  code: 'REVISION_CONFLICT' | 'KEY_CONFLICT' | 'SOURCE_CONFLICT'
  problems?: Located[]
}

/** What a revision holds: culm.json, site.json and the files under pages/, pieces/ and blocks/. */
const covered = (p: string) =>
  p === 'culm.json' || p === 'site.json' || /^(pages|pieces|blocks)\//.test(p)
const sha = (t: string) => createHash('sha256').update(t).digest('hex')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code
const HEX = /^[0-9a-f]{64}$/

const alive = (pid: unknown) => {
  if (typeof pid !== 'number') return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return code(e) !== 'ESRCH'
  }
}

/**
 * The history of a folder site in `.culm/` (spec item 44), behind the `SiteStore` interface. A folder is one site, so the site name
 * is ignored. Only `commit`, and recovery of an interrupted commit when the store is opened, write to `.culm/`.
 * `options.after(step)` runs after each of commit's nine steps (a test throws from it to simulate a crash; step 6's runs after the
 * first of the file renames); `options.now` replaces the clock.
 * `commit` refuses with SOURCE_CONFLICT (and the problems) when `fileEdits` cannot make an edit, and with REVISION_CONFLICT (and
 * the problems) when the folder does not load or `.culm/` is damaged. A restore of a revision the store holds writes that revision's
 * files back as they were; any other change is planned by `fileEdits`.
 * ponytail: a reader does not take the lock, so it can see a folder halfway through a commit; take it for reads if that matters.
 */
export async function fileStore(
  dir: string,
  registry: Registry,
  options: { after?(step: number): void; now?(): number } = {},
): Promise<SiteStore> {
  const now = options.now ?? Date.now
  const hook = (n: number) => options.after?.(n)
  const culm = join(dir, '.culm')
  const lockPath = join(culm, 'lock')
  const journalPath = join(culm, 'journal.json')
  /** The highest revision number this instance has reported or committed; a new history always starts above it. */
  let last = -1
  /** The number, and the files, that `head` reported for a folder with no history yet, until the first commit creates it. */
  let pending: { n: number; files: Record<string, string> } | undefined
  const seen = (n: number) => (last = Math.max(last, n))
  const fresh = () => Math.max(Math.floor(now() / 1000), last + 1)

  const bad = (file: string, what: string): State => ({
    kind: 'bad',
    problem: {
      code: 'INVALID_DOCUMENT',
      message: `${file} ${what}. Nothing was changed; delete .culm/ to start a new history.`,
      file,
    },
  })
  const exists = (p: string) =>
    access(p).then(
      () => true,
      () => false,
    )
  /** Writes through a temporary name and a rename. */
  async function put(path: string, body: string) {
    const tmp = join(culm, 'tmp', randomUUID())
    await mkdir(dirname(tmp), { recursive: true })
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, body)
    await rename(tmp, path)
  }
  const recPath = (n: number) => join(culm, 'revisions', `${n}.json`)
  const names = async (sub: string) =>
    readdir(join(culm, sub)).catch(() => [] as string[])
  const numbers = async () =>
    (await names('revisions'))
      .map(f => /^(\d+)\.json$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number)
      .sort((a, b) => a - b)

  async function readRec(n: number): Promise<Rec | undefined> {
    try {
      const r = JSON.parse(await readFile(recPath(n), 'utf8')) as Rec
      const ok =
        typeof r === 'object' &&
        r !== null &&
        (r.by === 'culm' || r.by === 'outside') &&
        typeof r.time === 'number' &&
        typeof r.files === 'object' &&
        r.files !== null &&
        Object.values(r.files).every(h => typeof h === 'string' && HEX.test(h))
      return ok ? r : undefined
    } catch {
      return undefined
    }
  }

  async function state(): Promise<State> {
    let text: string
    try {
      text = await readFile(join(culm, 'head'), 'utf8')
    } catch (e) {
      if (code(e) !== 'ENOENT') return bad('.culm/head', 'cannot be read')
      // no history, or a history that lost its head: the second is damage, never a new start
      const recs = await names('revisions')
      const left = recs.length + (await names('blobs')).length
      if (!left) return { kind: 'fresh' }
      // An interrupted first commit (blobs, and at most the one first record, no journal) is not damage: the project files are
      // still wholly old, and recovery removes the leftovers. Anything more is a history that lost its head.
      return recs.length <= 1 && !(await exists(journalPath))
        ? { kind: 'fresh', stale: true }
        : bad('.culm/head', 'is missing')
    }
    if (!/^\d+$/.test(text.trim()))
      return bad('.culm/head', 'is empty or not a revision number')
    const revision = Number(text.trim())
    const rec = await readRec(revision)
    if (!rec)
      return bad(`.culm/revisions/${revision}.json`, 'is missing or unreadable')
    for (const h of Object.values(rec.files))
      if (!(await exists(join(culm, 'blobs', h))))
        return bad(`.culm/blobs/${h}`, 'is missing')
    for (const n of await numbers())
      if (n < revision && !(await readRec(n)))
        return bad(`.culm/revisions/${n}.json`, 'is missing or unreadable')
    return { kind: 'ok', revision, rec }
  }

  // ------------------------------------------------------------ the lock
  async function takeLock(): Promise<() => Promise<void>> {
    await mkdir(culm, { recursive: true })
    for (;;) {
      const token = randomUUID()
      try {
        const fh = await open(lockPath, 'wx')
        await fh.writeFile(
          JSON.stringify({ pid: process.pid, time: now(), token }),
        )
        await fh.close()
        return async () => {
          const cur = await readFile(lockPath, 'utf8').catch(() => '')
          if (cur.includes(token)) await rm(lockPath, { force: true })
        }
      } catch (e) {
        if (code(e) !== 'EEXIST') throw e
      }
      const cur = await readFile(lockPath, 'utf8').catch(() => undefined)
      if (cur === undefined) continue
      let info: { pid?: unknown; time?: number }
      try {
        info = JSON.parse(cur)
      } catch {
        // being written, or torn: its age is the file's
        const m = await stat(lockPath).then(
          s => s.mtimeMs,
          () => Infinity,
        )
        info = { time: m }
      }
      const stale = now() - (info.time ?? 0) > LOCK_STALE_MS || !alive(info.pid)
      if (!stale) {
        await sleep(20)
        continue
      }
      // Exactly one contender's rename finds the file. If it moved a lock that was not the stale one we judged, give it back.
      // ponytail: the give-back can lose to a third contender; a lock service would close that gap.
      const gone = join(culm, `lock.${randomUUID()}`)
      try {
        await rename(lockPath, gone)
      } catch {
        continue
      }
      if ((await readFile(gone, 'utf8').catch(() => '')) !== cur)
        await link(gone, lockPath).catch(() => undefined)
      await rm(gone, { force: true })
    }
  }

  // ------------------------------------------------------- revisions, writes
  const hashes = (texts: Map<string, string>) =>
    Object.fromEntries([...texts].map(([p, t]) => [p, sha(t)]))
  async function blobs(texts: Map<string, string>) {
    for (const t of texts.values()) {
      const p = join(culm, 'blobs', sha(t))
      if (!(await exists(p))) await put(p, t)
    }
  }
  async function record(n: number, texts: Map<string, string>, by: Rec['by']) {
    await blobs(texts)
    const rec: Rec = { files: hashes(texts), by, time: now() }
    await put(recPath(n), JSON.stringify(rec))
    await put(join(culm, 'head'), `${n}\n`)
  }
  const mineOf = (loaded: Loaded) =>
    new Map(
      loaded.files.filter(f => covered(f.path)).map(f => [f.path, f.text]),
    )
  const sameFiles = (a: Record<string, string>, b: Record<string, string>) => {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k])
  }
  const blobText = (h: string) => readFile(join(culm, 'blobs', h), 'utf8')

  async function prune(head: number) {
    const all = (await numbers()).filter(n => n <= head)
    // nothing is deleted while a record cannot be read: its blobs are unknown
    for (const n of all) if (!(await readRec(n))) return
    for (const n of all.slice(0, Math.max(0, all.length - KEPT_REVISIONS)))
      await rm(recPath(n), { force: true })
    const keep = new Set<string>()
    for (const n of all.slice(-KEPT_REVISIONS))
      for (const h of Object.values((await readRec(n))?.files ?? {}))
        keep.add(h)
    for (const h of await names('blobs'))
      if (!keep.has(h)) await rm(join(culm, 'blobs', h), { force: true })
  }

  // ---------------------------------------------------------------- recovery
  /**
   * On open: records numbered above `head` are deleted, and the files a journal names are put back from the head revision's blobs.
   * This is the one place besides `commit` that writes to `.culm/`. A corrupt `.culm/` is left as it is.
   */
  const clear = async () => {
    for (const d of ['revisions', 'blobs', 'tmp'])
      await rm(join(culm, d), { recursive: true, force: true })
  }
  async function recover() {
    const st = await state()
    if (st.kind === 'fresh' && st.stale) {
      const release = await takeLock()
      try {
        if (((await state()) as State).kind === 'fresh') await clear()
      } finally {
        await release()
      }
      return
    }
    if (st.kind !== 'ok') return
    const pending = async () =>
      (await exists(journalPath)) ||
      (await numbers()).some(n => n > st.revision)
    if (!(await pending())) return
    const release = await takeLock()
    try {
      const now2 = await state()
      if (now2.kind !== 'ok') return
      for (const n of await numbers())
        if (n > now2.revision) await rm(recPath(n), { force: true })
      if (await exists(journalPath)) {
        let paths: unknown
        try {
          paths = (
            JSON.parse(await readFile(journalPath, 'utf8')) as {
              paths: unknown
            }
          ).paths
        } catch {
          return // a journal that does not parse is not guessed at
        }
        for (const p of Array.isArray(paths) ? paths : []) {
          if (
            typeof p !== 'string' ||
            !covered(p) ||
            p.includes('..') ||
            isAbsolute(p)
          )
            continue
          const h = now2.rec.files[p]
          if (h) await put(join(dir, p), await blobText(h))
          else await rm(join(dir, p), { force: true })
        }
        await rm(journalPath, { force: true })
      }
      await rm(join(culm, 'tmp'), { recursive: true, force: true })
    } finally {
      await release()
    }
  }

  /**
   * A restore (the request is core's `{ baseRevision, restore }`) whose document is exactly the one stored at `to`: the files of
   * `to` written back as they were, comments and layout included. Anything else returns undefined, and `fileEdits` plans it.
   */
  async function restoreEdits(
    c: { doc: unknown; request: string },
    head: number,
    mine: Map<string, string>,
  ) {
    let to: unknown
    try {
      const r = JSON.parse(c.request) as Record<string, unknown>
      if (Object.keys(r).sort().join() !== 'baseRevision,restore') return
      to = r.restore
    } catch {
      return
    }
    if (
      typeof to !== 'number' ||
      !Number.isSafeInteger(to) ||
      to < 0 ||
      to > head
    )
      return
    const rec = await readRec(to)
    const old = await store.get('', to)
    if (!rec || !old || !isDeepStrictEqual(old, c.doc)) return
    const write: Record<string, string> = {}
    const remove: string[] = []
    for (const [p, h] of Object.entries(rec.files)) {
      const t = await blobText(h)
      if (mine.get(p) !== t) write[p] = t
    }
    for (const p of mine.keys()) if (!(p in rec.files)) remove.push(p)
    return { write, remove, notes: [], problems: [] }
  }

  // ------------------------------------------------------------------- store
  const store: SiteStore = {
    async head() {
      const st = await state()
      if (st.kind === 'bad') return { problems: [st.problem] }
      const loaded = await loadFolder(dir, registry)
      if (!loaded.doc || loaded.problems.length)
        return { problems: loaded.problems }
      if (st.kind === 'ok') {
        pending = undefined
        seen(st.revision)
        return { revision: st.revision, doc: loaded.doc }
      }
      pending ??= { n: fresh(), files: hashes(mineOf(loaded)) }
      seen(pending.n)
      return { revision: pending.n, doc: loaded.doc }
    },

    async get(_site, revision) {
      if (!Number.isSafeInteger(revision) || revision < 0) return undefined
      const st = await state()
      if (st.kind === 'bad') return undefined
      if (st.kind === 'fresh') {
        if (revision !== pending?.n) return undefined
        const h = await store.head('')
        return 'doc' in h ? h.doc : undefined
      }
      if (revision > st.revision) return undefined
      const rec = await readRec(revision)
      if (!rec) return undefined
      try {
        const files = new Map<string, string>()
        for (const [p, h] of Object.entries(rec.files))
          files.set(p, await blobText(h))
        const loaded = await loadFiles(files, registry)
        return loaded.problems.length ? undefined : loaded.doc
      } catch {
        return undefined
      }
    },

    async replay(_site, key) {
      const st = await state()
      if (st.kind !== 'ok') return undefined
      for (const n of (await numbers()).filter(n => n <= st.revision)) {
        const rec = await readRec(n)
        if (rec?.key === key && rec.request !== undefined && rec.result)
          return { request: rec.request, result: rec.result }
      }
      return undefined
    },

    async commit(_site, c) {
      const release = await takeLock()
      hook(1)
      /** Step 9's hook for a commit that ends early, then the lock is released. */
      const end = <T>(r: T): T => (hook(9), r)
      try {
        const st = await state()
        if (st.kind === 'bad')
          return end<Refusal>({
            ok: false,
            code: 'REVISION_CONFLICT',
            problems: [st.problem],
          })
        // 2. load the folder; a hand edit becomes an outside revision
        const loaded = await loadFolder(dir, registry)
        if (!loaded.doc || loaded.problems.length)
          return end<Refusal>({
            ok: false,
            code: 'REVISION_CONFLICT',
            problems: loaded.problems,
          })
        const mine = mineOf(loaded)
        let head: number
        if (st.kind === 'fresh') {
          if (st.stale) await clear()
          const f = hashes(mine)
          // the files changed since `head` reported this number: the same rule as for a later revision
          if (pending && !sameFiles(f, pending.files)) {
            pending = undefined
            return end<Refusal>({ ok: false, code: 'REVISION_CONFLICT' })
          }
          head = pending?.n ?? fresh()
          await record(head, mine, 'culm')
          pending = undefined
        } else {
          head = st.revision
          if (!sameFiles(hashes(mine), st.rec.files)) {
            head += 1
            await record(head, mine, 'outside')
          }
        }
        seen(head)
        hook(2)
        // 3. the key, then the revision
        for (const n of (await numbers()).filter(n => n <= head)) {
          const rec = await readRec(n)
          if (rec?.key !== c.key || !rec.result) continue
          return end(
            rec.request === c.request
              ? { ok: true as const, revision: n, result: rec.result }
              : ({ ok: false, code: 'KEY_CONFLICT' } satisfies Refusal),
          )
        }
        if (c.expected !== head)
          return end<Refusal>({ ok: false, code: 'REVISION_CONFLICT' })
        hook(3)
        // 4. the edits, and the files as they are now
        const edits =
          (await restoreEdits(c, head, mine)) ??
          fileEdits(loaded.doc, c.doc, loaded, registry)
        if (edits.problems.length)
          return end<Refusal>({
            ok: false,
            code: 'SOURCE_CONFLICT',
            problems: edits.problems,
          })
        const paths = [...Object.keys(edits.write), ...edits.remove]
        const was = new Map(loaded.files.map(f => [f.path, f.text]))
        for (const p of paths) {
          const now1 = await readFile(join(dir, p), 'utf8').catch(() => null)
          if (now1 !== (was.get(p) ?? null))
            return end<Refusal>({ ok: false, code: 'SOURCE_CONFLICT' })
        }
        hook(4)
        // 5. the journal
        await put(journalPath, JSON.stringify({ paths }))
        hook(5)
        // 6. blobs, then each file through a temporary name and a rename
        const next = new Map(mine)
        for (const [p, t] of Object.entries(edits.write)) next.set(p, t)
        for (const p of edits.remove) next.delete(p)
        await blobs(next)
        let hooked = false
        for (const [p, t] of Object.entries(edits.write)) {
          await put(join(dir, p), t)
          if (!hooked) {
            hooked = true
            hook(6)
          }
        }
        for (const p of edits.remove) {
          await rm(join(dir, p), { force: true })
          if (!hooked) {
            hooked = true
            hook(6)
          }
        }
        if (!hooked) hook(6)
        // 7. the revision record
        const revision = head + 1
        const result: ApplyResult = c.result.ok
          ? {
              ...c.result,
              revision,
              notes: [...c.result.notes, ...edits.notes],
            }
          : c.result
        const rec: Rec = {
          files: hashes(next),
          by: 'culm',
          key: c.key,
          request: c.request,
          result,
          time: now(),
        }
        await put(recPath(revision), JSON.stringify(rec))
        hook(7)
        // 8. head: the commit
        await put(join(culm, 'head'), `${revision}\n`)
        hook(8)
        // 9. journal, pruning, lock
        await rm(journalPath, { force: true })
        await prune(revision)
        await rm(join(culm, 'tmp'), { recursive: true, force: true })
        seen(revision)
        return end({ ok: true as const, revision, result })
      } finally {
        await release()
      }
    },
  }
  await recover()
  return store
}
