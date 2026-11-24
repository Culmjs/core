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
  find as findNode,
  type Data,
  type Manifest,
  type Problem,
  type Registry,
  type SiteDocument,
} from '@culmjs/core'
import {
  READ_CAP,
  apply,
  catalogue,
  createdRoots,
  diffSites,
  pageOutline,
  plan,
  readNode,
  restore,
  search,
  siteOutline,
  treeKey,
  type Allow,
  type ApplyResult,
  type SiteStore,
} from '@culmjs/core/ops'
import type { Browser } from '../measure/browser.ts'
import type { Finding } from '@culmjs/core/measure'
import { locateFinding } from '../folder/locateFinding.ts'
import { measureSince, runMeasure } from '../measure/run.ts'
import { measureReply } from './measureReply.ts'
import { createHash } from 'node:crypto'
import { emit } from '../jsx/tree.ts'
import { diagnose, locate as locateJsx } from '../jsx/write.ts'
import { buildRequest } from '../jsx/batch.ts'
import { writeDrafts } from './drafts.ts'
import { findNodes, indexOf, pathIndex, treesOf } from '../jsx/find.ts'
import { examples, JSON_GUIDE, jsonEditSchema } from './json-authoring.ts'
import { isObj } from '../shared.ts'
import type { fetchFor } from '../folder/fetch.ts'
import type { readHeld } from '../folder/held.ts'

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
  /** Folder sites: the SHA-256 of every asset and font file, read for each measure (the build identity); absent: none. */
  files?(): Promise<{ path: string; sha256: string }[]>
  /** Folder sites: the bytes of a project file the measured page asks for (`assets/…`, `fonts/…`), or undefined. */
  assets?(path: string): Promise<Uint8Array | undefined>
  /** Folder sites: adds file and line to a problem. */
  locate?<P extends Problem>(p: P): P
  /** Folder sites: the file of a page, for a finding whose node cannot be placed. */
  pageFile?(page: string): string | undefined
  /** Folder sites: fetches what a batch names (a Google family) into the folder and returns the batch with it written as `up:<name>`. Absent: nothing is fetched. */
  fetch?(
    ops: unknown[],
    doc: SiteDocument,
    offline?: boolean,
  ): ReturnType<typeof fetchFor>
  /** Folder sites: what the folder holds (fonts), read again for each measure. */
  held?(): ReturnType<typeof readHeld>
  /** Absent: `build` returns UNSUPPORTED_CAPABILITY. */
  build?(): Promise<
    { ok: true; manifest: Manifest } | { ok: false; problems: Problem[] }
  >
  folder?: boolean
  /** Compact JSON-only operation writer with explicit rather than per-write browser measurement. */
  jsonOps?: boolean
}

type Obj = Record<string, unknown>
type Result = { content: { type: 'text'; text: string }[]; isError?: true }
type Head = Exclude<
  Awaited<ReturnType<SiteStore['head']>>,
  { problems: Problem[] }
>
type Tree = Parameters<typeof pageOutline>[1]

const bad = (message: string, path?: string): Problem => ({
  code: 'INVALID_OPERATION',
  message,
  ...(path ? { path } : {}),
})
/** The cursor of a call: absent, or a text. Anything else is a refusal. */
const badCursor = (a: Obj): Result | undefined =>
  a.cursor !== undefined && typeof a.cursor !== 'string'
    ? refuse([bad('cursor must be a text.', 'cursor')])
    : undefined
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
    schema({ example: { enum: Object.keys(examples) } }),
  ],
  [
    'read',
    'Read the site. what: site | page | node | search. page: a page id (or tree: "header" | "footer" | {component}), depth (1-2 is enough), from, id (node), text, kind, block (search), cursor. Rows are flat with depth; read only what you must change. format: "jsx" (with page: an id, "header" or "footer") returns that tree as JSX for write.',
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
        format: { enum: ['json', 'jsx'] },
      },
      ['what'],
    ),
  ],
  [
    'write',
    'Write html + optional css, literal jsx, or json nodes ({kind,text?,style?,children?}). No templates required. A page fragment replaces page; append:true adds siblings; target replaces one node. HTML documents or JSX/JSON Page/Header/Footer wrappers can write whole sites. Optional theme. For small edits use patch:[{id,text?,props?,style?,phone?}]; insert appends ordered {html,css?}, {jsx}, {json}, or registered {use,id,look?,set?} items. One checked revision per write.',
    schema(
      {
        page: str,
        jsx: str,
        ops: jsonEditSchema,
        html: str,
        css: str,
        json: {},
        theme: { type: 'object' },
        insert: { type: 'array', items: { type: 'object' } },
        patch: { type: 'array', items: { type: 'object' } },
        draft: str,
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { op: { const: 'replace' }, path: str, value: {} },
            required: ['op', 'path', 'value'],
          },
        },
        target: str,
        append: { type: 'boolean' },
        baseRevision: num,
        key: str,
        title: str,
        path: str,
      },
      ['baseRevision'],
    ),
  ],
  [
    'find',
    'Find the part to change. text (substring), kind (Text, Button ...), id, or selector ("Row > Text[level=1]", "Button[text*=Order]", "#hero"); tree: "header", "footer" or a page id to limit it; full: true for the whole subtree as JSX; limit. Each match has its id, tree, element path and small JSX, and the reply has the revision: write {target: id, jsx, baseRevision} replaces just that part.',
    schema({
      text: str,
      kind: str,
      id: str,
      selector: str,
      tree: str,
      full: { type: 'boolean' },
      limit: num,
    }),
  ],
  [
    'catalogue',
    "What can be built. what: guide | kinds | operations | recipes | blocks | sources | effects; id for one entry (an operation's example, a block's settings and insert, a recipe's batch, or an effect's tier, numeric settings and example); cursor.",
    schema(
      {
        what: {
          enum: [
            'guide',
            'kinds',
            'operations',
            'recipes',
            'blocks',
            'sources',
            'effects',
          ],
        },
        id: str,
        cursor: str,
      },
      ['what'],
    ),
  ],
  [
    'plan',
    'Check a batch without saving it. Optional: apply checks as plan does.',
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

/** A refusal with every problem that fits the cap, in the order given (by place in the JSX); `more` counts the ones left out. */
function refuseMany(problems: Problem[], extra: Obj = {}): Result {
  for (let n = problems.length; ; n = Math.floor(n * 0.8)) {
    const text = JSON.stringify({
      ...extra,
      problems: problems.slice(0, n),
      ...(n < problems.length ? { more: problems.length - n } : {}),
    })
    if (text.length <= READ_CAP || n <= 1)
      return {
        content: [{ type: 'text', text: text.slice(0, READ_CAP) }],
        isError: true,
      }
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

/** Ids listed per list of an apply or plan reply; `more` counts the rest. */
const LISTED = 20

/** Counts, the created roots and the changed nodes as "<tree>:<id>" (at most LISTED each), the pages and notes. All ids are in `read` or `diff`. */
const summary = (
  r: Pick<
    Extract<ApplyResult, { ok: true }>,
    'created' | 'changed' | 'pages' | 'notes'
  >,
  doc: SiteDocument | undefined,
  extra: Obj = {},
) => {
  const roots = doc ? createdRoots(doc, r.created) : []
  const changed = r.changed.map(c => `${treeKey(c.tree)}:${c.id}`)
  const more = {
    ...(roots.length > LISTED ? { roots: roots.length - LISTED } : {}),
    ...(changed.length > LISTED ? { changed: changed.length - LISTED } : {}),
  }
  return fit(
    {
      ...extra,
      counts: {
        created: r.created.length,
        changed: r.changed.length,
        pages: r.pages.length,
        notes: r.notes.length,
      },
      roots: roots.slice(0, LISTED),
      ...(changed.length ? { changed: changed.slice(0, LISTED) } : {}),
      ...(Object.keys(more).length ? { more } : {}),
      pages: r.pages,
      ...(r.notes.length ? { notes: r.notes } : {}),
    },
    ['pages', 'notes'],
  )
}
const HINT = 'All ids: read, or diff(from, to).'

const JSX_INSTRUCTIONS = [
  'Culm builds a site from HTML/CSS, literal JSX or JSON nodes. Write {baseRevision,page,html,css?}, {baseRevision,page,json:{kind:"text",text:"Hello"}}, or JSX as below. No registered block is needed. A new folder site starts with NO pages. Its header is a Row (id header.bar) holding Text header.name ("New site"), Menu header.nav and a hidden Button header.button; its footer is a Column (id footer.bar) holding Menu footer.nav and Text footer.note ("Footer"); fonts sys:sans, text sizes 11 to 96. So do not read first: call describe once for the revision, then write.',
  'One-shot: ONE write {jsx, baseRevision} holding the whole site: <Site fonts colors look /> <Header>...</Header> <Footer>...</Footer> <Page path="/" title="Home">...</Page> (one <Page> per page; no page argument). It is applied in one batch, all or nothing. The reply is all you need to go on: the new revision, findings (each with node id and JSX path), warnings, and an index of every tree (top-level sections with id, kind, first words). Fix the findings with write {target: "<node id>", jsx, baseRevision: <revision of the reply>}: only that part is replaced, the rest is not resent. Give id="..." to the parts you may change later (hero, pricing); a node without one gets a readable id (h1freshbread).',
  'Edit: find {text | kind | id | selector such as "Row > Text[level=1]" or "Button[text*=Order]", tree?} returns each match as small JSX with its id, tree, path and the revision; then write {target: id, jsx: the ONE element that replaces it, baseRevision}. No read, no resend of the other parts. page + jsx writes one whole tree (page id, "header" or "footer"), as before.',
  'CSS-style values are converted, not refused: width "100%" (fill) or "50%", "24px", "1.5rem", padding "8px 16px", rgba(...) and named colours, a CSS box-shadow string, letterSpacing in px, a font-family name (the Google font is fetched), a text size outside the site range (clamped). A setting that does not apply is moved or dropped (bg on a Shape is its fill, color on a Divider its line, justify on a Box makes it a Column). Each is listed in warnings with its path, line and column; write Culm forms to avoid the warnings.',
  'Elements are the kinds: Box Row Column Grid Free List Table TableRow TableCell Text Image Icon Button Divider Video Menu Form Field Details Embed Shape. Values are literals only: "text", {12}, {true}, {{object}}, {[array]}; no variables, calls or spread.',
  'Words go between the tags: <Text level="h1">Hello</Text>, <Button label="Go" link={{url:"https://x.com"}} /> (or link={{page:"/about"}}). Settings are attributes by their names: Text level (h1-h6, p, span), Image src alt fit, Icon name="lucide:github" (or a built-in like star), Row/Column as, Grid cols, Shape geometry={{type:"rect",radius:24}} fill="brand" (or {{from:"brand",to:"ink",angle:135}}), Menu which, Button label link.',
  'Style: style={{...}} with Culm names: bg color (brand ink bg muted line or #hex), size weight lineHeight letterSpacing textAlign, padding margin (number or [top,right,bottom,left]), gap, width height (fill, fit or {n:1100,unit:"px"}), maxWidth, align justify wrap, radius, border {width,color}, overflow ("clip"), balance, rotate (degrees; rotate 45 for diamond frames, on a Shape, Box or Icon). A block with a maxWidth is centred in its parent unless you give its slot an align. Layers: tablet={{...}} phone={{...}} hover={{...}} dark={{...}}. Placement: slot={{grow:1,align:"center"}} in a row or column, placement={{mode:"behind"}} for a decorative Shape. Node name: nodeName.',
  '<Site fonts={{heading:"google:Roboto Slab",body:"google:Open Sans"}} colors={{accent:"#c2410c"}} look={{brand:"#1d4ed8"}} /> may come first in a write: it sets the site fonts (a Google family is fetched), named colours and the look.',
  'Example: <Column id="hero" style={{bg:"ink",color:"bg",overflow:"clip",align:"center",padding:[96,16,96,16]}} phone={{padding:[64,16,64,16]}}><Shape placement={{mode:"behind"}} geometry={{type:"rect"}} fill={{from:"brand",to:"ink",angle:135}} /><Row slot={{align:"center"}} style={{width:"fill",maxWidth:{n:1100,unit:"px"},gap:48,wrap:true,align:"center"}}><Column slot={{grow:1}} style={{gap:20}}><Text level="h1" style={{size:56,weight:800,balance:true}}>Fresh bread daily</Text><Button label="Order" link={{url:"https://example.com"}} style={{bg:"bg",color:"ink",radius:999,padding:[14,32,14,32]}} /></Column></Row></Column>',
  'The starter header and footer are PLACEHOLDERS: rewrite them in <Header> and <Footer> (or write page "header" / "footer") to match the design, or make them minimal (one slim bar, one line) when the design has none. The first element you write IS the bar (the padding, rule and centring the starter gave the chrome are removed on a write). The starter Menu (id header.nav, which="menu") is a placeholder, not required: delete it when the design has no nav of its pages, or replace it with your own links. A header as a left sidebar at 901px and wider: style={{side:280,...}} on that top element (it is a bar again on narrower windows); height:"fill" on the bar fills the sidebar.',
  'Copy the design, do not invent: add the shadows, rings, gradients, toggles and icons you see (shadow, gradient, Icon); keep an alternating image-text row alternating and give it phone={{order:-1}} on the image so it comes first on a phone; a Field with only a placeholder needs no label (omit it); two columns of equal width are <Grid cols={2}> or slot={{grow:1}}, not two width:"fill" blocks; give a Grid phoneCols and a cell a phone span; upper:true for capitals; prefer fa6-solid or fa6-brands for filled glyphs; Fields may sit side by side in a Row inside the Form; <Grid divide>, <List divide>, <Row divide>, <Column divide> draw a line between items (a ruled grid: gap 0, padding on the items); shadow, radius and border work on Image (an avatar is radius 999 plus a shadow); a header gradient is style={{gradient:{angle:180,stops:[{color:"#fff",at:0},{color:"#e9ecef",at:100}]}}}; a logo shape is a Shape with geometry={{type:"path",d:"..."}}; the square menu button on a phone is <Menu foldOn="phone" toggle="box"/> (or "outline"); a link inside a header or footer has no underline unless you write <u>.',
  'A refused write returns problems, the revision, and a draft when available. Fix a field without resending the page: write {baseRevision,draft,edits:[{op:"replace",path:"/patch/0/id",value:"intro"}]}.',
].join(' ')

/** What the client reads once at initialize: the working order, in the order an agent should use it. The JSX route first; the operations after it, still available. */
export const INSTRUCTIONS =
  JSX_INSTRUCTIONS +
  ' The operation tools (apply, plan, catalogue) stay available for what JSX does not say. ' +
  'Culm builds a site through checked operations. Work in this order. 1. Read catalogue guide once: it has the setup batch and the shortest shape batch, so no catalogue lookups are needed after it. 2. Set the design first in one batch: setLook, setFonts, addPage. A Google family goes in setFonts as {google:"Name",weights:[400,700]} and is then named up:<name in lower case, dashes>; an icon may be any Iconify set:name. 3. Compose each section from kinds (column, row, grid, text, image, button, shape) with add, setStyle and setProps. Give every section at least one decorative shape or a recipe from catalogue recipes (hero, split, cta-band, card, divider, buttons): its ops go to apply as they are, then setText. 4. Send many operations in one apply; apply checks them as plan does, so skip plan for routine batches. Save a section you repeat with makeComponent. 5. End with measure, and repair what it reports. Fix each finding once on each node; if the same finding comes back on that node, try the other way its fix names once, then move on.'

export function createMcpServer(o: McpOptions): Server {
  const { store, registry, site, allow, locate } = o
  const sectionTools = ['describe', 'find', 'write', 'measure', 'build']
  const compact = o.jsonOps
  const exposed = compact
    ? TOOLS.filter(t => sectionTools.includes(String(t.name))).map(t =>
        t.name === 'write'
          ? {
              ...t,
              description:
                'Commit 1–32 ordered insert/update/move/remove/theme operations atomically. Each insert.node is one JSON section; update merges fields on an id. Give motion as {trigger,effect,settings?} or {trigger,steps}; update.motion:null clears it. Move defaults to the page root. Returns revision and section ids.',
              inputSchema: schema(
                { baseRevision: num, page: str, key: str, ops: jsonEditSchema },
                ['baseRevision', 'ops'],
              ),
            }
          : t.name === 'describe'
            ? {
                ...t,
                description:
                  'Revision, pages, display range. Optional example: figure, group, phone-row or display.',
              }
            : t.name === 'find'
              ? {
                  ...t,
                  description:
                    'Without filters, outline the actual section ids. Use tree, text, kind, id, selector, limit or full:true to inspect individual nodes.',
                }
              : t,
      )
    : TOOLS
  const server = new Server(
    { name: 'culm', version: FRAMEWORK_VERSION },
    {
      capabilities: { tools: {} },
      instructions: compact ? JSON_GUIDE : INSTRUCTIONS,
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposed,
  }))

  const fail = (problems: Problem[]) => refuse(problems, locate)
  const drafts = writeDrafts()
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
  const request = (a: Obj, ops: unknown = a.ops) => ({
    site,
    baseRevision: a.baseRevision as number,
    key: a.key as string,
    ops: ops as never,
  })
  /** baseRevision is required and a non-negative integer; anything else is refused before any fetch. */
  const badBase = (a: Obj): Result | undefined =>
    Number.isInteger(a.baseRevision) && (a.baseRevision as number) >= 0
      ? undefined
      : fail([
          bad('baseRevision must be a non-negative integer.', 'baseRevision'),
        ])
  /** The batch with what it names fetched into the folder (`plan` and `apply` agree on it); a refusal, or the ops to run. */
  const fetched = async (a: Obj, doc: SiteDocument, offline = false) => {
    if (!o.fetch || !Array.isArray(a.ops)) return { ops: a.ops }
    const r = await o.fetch(a.ops, doc, offline)
    return r.ok ? { ops: r.ops } : { refusal: fail(r.problems) }
  }
  // `measure` continues from the report it made, not a second run
  let last: { key: string; rows: Obj[]; meta: Obj } | undefined

  const tools: Record<string, (a: Obj) => Promise<Result>> = {
    async describe(a) {
      const h = await headOf()
      if ('content' in h) return h
      if (a.example !== undefined) {
        if (
          typeof a.example !== 'string' ||
          !Object.hasOwn(examples, a.example)
        )
          return fail([
            bad(`Choose ${Object.keys(examples).join(', ')}.`, 'example'),
          ])
        return reply({
          revision: h.revision,
          example: a.example,
          node: examples[a.example as keyof typeof examples],
        })
      }
      if (compact)
        return reply(
          fit(
            {
              revision: h.revision,
              name: h.doc.name,
              ...(h.doc.styles?.textRange
                ? { textRange: h.doc.styles.textRange }
                : {}),
              pages: h.doc.pages.map(p => ({ id: p.id, path: p.slug })),
            },
            ['pages'],
          ),
        )
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
      const c = badCursor(a)
      if (c) return c
      const h = await headOf()
      if ('content' in h) return h
      if (a.format !== undefined && a.format !== 'json' && a.format !== 'jsx')
        return fail([bad('format must be json or jsx.', 'format')])
      if (a.format === 'jsx') {
        const t = a.tree ?? a.page
        const root =
          t === 'header' || t === 'footer'
            ? h.doc[t]
            : h.doc.pages.find(p => p.id === (isObj(t) ? (t as Obj).page : t))
                ?.root
        if (!root)
          return fail([
            bad('page must be a page id, "header" or "footer".', 'page'),
          ])
        try {
          return reply({
            revision: h.revision,
            page: isObj(t) ? (t as Obj).page : t,
            jsx: (root.children ?? []).map(c => emit(c)).join('\n'),
          })
        } catch (e) {
          return fail([
            bad(
              `This tree cannot be shown as JSX (${why(e)}). Use format json.`,
              'page',
            ),
          ])
        }
      }
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
      const c = badCursor(a)
      if (c) return c
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
      const badRev = badBase(a)
      if (badRev) return badRev
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
      const f = await fetched(a, h.doc)
      if (f.refusal) return f.refusal
      const r = plan(
        h.doc,
        registry,
        {
          ...request(a, f.ops),
          key: typeof a.key === 'string' ? a.key : 'plan',
        },
        allow,
      )
      return r.ok
        ? reply(summary(r, r.doc, { revision: h.revision }))
        : fail(r.problems)
    },

    async apply(a) {
      const badRev = badBase(a)
      if (badRev) return badRev
      const h = await headOf()
      if ('content' in h) return h
      // a key already committed is replayed by core, whatever the revision is now; the fetch still runs (held files: no request)
      const seen =
        typeof a.key === 'string' ? await store.replay(site, a.key) : undefined
      // A seen key resolves from held files only, with no request: a true replay needs nothing new. A batch that would fetch is not a replay.
      const offline = seen ? await fetched(a, h.doc, true) : undefined
      // a reused key whose batch is not what it committed is a key conflict, before any request
      if (seen && offline?.refusal)
        return fail([
          {
            code: 'KEY_CONFLICT',
            message: 'This key was used for other content.',
            path: 'key',
          },
        ])
      if (
        !seen &&
        Number.isInteger(a.baseRevision) &&
        a.baseRevision !== h.revision
      )
        return fail([
          {
            code: 'REVISION_CONFLICT',
            message: `The site is at revision ${h.revision}, not ${a.baseRevision}.`,
            path: 'baseRevision',
          },
        ])
      const f = offline && !offline.refusal ? offline : await fetched(a, h.doc)
      if (f.refusal) return f.refusal
      const r = await apply(store, registry, request(a, f.ops), allow)
      return r.ok
        ? reply(
            summary(r, await store.get(site, r.revision), {
              revision: r.revision,
              from: a.baseRevision,
              hint: HINT,
            }),
          )
        : fail(r.problems)
    },

    async write(a) {
      const badRev = badBase(a)
      if (badRev) return badRev
      if (
        o.jsonOps &&
        (!Array.isArray(a.ops) ||
          Object.keys(a).some(
            k => !['baseRevision', 'page', 'key', 'ops'].includes(k),
          ))
      )
        return fail([
          bad(
            'Use baseRevision and ops in the JSON operations profile; page and key are optional.',
            'ops',
          ),
        ])
      if (a.draft !== undefined || a.edits !== undefined) {
        const amended = drafts.amend(a)
        if ('error' in amended) return fail([bad(amended.error, 'draft')])
        a = amended.input
      }
      if (a.append !== undefined && typeof a.append !== 'boolean')
        return fail([bad('append must be true or false.', 'append')])
      for (const k of ['page', 'key', 'title', 'path', 'target'])
        if (a[k] !== undefined && typeof a[k] !== 'string')
          return fail([bad(`${k} must be a text.`, k)])
      const h = await headOf()
      if ('content' in h) return h
      const base = a.baseRevision as number
      // a retry with the same content has the same key, so core replays it
      const key =
        (a.key as string | undefined) ??
        `write-${createHash('sha256')
          .update(
            JSON.stringify([
              a.page,
              a.target,
              base,
              a.jsx,
              a.title,
              a.path,
              ...(a.append ? ['append'] : []),
              ...(
                [
                  'html',
                  'css',
                  'json',
                  'theme',
                  'insert',
                  'patch',
                  'ops',
                ] as const
              )
                .filter(k => a[k] !== undefined)
                .map(k => [k, a[k]]),
            ]),
          )
          .digest('hex')
          .slice(0, 40)}`
      const seen = await store.replay(site, key)
      // a stale base is refused before the JSX is read and before any fetch
      if (!seen && base !== h.revision)
        return fail([
          {
            code: 'REVISION_CONFLICT',
            message: `The site is at revision ${h.revision}, not ${base}. Nothing was written; send the same write with baseRevision ${h.revision} (find returns the current ids).`,
            path: 'baseRevision',
            revision: h.revision,
          } as Problem,
        ])
      // the operations are built against the revision the caller read, so a retry builds the same ones
      const doc =
        base === h.revision ? h.doc : ((await store.get(site, base)) ?? h.doc)
      const b = buildRequest(doc, registry, a as never)
      const at = { revision: h.revision, baseRevision: h.revision }
      const rejected = (problems: Problem[]) =>
        refuseMany(problems, {
          ...at,
          ...(!o.jsonOps ? drafts.remember(a) : {}),
        })
      if (!b.ok) return rejected(b.problems)
      // every problem in the JSX at once, before anything is saved or fetched
      if (!seen) {
        const found = diagnose(b, doc, registry, allow)
        if (found.length) return rejected(found)
      }
      let sum: Obj
      if (!b.ops.length && !seen)
        sum = { revision: h.revision, from: base, ops: 0, noop: true }
      else {
        const res = await tools.apply({ baseRevision: base, key, ops: b.ops })
        const j = JSON.parse(res.content[0]!.text) as Obj
        if (res.isError)
          return refuseMany(
            ((j.problems as Problem[]) ?? []).map(p => locateJsx(b, p)),
            at,
          )
        sum = {
          revision: j.revision,
          from: base,
          ops: b.ops.length,
          counts: j.counts,
          roots: j.roots,
          pages: j.pages,
          ...(j.notes ? { notes: j.notes } : {}),
        }
      }
      // the report of the page just written; the write is kept whatever it says
      if (a.ops !== undefined) {
        const committed = await store.get(site, sum.revision as number)
        return reply(
          fit(
            {
              revision: sum.revision,
              sections:
                committed?.pages
                  .find(p => p.id === (a.page ?? 'home'))
                  ?.root.children?.map(n => n.id) ?? [],
              ...(b.warnings.length
                ? {
                    warningCount: b.warnings.length,
                    warning: b.warnings[0]!.message.slice(0, 220),
                  }
                : {}),
            },
            ['sections'],
          ),
        )
      }
      if (b.warnings.length) sum.warnings = b.warnings
      const head = await store.head(site)
      const first = 'doc' in head ? head.doc.pages[0]?.id : undefined
      const written = b.trees.flatMap(t =>
        typeof t === 'object' ? [t.page] : [],
      )
      const pages = written.length ? written : first ? [first] : []
      const mr = await tools.measure({
        ...(pages.length ? { pages } : {}),
        classes: [1, 2],
      })
      const m = JSON.parse(mr.content[0]!.text) as Obj
      const paths =
        'doc' in head ? pathIndex(head.doc) : new Map<string, string>()
      if ('doc' in head) sum.index = indexOf(head.doc)
      sum.hint =
        'Nothing needs a read: index lists what exists, findings name the node id and JSX path. Fix with write {target: id, jsx}; to find another part use find.'
      const body: Obj = mr.isError
        ? { ...sum, measure: 'failed', problems: m.problems, complete: false }
        : {
            ...sum,
            measured: m.measured,
            skipped: m.skipped,
            complete:
              (m.incomplete as unknown[]).length === 0 &&
              (m.blocked as unknown[]).length === 0,
            findings: (m.findings as Obj[]).map(f => {
              const jsx = ((f.nodes as string[]) ?? []).flatMap(id =>
                paths.has(id) ? [`${id} = ${paths.get(id)}`] : [],
              )
              return jsx.length ? { ...f, jsx } : f
            }),
            incomplete: m.incomplete,
            blocked: m.blocked,
            ...(m.cursor ? { cursor: m.cursor } : {}),
          }
      const out = fit(body, [
        'findings',
        'warnings',
        'incomplete',
        'blocked',
        'index',
        'roots',
        'pages',
      ])
      if (out.cut && !m.cut) {
        delete out.cursor
        out.hint = 'More findings: call measure.'
      }
      return reply(out)
    },

    async find(a) {
      for (const k of ['text', 'kind', 'id', 'selector', 'tree'])
        if (a[k] !== undefined && typeof a[k] !== 'string')
          return fail([bad(`${k} must be a text.`, k)])
      if (a.limit !== undefined && !Number.isInteger(a.limit))
        return fail([bad('limit must be a whole number.', 'limit')])
      const h = await headOf()
      if ('content' in h) return h
      const bare = ['text', 'kind', 'id', 'selector'].every(
        k => a[k] === undefined,
      )
      if (bare && !a.full) {
        const outline = indexOf(h.doc).filter(
          t => a.tree === undefined || a.tree === t.tree,
        )
        return reply(
          fit(
            {
              revision: h.revision,
              outline,
              hint: 'Use a section id, or full:true to list node ids.',
            },
            ['outline'],
          ),
        )
      }
      const r = findNodes(h.doc, a as never)
      if ('error' in r) return fail([bad(r.error, 'selector')])
      const trees = ['header', 'footer', ...h.doc.pages.map(p => p.id)]
      return reply(
        fit(
          {
            revision: h.revision,
            total: r.total,
            matches: o.jsonOps
              ? r.hits.map(({ tree, id, kind, path, text, children }) => {
                  const hit = {
                    tree,
                    id,
                    kind,
                    path,
                    ...(text ? { text } : {}),
                    children,
                  }
                  const root =
                    a.full && !bare
                      ? treesOf(h.doc).find(([key]) => key === hit.tree)?.[1]
                      : undefined
                  return {
                    ...hit,
                    ...(root ? { node: findNode(root, hit.id) } : {}),
                  }
                })
              : r.hits,
            hint: r.total
              ? o.jsonOps
                ? 'Use the returned id in an update, move or remove operation.'
                : 'write {target: <id>, jsx: <the one element that replaces it>, baseRevision: revision}. A match is a node of the tree named; its path is Name[index] > ... below the tree root.'
              : `Nothing matches. Trees: ${trees.join(', ')}.`,
          },
          ['matches'],
        ),
      )
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
        ? reply(
            summary(r, await store.get(site, r.revision), {
              revision: r.revision,
              from: a.baseRevision,
              hint: HINT,
            }),
          )
        : fail(r.problems)
    },

    async diff(a) {
      const c = badCursor(a)
      if (c) return c
      if (
        !Number.isInteger(a.from) ||
        (a.to !== undefined && !Number.isInteger(a.to))
      )
        return fail([
          bad(
            'from and to must be revision numbers.',
            Number.isInteger(a.from) ? 'to' : 'from',
          ),
        ])
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
      const c = badCursor(a)
      if (c) return c
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
      if (a.cursor !== undefined && last?.key !== key)
        return fail([
          bad(
            'That report is no longer held; run measure again without a cursor.',
            'cursor',
          ),
        ])
      if (a.cursor === undefined) {
        const input = {
          registry,
          data: o.data,
          ...(a.pages ? { pages: a.pages as string[] } : {}),
          ...(a.widths ? { widths: a.widths as number[] } : {}),
          ...(a.classes ? { classes: a.classes as (1 | 2 | 3)[] } : {}),
          ...(o.browser ? { browser: o.browser } : {}),
          ...(o.executable ? { executable: o.executable } : {}),
          ...(o.files ? { files: await o.files() } : {}),
          ...(o.held ? await o.held() : {}),
          ...(o.assets ? { assets: o.assets } : {}),
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
        // folder sites: each finding names its file and line
        const at = (f: Finding): Finding =>
          locate ? locateFinding(f, locate, id => o.pageFile?.(id)) : f
        const r = { ...m.report, findings: m.report.findings.map(at) }
        const c = m.comparison && {
          was: m.comparison.was.map(w => ({ ...w, finding: at(w.finding) })),
          added: m.comparison.added.map(at),
        }
        const x = measureReply(r, c) as Obj & {
          findings: Obj[]
          fixed?: Obj[]
          incomplete: Obj[]
          blocked: unknown[]
        }
        last = {
          key,
          meta: {
            revision: x.revision,
            measured: x.measured,
            skipped: x.skipped,
            ...(x.unchecked !== undefined ? { unchecked: x.unchecked } : {}),
          },
          rows: [
            ...x.findings.map(finding => ({ finding })),
            ...x.incomplete.map(incomplete => ({ incomplete })),
            ...x.blocked.map(blocked => ({ blocked })),
            ...(x.fixed ?? []).map(fixed => ({ fixed })),
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
        ...(a.since !== undefined ? { fixed: pick(rs, 'fixed') } : {}),
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
      if (!run || (compact && !sectionTools.includes(name)))
        return fail([bad(`There is no tool "${name}".`)])
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
