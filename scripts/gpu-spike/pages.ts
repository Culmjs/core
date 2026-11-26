import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync, transformSync } from 'esbuild'
import { DomUtils, parseDocument } from 'htmlparser2'
import {
  applySetting,
  BUDGETS,
  compilePage,
  createRegistry,
  insertBlock,
  pageScriptPolicy,
  policyMeta,
} from '@culmjs/core'
import starter, { STYLES } from '@culmjs/starter'
import { scenes } from '../../packages/tools/__tests__/fixtures/motion-scenes.ts'
import { writeHtml } from '../../packages/core/src/compile/html.ts'
import { sources, type EffectName, type Payload } from './shaders.ts'

// Match scripts/gen-scripts.ts:renderTimeline (including the final trim).
const bundle = (name: string, define?: Record<string, string>) =>
  buildSync({
    entryPoints: [fileURLToPath(new URL(name, import.meta.url))],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2017',
    write: false,
    define,
  }).outputFiles[0].text.trim()
export const lazyJs = bundle('host.ts', {
  WORKER_SOURCE: JSON.stringify(bundle('worker.ts')),
})
export const hostPath = '/_culm/gpu.js'
const integrity =
  'sha256-' + createHash('sha256').update(lazyJs).digest('base64')
const loader = transformSync(
  `
if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
 const o=new IntersectionObserver(entries=>{
  if(entries.some(e=>e.isIntersecting)){
    o.disconnect();const s=document.createElement('script');s.src='${hostPath}';s.integrity='${integrity}';document.head.append(s)
  }
 },{rootMargin:'200px'});
 document.querySelectorAll('[data-field]').forEach(e=>o.observe(e))
}`,
  { minify: true, target: 'es2017' },
).code.trim()
const wasm = readFileSync(new URL('ripple.wasm', import.meta.url))
// main and .s-site retain their opaque backgrounds. The canvas is a child of
// the isolated main: after its background, behind in-flow hero content.
const style = `<style>main{isolation:isolate}main>canvas{position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;visibility:hidden}main.gpu-active>canvas{visibility:visible}[data-field]{background:#707070 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M0 24L24 0' stroke='%23757575'/%3E%3C/svg%3E")}.gpu-active [data-field]{background:transparent}</style>`
const variants = {
  control: [],
  shader: ['contours', 'mist'],
  wasm: ['ripple_field', 'ripple_field'],
  mixed: ['contours', 'ripple_field', 'mist'],
} satisfies Record<string, EffectName[]>
export type Variant = keyof typeof variants
export const dataScript = (payload: Payload) =>
  writeHtml({
    tag: 'script',
    attrs: { type: 'application/json', id: 'fields' },
    raw: { kind: 'json', content: JSON.stringify(payload) },
  })

export async function makePage(name: Variant) {
  const doc = await scenes[name === 'mixed' ? 'mixed' : 'control']()
  const registry = createRegistry()
  registry.use(starter)
  doc.styles = STYLES
  const names = variants[name] as EffectName[]
  // Both the no-GPU control and GPU pages have the same first two starter heroes.
  const heroes = Array.from({ length: Math.max(2, names.length) }, (_, i) => {
    const r = insertBlock(registry, 'hero', 'plain', `hero${i}`)
    assert.ok(r.ok)
    const s = applySetting(registry, r.root, 'buttonLink', { url: '#plate' })
    assert.ok(s.ok)
    return s.root
  })
  doc.pages[0].root.children!.unshift(...heroes)
  const c = compilePage(doc, 'home', { registry })
  assert.ok(c.ok, JSON.stringify(c.problems))
  assert.deepEqual(c.problems, [])
  const inline = c.scripts.map(s => s.code)
  const compiled = inline.join(';')
  assert.ok(c.html.includes(`<script>${compiled}</script>`))
  const module = names.includes('ripple_field') ? wasm : Buffer.alloc(0)
  const payload: Payload = {
    sources: Object.fromEntries(names.map(n => [n, sources[n]])),
    ...(module.length && { module: module.toString('base64') }),
  }
  // This isolated loopback experiment appends different executable bytes after compilation.
  // observe.ts supplies a fixture-owned HTTP policy for the final bytes, including instrumentation.
  const meta = policyMeta(pageScriptPolicy(c.scripts))
  assert.ok(c.html.includes(meta))
  const baseline = c.html.replace(meta, '')
  let html = baseline
  const data = names.length ? dataScript(payload) : ''
  if (names.length) {
    inline.push(loader)
    let i = 0
    html = html
      .replace(/<section /g, tag =>
        i < names.length ? `<section data-field="${names[i++]}" ` : tag,
      )
      .replace('</head>', style + '</head>')
      .replace(
        `<script>${compiled}</script>`,
        () => `${data}<script>${inline.join(';')}</script>`,
      )
    assert.equal(i, names.length)
  }
  // Count the emitted fixture, including post-compile markup. As in compile/page.ts,
  // style text is priced without its tags, and elements start below <body>.
  const parsed = parseDocument(html)
  const [body] = DomUtils.getElementsByTagName('body', parsed)
  const structure = {
    cssBytes: DomUtils.getElementsByTagName('style', parsed).reduce(
      (sum, el) => sum + Buffer.byteLength(DomUtils.textContent(el)),
      0,
    ),
    bodyElements: DomUtils.getElementsByTagName('*', body.children).length,
    // Lowering only alters HTML, not the expanded document trees.
    logicalDepth: c.stats.depth,
  }
  assert.ok(
    structure.cssBytes <= BUDGETS.css,
    `${name}: ${structure.cssBytes} CSS bytes`,
  )
  assert.ok(
    structure.bodyElements <= BUDGETS.elements,
    `${name}: ${structure.bodyElements} body elements`,
  )
  assert.ok(
    structure.logicalDepth <= BUDGETS.depth,
    `${name}: logical depth ${structure.logicalDepth}`,
  )
  return {
    html,
    structure,
    inline,
    lazyJs: names.length ? lazyJs : '',
    wasm: module,
    encodedWasm: payload.module ?? '',
    glslBytes: Object.values(payload.sources).reduce(
      (n, s) => n + Buffer.byteLength(s),
      0,
    ),
    dataBytes: Buffer.byteLength(
      data.replace(/^<script[^>]*>|<\/script>$/g, ''),
    ),
    compiledBytes: Buffer.byteLength(compiled),
    addedHtmlBytes: Buffer.byteLength(html) - Buffer.byteLength(baseline),
  }
}
