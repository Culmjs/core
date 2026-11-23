import type { Layout, Node, Run, SiteDocument } from '../document/index.ts'
import type { Problem } from '../document/problems.ts'
import { isRequired } from '../document/required.ts'
import { walk } from '../document/tree.ts'
import { effectivePlacement, flagOf, floating } from '../layout/placement.ts'
import type { Registry } from '../registry/index.ts'
import { docDesign } from './designDoc.ts'
import { outlineOf } from './outline.ts'
import { unrolledTrees } from './unrolled.ts'
import type {
  ContrastRaw,
  Finding,
  LayoutRaw,
  MeasuredBox as Box,
  NodeRaw,
} from './types.ts'

/** First values, to be tuned against the agentic tests. Lengths are px; rhythm is a share of the usual gap. */
export const THRESHOLDS = {
  align: 4,
  symmetry: 4,
  rhythm: 0.25,
  emptyBand: 48,
  lineChars: 90,
  tap: 44,
  column: 1120,
  contrastBody: 4.5,
  contrastLarge: 3,
  largePx: 24,
  largeBoldPx: 19,
  shapeParts: 16,
  shapePath: 3000,
  accentHue: 20,
  accentText: 20,
  chroma: 32,
  stripeSide: 2,
  stripeFlat: 3,
  stripeEdge: [3, 12],
  emojiCount: 3,
  /** a button this share of its parent's width, and wider than stretchMin or stretchLabel times its label's width, is stretched */
  stretchShare: 0.8,
  stretchMin: 280,
  stretchLabel: 2.5,
  /** the width of a character, in em, for a label of unknown font */
  charEm: 0.55,
  /** Bare hero: text ink occupies less than this share of the column and no visual extends beyond it by heroOut. */
  heroInk: 0.75,
  heroOut: 0.25,
  /** a visual is at least this share of its section's area; a behind shape covering coverShare of its parent is a background */
  visualArea: 0.04,
  coverShare: 0.9,
  /** a last line shorter than this share of the longest line is an orphan */
  orphanShare: 0.25,
  /** the least distance from the text of a bleed section to the window edge */
  gutter: 56,
  /** a page whose paragraphs of 3 lines or more cover this share of its text is long form */
  longForm: 0.7,
} as const
const T = THRESHOLDS

/** The window width each layout is measured at. */
export const WIDTH_OF: Record<Layout, number> = {
  desktop: 1280,
  tablet: 834,
  phone: 390,
}

type CheckId =
  | 'invalid'
  | 'off-screen'
  | 'overflow'
  | 'broken-word'
  | 'h-scroll'
  | 'overlap'
  | 'contrast'
  | 'tap-target'
  | 'column'
  | 'alignment'
  | 'symmetry'
  | 'rhythm'
  | 'empty-band'
  | 'line-length'
  | 'heading-order'
  | 'duplicate-heading'
  | 'stacked-row'
  | 'phone-order'
  | 'shape-covers'
  | 'shape-complex'
  | 'raw-colour'
  | 'stretched-button'
  | 'crowded-phone-row'
  | 'header-edge'
  | 'hero-bare'
  | 'orphan-heading'
  | 'bleed-gutter'
  | 'all-stacked'
  | 'no-accent'
  | 'starter-chrome'
  | 'side-stripe'
  | 'gradient-text'
  | 'glow'
  | 'emoji-icon'
const CLASS: Record<CheckId, 1 | 2 | 3> = {
  invalid: 1,
  'off-screen': 2,
  overflow: 2,
  'broken-word': 2,
  'h-scroll': 2,
  overlap: 2,
  contrast: 2,
  'tap-target': 2,
  column: 3,
  alignment: 3,
  symmetry: 3,
  rhythm: 3,
  'empty-band': 3,
  'line-length': 3,
  'heading-order': 3,
  'duplicate-heading': 3,
  'stacked-row': 3,
  'phone-order': 3,
  'shape-covers': 2,
  'shape-complex': 2,
  'raw-colour': 2,
  'stretched-button': 2,
  'crowded-phone-row': 2,
  'header-edge': 2,
  'hero-bare': 2,
  'orphan-heading': 2,
  'bleed-gutter': 2,
  'all-stacked': 2,
  'no-accent': 2,
  'starter-chrome': 2,
  'side-stripe': 2,
  'gradient-text': 2,
  glow: 2,
  'emoji-icon': 2,
}

/** The advice that goes with each class 2 finding. */
export const FIX: Partial<Record<CheckId, string>> = {
  'off-screen': 'Let it wrap, or give it a smaller width on phone.',
  overflow: 'Let its row wrap, or shrink it to fit its parent.',
  'broken-word': 'Give the column more room, or use a smaller size on phone.',
  'h-scroll': 'Find the widest block at this width and let it wrap or shrink.',
  overlap: 'Space the two blocks apart, or place one behind.',
  'tap-target': 'Give it at least 44 px each way, with padding.',
  contrast: 'Use a site colour with more contrast, or change the background.',
  'shape-covers': 'Place the shape behind, or move it off the text.',
  'shape-complex': 'Use a preset geometry or fewer parts.',
  'raw-colour': 'Use a site colour by name, so dark mode follows.',
  'stretched-button':
    'Set its slot align to start or center, or its width to fit, so it is as wide as its label (recipe buttons).',
  'header-edge':
    'Give it the side padding of the sections, or hold its content in a centred column with their max width.',
  'hero-bare':
    'Give the hero a visual on its empty side: an image, shapes placed on that side, or a split into two columns (recipe hero).',
  'orphan-heading':
    'Set balance on the heading, or change its max width or its words, so the last line holds more than one word.',
  'bleed-gutter':
    'Hold the content in an inner column of max width 1120, centred, or give the section at least 56 px of side padding.',
  'all-stacked':
    'Set one section as two columns: a grid with the heading beside its text, or text beside an image or a shape (recipe split).',
  'no-accent':
    'Use the brand colour once below the hero: on a large heading, a divider, a short bar above a heading, or a button.',
  'starter-chrome':
    "Make it the site's own: change its padding or background, add a divider, or give the site name the heading font or weight.",
  'side-stripe':
    "Drop the one-sided border: tint the block's background, or give it a full hairline border.",
  'gradient-text':
    'Set the text in one site colour; for emphasis use weight or size, or a shape behind it.',
  glow: 'Use a shadow with an offset, such as soft, or none.',
  'emoji-icon': 'Use the icon kind or a small shape in its place, or drop it.',
}

export function findingKey(
  f: Pick<Finding, 'check' | 'page' | 'nodes' | 'width' | 'theme' | 'dir'>,
): string {
  return [
    f.check,
    f.page,
    [...f.nodes].sort().join(','),
    f.width,
    f.theme,
    f.dir,
  ].join('|')
}

/** The usual gap: the median of at least 3 gaps, and only from 8 px; null when there is no usual gap to compare with. */
const usualGap = (gaps: number[]) => {
  const usual =
    gaps.length >= 3
      ? [...gaps].sort((a, b) => a - b)[Math.floor((gaps.length - 1) / 2)]
      : 0
  return usual >= 8 ? usual : null
}

const px = (n: number) => Math.round(n)
const right = (b: Box) => b.x + b.w
const bottom = (b: Box) => b.y + b.h
/** Boxes that share more than a pixel vertically sit side by side. */
const besideV = (a: Box, b: Box) =>
  Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > 1
const words = (runs: unknown) =>
  (Array.isArray(runs) ? (runs as Run[]) : [])
    .map(r => r.text || (r.bind ? ` {${r.bind.from}.${r.bind.field}} ` : ''))
    .join('')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}{}.]+/gu, ' ')
    .trim()

type Input = {
  revision: number
  page: string
  dir: 'ltr' | 'rtl'
  layouts: LayoutRaw[]
  contrast: ContrastRaw[]
  /** the page, its header and footer are read from this, with component instances unrolled */
  doc: SiteDocument
  registry: Registry
  loaded: { fonts: boolean; assets: boolean }
  /** the page's compile problems: each becomes one class 1 finding, check 'invalid' */
  problems?: Problem[]
}

/**
 * The design checks over one page in one direction (one call, its three layouts). The outline gives the structure; `root` is read only for
 * what the outline leaves out: a Free child's front/behind layering, a row's direction and a heading's words.
 * Geometry is measured in the light theme only; contrast findings carry the theme and width they were measured at.
 */
export function runChecks(input: Input): Finding[] {
  const { layouts, contrast, doc, revision, page, dir, loaded } = input
  const out: Finding[] = []
  const trees = unrolledTrees(doc, page)
  // A page that is not in the document has no tree of its own: an empty one stands in, so the header and footer are still read.
  const known = doc.pages.some(p => p.id === page)
  const root: Node = known
    ? trees[0]!
    : { id: page, kind: 'column', name: page, slot: {} }
  const outline = {
    nodes: [root, ...(known ? trees.slice(1) : trees)].flatMap(
      t => outlineOf(t, input.registry).nodes,
    ),
  }
  const info = new Map(outline.nodes.map(n => [n.id, n]))
  const kids = new Map<string, string[]>()
  for (const n of outline.nodes)
    if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id])
  const widgets = new Map<string, Node>()
  for (const t of trees) walk(t, w => widgets.set(w.id, w))
  const sections = kids.get(root.id) ?? []

  const push = (
    check: CheckId,
    cls: 1 | 2 | 3,
    cell: { width: number; theme: 'light' | 'dark' },
    nodes: string[],
    observed: number | string,
    expected: string,
    message: string,
    cause?: string,
    fix = FIX[check],
  ) =>
    out.push({
      page,
      ...cell,
      dir,
      check,
      class: cls,
      revision,
      nodes,
      state: 'default',
      fonts: loaded.fonts,
      assets: loaded.assets,
      observed,
      expected,
      ...(cause ? { cause } : {}),
      ...(fix ? { fix } : {}),
      message,
      key: findingKey({ check, page, nodes, ...cell, dir }),
    })

  // Centred on purpose: the block's style places or aligns it in the centre, or its parent centres its children.
  const declOn = (id: string, l: Layout) => {
    const st = widgets.get(id)?.style
    return {
      ...st?.base,
      ...(l !== 'desktop' ? st?.tablet : {}),
      ...(l === 'phone' ? st?.phone : {}),
    }
  }
  // A row's children sit along it, so its `justify` centres them across and its `align` only up and down. A row stacks on phone unless it is a nav
  // or breadcrumb or says its phone direction.
  const rowOn = (id: string, l: Layout) => {
    const w = widgets.get(id)
    if (
      w?.kind === 'row' &&
      l === 'phone' &&
      !['nav', 'breadcrumb'].includes(String(w.props?.as)) &&
      !w.style?.phone?.direction &&
      !doc.centreMaxWidth
    )
      return false
    return (
      (declOn(id, l).direction ?? (w?.kind === 'row' ? 'row' : 'column')) ===
      'row'
    )
  }
  const centredOn = (id: string, parent: string, l: Layout) => {
    const d = declOn(id, l)
    const p = declOn(parent, l)
    const slot = widgets.get(id)?.slot as { align?: string } | undefined
    return (
      d.place === 'center' ||
      d.textAlign === 'center' ||
      slot?.align === 'center' ||
      (rowOn(parent, l) ? p.justify : p.align) === 'center'
    )
  }
  const label = (id: string) => {
    const n = info.get(id)
    return n
      ? `${n.kind[0].toUpperCase()}${n.kind.slice(1)} "${n.name}"`
      : `"${id}"`
  }
  const ancestors = (id: string) => {
    const a: string[] = []
    for (let p = info.get(id)?.parent; p; p = info.get(p)?.parent) a.push(p)
    return a
  }
  /** The top-level section a block is or sits in. */
  const sectionOf = (id: string) =>
    [id, ...ancestors(id)].find(a => info.get(a)?.parent === root.id) ?? id

  // Compile problems have no cell of their own; they sit at the desktop width in the light theme.
  for (const p of input.problems ?? [])
    push(
      'invalid',
      1,
      { width: WIDTH_OF.desktop, theme: 'light' },
      p.nodeId ? [p.nodeId] : [],
      p.code,
      'no compile problems',
      p.message,
    )

  // Shapes: document-only findings, at 1280 light like `invalid`.
  const docCell = { width: WIDTH_OF.desktop, theme: 'light' as const }
  const isHex = (c: unknown) => typeof c === 'string' && c.startsWith('#')
  for (const w of widgets.values()) {
    if (w.kind !== 'shape') continue
    const { fill, stroke } = (w.props ?? {}) as Record<string, unknown>
    const paints =
      fill && typeof fill === 'object'
        ? [(fill as { from?: unknown }).from, (fill as { to?: unknown }).to]
        : [fill]
    const line = (stroke as { color?: unknown } | undefined)?.color
    if ([...paints, line].some(isHex))
      push(
        'raw-colour',
        2,
        docCell,
        [w.id],
        'a # colour',
        'site colours by name',
        `${label(w.id)} is painted with a # colour, which does not follow dark mode.`,
      )
    // Only a root shape: a part belongs to its root's count.
    if (info.get(info.get(w.id)?.parent ?? '')?.kind === 'shape') continue
    let parts = 0
    let path = 0
    walk(w, d => {
      if (d === w) return
      parts++
    })
    walk(w, d => {
      const g = d.props?.geometry as { type?: string; d?: unknown } | undefined
      if (g?.type === 'path' && typeof g.d === 'string') path += g.d.length
    })
    if (parts > T.shapeParts || path > T.shapePath)
      push(
        'shape-complex',
        2,
        docCell,
        [w.id],
        parts > T.shapeParts ? parts : path,
        `at most ${T.shapeParts} parts and ${T.shapePath} characters of path`,
        `${label(w.id)} has ${parts} parts and ${path} characters of path data.`,
      )
  }

  // The design findings of the document. `starter-chrome` waits until the layouts are read.
  const design = docDesign(doc, page, trees, input.registry)
  const pushDoc = (h: (typeof design)[number]) =>
    push(
      h.check,
      CLASS[h.check],
      docCell,
      h.nodes,
      h.observed,
      h.expected,
      h.message,
    )
  for (const h of design) if (h.check !== 'starter-chrome') pushDoc(h)

  for (const c of contrast) {
    const seen = Math.floor(c.ratio * 10) / 10 // never rounds up to the threshold
    const need = c.large ? T.contrastLarge : T.contrastBody
    if (c.ratio < need)
      push(
        'contrast',
        2,
        { width: c.width, theme: c.scheme },
        [c.id],
        seen,
        `at least ${need}:1`,
        `${label(c.id)} has text at ${seen}:1 in the ${c.scheme} scheme${c.sampled ? ' (sampled over a picture or gradient)' : ''}; ${c.large ? 'large' : 'body'} text needs ${need}:1.`,
      )
  }

  for (const L of layouts) {
    const on = `on ${L.layout}`
    const cell = { width: WIDTH_OF[L.layout], theme: 'light' as const }
    const add = (
      check: CheckId,
      nodes: string[],
      observed: number | string,
      expected: string,
      message: string,
      cause?: string,
    ) =>
      push(check, CLASS[check], cell, nodes, observed, expected, message, cause)
    const at = new Map(L.nodes.map(n => [n.id, n]))
    const shown = (id: string) => at.get(id)?.box ?? null
    const shownKids = (id: string) => (kids.get(id) ?? []).filter(k => shown(k))

    const wide = new Set(L.wide.map(x => x.id))
    for (const { id, by } of L.wide) {
      if (ancestors(id).some(a => wide.has(a))) continue // the outermost block past the edge is the one to fix
      add(
        'off-screen',
        [id],
        by,
        `the block ends within the ${L.width} px window`,
        `${label(id)} is ${px(shown(id)?.w ?? 0)} px wide ${on} (${by} past the screen).`,
      )
    }
    if (L.docWidth > L.width)
      add(
        'h-scroll',
        [],
        px(L.docWidth - L.width),
        `the page is at most ${L.width} px wide`,
        `The page is ${px(L.docWidth)} px wide ${on}, ${px(L.docWidth - L.width)} more than the ${L.width} px window, so it scrolls sideways.`,
      )

    for (const n of L.nodes) {
      const parent = info.get(n.id)?.parent
      const p = parent ? at.get(parent) : undefined
      if (!n.box || !p?.box || p.clip || n.fixedOrSticky || wide.has(n.id))
        continue
      const by = Math.max(p.box.x - n.box.x, right(n.box) - right(p.box))
      if (by > 1)
        add(
          'overflow',
          [n.id],
          px(by),
          'a block reaches at most 1 px past its parent',
          `${label(n.id)} reaches ${px(by)} px past ${label(parent!)} ${on}.`,
        )
    }

    const empty = (n?: NodeRaw) =>
      !!n?.box && n.box.h > T.emptyBand && !n.visible
    // A section waiting for content: a list, or a block shown only with the site's data, that the page drew nothing for (a fresh site's Awards or Timeline).
    // What depends on an item is left out: a list's rows are measured as the list.
    const byData = (d: Node) =>
      d.repeat
        ? typeof d.repeat.source === 'string' || d.repeat.source.from !== 'item'
        : !!d.showIf && d.showIf.from !== 'item'
    const waiting = (id: string) => {
      let found = false
      const w = widgets.get(sectionOf(id))
      if (w)
        walk(w, d => {
          if (byData(d) && !at.get(d.id)?.box?.h) found = true
        })
      return found
    }
    for (const n of L.nodes) {
      // Only the outermost empty block is named.
      if (!empty(n) || empty(at.get(info.get(n.id)?.parent ?? ''))) continue
      const nothing = `a block taller than ${T.emptyBand} px shows something`
      if (waiting(n.id))
        add(
          'empty-band',
          [n.id],
          px(n.box!.h),
          nothing,
          `${label(n.id)} is ${px(n.box!.h)} px tall ${on} with nothing visible in it (no items yet).`,
          'no items yet',
        )
      else
        add(
          'empty-band',
          [n.id],
          px(n.box!.h),
          nothing,
          `${label(n.id)} is ${px(n.box!.h)} px tall ${on} with nothing visible in it.`,
        )
    }

    if (L.layout === 'phone')
      for (const n of L.nodes) {
        if (n.box && n.tap && (n.tap.w < T.tap || n.tap.h < T.tap))
          add(
            'tap-target',
            [n.id],
            `${px(n.tap.w)} x ${px(n.tap.h)}`,
            `at least ${T.tap} x ${T.tap} px`,
            `${label(n.id)} is ${px(n.tap.w)} x ${px(n.tap.h)} px ${on}; a tap target needs ${T.tap} x ${T.tap}.`,
          )
      }

    if (L.layout === 'desktop')
      for (const n of L.nodes) {
        if (n.box && n.text && n.text.longest > T.lineChars)
          add(
            'line-length',
            [n.id],
            n.text.longest,
            `at most ${T.lineChars} characters per line`,
            `${label(n.id)} has lines of ${n.text.longest} characters ${on}; about ${T.lineChars} is the most that reads well.`,
          )
      }

    // A front shape over a required text. Only a text has a box here: a shape's `label` is not text.
    for (const [id, w] of widgets) {
      const sb = w.kind === 'shape' ? shown(id) : null
      if (!sb || effectivePlacement(w, flagOf(L.layout)).mode !== 'front')
        continue
      for (const n of L.nodes) {
        const tb = n.box
        if (!tb || !n.text) continue
        if (
          ![n.id, ...ancestors(n.id)].some(a => {
            const x = widgets.get(a)
            return !!x && isRequired(x)
          })
        )
          continue
        const mw = Math.min(right(sb), right(tb)) - Math.max(sb.x, tb.x)
        const mh = Math.min(bottom(sb), bottom(tb)) - Math.max(sb.y, tb.y)
        if (mw > 1 && mh > 1)
          add(
            'shape-covers',
            [id, n.id],
            `${px(mw)} x ${px(mh)}`,
            'a front shape does not meet required text',
            `${label(id)} is in front of ${label(n.id)}, required text, by ${px(mw)} x ${px(mh)} px ${on}.`,
          )
      }
    }

    // Siblings: overlap, alignment, symmetry and stacked rows.
    for (const [parent, ids] of kids) {
      // A block with no width or no height paints nothing to line up (an empty menu, say).
      const boxes = ids.flatMap(id =>
        shown(id)?.w && shown(id)?.h
          ? [{ id, box: shown(id)!, raw: at.get(id)! }]
          : [],
      )
      const pBox = shown(parent)
      const layered = (id: string) =>
        at.get(id)!.fixedOrSticky ||
        (widgets.has(id) && floating(widgets.get(id)!, flagOf(L.layout)))
      boxes.forEach((a, i) => {
        for (const c of boxes.slice(i + 1)) {
          // a union of a list's rows spans every row, so it meets its siblings' unions without anything overlapping
          if (layered(a.id) || layered(c.id) || a.raw.merged || c.raw.merged)
            continue
          const w =
            Math.min(right(a.box), right(c.box)) - Math.max(a.box.x, c.box.x)
          const h =
            Math.min(bottom(a.box), bottom(c.box)) - Math.max(a.box.y, c.box.y)
          if (w > 1 && h > 1)
            add(
              'overlap',
              [a.id, c.id],
              `${px(w)} x ${px(h)}`,
              'sibling blocks overlap by at most 1 px in each direction, unless layered or fixed',
              `${label(a.id)} and ${label(c.id)} overlap by ${px(w)} x ${px(h)} px ${on}.`,
            )
        }
      })
      if (!pBox || !boxes.length) continue
      const stacked = boxes.every((a, i) =>
        boxes.slice(i + 1).every(c => !besideV(a.box, c.box)),
      )
      if (stacked) {
        const margins = boxes.map(k => ({
          ...k,
          l: k.box.x - pBox.x,
          r: right(pBox) - right(k.box),
        }))
        const centred = (m: { id: string }) => centredOn(m.id, parent, L.layout)
        for (const m of margins) {
          if (centred(m) && Math.abs(m.l - m.r) > T.symmetry)
            add(
              'symmetry',
              [m.id],
              px(Math.abs(m.l - m.r)),
              `margins within ${T.symmetry} px of each other`,
              `${label(m.id)} is centred with margins ${px(m.l)} and ${px(m.r)} px ${on}.`,
            )
        }
        const lefts = margins.filter(m => !centred(m))
        if (parent !== root.id && lefts.length > 1) {
          const count = new Map<number, number>()
          for (const m of lefts)
            count.set(px(m.box.x), (count.get(px(m.box.x)) ?? 0) + 1)
          const edge = [...count].reduce((best, e) =>
            e[1] > best[1] ? e : best,
          )[0]
          const ref = lefts.find(m => px(m.box.x) === edge)!
          const off = lefts.filter(m => Math.abs(m.box.x - edge) > T.align)
          if (off.length)
            add(
              'alignment',
              [ref.id, ...off.map(m => m.id)],
              px(Math.max(...off.map(m => Math.abs(m.box.x - edge)))),
              `left edges within ${T.align} px of the usual edge (${edge} px)`,
              `In ${label(parent)} ${on}, ${off.map(m => `${label(m.id)} starts at ${px(m.box.x)} px`).join(', ')} while ${label(ref.id)} starts at ${edge} px.`,
            )
        }
      } else {
        // A row of equal items (same kind and name) should have equal widths.
        const same = boxes.filter(
          k =>
            info.get(k.id)?.kind === info.get(boxes[0].id)?.kind &&
            info.get(k.id)?.name === info.get(boxes[0].id)?.name,
        )
        const ws = same.map(k => k.box.w)
        if (
          same.length === boxes.length &&
          boxes.length > 1 &&
          Math.max(...ws) - Math.min(...ws) > T.symmetry
        )
          add(
            'symmetry',
            same.map(k => k.id),
            px(Math.max(...ws) - Math.min(...ws)),
            `widths within ${T.symmetry} px of each other`,
            `The ${same.length} "${info.get(same[0].id)!.name}" items in ${label(parent)} are ${px(Math.min(...ws))} to ${px(Math.max(...ws))} px wide ${on}.`,
          )
      }
      if (
        L.layout === 'desktop' &&
        info.get(parent)?.kind === 'row' &&
        boxes.length > 1 &&
        boxes.every(k => k.box.w >= pBox.w - T.align)
      )
        add(
          'stacked-row',
          [parent],
          boxes.length,
          'the blocks of a row do not each take its full width',
          `${label(parent)} has ${boxes.length} blocks that each take its full width ${on}, so it reads as a column.`,
        )
    }

    // Top-level sections: rhythm and the main column, read from each section's content, not its full-width outer box.
    // The main column: 1120 px, or the page area when that is narrower (a tablet, a phone, a page beside a side header).
    const column = Math.min(T.column, shown(root.id)?.w ?? L.width)
    const contentOf = (id: string) => {
      // Down through transparent wrappers wider than the main column with one child to the first box that is not, or a branch.
      let n = at.get(id)!
      for (
        let k = shownKids(n.id);
        n.bg === null &&
        !n.clip &&
        n.box!.w > column + T.align &&
        k.length === 1;
        k = shownKids(n.id)
      )
        n = at.get(k[0])!
      // Full-bleed: the section paints a background or clips at full width.
      return { box: n.box!, bleed: n.bg !== null || n.clip }
    }
    const inkOf = (id: string): Box | null => {
      // The visible content: leaves that show something and blocks that paint a background, without their padding around it.
      const k = shownKids(id)
      const n = at.get(id)!
      if (n.bg !== null || (!k.length && n.visible)) return n.box
      return k.map(inkOf).reduce<Box | null>(
        (u, b) =>
          !b
            ? u
            : !u
              ? b
              : {
                  x: Math.min(u.x, b.x),
                  y: Math.min(u.y, b.y),
                  w: Math.max(right(u), right(b)) - Math.min(u.x, b.x),
                  h: Math.max(bottom(u), bottom(b)) - Math.min(u.y, b.y),
                },
        null,
      )
    }
    // A see-through full-width column holding several blocks is only a wrapper: the blocks in it are the page's sections.
    const flat = (id: string): string[] => {
      const n = at.get(id)
      const k = shownKids(id)
      return n?.box &&
        widgets.get(id)?.kind === 'column' &&
        n.bg === null &&
        !n.clip &&
        n.box.w > column + T.align &&
        k.length > 1
        ? k.flatMap(flat)
        : [id]
    }
    const secs = sections
      .flatMap(flat)
      .filter(id => shown(id))
      .map(id => ({ id, ...contentOf(id), ink: inkOf(id) }))
      .sort((a, c) => shown(a.id)!.y - shown(c.id)!.y)
    const inked = secs.filter(s => s.ink)
    const gaps = inked
      .slice(1)
      .map((c, i) => ({ a: inked[i], c, g: c.ink!.y - bottom(inked[i].ink!) }))
      .filter(x => x.g >= 0 && !x.a.bleed && !x.c.bleed)
    const usual = usualGap(gaps.map(x => x.g))
    if (usual !== null) {
      for (const { a, c, g } of gaps) {
        if (Math.abs(g - usual) > T.rhythm * usual)
          add(
            'rhythm',
            [a.id, c.id],
            px(g),
            `within ${T.rhythm * 100}% of the usual gap (${px(usual)} px)`,
            `The gap between ${label(a.id)} and ${label(c.id)} is ${px(g)} px ${on}; the others are about ${px(usual)} px.`,
          )
      }
    }
    for (const s of secs) {
      // A section that shows nothing has no column to judge.
      if (!s.bleed && s.ink && Math.abs(s.box.w - column) > T.align)
        add(
          'column',
          [s.id],
          px(s.box.w),
          `${px(column)} px, within ${T.align} px`,
          `${label(s.id)} has content ${px(s.box.w)} px wide ${on}; the page's main column is ${px(column)} px.`,
        )
    }

    // Text ink: the union of the boxes of a block and its descendants that carry text or are images. `inkOf` takes a whole painted block.
    const union = (u: Box | null, b: Box | null): Box | null =>
      !b
        ? u
        : !u
          ? b
          : {
              x: Math.min(u.x, b.x),
              y: Math.min(u.y, b.y),
              w: Math.max(right(u), right(b)) - Math.min(u.x, b.x),
              h: Math.max(bottom(u), bottom(b)) - Math.min(u.y, b.y),
            }
    const textInk = (id: string): Box | null => {
      const n = at.get(id)
      let own =
        n?.box && (n.text || info.get(id)?.kind === 'image') ? n.box : null
      // A button's ink is its label and padding, however far it is stretched: fixing stretched-button must not change what hero-bare reads.
      if (own && info.get(id)?.kind === 'button') {
        const label = String(widgets.get(id)?.props?.label ?? '').length
        const w = Math.min(
          own.w,
          label * T.charEm * (n?.text?.size ?? 16) + own.h,
        )
        own = { ...own, w, x: dir === 'rtl' ? right(own) - w : own.x }
      }
      return (kids.get(id) ?? []).reduce<Box | null>(
        (u, k) => union(u, textInk(k)),
        own,
      )
    }
    const area = (b: Box) => b.w * b.h

    // Use rendered siblings, not just a row's declared direction. A nested
    // heading can be constrained by a grandparent; report the editable row.
    if (L.layout === 'phone')
      for (const n of L.nodes) {
        if (!n.box || !n.text || n.merged) continue
        const node = widgets.get(n.id)
        const button =
          node?.kind === 'button' &&
          typeof node.props?.label === 'string' &&
          node.props.label.length <= 48 &&
          n.text.lines >= 3
        const heading =
          node?.kind === 'text' &&
          /^h[12]$/.test(n.tag) &&
          n.text.lines >= 2 &&
          !((node.props?.runs ?? []) as Run[]).some(
            r => r.br || r.text?.includes('\n'),
          )
        if (!button && !heading) continue
        let child = n.id
        for (const parent of ancestors(n.id)) {
          const container = widgets.get(parent),
            p = shown(parent),
            c = shown(child)
          const siblings = shownKids(parent).filter(id => id !== child)
          if (
            container?.props?.as === 'nav' ||
            container?.props?.as === 'breadcrumb'
          )
            break
          if (
            p &&
            c &&
            (container?.kind === 'row' || container?.kind === 'grid') &&
            n.box.w < p.w * 0.72 &&
            siblings.some(id => {
              const s = at.get(id),
                box = s?.box
              if (
                !box ||
                !besideV(c, box) ||
                !(right(c) <= box.x + 1 || right(box) <= c.x + 1)
              )
                return false
              if (button) return true
              const w = widgets.get(id)
              return (
                w?.kind === 'text' &&
                !!s?.text &&
                s.text.size <= 18 &&
                !/\d{1,2}:\d{2}/.test(
                  ((w.props?.runs ?? []) as Run[])
                    .map(r => r.text ?? '')
                    .join(''),
                )
              )
            })
          ) {
            const edit =
              container.kind === 'grid'
                ? { props: { phoneCols: 1 } }
                : { phone: { direction: 'column', align: 'start' } }
            push(
              'crowded-phone-row',
              2,
              cell,
              [n.id, parent],
              px(n.box.w),
              'enough room for the phone label or heading',
              `At ${L.width}px "${n.id}" is ${px(n.box.w)}px wide and wraps to ${n.text.lines} lines beside another item in "${parent}".`,
              parent,
              `Stack the constraining parent on phone: ${JSON.stringify({ op: 'update', id: parent, ...edit })}`,
            )
            break
          }
          child = parent
        }
      }

    // Buttons stretched across their parent, at desktop and tablet.
    if (L.layout !== 'phone')
      for (const n of L.nodes) {
        const parent = info.get(n.id)?.parent
        const p = parent ? shown(parent) : null
        if (!n.tap || !n.box || !p || info.get(n.id)?.kind !== 'button')
          continue
        if (ancestors(n.id).some(a => info.get(a)?.kind === 'form')) continue
        const chars = String(widgets.get(n.id)?.props?.label ?? '').length
        const label2 = T.stretchLabel * chars * T.charEm * (n.text?.size ?? 16)
        if (
          n.tap.w >= T.stretchShare * p.w &&
          n.tap.w >= Math.max(T.stretchMin, label2)
        )
          add(
            'stretched-button',
            [n.id],
            px(n.tap.w),
            `a button narrower than ${T.stretchShare * 100}% of its parent, or than ${px(Math.max(T.stretchMin, label2))} px`,
            `${label(n.id)} is ${px(n.tap.w)} px wide ${on} for a ${chars}-character label, across its parent.`,
          )
      }

    // A word split across two lines.
    for (const n of L.nodes)
      if (n.box && n.text?.broken)
        add(
          'broken-word',
          [n.id],
          'split',
          'every word on one line',
          `${label(n.id)} has a word split across two lines ${on}.`,
        )

    // Headings that end on a lone word.
    for (const n of L.nodes) {
      if (!n.box || !n.text || !/^h[12]$/.test(n.tag) || n.text.lines < 2)
        continue
      const runs = (widgets.get(n.id)?.props?.runs ?? []) as Run[]
      const said = runs
        .map(r => r.text ?? '')
        .join('')
        .replace(/\s+/g, ' ')
      const lone =
        !runs.some(r => r.bind) &&
        !said.slice(-n.text.last).trim().includes(' ')
      if (n.text.last < T.orphanShare * n.text.longest || lone)
        add(
          'orphan-heading',
          [n.id],
          n.text.last,
          `a last line of at least ${T.orphanShare * 100}% of the longest, and more than one word`,
          `${label(n.id)} ends on a last line of ${n.text.last} characters (longest line ${n.text.longest}) ${on}.`,
        )
    }

    // The header and the footer start where the sections' text starts.
    if (L.layout !== 'phone') {
      const start = (b: Box) => (dir === 'rtl' ? right(b) : b.x)
      const count = new Map<number, number>()
      for (const s of secs) {
        const ink = textInk(s.id)
        if (ink) count.set(px(start(ink)), (count.get(px(start(ink))) ?? 0) + 1)
      }
      const usualEdge = [...count].reduce<[number, number] | null>(
        (best, e) => (!best || e[1] > best[1] ? e : best),
        null,
      )
      if (usualEdge && usualEdge[1] >= 2)
        for (const id of [doc.header?.id, doc.footer?.id]) {
          const ink = id ? textInk(id) : null
          if (!id || !ink) continue
          const at0 = start(ink)
          // Centred on purpose: equal margins, and the text starts inside the sections' edge (a full-width bar that starts outside it is not centred).
          const inside =
            dir === 'rtl'
              ? at0 <= usualEdge[0] + T.align
              : at0 >= usualEdge[0] - T.align
          if (inside && Math.abs(ink.x - (L.width - right(ink))) <= T.symmetry)
            continue
          if (Math.abs(at0 - usualEdge[0]) > T.align)
            add(
              'header-edge',
              [id],
              px(at0),
              `its text starts within ${T.align} px of the sections' (${usualEdge[0]} px)`,
              `${label(id)} has its text start at ${px(at0)} px ${on} while the page's sections start at ${usualEdge[0]} px.`,
            )
        }
    }

    if (L.layout !== 'desktop') continue

    // The hero: its text and nothing beside it.
    const hero = secs[0]
    const inside = (id: string): string[] =>
      (kids.get(id) ?? []).flatMap(k => [k, ...inside(k)])
    const heroNodes = hero ? inside(hero.id) : []
    const heroInk = hero ? textInk(hero.id) : null
    if (
      hero &&
      heroInk &&
      L.nodes.some(n => n.tag === 'h1' && n.box && heroNodes.includes(n.id))
    ) {
      const sbox = shown(hero.id)!
      const visual = heroNodes.some(id => {
        const v = shown(id)
        const w0 = widgets.get(id)
        if (!v || !w0) return false
        const k = w0.kind as string
        if (!['image', 'video', 'embed', 'shape'].includes(k)) return false
        const pBox = shown(info.get(id)?.parent ?? '')
        if (
          k === 'shape' &&
          effectivePlacement(w0, flagOf(L.layout)).mode === 'behind' &&
          (w0.props?.geometry as { type?: string } | undefined)?.type !==
            'group' &&
          pBox &&
          area(v) >= T.coverShare * area(pBox)
        )
          return false
        if (area(v) < T.visualArea * area(sbox)) return false
        const overlap = Math.max(
          0,
          Math.min(right(v), right(heroInk)) - Math.max(v.x, heroInk.x),
        )
        return v.w - overlap >= T.heroOut * column
      })
      const share = heroInk.w / column
      if (
        share < T.heroInk &&
        !visual &&
        !(declOn(hero.id, 'desktop') as { bgImage?: unknown }).bgImage
      )
        add(
          'hero-bare',
          [hero.id],
          `${Math.round(share * 100)}%`,
          `the hero's text fills ${T.heroInk * 100}% of the column, or a visual sits beside it`,
          `${label(hero.id)} has its text in ${Math.round(share * 100)}% of the ${px(column)} px column ${on} and nothing on the rest of its width.`,
        )
    }

    // A full-bleed section whose text runs near the window edge.
    for (const s of secs) {
      const ink = s.bleed && s.box.w > column + T.align ? textInk(s.id) : null
      if (!ink) continue
      const gutter = Math.min(ink.x, L.width - right(ink))
      if (gutter < T.gutter)
        add(
          'bleed-gutter',
          [s.id],
          px(gutter),
          `text at least ${T.gutter} px from the window edge`,
          `${label(s.id)} paints to the window edge and its text is ${px(gutter)} px from it ${on}.`,
        )
    }

    // A page of one column.
    const pageIds = new Set([root.id, ...inside(root.id)])
    const texts = L.nodes.filter(n => n.box && n.text && pageIds.has(n.id))
    const inkArea = texts.reduce((a, n) => a + area(n.box!), 0)
    const longs = texts
      .filter(n => n.tag === 'p' && n.text!.lines >= 3)
      .reduce((a, n) => a + area(n.box!), 0)
    const counted = (pid: string) =>
      shownKids(pid).filter(
        k =>
          shown(k)!.w &&
          shown(k)!.h &&
          // a shape in the flow counts as a block beside text once it is big enough to be a visual, not a bar
          (info.get(k)?.kind !== 'shape' ||
            area(shown(k)!) >=
              T.visualArea * area(shown(sectionOf(k)) ?? shown(k)!)) &&
          !at.get(k)!.fixedOrSticky &&
          !(widgets.has(k) && floating(widgets.get(k)!, flagOf(L.layout))),
      )
    const sideBySide = [...pageIds].some(pid => {
      const k = counted(pid)
      const pw = widgets.get(pid)
      if (
        k.length < 2 ||
        info.get(pid)?.kind === 'menu' ||
        (pw?.kind === 'row' &&
          ['nav', 'breadcrumb'].includes(String(pw.props?.as))) ||
        k.every(c => info.get(c)?.kind === 'button')
      )
        return false
      return k.some((a, i) =>
        k.slice(i + 1).some(c => {
          const x = shown(a)!
          const y = shown(c)!
          return (
            besideV(x, y) &&
            Math.min(right(x), right(y)) - Math.max(x.x, y.x) <= 1
          )
        }),
      )
    })
    if (
      secs.length >= 2 &&
      !sideBySide &&
      !(inkArea && longs >= T.longForm * inkArea)
    )
      add(
        'all-stacked',
        [root.id],
        secs.length,
        'one section with two blocks side by side',
        `All ${secs.length} sections of the page are one column ${on}; no two blocks sit side by side.`,
      )

    // Headings in reading order on desktop.
    const heads = L.nodes
      .filter(n => n.box && /^h[1-6]$/.test(n.tag))
      .sort((a, c) => a.box!.y - c.box!.y || a.box!.x - c.box!.x)
    heads.forEach((h, i) => {
      const prev = heads[i - 1]
      if (prev && Number(h.tag[1]) > Number(prev.tag[1]) + 1)
        add(
          'heading-order',
          [prev.id, h.id],
          `${prev.tag} then ${h.tag}`,
          'a heading is at most one level below the one before it',
          `${label(h.id)} is an ${h.tag} right after the ${prev.tag} ${label(prev.id)}; a level is skipped.`,
        )
    })
    const h1 = heads.filter(h => h.tag === 'h1')
    if (h1.length > 1)
      add(
        'heading-order',
        h1.map(h => h.id),
        h1.length,
        'one h1 on the page',
        `The page has ${h1.length} h1 headings; it should have one.`,
      )
    heads.forEach((h, i) => {
      const prev = heads[i - 1]
      const said = words(widgets.get(h.id)?.props?.runs)
      if (prev && said && said === words(widgets.get(prev.id)?.props?.runs))
        add(
          'duplicate-heading',
          [prev.id, h.id],
          said,
          'consecutive headings say different words',
          `${label(prev.id)} and ${label(h.id)} say the same words one after another.`,
        )
    })
    // A heading and the block after it on desktop should stay together on phone.
    if (layouts.some(x => x.layout === 'phone'))
      for (const h of heads) {
        const n = info.get(h.id)
        const sibs = n?.parent
          ? kids.get(n.parent)!.map(id => info.get(id)!)
          : []
        const next = (l: Layout) =>
          n?.order[l] == null
            ? undefined
            : sibs.find(s => s.order[l] === n.order[l]! + 1)
        const content = next('desktop')
        if (
          content &&
          content.order.phone !== null &&
          n!.order.phone !== null &&
          next('phone')?.id !== content.id
        )
          push(
            'phone-order',
            3,
            { width: WIDTH_OF.phone, theme: 'light' },
            [h.id, content.id],
            next('phone')?.id ?? 'none',
            `the block after the heading on desktop (${content.id}) follows it on phone`,
            `On phone, ${label(h.id)} no longer comes right before ${label(content.id)} as it does on desktop.`,
          )
      }
  }
  // The overlap rule: a header or footer that fails header-edge is told about that, not also that it is the starter's.
  for (const h of design)
    if (
      h.check === 'starter-chrome' &&
      !out.some(f => f.check === 'header-edge' && f.nodes[0] === h.nodes[0])
    )
      pushDoc(h)
  return out
}
