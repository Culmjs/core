import assert from 'node:assert/strict'
import test from 'node:test'
import { priceGpu } from '../gpu-spike.ts'

test('price the joined UTF-8 inline script and all lazy JS; separate WASM and its transport', () => {
  const r = priceGpu({
    inline: ['a', 'é'],
    lazyJs: 'xyz',
    wasm: Uint8Array.of(0, 1),
    encodedWasm: 'AAE=',
  })
  assert.deepEqual(
    [r.sharedJs, r.hostJs, r.wasmBytes, r.wasmTransportBytes, r.remainingJs],
    [7, 3, 2, 4, 19993],
  )
})

test('the mixed HTML delivers the priced executable and one inert recoverable module', async () => {
  const { makePage } = await import('../gpu-spike/pages.ts')
  const p = await makePage('mixed')
  const inline = [...p.html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  assert.equal(inline.length, 1)
  const r = priceGpu(p)
  assert.equal(
    r.sharedJs,
    Buffer.byteLength(inline[0][1]) + Buffer.byteLength(p.lazyJs),
  )
  const payload = JSON.parse(
    p.html.match(
      /<script type="application\/json" id="fields">([^<]*)<\/script>/,
    )![1],
  )
  assert.equal(payload.module, p.encodedWasm)
  assert.deepEqual(Buffer.from(payload.module, 'base64'), p.wasm)
  assert.ok(WebAssembly.validate(p.wasm))
  assert.ok(!p.lazyJs.includes(p.encodedWasm))
  assert.equal(p.html.split(p.encodedWasm).length, 2)
})

test('the final fixture budgets include all style bodies and the inert body script', async () => {
  const { makePage } = await import('../gpu-spike/pages.ts')
  for (const [name, cssBytes, bodyElements] of [
    ['control', 7517, 41],
    ['shader', 7920, 42],
    ['wasm', 7920, 42],
    ['mixed', 8416, 58],
  ] as const) {
    const page = await makePage(name)
    assert.deepEqual(
      page.structure,
      { cssBytes, bodyElements, logicalDepth: 6 },
      name,
    )
  }
})
