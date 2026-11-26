import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import * as shipped from '@culmjs/core'
import { comparisonCompiler } from './gpu-flash/compiler.ts'
import { renderGpuWorker, RELEASE_CHECKED } from './gen-scripts.ts'
import { DEMO_PLUGIN, node, text } from '../packages/core/__tests__/kit.ts'
import { mist } from '../packages/tools/__tests__/fixtures/shader.ts'
import { scenes } from '../packages/tools/__tests__/fixtures/motion-scenes.ts'
import { BUDGETS } from '../packages/core/src/compile/budgets.ts'

const strict = process.argv.includes('--require-fit')
const unreviewed = process.argv.includes('--unreviewed')
const interactive = process.argv.includes('--interactive')

// Include delimiters and escapes: the standalone worker size isn't in general
// the number of bytes its literal occupies in the shipped lazy host.
function embeddedBytes(host: string, worker: string) {
  const js = ts.createSourceFile(
    'host.js',
    host,
    ts.ScriptTarget.ES2017,
    true,
    ts.ScriptKind.JS,
  )
  const occurrences: number[] = []
  function visit(n: ts.Node) {
    if (ts.isStringLiteralLike(n) && n.text === worker)
      occurrences.push(Buffer.byteLength(n.getText(js)))
    ts.forEachChild(n, visit)
  }
  visit(js)
  assert.equal(
    occurrences.length,
    1,
    'expected the complete worker exactly once',
  )
  return occurrences[0]
}

for (const [profile, core, checked] of [
  ['release', shipped, RELEASE_CHECKED],
  ['trusted-reference', await comparisonCompiler(false), false],
] as const) {
  const fixture = process.argv.includes('--simple') ? 'control' : 'mixed'
  const doc = await scenes[fixture]()
  if (interactive)
    doc.pages[0].root.children!.push(
      text('pointerclock', 'Field meter', {
        motion: {
          trigger: 'pointer-x',
          steps: [
            {
              target: 'self',
              from: { scale: 1 },
              to: { scale: 1.25 },
              durationMs: 200,
            },
          ],
        },
      }),
    )
  const registry = core.createRegistry({
    gpu: {
      enabled: true,
      approvedWasmPlugins: [{ name: 'demo', version: 1 }],
      reviewed: unreviewed ? [] : [mist],
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
  assert.ok(c.ok, JSON.stringify(c.problems))
  if (checked) {
    // A release that fits by silently declining custom shaders is not a fit.
    const payload = JSON.parse(
      c.html.match(
        /<script type="application\/json" id="culm-gpu">([^<]*)<\/script>/,
      )![1],
    )
    const index = payload.definitions.findIndex(
      (d: { name: string }) => d.name === 'mist',
    )
    assert.ok(index >= 0)
    assert.equal(!!payload.definitions[index].reviewed, !unreviewed)
    const region = payload.regions.find(
      (r: { definition: number }) => r.definition === index,
    )
    assert.ok(
      region &&
        [...c.html.matchAll(/<[^<>]+ data-gpu-run="[^"]*"[^<>]*>/g)].some(
          ([tag]) => tag.includes(`data-culm-gpu="${region.owner}"`),
        ),
    )
  }
  const code = c.assets![0].content,
    host = Buffer.byteLength(code),
    inline = Buffer.byteLength(c.scripts.map(s => s.code).join(';'))
  assert.equal(host, c.stats.scriptBytes.gpuHost)
  if (profile === 'release') {
    assert.equal(checked, true, 'production must select the checked host')
    assert.equal(code, shipped.GPU_HOST_SCRIPT)
    assert.equal(
      shipped.GPU_HOST_INTEGRITY,
      'sha256-' + createHash('sha256').update(code).digest('base64'),
    )
  }
  const worker = renderGpuWorker(checked)
  const embeddedWorker = embeddedBytes(code, worker)
  for (const js of [code, worker]) {
    assert.equal(
      transformSync(js, { target: 'es2017' }).code,
      transformSync(js, { target: 'esnext' }).code,
    )
    assert.doesNotMatch(
      js,
      /\breadPixels\b|\bfetch\(|XMLHttpRequest|new Function\(|\beval\(/,
    )
  }
  assert.equal(
    host + inline,
    Object.values(c.stats.scriptBytes).reduce((a, b) => a + b, 0),
  )
  const hostHeadroom = BUDGETS.gpuHostScript - host
  const mixedHeadroom = BUDGETS.sharedScripts - host - inline
  for (const [path, remaining] of [
    ['gpuHostScript', hostHeadroom],
    ['sharedScripts', mixedHeadroom],
  ] as const)
    assert.equal(
      c.problems.some(p => p.path === path),
      remaining < 0,
      path,
    )
  const hash = createHash('sha256').update(code)
  console.log(
    JSON.stringify({
      profile,
      fixture,
      interactive,
      unreviewed,
      worker: Buffer.byteLength(worker),
      embeddedWorker,
      hostExcludingWorker: host - embeddedWorker,
      host,
      inline,
      shared: host + inline,
      hostHeadroom,
      mixedHeadroom,
      sha256: hash.copy().digest('hex'),
      sri: 'sha256-' + hash.digest('base64'),
      stats: c.stats,
      refusals: c.problems.map(p => p.path),
    }),
  )
  if (strict && profile === 'release' && c.problems.length) process.exitCode = 1
}
