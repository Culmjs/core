import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as shipped from '@culmjs/core'
import { candidateCompiler } from './gpu-flash/compiler.ts'
import { renderGpuWorker, RELEASE_CHECKED } from './gen-scripts.ts'
import { DEMO_PLUGIN, node, text } from '../packages/core/__tests__/kit.ts'
import { mist } from '../packages/tools/__tests__/fixtures/shader.ts'
import { scenes } from '../packages/tools/__tests__/fixtures/motion-scenes.ts'

for (const [profile, core, checked] of [
  ['release', shipped, RELEASE_CHECKED],
  ['candidate', await candidateCompiler(), true],
] as const) {
  const doc = await scenes.mixed()
  const registry = core.createRegistry({
    gpu: {
      enabled: true,
      approvedWasmPlugins: [{ name: 'demo', version: 1 }],
      reviewed: [mist],
    },
  })
  registry.use({
    ...DEMO_PLUGIN,
    effects: [
      {
        ...mist,
        name: 'field',
        tier: 3,
        wasm: { abi: 'field-v1', bytesBase64: 'AAE=' },
      },
    ],
  })
  doc.customEffects = [mist]
  for (const name of ['contours', 'mist', 'field'])
    doc.pages[0].root.children!.push({
      ...node(name, 'column', [text(name + 'caption', 'Field notes')]),
      motion: { trigger: 'enter-view', gpu: name },
    })
  const c = core.compilePage(doc, 'home', { registry })
  assert.ok(c.ok)
  const code = c.assets![0].content,
    host = Buffer.byteLength(code),
    inline = Buffer.byteLength(c.scripts.map(s => s.code).join(';'))
  assert.equal(host, c.stats.scriptBytes.gpuHost)
  assert.equal(
    host + inline,
    Object.values(c.stats.scriptBytes).reduce((a, b) => a + b, 0),
  )
  const hash = createHash('sha256').update(code)
  console.log(
    JSON.stringify({
      profile,
      worker: Buffer.byteLength(renderGpuWorker(checked)),
      host,
      inline,
      shared: host + inline,
      hostHeadroom: 6144 - host,
      mixedHeadroom: 20000 - host - inline,
      sha256: hash.copy().digest('hex'),
      sri: 'sha256-' + hash.digest('base64'),
      stats: c.stats,
      refusals: c.problems.map(p => p.path),
    }),
  )
}
