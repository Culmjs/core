import type { Layout, Node, Run } from '../document/index.ts'
import type { Problem } from '../document/problems.ts'
import { walk } from '../document/tree.ts'
import { flagOf, floating } from '../layout/placement.ts'
import type { Registry } from '../registry/index.ts'
import { outlineOf } from './outline.ts'
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
} as const
const T = THRESHOLDS

/** The window width each layout is measured at. */
export const WIDTH_OF: Record<Layout, number> = {
  desktop: 1280,
  tablet: 834,
  phone: 390,
}

const CLASS: Record<string, 1 | 2 | 3> = {
  invalid: 1,
  'off-screen': 2,
  overflow: 2,
  'h-scroll': 2,
  overlap: 2,
  contrast: 2,
  'tap-target': 2,
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
  root: Node
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
  const { layouts, contrast, root, revision, page, dir, loaded } = input
  const out: Finding[] = []
  const outline = outlineOf(root, input.registry)
  const info = new Map(outline.nodes.map(n => [n.id, n]))
  const kids = new Map<string, string[]>()
  for (const n of outline.nodes)
    if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id])
  const widgets = new Map<string, Node>()
  walk(root, w => widgets.set(w.id, w))
  const sections = kids.get(root.id) ?? []

  const push = (
    check: string,
    cls: 1 | 2 | 3,
    cell: { width: number; theme: 'light' | 'dark' },
    nodes: string[],
    observed: number | string,
    expected: string,
    message: string,
    cause?: string,
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
      !w.style?.phone?.direction
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

  for (const c of contrast) {
    const need = c.large ? T.contrastLarge : T.contrastBody
    if (c.ratio < need)
      push(
        'contrast',
        2,
        { width: c.width, theme: c.scheme },
        [c.id],
        Number(c.ratio.toFixed(1)),
        `at least ${need}:1`,
        `${label(c.id)} has text at ${c.ratio.toFixed(1)}:1 in the ${c.scheme} scheme${c.sampled ? ' (sampled over a picture or gradient)' : ''}; ${c.large ? 'large' : 'body'} text needs ${need}:1.`,
      )
  }

  for (const L of layouts) {
    const on = `on ${L.layout}`
    const cell = { width: WIDTH_OF[L.layout], theme: 'light' as const }
    const add = (
      check: string,
      nodes: string[],
      observed: number | string,
      expected: string,
      message: string,
      cause?: string,
    ) =>
      push(
        check,
        CLASS[check] ?? 3,
        cell,
        nodes,
        observed,
        expected,
        message,
        cause,
      )
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

    if (L.layout !== 'desktop') continue
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
  return out
}
