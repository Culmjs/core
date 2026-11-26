import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildIdentity,
  checkShader,
  compilePage,
  compileSite,
  createRegistry,
  type CustomEffect,
  type GpuEffectDef,
  type Node,
  type SiteDocument,
} from '../../src/index.ts'
import {
  RIPPLE_WASM_BASE64,
  RIPPLE_WASM_SHA256,
} from '../../src/registry/rippleModule.ts'
import { DEMO_PLUGIN, node, siteWith, text, twoPages } from '../kit.ts'

const owner = (id: string, gpu: string, hidden = false): Node => ({
  ...node(id, 'column', [text(`${id}title`, 'Static heading')]),
  ...(hidden && { style: { base: { hidden: true } } }),
  motion: { trigger: 'enter-view', gpu, poster: 'static.png' },
})

const customMist: CustomEffect = {
  name: 'mist',
  source: 'vec4 shade(vec2 uv){return vec4(u_set_tint,1.0);}',
  settings: { tint: { type: 'color', default: '#445566' } },
}

const policy = (html: string) =>
  html
    .match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)![1]
    .replaceAll('&#39;', "'")

const wasmBytes = (length: number) =>
  Buffer.alloc(length, 0xaa).toString('base64')

function withPlugin(
  effect: GpuEffectDef,
  gpu: NonNullable<Parameters<typeof createRegistry>[0]>['gpu'] = {
    enabled: true,
    approvedWasmPlugins: [
      { name: DEMO_PLUGIN.name, version: DEMO_PLUGIN.version },
    ],
  },
) {
  const r = createRegistry({ gpu })
  r.use({ ...DEMO_PLUGIN, effects: [effect] })
  return r
}

test('ripple_field is registered only with GPU enabled, reviewed, and executes fixed-memory zero-import ABI', () => {
  assert.equal(createRegistry().effect('ripple_field'), undefined)

  const reg = createRegistry({ gpu: { enabled: true } })
  const ripple = reg.effect('ripple_field') as GpuEffectDef | undefined
  assert.ok(ripple && ripple.tier === 3)
  assert.equal(ripple.wasm?.abi, 'field-v1')
  assert.equal(ripple.wasm?.bytesBase64, RIPPLE_WASM_BASE64)
  assert.equal(reg.gpu?.isReviewed(ripple), true)

  const raw = Buffer.from(RIPPLE_WASM_BASE64, 'base64')
  assert.equal(raw.length, 382)
  assert.equal(
    createHash('sha256').update(raw).digest('hex'),
    RIPPLE_WASM_SHA256,
  )

  const mod = new WebAssembly.Module(raw)
  assert.deepEqual(WebAssembly.Module.imports(mod), [])
  const inst = new WebAssembly.Instance(mod)
  const ex = inst.exports as {
    memory: WebAssembly.Memory
    reset: () => void
    step: (dt: number) => void
    fieldPtr: () => number
  }
  assert.equal(ex.memory.buffer.byteLength, 65_536)
  assert.throws(() => ex.memory.grow(1), RangeError)

  ex.reset()
  const ptr = ex.fieldPtr()
  assert.ok(Number.isInteger(ptr) && ptr >= 0 && ptr <= 64_512)
  const field = new Uint8Array(ex.memory.buffer, ptr, 1024)
  const initial198 = field[198]
  assert.equal(initial198, 255)

  const observed198: number[] = []
  for (let i = 0; i < 4; i++) {
    ex.step(1 / 60)
    observed198.push(field[198])
  }
  assert.ok(observed198.some(v => v !== initial198))
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      if (x === 0 || x === 31 || y === 0 || y === 31)
        assert.equal(field[y * 32 + x], 128)
})

test('WASM size boundaries, plugin approval, ABI, and private u_field rules are enforced', () => {
  const validSource = 'vec4 shade(vec2 uv){return vec4(texture(u_field,uv).r);}'
  assert.equal(checkShader(validSource, {}).ok, false)

  // 512 raw bytes -> 684 base64 chars; 513 raw bytes -> 684 base64 chars (over 512 raw);
  // 514 raw bytes -> 688 base64 chars (over both caps).
  const atRawLimit = wasmBytes(512)
  assert.equal(atRawLimit.length, 684)
  const overRawLimit = wasmBytes(513)
  assert.equal(overRawLimit.length, 684)
  const overTransportLimit = wasmBytes(514)
  assert.equal(overTransportLimit.length, 688)

  assert.doesNotThrow(() =>
    withPlugin({
      name: 'okfield',
      tier: 3,
      source: validSource,
      settings: {},
      wasm: { abi: 'field-v1', bytesBase64: atRawLimit },
    }),
  )
  assert.throws(() =>
    withPlugin({
      name: 'overraw',
      tier: 3,
      source: validSource,
      settings: {},
      wasm: { abi: 'field-v1', bytesBase64: overRawLimit },
    }),
  )
  assert.throws(() =>
    withPlugin({
      name: 'overb64',
      tier: 3,
      source: validSource,
      settings: {},
      wasm: { abi: 'field-v1', bytesBase64: overTransportLimit },
    }),
  )
  // Unapproved plugin cannot register WASM modules.
  assert.throws(
    () =>
      withPlugin(
        {
          name: 'unapproved',
          tier: 3,
          source: validSource,
          settings: {},
          wasm: { abi: 'field-v1', bytesBase64: atRawLimit },
        },
        { enabled: true },
      ),
    /not approved/i,
  )
  // Unknown ABI is refused.
  assert.throws(() =>
    withPlugin({
      name: 'badabi',
      tier: 3,
      source: validSource,
      settings: {},
      wasm: { abi: 'field-v2' as 'field-v1', bytesBase64: atRawLimit },
    }),
  )

  // Public checkShader and customEffects always refuse private u_field.
  const r = checkShader(validSource, {})
  assert.deepEqual(r, {
    ok: false,
    rule: 'shader.input',
    line: 1,
    measured: 'u_field',
    limit: 'declared input',
  })
  const badCustom = compilePage(
    siteWith([owner('hero', 'custom_field')], {
      customEffects: [
        { name: 'custom_field', source: validSource, settings: {} },
      ],
    }),
    'home',
    { registry: createRegistry({ gpu: { enabled: true } }) },
  )
  assert.equal(badCustom.ok, false)
  assert.equal(badCustom.problems[0]?.rule, 'shader.input')
})

test('CSP only grants wasm-unsafe-eval when a live main region uses a WASM module', () => {
  const reg = createRegistry({ gpu: { enabled: true } })
  const checkMeta = (
    doc: SiteDocument,
    expectWorker: boolean,
    expectWasm: boolean,
  ) => {
    const p = compilePage(doc, 'home', { registry: reg })
    assert.ok(p.ok, JSON.stringify(p.problems))
    const csp = policy(p.html)
    assert.equal(csp.includes('worker-src blob:'), expectWorker)
    assert.equal(csp.includes("'wasm-unsafe-eval'"), expectWasm)
    return p
  }

  // Plain page and shader-only pages must not receive wasm-unsafe-eval.
  checkMeta(
    siteWith([node('box', 'column', [text('h', 'Plain')])]),
    false,
    false,
  )
  checkMeta(siteWith([owner('c', 'contours')]), true, false)
  checkMeta(
    siteWith([owner('m', 'mist')], { customEffects: [customMist] }),
    true,
    false,
  )
  // Registered WASM effect exists on registry, but unused on page.
  assert.ok(reg.effect('ripple_field'))
  checkMeta(siteWith([owner('c2', 'contours')]), true, false)

  // Non-runnable WASM owners (off page, outside <main> in header, or outer owner wrapping a leaf owner) receive no wasm-unsafe-eval.
  const pageOff = siteWith([owner('offpage', 'ripple_field')])
  pageOff.pages[0] = { ...pageOff.pages[0], on: false }
  checkMeta(pageOff, false, false)
  const nestedNonRunnable = siteWith([
    {
      ...node('outer', 'column', [
        text('outertitle', 'Outer static heading'),
        owner('inner', 'contours'),
      ]),
      motion: {
        trigger: 'enter-view',
        gpu: 'ripple_field',
        poster: 'static.png',
      },
    },
  ])
  checkMeta(nestedNonRunnable, true, false)
  const inHeader = siteWith([owner('c3', 'contours')])
  inHeader.header.children = [owner('hdr', 'ripple_field')]
  checkMeta(inHeader, true, false)

  // Runnable live WASM owner inside <main> grants 'wasm-unsafe-eval'.
  checkMeta(siteWith([owner('rip', 'ripple_field')]), true, true)
})

test('compileSite emits manifest.wasmModules only for used WASM pages and _headers follows active WASM usage', () => {
  const reg = createRegistry({ gpu: { enabled: true } })
  const mixed = twoPages(
    [owner('rip', 'ripple_field')],
    [owner('con', 'contours')],
  )
  const site = compileSite(mixed, { registry: reg })
  assert.deepEqual(site.problems, [])
  assert.deepEqual(site.manifest.wasmModules, [
    {
      name: 'ripple_field',
      sha256: RIPPLE_WASM_SHA256,
      bytes: 382,
      transportBytes: 512,
      pages: ['home'],
    },
  ])
  const headers = site.files.find(f => f.path === '_headers')!.content
  assert.match(headers, /'wasm-unsafe-eval'/)
  // Inert per-page GPU stats: contours-only page reports wasmBytes = 0 when compiled alone or per page.
  const contoursPage = compilePage(mixed, 'about', { registry: reg })
  assert.ok(contoursPage.ok)
  assert.equal(contoursPage.stats.gpuData?.wasmBytes, 0)
  assert.doesNotMatch(policy(contoursPage.html), /wasm-unsafe-eval/)

  // Site without WASM regions omits manifest.wasmModules and 'wasm-unsafe-eval'.
  const shaderOnly = compileSite(siteWith([owner('con', 'contours')]), {
    registry: reg,
  })
  assert.deepEqual(shaderOnly.problems, [])
  assert.equal(shaderOnly.manifest.wasmModules, undefined)
  const shaderHeaders = shaderOnly.files.find(
    f => f.path === '_headers',
  )!.content
  assert.doesNotMatch(shaderHeaders, /wasm-unsafe-eval/)
})

test('buildIdentity reflects active GPU and WASM registrations and stays identical when GPU is disabled', async () => {
  const offReg = createRegistry()
  const onReg = createRegistry({ gpu: { enabled: true } })
  const plainDoc = siteWith([node('box', 'column', [text('h', 'Hello')])])
  assert.equal(
    await buildIdentity(plainDoc, { rows: {} }, offReg),
    await buildIdentity(plainDoc, { rows: {} }, onReg),
  )

  const rippleDoc = siteWith([owner('rip', 'ripple_field')])
  const withoutGpu = await buildIdentity(rippleDoc, { rows: {} }, offReg)
  const withRippleV1 = await buildIdentity(rippleDoc, { rows: {} }, onReg)
  assert.notEqual(withRippleV1, withoutGpu)

  // Changing the WASM module bytes in a registered effect changes buildIdentity.
  const customA = withPlugin({
    name: 'fld',
    tier: 3,
    source: 'vec4 shade(vec2 uv){return vec4(texture(u_field,uv).r);}',
    settings: {},
    wasm: { abi: 'field-v1', bytesBase64: wasmBytes(8) },
  })
  const customB = withPlugin({
    name: 'fld',
    tier: 3,
    source: 'vec4 shade(vec2 uv){return vec4(texture(u_field,uv).r);}',
    settings: {},
    wasm: { abi: 'field-v1', bytesBase64: wasmBytes(9) },
  })
  const docA = siteWith([owner('x', 'fld')])
  assert.notEqual(
    await buildIdentity(docA, { rows: {} }, customA),
    await buildIdentity(docA, { rows: {} }, customB),
  )
  // Disabled GPU builds ignore registry GPU metadata.
  assert.equal(
    await buildIdentity(rippleDoc, { rows: {} }, offReg),
    await buildIdentity(rippleDoc, { rows: {} }, createRegistry()),
  )
})
