// SDK 1.32.2, names as installed (all as the spec has them):
//   Server                        from '@modelcontextprotocol/sdk/server/index.js'
//   StdioServerTransport          from '@modelcontextprotocol/sdk/server/stdio.js'
//   InMemoryTransport             from '@modelcontextprotocol/sdk/inMemory.js'
//   StreamableHTTPServerTransport from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  API_VERSION,
  BUDGETS,
  FRAMEWORK_VERSION,
  MAX_DEPTH,
  MAX_NODES,
  MEASURE_PROFILE,
  SCHEMA_VERSION,
  type Data,
  type Manifest,
  type Problem,
  type Registry,
} from '@culmjs/core'
import {
  READ_CAP,
  apply,
  catalogue,
  diffSites,
  pageOutline,
  plan,
  readNode,
  restore,
  search,
  siteOutline,
  type Allow,
  type ApplyResult,
  type SiteStore,
} from '@culmjs/core/ops'
import type { Browser } from '../measure/browser.ts'
import { measureSince, runMeasure } from '../measure/run.ts'

export type McpOptions = {
  store: SiteStore
  registry: Registry
  site: string
  data: Data
  allow?: Allow
  browser?: Browser
  /** The Chrome `measure` opens when no `browser` is given. */
  executable?: string
  out?: string
  /** Folder sites: adds file and line to a problem. */
  locate?<P extends Problem>(p: P): P
  /** Absent: `build` returns UNSUPPORTED_CAPABILITY. */
  build?(): Promise<
    { ok: true; manifest: Manifest } | { ok: false; problems: Problem[] }
  >
  folder?: boolean
}

type Obj = Record<string, unknown>
type Result = { content: { type: 'text'; text: string }[]; isError?: true }
type Head = Exclude<
  Awaited<ReturnType<SiteStore['head']>>,
  { problems: Problem[] }
>
type Tree = Parameters<typeof pageOutline>[1]

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const bad = (message: string, path?: string): Problem => ({
  code: 'INVALID_OPERATION',
  message,
  ...(path ? { path } : {}),
})
const why = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300)

// ---- the tools: a name, a line for the agent, and the arguments it takes (core decides the rest)
const num = { type: 'number' }
const str = { type: 'string' }
const schema = (properties: Obj = {}, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: true,
})
const batch = (key: Obj) =>
  schema(
    {
      baseRevision: num,
      ...key,
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: { op: str },
          required: ['op'],
          additionalProperties: true,
        },
      },
    },
    ['baseRevision', 'ops'],
  )
const TOOLS = [
  [
    'describe',
    'Versions, site name and revision, ceilings, the read cap, the required node count and text range, folder or host-supplied.',
    schema(),
  ],
  [
    'read',
    'Read the site. what: site | page | node | search. page: a page id (or tree: "header" | "footer" | {component}), depth, from, id (node), text, kind, block (search), cursor.',
    schema(
      {
        what: { enum: ['site', 'page', 'node', 'search'] },
        page: str,
        tree: {},
        id: str,
        depth: num,
        from: str,
        text: str,
        kind: str,
        block: str,
        cursor: str,
      },
      ['what'],
    ),
  ],
  [
    'catalogue',
    'What can be built. what: kinds | blocks | sources | operations; id for one entry; cursor.',
    schema(
      {
        what: { enum: ['kinds', 'blocks', 'sources', 'operations'] },
        id: str,
        cursor: str,
      },
      ['what'],
    ),
  ],
  [
    'plan',
    "Check a batch of operations without saving it; the catalogue lists each operation's arguments.",
    batch({ key: str }),
  ],
  [
    'apply',
    'Save a batch of operations as the next revision. key makes a retry safe.',
    { ...batch({ key: str }), required: ['baseRevision', 'key', 'ops'] },
  ],
  [
    'measure',
    'Render the pages and report layout findings. pages, widths (1280, 834, 390), classes (1, 2, 3), since (a revision to compare with), cursor.',
    schema({
      pages: { type: 'array', items: str },
      widths: { type: 'array', items: num },
      classes: { type: 'array', items: num },
      since: num,
      cursor: str,
    }),
  ],
  [
    'diff',
    'What differs between two revisions. from, to (default: the head), cursor.',
    schema({ from: num, to: num, cursor: str }, ['from']),
  ],
  [
    'restore',
    'Make an earlier revision the new head, keeping the history.',
    schema({ to: num, baseRevision: num, key: str }, [
      'to',
      'baseRevision',
      'key',
    ]),
  ],
  [
    'build',
    'Build the site to its output folder and summarise the manifest.',
    schema(),
  ],
].map(([name, description, inputSchema]) => ({
  name,
  description,
  inputSchema,
}))

/** Whole replies only: one text item of JSON, `cut` set, never over READ_CAP. A refusal is `{ problems }` with `isError`. */
function reply(body: Obj): Result {
  const text = JSON.stringify({ cut: false, ...body })
  if (text.length <= READ_CAP) return { content: [{ type: 'text', text }] }
  return refuse([
    {
      code: 'RESOURCE_LIMIT_EXCEEDED',
      message: 'The reply could not be made to fit.',
    },
  ])
}
function refuse(problems: Problem[], locate?: McpOptions['locate']): Result {
  const ps = problems.slice(0, 20).map(p => (locate ? locate(p) : p))
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ problems: ps }).slice(0, READ_CAP),
      },
    ],
    isError: true,
  }
}

/** Cuts the longest of `lists` until the reply fits; `cut` says whether any was. */
function fit(body: Obj, lists: string[]): Obj {
  const o = { ...body }
  let cut = false
  const n = (k: string) =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).length : 0
  while (JSON.stringify({ cut, ...o }).length > READ_CAP) {
    const k = lists.reduce((a, b) => (n(b) > n(a) ? b : a))
    if (!n(k)) break
    o[k] = (o[k] as unknown[]).slice(0, Math.floor(n(k) * 0.8))
    cut = true
  }
  return { ...o, cut }
}

/** One page of `rows`: as many as fit the cap (always at least one), and a cursor `"<revision>:<offset>:<tag>"` for the rest. */
function pageOf<R>(
  rows: R[],
  revision: number,
  cursor: unknown,
  tag: string,
  wrap: (rows: R[], cut: boolean) => Obj,
): Obj | Problem {
  let from = 0
  if (cursor !== undefined) {
    const m =
      typeof cursor === 'string' ? /^(\d+):(\d+):([^]*)$/.exec(cursor) : null
    if (!m || m[3] !== tag || +m[2]! > rows.length)
      return bad(
        'This cursor belongs to another read. Start again without a cursor.',
        'cursor',
      )
    if (+m[1]! !== revision)
      return {
        code: 'REVISION_CONFLICT',
        message: `The cursor was made for revision ${m[1]}, not ${revision}.`,
        path: 'cursor',
      }
    from = +m[2]!
  }
  const one = (k: number) => {
    const cut = from + k < rows.length
    return {
      ...wrap(rows.slice(from, from + k), cut),
      ...(cut ? { cursor: `${revision}:${from + k}:${tag}` } : {}),
    }
  }
  const fits = (k: number) => JSON.stringify(one(k)).length <= READ_CAP
  let hi = rows.length - from
  if (fits(hi)) return one(hi)
  let lo = 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return one(lo)
}

const summary = (r: Extract<ApplyResult, { ok: true }>, extra: Obj = {}) =>
  fit(
    {
      ...extra,
      counts: {
        created: r.created.length,
        changed: r.changed.length,
        pages: r.pages.length,
        notes: r.notes.length,
      },
      created: r.created,
      changed: r.changed,
      pages: r.pages,
      notes: r.notes,
    },
    ['created', 'changed', 'pages', 'notes'],
  )

export function createMcpServer(o: McpOptions): Server {
  const { store, registry, site, data, allow, locate } = o
  const server = new Server(
    { name: 'culm', version: FRAMEWORK_VERSION },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }))

  const fail = (problems: Problem[]) => refuse(problems, locate)
  const headOf = async (): Promise<Head | Result> => {
    const h = await store.head(site)
    return 'problems' in h ? fail(h.problems) : h
  }
  /** A core reply: a refusal, or the reply itself. */
  const pass = (r: unknown): Result =>
    isObj(r) && r.ok === false ? fail(r.problems as Problem[]) : reply(r as Obj)
  const treeOf = (a: Obj): Tree | undefined =>
    (a.tree ?? (typeof a.page === 'string' ? { page: a.page } : undefined)) as
      Tree | undefined
  const request = (a: Obj) => ({
    site,
    baseRevision: a.baseRevision as number,
    key: a.key as string,
    ops: a.ops as never,
  })
  // `measure` continues from the report it made, not a second run
  let last: { key: string; rows: Obj[]; meta: Obj } | undefined

  const tools: Record<string, (a: Obj) => Promise<Result>> = {
    async describe() {
      const h = await headOf()
      if ('content' in h) return h
      const s = siteOutline(h)
      if (!s.ok) return fail(s.problems)
      return reply({
        framework: FRAMEWORK_VERSION,
        schema: SCHEMA_VERSION,
        pluginApi: API_VERSION,
        measureProfile: MEASURE_PROFILE,
        site,
        name: s.name,
        revision: h.revision,
        ceilings: {
          page: BUDGETS,
          nodes: MAX_NODES,
          treeDepth: MAX_DEPTH,
          operations: 200,
          requestChars: 1_000_000,
        },
        readCap: READ_CAP,
        required: s.required,
        textRange: s.textRange ?? null,
        folder: o.folder === true,
        ...(o.out ? { out: o.out } : {}),
      })
    },

    async read(a) {
      const h = await headOf()
      if ('content' in h) return h
      const cursor = typeof a.cursor === 'string' ? { cursor: a.cursor } : {}
      switch (a.what) {
        case 'site':
          return pass(siteOutline(h, cursor))
        case 'page':
          return pass(
            pageOutline(h, treeOf(a) as Tree, {
              ...cursor,
              ...(a.depth !== undefined ? { depth: a.depth as number } : {}),
              ...(a.from !== undefined ? { from: a.from as string } : {}),
            }),
          )
        case 'node':
          return pass(
            readNode(h, treeOf(a) as Tree, a.id as string, cursor, registry),
          )
        case 'search':
          return pass(
            search(h, {
              text: a.text,
              kind: a.kind,
              block: a.block,
              ...cursor,
            } as never),
          )
        default:
          return fail([bad('what must be site, page, node or search.', 'what')])
      }
    },

    async catalogue(a) {
      const h = await headOf()
      if ('content' in h) return h
      return pass(
        catalogue(registry, {
          what: a.what,
          ...(a.id !== undefined ? { id: a.id } : {}),
          ...(a.cursor !== undefined ? { cursor: a.cursor } : {}),
          site: h,
        } as Parameters<typeof catalogue>[1]),
      )
    },

    async plan(a) {
      const h = await headOf()
      if ('content' in h) return h
      if (Number.isInteger(a.baseRevision) && a.baseRevision !== h.revision)
        return fail([
          {
            code: 'REVISION_CONFLICT',
            message: `The site is at revision ${h.revision}, not ${a.baseRevision}.`,
            path: 'baseRevision',
          },
        ])
      const r = plan(
        h.doc,
        registry,
        { ...request(a), key: typeof a.key === 'string' ? a.key : 'plan' },
        allow,
      )
      return r.ok
        ? reply(summary({ ...r, revision: h.revision }))
        : fail(r.problems)
    },

    async apply(a) {
      const r = await apply(store, registry, request(a), allow)
      return r.ok
        ? reply(
            summary(r, {
              revision: r.revision,
              from: a.baseRevision,
              hint: 'Ids that were cut are in diff(from, to).',
            }),
          )
        : fail(r.problems)
    },

    async restore(a) {
      const r = await restore(
        store,
        registry,
        {
          site,
          to: a.to as number,
          baseRevision: a.baseRevision as number,
          key: a.key as string,
        },
        allow,
      )
      return r.ok
        ? reply(summary(r, { revision: r.revision, from: a.baseRevision }))
        : fail(r.problems)
    },

    async diff(a) {
      const h = await headOf()
      if ('content' in h) return h
      const to = a.to === undefined ? h.revision : a.to
      const doc = (n: unknown) =>
        Number.isInteger(n) ? store.get(site, n as number) : undefined
      const [from, now] = [await doc(a.from), await doc(to)]
      if (!from || !now)
        return fail([
          {
            code: 'UNSUPPORTED_CAPABILITY',
            message: `The store does not hold revision ${from ? to : a.from} of "${site}".`,
            path: from ? 'to' : 'from',
          },
        ])
      return pass(
        diffSites(
          from,
          now,
          typeof a.cursor === 'string' ? { cursor: a.cursor } : {},
        ),
      )
    },

    async measure(a) {
      const lists = (k: string, ok: (v: unknown) => boolean) =>
        a[k] === undefined ||
        (Array.isArray(a[k]) && (a[k] as unknown[]).every(ok))
      if (
        !lists('pages', v => typeof v === 'string') ||
        !lists('widths', v => typeof v === 'number') ||
        !lists('classes', v => v === 1 || v === 2 || v === 3)
      )
        return fail([
          bad(
            'pages must be a list of page ids, widths and classes lists of numbers (classes 1, 2 or 3).',
          ),
        ])
      if (a.since !== undefined && !Number.isInteger(a.since))
        return fail([bad('since must be a revision number.', 'since')])
      const h = await headOf()
      if ('content' in h) return h
      const tag = JSON.stringify([a.pages, a.widths, a.classes, a.since])
      const key = `${h.revision}|${tag}`
      if (a.cursor === undefined || last?.key !== key) {
        const input = {
          registry,
          data,
          ...(a.pages ? { pages: a.pages as string[] } : {}),
          ...(a.widths ? { widths: a.widths as number[] } : {}),
          ...(a.classes ? { classes: a.classes as (1 | 2 | 3)[] } : {}),
          ...(o.browser ? { browser: o.browser } : {}),
          ...(o.executable ? { executable: o.executable } : {}),
        }
        const m =
          a.since === undefined
            ? {
                ok: true as const,
                report: await runMeasure({
                  ...input,
                  doc: h.doc,
                  revision: h.revision,
                }),
                comparison: undefined,
              }
            : await measureSince({
                ...input,
                store,
                site,
                since: a.since as number,
              })
        if (!m.ok) return fail(m.problems)
        const r = m.report
        last = {
          key,
          meta: {
            revision: r.revision,
            build: r.build,
            profile: r.profile,
            browser: r.browser,
            measured: r.measured.length,
            skipped: r.skipped,
          },
          rows: [
            ...r.findings.map(finding => ({ finding })),
            ...r.incomplete.map(incomplete => ({ incomplete })),
            ...r.blocked.map(blocked => ({ blocked })),
            ...(m.comparison?.was.map(was => ({ was })) ?? []),
            ...(m.comparison?.added.map(added => ({ added })) ?? []),
          ],
        }
      }
      const { rows, meta } = last!
      const pick = (rs: Obj[], k: string) =>
        rs.flatMap(r => (k in r ? [r[k]] : []))
      const p = pageOf(rows, h.revision, a.cursor, tag, (rs, cut) => ({
        ...meta,
        findings: pick(rs, 'finding'),
        incomplete: pick(rs, 'incomplete'),
        blocked: pick(rs, 'blocked'),
        ...(a.since !== undefined
          ? { was: pick(rs, 'was'), added: pick(rs, 'added') }
          : {}),
        cut,
      }))
      return 'code' in p ? fail([p as Problem]) : reply(p)
    },

    async build() {
      if (!o.build)
        return fail([
          {
            code: 'UNSUPPORTED_CAPABILITY',
            message:
              'This site has no output folder, so it cannot be built here.',
          },
        ])
      const r = await o.build()
      if (!r.ok) return fail(r.problems)
      const { pages, scripts, styles, build } = r.manifest
      return reply(
        fit(
          {
            ok: true,
            ...(build ? { build } : {}),
            counts: {
              pages: pages.length,
              scripts: scripts.length,
              styles: styles.length,
            },
            pages,
            scripts,
            styles,
          },
          ['pages', 'scripts', 'styles'],
        ),
      )
    },
  }

  server.setRequestHandler(
    CallToolRequestSchema,
    async (req): Promise<Result> => {
      const { name, arguments: args } = req.params
      const run = Object.hasOwn(tools, name) ? tools[name] : undefined
      if (!run) return fail([bad(`There is no tool "${name}".`)])
      try {
        return await run(isObj(args) ? args : {})
      } catch (e) {
        // a store that throws, a browser that dies: a refusal, never a protocol error
        return fail([bad(`The tool "${name}" failed: ${why(e)}`)])
      }
    },
  )
  return server
}
