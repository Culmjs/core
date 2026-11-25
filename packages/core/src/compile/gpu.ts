import type { GpuMotion, Look, Node } from '../document/index.ts'
import { renderedFacts } from './scrollScene.ts'
import { NO, StateAnalysisLimit, StateConditions } from './stateConditions.ts'
import { moduleBytes, reviewedSnapshot } from '../registry/gpu.ts'
import type { CheckedEffect } from '../validate/gpu.ts'
import { visibleText } from '../validate/required.ts'
import { byteLength } from './budgets.ts'
import type { HtmlNode } from './html.ts'
import { knownMedia } from './links.ts'
import type { GpuCapability } from '../registry/gpu.ts'
import { GPU_CHECKED } from '../scripts/scriptsMin.ts'

/** Text is counted on the actual emitted element. For non-text media require
 * a confirmed file, labelled drawing, or both the icon link and its rendered glyph. */
function mediaWitness(
  el: HtmlNode,
  w: Node | undefined,
  available: ReadonlySet<string> | undefined,
) {
  if (el.tag === 'img' || el.tag === 'video')
    return knownMedia(el.attrs?.src, available)
  if (el.tag === 'svg') return visibleText(el.attrs?.['aria-label'])
  return (
    w?.kind === 'icon' &&
    el.tag === 'a' &&
    visibleText(el.attrs?.['aria-label']) &&
    el.children?.some(
      c => typeof c !== 'string' && c.tag === 'svg' && c.raw?.kind === 'icon',
    )
  )
}

/** Only HTML descendants of the emitted site can earn delivery. Structural wrappers, empty
 * text runs and a source node that drew no element are not fallback content. */
export function lowerGpu(
  site: HtmlNode,
  rendered: Map<Node, HtmlNode>,
  view: {
    trees: Node[]
    classOf: ReadonlyMap<string, string>
    scheme: Look['dark']
  },
  effects: ReadonlyMap<string, CheckedEffect>,
  canvasSlot: boolean,
  availableMedia?: ReadonlySet<string>,
  authority?: GpuCapability,
) {
  const { trees, classOf, scheme } = view
  const { facts } = renderedFacts(
    trees,
    trees[1],
    site,
    rendered,
    classOf,
    scheme,
    new StateConditions(),
  )
  const source = new Map([...rendered].map(([w, e]) => [e, w]))
  const owners = new Map<HtmlNode, GpuMotion>()
  const witnesses = new Map<HtmlNode, string>()
  function visit(
    el: HtmlNode | string,
    parent: number,
    inside: boolean,
  ): number {
    if (typeof el === 'string') return visibleText(el) ? parent : 0
    const w = source.get(el)
    const motion = w?.motion
    inside ||= !!motion && 'gpu' in motion
    // facts intersect the CSS predicates of all actual holders along this path
    // before reducing each layout/scheme to "has a reachable assignment".
    const mask =
      w && inside
        ? parent &
          facts(w).reduce(
            (bits, f, i) => (f.visible === NO ? bits : bits | (1 << i)),
            0,
          )
        : parent
    if (!mask) return 0
    if (motion && 'gpu' in motion) owners.set(el, motion)
    let found = inside && mediaWitness(el, w, availableMedia) ? mask : 0
    if (found) {
      const glyph =
        el.tag === 'a' &&
        el.children?.find(c => typeof c !== 'string' && c.tag === 'svg')
      witnesses.set(glyph && typeof glyph !== 'string' ? glyph : el, '')
    } else if (
      inside &&
      el.children?.some(c => typeof c === 'string' && visibleText(c))
    )
      witnesses.set(el, 't')
    for (const child of el.children ?? []) found |= visit(child, mask, inside)
    if (found !== mask) owners.delete(el)
    return found
  }
  try {
    visit(site, 63, false)
  } catch (e) {
    // No region has been marked yet. Over-complex display conditions keep the static fallback.
    if (e instanceof StateAnalysisLimit) return
    throw e
  }
  if (!owners.size) return
  const definitions: (CheckedEffect & { reviewed?: true })[] = []
  const indices = new Map<string, number>()
  const regions = []
  // A strip or an enclosing GPU owner's box cannot use the main plane.
  // Make this selection once; loader, host and policy all consume its result.
  const runnable = new Set<HtmlNode>()
  function select(el: HtmlNode): boolean {
    let nested = false
    for (const child of el.children ?? [])
      if (typeof child !== 'string' && select(child)) nested = true
    const m = owners.get(el)
    if (
      !nested &&
      m &&
      (GPU_CHECKED ? !effects.get(m.gpu)?.wasm : effects.get(m.gpu)?.builtin)
    )
      runnable.add(el)
    return nested || !!m
  }
  function markContent(el: HtmlNode) {
    if (witnesses.has(el))
      (el.attrs ??= {})['data-gpu-content'] = witnesses.get(el)
    for (const child of el.children ?? [])
      if (typeof child !== 'string') markContent(child)
  }
  for (const strip of site.children ?? [])
    if (typeof strip !== 'string' && strip.tag === 'main') select(strip)
  const worker = runnable.size > 0
  if (worker && !canvasSlot) return // keep the complete static page
  const stats = { shaderBytes: 0, wasmBytes: 0, wasmTransportBytes: 0 }
  for (const [el, m] of owners) {
    const def = effects.get(m.gpu)
    if (!def) throw new Error('Missing checked GPU definition.')
    let definition = indices.get(m.gpu)
    if (definition === undefined) {
      definition = definitions.length
      indices.set(m.gpu, definition)
      definitions.push(
        GPU_CHECKED && reviewedSnapshot(authority, def)
          ? { ...def, reviewed: true }
          : def,
      )
      stats.shaderBytes += byteLength(def.source)
      if (def.wasm) {
        stats.wasmBytes += moduleBytes(def.wasm.bytesBase64)
        stats.wasmTransportBytes += byteLength(def.wasm.bytesBase64)
      }
    }
    const owner: string = String(regions.length)
    ;(el.attrs ??= {})['data-culm-gpu'] = owner
    const settings = Object.fromEntries(
      Object.entries(def.settings).map(([k, s]) => [
        k,
        m.settings?.[k] ?? s.default,
      ]),
    )
    if (runnable.has(el)) {
      el.attrs['data-gpu-run'] = def.builtin ? settings.speed : 'custom'
      markContent(el)
    }
    regions.push({
      owner,
      definition,
      settings,
      ...(m.poster && { poster: m.poster }),
    })
  }
  const element: HtmlNode = {
    tag: 'script',
    attrs: { type: 'application/json', id: 'culm-gpu' },
    raw: { kind: 'json', content: JSON.stringify({ definitions, regions }) },
  }
  const css = worker
    ? 'main:has(>.culm-plane:not([hidden])){isolation:isolate}.culm-plane{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:' +
      (GPU_CHECKED
        ? '0;image-rendering:pixelated}[data-gpu-painted]>*{position:relative!important;z-index:1!important}'
        : '-1;image-rendering:pixelated}[data-gpu-painted]{background-color:transparent!important;background-image:none!important}')
    : ''
  return {
    element,
    stats,
    worker,
    css,
    usesWasm: stats.wasmBytes > 0,
  }
}
