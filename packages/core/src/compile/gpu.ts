import type { GpuMotion, Look, Node } from '../document/index.ts'
import { renderedFacts } from './scrollScene.ts'
import { NO, StateAnalysisLimit, StateConditions } from './stateConditions.ts'
import { moduleBytes } from '../registry/gpu.ts'
import type { CheckedEffect } from '../validate/gpu.ts'
import { visibleText } from '../validate/required.ts'
import { byteLength } from './budgets.ts'
import type { HtmlNode } from './html.ts'

/** Inventory keys name files. Strip literal URL suffixes before interpreting
 * escapes: an encoded '?' or '#' is still part of the filename. */
function knownMedia(
  src: unknown,
  available: ReadonlySet<string> | undefined,
): boolean {
  if (
    !available ||
    typeof src !== 'string' ||
    !src.startsWith('/') ||
    src.startsWith('//')
  )
    return false
  const path = src.split(/[?#]/, 1)[0]
  if (available.has(path)) return true
  try {
    // Match the folder inventory's encoded spelling, segment by segment.
    return available.has(
      path
        .split('/')
        .map(s => encodeURIComponent(decodeURIComponent(s)))
        .join('/'),
    )
  } catch {
    return false
  }
}

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
    links: { file(id: string): string | undefined }
  },
  effects: ReadonlyMap<string, CheckedEffect>,
  availableMedia?: ReadonlySet<string>,
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
  const witnesses = new Set<HtmlNode>()
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
    if (
      inside &&
      (found || el.children?.some(c => typeof c === 'string' && visibleText(c)))
    )
      witnesses.add(el)
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
  const definitions: CheckedEffect[] = []
  const indices = new Map<string, number>()
  const regions = []
  const styles: string[] = []
  let worker = false
  // Only main participates in the display plane. Header/footer strips keep
  // their authored stacking and cannot earn the deployment's worker grant.
  function markContent(el: HtmlNode, inside: boolean) {
    const owner = owners.get(el)
    if (owner && effects.get(owner.gpu)?.builtin) inside = worker = true
    if (inside && witnesses.has(el)) (el.attrs ??= {})['data-gpu-content'] = ''
    for (const child of el.children ?? [])
      if (typeof child !== 'string') markContent(child, inside)
  }
  for (const strip of site.children ?? [])
    if (typeof strip !== 'string' && strip.tag === 'main')
      markContent(strip, false)
  const stats = { shaderBytes: 0, wasmBytes: 0, wasmTransportBytes: 0 }
  for (const [el, m] of owners) {
    const def = effects.get(m.gpu)
    if (!def) throw new Error('Missing checked GPU definition.')
    let definition = indices.get(m.gpu)
    if (definition === undefined) {
      definition = definitions.length
      indices.set(m.gpu, definition)
      definitions.push(def)
      stats.shaderBytes += byteLength(def.source)
      if (def.wasm) {
        stats.wasmBytes += moduleBytes(def.wasm.bytesBase64)
        stats.wasmTransportBytes += byteLength(def.wasm.bytesBase64)
      }
    }
    const owner: string = String(regions.length)
    ;(el.attrs ??= {})['data-culm-gpu'] = owner
    const url = m.poster && view.links.file(m.poster)
    // A quoted, local URL (retain the resolver's percent escapes and suffix).
    // Low specificity lets authored image styles win; no layout/foreground change.
    if (url?.startsWith('/') && !url.startsWith('//'))
      styles.push(
        `:where([data-culm-gpu="${owner}"]){background-image:url("${url.replace(/["<>\s]/gu, c => encodeURIComponent(c))}");background-size:cover}`,
      )
    const settings = Object.fromEntries(
      Object.entries(def.settings).map(([k, s]) => [
        k,
        m.settings?.[k] ?? s.default,
      ]),
    )
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
  if (worker)
    styles.push(
      'main:has(>.culm-plane:not([hidden])){isolation:isolate}.culm-plane{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;image-rendering:pixelated}[data-gpu-painted]{background-color:transparent!important;background-image:none!important}',
    )
  return {
    element,
    stats,
    worker,
    css: styles.join(''),
    usesWasm: stats.wasmBytes > 0,
  }
}
