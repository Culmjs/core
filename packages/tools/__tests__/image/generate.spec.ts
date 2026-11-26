import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'node:http'
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRegistry, emptySite } from '@culmjs/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { readHeld } from '../../src/folder/held.ts'
import { fetchFor } from '../../src/folder/fetch.ts'
import { loadPlugins } from '../../src/folder/plugins.ts'
import {
  genAssetStem,
  inspectImageBytes,
  MAX_GENERATED_IMAGES,
} from '../../src/image/generate.ts'
import {
  makeImageProvider,
  resolveProviderName,
} from '../../src/image/providers.ts'
import { createMcpServer } from '../../src/mcp/server.ts'
import { protect } from '../../src/mcp/protect.ts'
import { LOOK } from '../../../core/__tests__/kit.ts'

// Minimal valid 2x2 PNG and 1x1 VP8L WebP bytes
const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d, 0x24,
])
const TINY_WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x4c, 0x0c, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00,
])

const dirs: string[] = []
after(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })))
})

async function makeDir() {
  const d = await mkdtemp(join(tmpdir(), 'culm-img-'))
  dirs.push(d)
  return d
}

test('inspectImageBytes verifies PNG, WebP, JPEG magic bytes and rejects invalid payloads', () => {
  assert.deepEqual(inspectImageBytes(TINY_PNG), {
    ext: 'png',
    width: 2,
    height: 2,
  })
  assert.deepEqual(inspectImageBytes(TINY_WEBP), {
    ext: 'webp',
    width: 1,
    height: 1,
  })
  assert.equal(
    inspectImageBytes(new TextEncoder().encode('<html>nope</html>')),
    null,
  )
})

test('openai, gemini, higgsfield (execFn) and http adapters parse and return validated bytes', async () => {
  const b64Png = Buffer.from(TINY_PNG).toString('base64')
  const openai = makeImageProvider(
    { provider: 'openai' },
    {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchFn: async (url, init) => {
        assert.match(String(url), /api\.openai\.com\/v1\/images\/generations/)
        const body = JSON.parse(String(init?.body))
        assert.equal(body.output_format, 'png')
        assert.equal(body.background, 'transparent')
        return new Response(JSON.stringify({ data: [{ b64_json: b64Png }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  )!
  const r1 = await openai({
    prompt: 'Studio ceramic cup',
    aspect: '1:1',
    transparent: true,
  })
  assert.equal(r1.ext, 'png')
  assert.equal(r1.bytes.length, TINY_PNG.length)

  const gemini = makeImageProvider(
    { provider: 'gemini', model: 'gemini-2.5-flash-image' },
    {
      env: { GEMINI_API_KEY: 'gm-test' },
      fetchFn: async url => {
        assert.match(String(url), /generativelanguage\.googleapis\.com/)
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { data: b64Png, mimeType: 'image/png' } },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    },
  )!
  const r2 = await gemini({ prompt: 'Basalt coast', aspect: '16:9' })
  assert.equal(r2.provider, 'gemini')
  assert.equal(r2.ext, 'png')

  // Real local HTTP server test for the http adapter
  const srv = createServer((req, res) => {
    assert.equal(req.method, 'POST')
    res.writeHead(200, { 'content-type': 'image/webp' })
    res.end(TINY_WEBP)
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as { port: number }).port
  try {
    const httpProv = makeImageProvider(
      { provider: 'http', endpoint: `http://127.0.0.1:${port}/gen` },
      { env: {} },
    )!
    const r3 = await httpProv({ prompt: 'Local render', aspect: '4:3' })
    assert.equal(r3.ext, 'webp')
    assert.equal(inspectImageBytes(r3.bytes)?.ext, 'webp')
  } finally {
    await new Promise<void>(r => srv.close(() => r()))
  }

  // higgsfield adapter via execFn writing to --out
  const hf = makeImageProvider(
    { provider: 'higgsfield' },
    {
      env: {},
      hasBinary: () => true,
      execFn: async (cmd, args) => {
        assert.equal(cmd, 'higgsfield')
        const outIdx = args.indexOf('--out')
        assert.ok(outIdx > 0)
        await writeFile(args[outIdx + 1]!, TINY_PNG)
        return { stdout: 'ok', stderr: '' }
      },
    },
  )!
  const r4 = await hf({ prompt: 'Kiln', aspect: '1:1' })
  assert.equal(r4.provider, 'higgsfield')
  assert.equal(r4.ext, 'png')
})

test('fetchFor caches generated images in assets/gen/, supports offline replay, and enforces batch cap', async () => {
  const dir = await makeDir()
  const doc = emptySite('Img', LOOK)
  let calls = 0
  const provider = async () => {
    calls++
    return {
      bytes: TINY_WEBP,
      ext: 'webp' as const,
      width: 1200,
      height: 675,
      provider: 'fake',
      model: 'fake-1',
    }
  }
  const ops = [
    {
      op: 'add',
      tree: { page: 'home' },
      parent: 'homeroot',
      index: 0,
      node: {
        id: 'pic1',
        kind: 'image',
        name: 'Pic',
        slot: {},
        props: {
          generate: 'Ceramic bowls on warm stone',
          aspect: '16:9',
          alt: 'Ceramic bowls',
        },
      },
    },
  ]

  const first = await fetchFor(dir, doc, ops, { imageProvider: provider })
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(calls, 1)
  const expectedStem = genAssetStem({
    prompt: 'Ceramic bowls on warm stone',
    aspect: '16:9',
  })
  if (first.ok) {
    const added = (first.ops[0] as { node: { props: Record<string, unknown> } })
      .node
    assert.equal(added.props.assetId, `${expectedStem}.webp`)
    assert.equal(added.props.width, 1200)
    assert.equal(added.props.generate, undefined)
  }

  // Provenance sidecar and held inventory match
  const genFiles = await readdir(join(dir, 'assets/gen'))
  assert.equal(genFiles.length, 2)
  const held = await readHeld(dir)
  assert.equal(
    held.generated.get(expectedStem)?.assetId,
    `${expectedStem}.webp`,
  )

  // Second call + offline replay hit disk cache with 0 provider calls
  const replay = await fetchFor(dir, doc, ops, {
    offline: true,
    imageProvider: provider,
  })
  assert.equal(replay.ok, true)
  assert.equal(calls, 1)

  // Over MAX_GENERATED_IMAGES uncached images in one batch refuses cleanly
  const many = Array.from({ length: MAX_GENERATED_IMAGES + 1 }, (_, i) => ({
    op: 'add',
    tree: { page: 'home' },
    parent: 'homeroot',
    index: i,
    node: {
      id: `p${i}`,
      kind: 'image',
      name: 'P',
      slot: {},
      props: { generate: `Unique subject ${i}`, aspect: '1:1', alt: 'P' },
    },
  }))
  const capped = await fetchFor(dir, doc, many, { imageProvider: provider })
  assert.equal(capped.ok, false)
  if (!capped.ok)
    assert.equal(capped.problems[0]?.code, 'RESOURCE_LIMIT_EXCEEDED')
})

test('culm.json images config is validated and MCP write with image.generate + bgImage.generate commits cleanly', async () => {
  const dir = await makeDir()
  const bad = await loadPlugins(
    dir,
    new Map([
      [
        'culm.json',
        JSON.stringify({ plugins: [], images: { provider: 'nope' } }),
      ],
    ]),
  )
  assert.ok(bad.problems.some(p => p.code === 'INVALID_DOCUMENT'))

  const good = await loadPlugins(
    dir,
    new Map([
      [
        'culm.json',
        JSON.stringify({
          plugins: [],
          images: { provider: 'openai', model: 'gpt-image-1' },
        }),
      ],
    ]),
  )
  assert.deepEqual(good.problems, [])
  assert.equal(good.config.images?.provider, 'openai')

  // End-to-end compact MCP write with image.generate & style.bgImage.generate
  const { memoryStore } = await import('@culmjs/core/ops')
  const doc = emptySite('GenSite', LOOK)
  const store = memoryStore({ s: doc })
  const reg = createRegistry()
  const server = createMcpServer({
    store,
    registry: reg,
    site: 's',
    data: { rows: {} },
    allow: protect,
    jsonOps: true,
    cwd: dir,
    fetch: (ops, d, offline) =>
      fetchFor(dir, d, ops, {
        offline,
        imageProvider: async () => ({
          bytes: TINY_WEBP,
          ext: 'webp',
          width: 800,
          height: 450,
          provider: 'test',
          model: 't1',
        }),
      }),
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 't', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  try {
    const wr = await client.callTool({
      name: 'write',
      arguments: {
        baseRevision: 0,
        page: 'home',
        ops: [
          {
            op: 'insert',
            node: {
              id: 'hero',
              kind: 'column',
              style: {
                bgImage: { generate: 'Mist over pine ridge', aspect: '16:9' },
              },
              children: [
                {
                  id: 'vessel',
                  kind: 'image',
                  generate: 'Glazed bowl on limestone',
                  aspect: '4:3',
                  alt: 'Glazed bowl',
                },
              ],
            },
          },
        ],
      },
    })
    assert.equal(wr.isError, undefined, JSON.stringify(wr))
    const head = await store.head('s')
    assert.ok('doc' in head)
    const hero = head.doc.pages[0]!.root.children![0]!
    assert.match(
      String(hero.style?.base?.bgImage),
      /^gen\/mist-over-pine-ridge-/,
    )
    assert.match(
      String(hero.children?.[0]?.props?.assetId),
      /^gen\/glazed-bowl-on-limestone-/,
    )
    const metaRaw = await readFile(
      join(
        dir,
        'assets',
        String(hero.children?.[0]?.props?.assetId).replace(
          /\.(png|webp)$/,
          '.json',
        ),
      ),
      'utf8',
    )
    assert.equal(JSON.parse(metaRaw).prompt, 'Glazed bowl on limestone')
  } finally {
    await client.close()
    await chmod(dir, 0o755).catch(() => {})
  }
})

for (const [name, envKey, host, header] of [
  [
    'gemini',
    'GEMINI_API_KEY',
    'generativelanguage.googleapis.com',
    'x-goog-api-key',
  ],
  ['openai', 'OPENAI_API_KEY', 'api.openai.com', 'authorization'],
] as const)
  for (const provider of [name, undefined])
    test(`a configured endpoint never receives a provider key (${name}, provider ${provider ?? 'auto'})`, async () => {
      const seen: { url: string; init: RequestInit | undefined }[] = []
      const p = makeImageProvider(
        {
          ...(provider ? { provider } : {}),
          endpoint: 'https://other.example/x',
        },
        {
          env: { [envKey]: 'SECRET' },
          fetchFn: async (url, init) => {
            seen.push({ url: String(url), init })
            return new Response('{}', { status: 500 })
          },
        },
      )!
      await p({ prompt: 'cup', aspect: '1:1' }).catch(() => {})
      assert.ok(seen.length > 0)
      for (const { url, init } of seen) {
        if (new URL(url).host === host) continue
        const dump = JSON.stringify([url, init?.headers, init?.body])
        assert.ok(!dump.includes('SECRET'), dump)
        assert.ok(!dump.toLowerCase().includes(header), dump)
      }
    })

async function genServer(dir: string, jsonOps = true) {
  const { memoryStore } = await import('@culmjs/core/ops')
  const store = memoryStore({ s: emptySite('GenSite', LOOK) })
  let calls = 0
  const server = createMcpServer({
    store,
    registry: createRegistry(),
    site: 's',
    data: { rows: {} },
    allow: protect,
    jsonOps,
    cwd: dir,
    fetch: (ops, d, offline, defer) =>
      fetchFor(
        dir,
        d,
        ops,
        {
          offline,
          imageProvider: async () => {
            calls++
            return {
              bytes: TINY_WEBP,
              ext: 'webp',
              width: 8,
              height: 8,
              provider: 'test',
              model: 't1',
            }
          },
        },
        defer,
      ),
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 't', version: '0' })
  await Promise.all([server.connect(b), client.connect(a)])
  const image = {
    op: 'insert',
    node: { id: 'pic', kind: 'image', generate: 'Glazed bowl', alt: 'Bowl' },
  }
  const full = {
    op: 'add',
    tree: { page: 'home' },
    parent: 'homeroot',
    index: 0,
    node: {
      id: 'pic',
      kind: 'image',
      name: 'Pic',
      slot: {},
      props: { generate: 'Glazed bowl', alt: 'Bowl' },
    },
  }
  return { client, image, full, calls: () => calls }
}

test('plan with a generate request calls no provider and writes no file', async () => {
  const dir = await makeDir()
  const { client, full, calls } = await genServer(dir, false)
  try {
    const r = await client.callTool({
      name: 'plan',
      arguments: { baseRevision: 0, ops: [full] },
    })
    assert.equal(r.isError, undefined, JSON.stringify(r))
    assert.equal(calls(), 0)
    await assert.rejects(readdir(join(dir, 'assets', 'gen')))
    const doc = emptySite('Img', LOOK)
    const f = await fetchFor(
      dir,
      doc,
      [full],
      {
        imageProvider: async () => {
          throw new Error('must not be called')
        },
      },
      true,
    )
    assert.ok(f.ok)
    assert.match(
      (f.ops[0] as { node: { props: { assetId: string } } }).node.props.assetId,
      /^gen\/glazed-bowl-[0-9a-f]{10}\.webp$/,
    )
  } finally {
    await client.close()
  }
})

test('a refused write calls no provider', async () => {
  const dir = await makeDir()
  const { client, full, calls } = await genServer(dir, false)
  try {
    const r = await client.callTool({
      name: 'apply',
      arguments: {
        baseRevision: 0,
        key: 'k',
        ops: [
          full,
          {
            ...full,
            parent: 'no-such-parent',
            node: { ...full.node, id: 'other' },
          },
        ],
      },
    })
    assert.equal(r.isError, true, JSON.stringify(r))
    assert.equal(calls(), 0)
    await assert.rejects(readdir(join(dir, 'assets', 'gen')))
  } finally {
    await client.close()
  }
})

test('an accepted write calls the provider once', async () => {
  const dir = await makeDir()
  const { client, image, calls } = await genServer(dir)
  try {
    const r = await client.callTool({
      name: 'write',
      arguments: { baseRevision: 0, page: 'home', ops: [image] },
    })
    assert.equal(r.isError, undefined, JSON.stringify(r))
    assert.equal(calls(), 1)
    assert.equal((await readdir(join(dir, 'assets', 'gen'))).length, 2)
  } finally {
    await client.close()
  }
})

test('no provider is chosen without an opt-in', () => {
  const env = { GEMINI_API_KEY: 'k' }
  assert.equal(resolveProviderName(undefined, { env }), undefined)
  assert.equal(resolveProviderName({}, { env }), 'gemini')
  assert.equal(
    resolveProviderName(undefined, { env: { CULM_IMAGE_PROVIDER: 'openai' } }),
    'openai',
  )
})

test('a provider reply in another format than the predicted one is refused and writes no file', async () => {
  const dir = await makeDir()
  const doc = emptySite('Img', LOOK)
  const ops = [
    {
      op: 'add',
      tree: { page: 'home' },
      parent: 'homeroot',
      index: 0,
      node: {
        id: 'pic',
        kind: 'image',
        name: 'Pic',
        slot: {},
        props: { generate: 'Glazed bowl', alt: 'Bowl' },
      },
    },
  ]
  const reply = (bytes: Uint8Array, ext: 'png' | 'webp') => async () => ({
    bytes,
    ext,
    provider: 'fake',
    model: 'm',
  })
  const bad = await fetchFor(dir, doc, ops, {
    imageProvider: reply(TINY_PNG, 'png'),
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) {
    assert.equal(bad.problems[0]!.code, 'FETCH_FAILED')
    assert.match(bad.problems[0]!.message, /png but webp was expected/)
  }
  await assert.rejects(readdir(join(dir, 'assets', 'gen')))
  const good = await fetchFor(dir, doc, ops, {
    imageProvider: reply(TINY_WEBP, 'webp'),
  })
  assert.equal(good.ok, true, JSON.stringify(good))
})

test('CULM_IMAGE_ENDPOINT alone does not opt in; an images key does', () => {
  const env = { CULM_IMAGE_ENDPOINT: 'https://x.example/g' }
  assert.equal(resolveProviderName(undefined, { env }), undefined)
  assert.equal(resolveProviderName({}, { env }), 'http')
})
