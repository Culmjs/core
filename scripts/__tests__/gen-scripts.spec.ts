import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { transformSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { shareScriptKeys } from '../share-script-keys.ts'
import { render, renderProbe, renderGpuWorker } from '../gen-scripts.ts'
import { byteLength } from '../../packages/core/src/compile/budgets.ts'
import { PROBE_SCRIPT } from '../../packages/core/src/measure/probeMin.ts'
import {
  BASE_SCRIPT,
  GPU_LOADER_SCRIPT,
  GPU_HOST_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  STATES_SCRIPT,
  TIMELINE_SCRIPT,
  PLAYBACK_TIMELINE_SCRIPT,
} from '../../packages/core/src/scripts/scriptsMin.ts'
import {
  pageScriptPolicy,
  type PageScript,
} from '../../packages/core/src/compile/gpuPolicy.ts'

test('scriptsMin.ts is up to date', () => {
  assert.equal(
    readFileSync(
      new URL('../../packages/core/src/scripts/scriptsMin.ts', import.meta.url),
      'utf8',
    ),
    render(),
    'run `npm run gen:scripts`',
  )
})

test('interning DOM keys preserves receivers, nested access, string arguments and directives', () => {
  const c = `(()=>{"use strict";abc.deeplyNestedElement.deeplyNestedElement.getBoundingClientRect("getBoundingClientRect");
abc.deeplyNestedElement.getBoundingClientRect("deeplyNestedElement");abc.getBoundingClientRect("getBoundingClientRect");
abc.deeplyNestedElement.getBoundingClientRect("getBoundingClientRect");
try{undeclaredVariable=1}catch{abc.getBoundingClientRect("strict")}})()`
  const min = transformSync(c, { target: 'es2017', minify: true }).code.trim()
  const smaller = shareScriptKeys(min)
  assert.ok(Buffer.byteLength(smaller) < Buffer.byteLength(min))
  const invoke = (code: string) => {
    const calls: string[] = []
    const leaf = (name: string, deeplyNestedElement?: object) => ({
      deeplyNestedElement,
      name,
      getBoundingClientRect(k: string) {
        calls.push(this.name + ':' + k)
      },
    })
    runInNewContext(code, { abc: leaf('root', leaf('child', leaf('leaf'))) })
    return calls
  }
  assert.deepEqual(invoke(smaller), invoke(min))
  assert.equal(invoke(smaller).at(-1), 'root:strict')
})

test('each script is within its ceiling, all appendices included', () => {
  const base = BASE_SCRIPT + OPEN_SCRIPT + EMAIL_SCRIPT
  assert.ok(byteLength(base) <= 10_000)
  assert.ok(byteLength(STATES_SCRIPT) <= 6_193)
  assert.ok(byteLength(base + STATES_SCRIPT) <= 20_000)
  assert.ok(byteLength(GPU_HOST_SCRIPT) <= 6_144)
})

test('the production GPU executable is already ES2017', () => {
  for (const code of [GPU_HOST_SCRIPT, GPU_LOADER_SCRIPT, renderGpuWorker()]) {
    const emit = (target: string) => transformSync(code, { target }).code
    assert.ok(
      emit('es2017') === emit('esnext'),
      'newer syntax in the shipped GPU script',
    )
  }
})

test('all 48 joined inline selections authorize exactly the executable bytes they deliver', () => {
  const hash = (s: string) =>
    `sha256-${createHash('sha256').update(s).digest('base64')}`
  for (const open of ['', OPEN_SCRIPT])
    for (const email of ['', EMAIL_SCRIPT])
      for (const states of [false, true])
        for (const timeline of ['', TIMELINE_SCRIPT, PLAYBACK_TIMELINE_SCRIPT])
          for (const gpu of [false, true]) {
            const scripts: PageScript[] = [
              { name: 'base', code: BASE_SCRIPT + open + email },
            ]
            if (states) scripts.push({ name: 'states', code: STATES_SCRIPT })
            if (timeline) scripts.push({ name: 'timeline', code: timeline })
            if (gpu)
              scripts.push({ name: 'gpuLoader', code: GPU_LOADER_SCRIPT })
            assert.deepEqual(
              pageScriptPolicy(scripts).match(/sha256-[A-Za-z0-9+/=]+/g),
              [
                hash(scripts.map(s => s.code).join(';')),
                ...(gpu ? [hash(GPU_HOST_SCRIPT)] : []),
              ],
            )
          }
})

test('the shipped scripts use no syntax newer than ES2017 and make no request and touch no storage', () => {
  for (const s of [
    BASE_SCRIPT,
    OPEN_SCRIPT,
    EMAIL_SCRIPT,
    STATES_SCRIPT,
    TIMELINE_SCRIPT,
    PLAYBACK_TIMELINE_SCRIPT,
  ]) {
    // esbuild lowers newer syntax instead of throwing: if es2017 output differs from esnext output, something was lowered
    const out = (target: string) =>
      transformSync(s, { target, minify: false }).code
    assert.equal(out('es2017'), out('esnext'))
    for (const word of [
      'fetch(',
      'XMLHttpRequest',
      'localStorage',
      'sessionStorage',
      'eval(',
      'new Function',
    ])
      assert.ok(!s.includes(word), word)
  }
})

test('probeMin.ts is current', () => {
  assert.equal(
    readFileSync(
      new URL('../../packages/core/src/measure/probeMin.ts', import.meta.url),
      'utf8',
    ),
    renderProbe(),
    'run `npm run gen:scripts`',
  )
})

test('PROBE_SCRIPT is one function expression', () =>
  assert.equal(typeof new Function(`return (${PROBE_SCRIPT})`)(), 'function'))
