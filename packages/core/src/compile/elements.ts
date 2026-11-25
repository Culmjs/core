import {
  kindSpec,
  walk,
  type Kind,
  type KindSpec,
  type Link,
  type Node,
  type Pattern,
} from '../document/index.ts'
import { LAYERS } from '../document/kinds.ts'
import { orderedChildren, targetOf } from '../document/tree.ts'
import { isObj, urlOk } from '../document/rules.ts'
import { isSample } from '../document/samples.ts'
import { tabInfo } from '../document/tabs.ts'
import { shownOn } from '../layout/placement.ts'
import { STATE_NAME, stateNameOk } from '../style/decl.ts'
import {
  SAFE_ID,
  TAGS,
  UI,
  domId,
  el,
  nativeCommand,
  type Attrs,
  type Build,
  type ElementCtx,
  type Inner,
  type Props,
} from './elementsBase.ts'
import { formElement } from './elementsForm.ts'
import { shapeElement } from './elementsShape.ts'
import { textElement } from './elementsText.ts'
import { type HtmlNode } from './html.ts'
import { href } from './links.ts'

export type { ElementCtx } from './elementsBase.ts'

const EVENTS = new Set(['click', 'hover', 'enter-view', 'leave-view', 'submit'])

/** The nodes a trigger points at, by id, across every tree given. They get a DOM id so the script and the browser can find them. */
export function triggerTargets(...trees: Node[]): Map<string, Node> {
  const ids = new Set<string>()
  const found = new Map<string, Node>()
  for (const t of trees)
    walk(t, w => {
      for (const x of Array.isArray(w.on) ? w.on : []) {
        const id = targetOf(x?.do)
        if (id) ids.add(id)
      }
      if (typeof w.props?.labelledBy === 'string') ids.add(w.props.labelledBy)
      const anchor = (l: unknown) => {
        if (isObj(l) && typeof l.url === 'string' && l.url.startsWith('#'))
          ids.add(l.url.slice(1))
      }
      anchor(w.props?.link)
      if (Array.isArray(w.props?.runs))
        for (const r of w.props.runs) if (isObj(r)) anchor(r.link)
    })
  for (const t of trees)
    walk(t, w => void (ids.has(w.id) && found.set(w.id, w)))
  return found
}

/**
 * The attributes a node's states write. Every name and value passes the same grammar as at save, so a tree that skipped
 * the save check still cannot reach an attribute name or value with anything else.
 */
export function stateAttrs(w: Node): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of Array.isArray(w.state) ? w.state : []) {
    const ok =
      isObj(s) &&
      stateNameOk(s.name) &&
      typeof s.initial === 'string' &&
      STATE_NAME.test(s.initial) &&
      (s.values === 'on-off'
        ? s.initial === 'on' || s.initial === 'off'
        : Array.isArray(s.values) && s.values.includes(s.initial))
    if (ok) out[`data-s-${s.name}`] = s.initial as string
  }
  return out
}

/** `data-s-on` is `<event>:<verb>:<arg>[:<value>]`, entries separated by spaces. Live pages only. */
function dataAttrs(w: Node, ctx: Inner): Attrs {
  const out: Attrs = ctx.holds ? {} : stateAttrs(w)
  if (ctx.mode !== 'live') return out
  const entries: string[] = []
  const id = (v: unknown) =>
    typeof v === 'string' && SAFE_ID.test(v) ? domId(v) : undefined
  for (const t of Array.isArray(w.on) ? w.on : []) {
    const d =
      isObj(t) && typeof t.on === 'string' && EVENTS.has(t.on) && isObj(t.do)
        ? (t.do as Record<string, unknown>)
        : undefined
    if (!d) continue
    if (
      t.on === 'click' &&
      w.kind === 'button' &&
      ('open' in d || 'close' in d) &&
      nativeCommand(w, ctx)
    )
      continue
    let rest: string | undefined
    if ('set' in d)
      rest =
        stateNameOk(d.set) && typeof d.to === 'string' && STATE_NAME.test(d.to)
          ? `set:${d.set}:${d.to}`
          : undefined
    else if ('toggle' in d)
      rest = stateNameOk(d.toggle) ? `toggle:${d.toggle}` : undefined
    else if ('step' in d)
      rest =
        stateNameOk(d.step) &&
        (d.by === 1 || d.by === -1) &&
        Array.isArray(d.over) &&
        d.over.length > 0 &&
        d.over.every(
          (v: unknown) => typeof v === 'string' && STATE_NAME.test(v),
        )
          ? `step:${d.step}:${d.by}.${d.over.join('.')}`
          : undefined
    else if ('goTo' in d) {
      const to = isObj(d.goTo)
        ? href(d.goTo as Link, ctx.doc, ctx.links)
        : undefined
      rest = to === undefined ? undefined : `goTo:${encodeURIComponent(to)}`
    } else
      for (const verb of ['scrollTo', 'open', 'close', 'play', 'pause'])
        if (verb in d && id(d[verb])) rest = `${verb}:${id(d[verb])}`
    if (rest) entries.push(`${t.on}:${rest}`)
  }
  if (entries.length) out['data-s-on'] = entries.join(' ')
  return out
}

const LAYOUT_WORDS = ['desktop', 'tablet', 'phone'] as const

/**
 * Edit mode only: where a node is hidden on a layout, the canvas keeps its place with a faded dashed note, "Portrait · hidden on phone".
 * The node itself stays display:none there; the editor's CSS shows the note only while that layout is the one being edited (`data-gh` lists
 * the layouts the node is hidden on). It has no data-id, so it can't be picked, and never reaches the live site.
 * Tables have no room for a stray element, so a node hidden in one gets no note.
 */
function ghost(c: Node, parent: Kind): HtmlNode | null {
  if (!c.hide || parent === 'table' || parent === 'table-row') return null
  const hidden = LAYOUT_WORDS.filter(l => !shownOn(c, l))
  if (!hidden.length) return null
  return el(
    parent === 'list' ? 'li' : 'div',
    {
      class: 's-ghost',
      'data-gh': hidden.join(' '),
      'data-in': parent === 'free' ? 'free' : undefined,
    },
    [
      el(
        'svg',
        {
          'aria-hidden': 'true',
          width: 14,
          height: 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        },
        [
          el('path', {
            d: 'M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A16.7 16.7 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2',
          }),
        ],
      ),
      ...hidden.map(l =>
        el('span', { 'data-l': l }, [`${c.name} · hidden on ${l}`]),
      ),
    ],
  )
}

/** `head` is true for the first row of a table with a header, and for that row's cells. */
function build(
  w: Node,
  ctx: Inner,
  parent: Kind | null,
  grand: Kind | null,
  head: boolean,
): HtmlNode | null {
  const element = draw(w, ctx, parent, grand, head)
  if (element) {
    ctx.rendered?.set(w, element)
    // The poster is authored content, including in edit/fragment output and
    // when no GPU program is delivered. Leave other background properties alone.
    const id = w.motion && 'poster' in w.motion && w.motion.poster
    const url = id && ctx.links.file(id)
    if (url && urlOk(url) && url.startsWith('/') && !url.startsWith('//')) {
      const attrs = (element.attrs ??= {})
      const quoted = url.replace(/["<>\s]/gu, c => encodeURIComponent(c))
      attrs.style = `${attrs.style ? attrs.style + ';' : ''}background-image:url("${quoted}");background-size:cover`
    }
  }
  return element
}

function draw(
  w: Node,
  ctx: Inner,
  parent: Kind | null,
  grand: Kind | null,
  head: boolean,
): HtmlNode | null {
  const { mode, classOf } = ctx
  if (w.kind === 'instance') return null
  if (mode === 'live' && LAYOUT_WORDS.every(l => !shownOn(w, l))) return null
  const spec = kindSpec(w.kind, ctx.kinds)
  if (!spec) return null
  const p: Props = w.props ?? {}
  const tip =
    typeof p.tip === 'string' && p.tip && Object.hasOwn(spec.props, 'tip')
      ? p.tip.slice(0, 120)
      : undefined
  const attrs: Attrs = {
    class: classOf.get(w.id),
    'data-id': mode === 'edit' || ctx.ids ? w.id : undefined,
    // editor only: a sample line is marked on the canvas, since the published page leaves it out until the owner writes over it
    'data-sample': mode === 'edit' && isSample(w) ? '' : undefined,
    id: ctx.targets?.has(w.id) && SAFE_ID.test(w.id) ? domId(w.id) : undefined,
    ...dataAttrs(w, ctx),
    ...ctx.tabs?.get(w.id),
    // a tooltip (CSS only) and the words a screen reader reads as the node's description
    'data-tip': tip,
    'aria-description': tip,
  }
  const cls = (...extra: (string | false | undefined)[]) =>
    [attrs.class, ...extra].filter(Boolean).join(' ') || undefined
  const note = (words: string) =>
    mode === 'edit'
      ? el('p', { class: cls('s-placeholder'), 'data-id': w.id }, [words])
      : null
  const plate = (icon: 'photo' | 'video') =>
    mode === 'edit'
      ? el(
          'div',
          {
            ...attrs,
            'data-sample': 'image',
            style: 'display:grid;place-items:center;box-sizing:border-box',
            class: cls('s-placeholder', 's-plate'),
            role: 'img',
            'aria-label':
              icon === 'photo'
                ? 'Sample photo, not yet chosen'
                : 'Sample video, not yet chosen',
          },
          [
            el(
              'svg',
              {
                'aria-hidden': 'true',
                viewBox: '0 0 48 48',
                width: '40%',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
              },
              [
                el('rect', { x: 6, y: 9, width: 36, height: 30, rx: 3 }),
                ...(icon === 'photo'
                  ? [
                      el('circle', { cx: 17, cy: 20, r: 3.5 }),
                      el('path', { d: 'M6 33l10-9 9 8 6-5 11 9' }),
                    ]
                  : [el('path', { d: 'M20 17l12 7-12 7z' })]),
              ],
            ),
          ],
        )
      : null
  const children = orderedChildren(w)
  const inner: Inner = { ...ctx, holds: undefined }
  const kids = () =>
    children
      .flatMap(c => [
        build(
          c,
          inner,
          w.kind,
          parent,
          w.kind === 'table'
            ? !!p.header && c === children[0]
            : w.kind === 'table-row' && head,
        ),
        mode === 'edit' ? ghost(c, w.kind) : null,
      ])
      .filter((e): e is HtmlNode => e !== null)
  const b: Build = {
    w,
    p,
    ctx,
    parent,
    grand,
    head,
    attrs,
    cls,
    note,
    plate,
    kids,
  }

  switch (w.kind) {
    case 'text':
    case 'image':
    case 'icon':
    case 'video':
    case 'button':
      return textElement(b)
    case 'embed':
    case 'menu':
    case 'form':
    case 'field':
    case 'details':
      return formElement(b)
    case 'shape':
      return shapeElement(b)
    case 'divider':
      return { tag: 'hr', attrs }
    case 'table':
      // a list inside a repeated row that has nothing in it draws nothing; only a table of its own shows the placeholder
      if (!children.length)
        return w.id.includes('~') ? null : b.note('Nothing to show yet.')
      return el('table', attrs, [el('tbody', {}, kids())])
    case 'list': {
      if (!children.length)
        return w.id.includes('~') ? null : b.note('Nothing to show yet.')
      return el(tagOf(spec, b), attrs, kids())
    }
    case 'free':
    case 'box':
    case 'row':
    case 'column':
    case 'grid':
    case 'table-row':
    case 'table-cell':
      return container(b, spec)
    default: {
      // a plug-in kind: its tag, its class and its children
      // A plug-in is outside code: only a tag core itself writes for containers and text is allowed, anything else becomes a div.
      const tag = spec.tag(parent, w, grand)
      const children = kids()
      const fit = typeof tag === 'string' && TAGS.has(tag) && tag !== 'dialog'
      return { tag: fit ? tag : 'div', attrs, children }
    }
  }
}

const tagOf = (spec: KindSpec, b: Build) => {
  const tag = spec.tag(b.parent, b.w, b.grand)
  return TAGS.has(tag) ? tag : 'div'
}

function container(b: Build, spec: KindSpec): HtmlNode {
  const { w, p, ctx, head, attrs } = b
  const pattern = p.pattern as Pattern | undefined
  const fill =
    !!pattern &&
    typeof pattern === 'object' &&
    el('div', {
      class: ctx.classOf.get(`${w.id}:pattern`),
      'aria-hidden': 'true',
      'data-s-pattern': pattern.cursor,
    })
  // The editor shows a layer in place: a popover or dialog would be hidden there.
  const layer =
    ctx.mode === 'live' &&
    typeof p.layer === 'string' &&
    LAYERS.includes(p.layer)
      ? p.layer
      : undefined
  let tag =
    w.kind === 'table-cell' && head ? 'th' : spec.tag(b.parent, w, b.grand)
  if (!TAGS.has(tag) || (tag === 'dialog' && layer !== 'dialog')) tag = 'div'
  const lp: Attrs = layer
    ? {
        id: domId(w.id),
        popover: layer === 'dialog' ? undefined : layer.slice(8),
        'data-s-open':
          layer === 'popover-manual' && p.open === true ? '' : undefined,
      }
    : {}
  // A container named by a text on the page: a div becomes a group.
  const named: Attrs =
    typeof p.labelledBy === 'string' &&
    SAFE_ID.test(p.labelledBy) &&
    ctx.targets?.has(p.labelledBy)
      ? {
          'aria-labelledby': domId(p.labelledBy),
          role: tag === 'div' ? 'group' : undefined,
        }
      : {}
  return el(
    tag,
    {
      ...attrs,
      ...lp,
      colspan:
        w.kind === 'table-cell' && typeof p.span === 'number'
          ? p.span
          : undefined,
      'aria-label':
        w.kind === 'row' && p.as === 'breadcrumb' ? UI.breadcrumb : undefined,
      ...named,
    },
    [fill, ...b.kids()],
  )
}

/** The element tree of a node: one element per node, with the attributes the styles and page scripts select on. Null for a node that draws nothing. */
export function toElements(
  node: Node,
  ctx: ElementCtx,
  parent: Kind | null = null,
): HtmlNode | null {
  const targets = ctx.targets ?? triggerTargets(node)
  const inner: Inner = {
    ...ctx,
    targets,
    links: {
      ...ctx.links,
      fragment: id => (targets.has(id) && SAFE_ID.test(id) ? domId(id) : id),
    },
    tabs: tabInfo(node, id => (SAFE_ID.test(id) ? domId(id) : undefined)),
  }
  return build(node, inner, parent, null, false)
}
