import type { Scene } from '../scripts/motionHost.ts'
import type { HtmlNode } from './html.ts'

const containers: Record<string, string[]> = {
  table: ['caption'],
  tr: ['td'],
  tbody: ['td', 'tr'],
  thead: ['td', 'tr'],
  tfoot: ['td', 'tr'],
  ul: ['li'],
  ol: ['li'],
}

/** Index the actual output before adding any measurement nodes. Only a branch
 * with a following sibling (or the document boundary) can pass on a change
 * of flow extent. Shared branches need only one noninteractive basis SVG. */
export function pinGeometry(site: HtmlNode, token: (el: HtmlNode) => number) {
  const edges = new Map<HtmlNode, { parent: HtmlNode; followed: boolean }>()
  const index = (el: HtmlNode) => {
    const kids =
      el.children?.filter((c): c is HtmlNode => typeof c !== 'string') ?? []
    kids.forEach((c, i) => {
      edges.set(c, { parent: el, followed: i + 1 < kids.length })
      index(c)
    })
  }
  index(site)
  const bases = new Map<HtmlNode, number>()
  const basis = (el: HtmlNode) => {
    const existing = bases.get(el)
    if (existing) return existing
    let meter: HtmlNode = {
      tag: 'svg',
      attrs: {
        'data-cm-m': '',
        width: 0,
        height: 0,
        'aria-hidden': 'true',
        style: 'position:absolute;pointer-events:none;visibility:hidden',
      },
    }
    const id = token(meter)
    bases.set(el, id)
    // An SVG directly under a table is foster-parented outside its scope.
    for (const tag of containers[el.tag] ?? [])
      meter = {
        tag,
        attrs: {
          'data-cm-m': '',
          'aria-hidden': 'true',
          style: 'display:contents',
        },
        children: [meter],
      }
    ;(el.children ??= []).push(meter)
    return id
  }
  return (scene: Scene, owner: HtmlNode, visual: HtmlNode, travel: number) => {
    scene.pin = travel
    scene.child = token(visual)
    scene.basis = basis(owner)
    scene.flow = []
    for (let el = owner; ;) {
      const edge = edges.get(el)
      if (!edge || edge.followed)
        scene.flow.push([token(el), edge ? basis(edge.parent) : 0])
      if (!edge) break
      el = edge.parent
    }
    // Child translation and the owner's clip are in one local plane. The
    // document-flow reservation is balanced independently at the exits.
    const options = {
      duration: scene.duration,
      fill: 'both',
      composite: 'add',
    } as const
    scene.tracks.push(
      [
        [[scene.child, 0]],
        [{ translate: '0px 0px' }, { translate: `var(--p${scene.child})` }],
        options,
      ],
      [
        [[0, 0]],
        Array(2).fill({ paddingBottom: `var(--p${scene.child}y)` }),
        options,
      ],
    )
  }
}
