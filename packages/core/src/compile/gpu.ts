import type { GpuMotion, Look, Node } from '../document/index.ts'
import { layoutDisplays } from '../layout/display.ts'
import { moduleBytes } from '../registry/gpu.ts'
import type { CheckedEffect } from '../validate/gpu.ts'
import { visibleText } from '../validate/required.ts'
import { byteLength } from './budgets.ts'
import type { HtmlNode } from './html.ts'

/** Six visibility bits: a leaf can witness its owner only in the same scheme and layout. */
function coverage(w: Node, scheme: Look['dark']) {
  const mask = (dark: boolean) => {
    const { desktop, tablet, phone } = layoutDisplays(w, dark)
    return +desktop | (+tablet << 1) | (+phone << 2)
  }
  return (
    (scheme === 'dark' ? 0 : mask(false)) |
    (scheme === 'light' ? 0 : mask(true) << 3)
  )
}

/** Only HTML descendants of the emitted site can earn delivery. Structural wrappers, empty
 * text runs and a source node that drew no element are not fallback content. */
export function lowerGpu(
  site: HtmlNode,
  rendered: Map<Node, HtmlNode>,
  scheme: Look['dark'],
  effects: ReadonlyMap<string, CheckedEffect>,
) {
  const source = new Map([...rendered].map(([w, e]) => [e, w]))
  const owners = new Map<HtmlNode, GpuMotion>()
  function visit(el: HtmlNode | string, parent: number): number {
    if (typeof el === 'string') return visibleText(el) ? parent : 0
    const w = source.get(el)
    const mask = w ? parent & coverage(w, scheme) : parent
    if (!mask) return 0
    const motion = w?.motion
    if (motion && 'gpu' in motion) owners.set(el, motion)
    let found =
      ((el.tag === 'img' || el.tag === 'video') && el.attrs?.src) ||
      (el.tag === 'svg' && el.attrs?.['aria-label'])
        ? mask
        : 0
    for (const child of el.children ?? []) found |= visit(child, mask)
    if (found !== mask) owners.delete(el)
    return found
  }
  visit(site, 63)
  if (!owners.size) return
  const definitions: CheckedEffect[] = []
  const indices = new Map<string, number>()
  const regions = []
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
  return { element, stats, usesWasm: stats.wasmBytes > 0 }
}
