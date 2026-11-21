import {
  KINDS,
  kindSpec,
  walk,
  type KindSpec,
  type Box,
  type Decl,
  type FlowSlot,
  type FreeSlot,
  type GridSlot,
  type Look,
  type Node,
  type Pattern,
  type Run,
  type SiteStyles,
} from '../document/index.ts'
import { EMBEDS } from '../document/embed.ts'
import { STYLE_GROUPS } from '../document/kinds.ts'
import {
  effectivePlacement,
  floating,
  wrapping,
  type LayoutFlag,
} from '../layout/placement.ts'
import { effectiveFreeBoxes, phoneBoxes } from '../layout/phone.ts'
import { checkSiteStyles } from '../style/index.ts'
import {
  checkStyle,
  declCss,
  declsOf,
  escapeCss,
  STATE_NAME,
  stateNameOk,
  type StyleCtx,
} from '../style/decl.ts'
import { stylesOf } from '../style/siteStyles.ts'
import { lookCss } from '../style/look.ts'

import { DENSITY, FADE, patternBackground } from './stylesPatterns.ts'
import {
  CODE_HEX,
  FLEX,
  GRAIN,
  KIND_CSS,
  MARKERS,
  STATE_SEL,
  TF,
  TIP_CSS,
  VARIANTS,
  cols,
  currentMarkRules,
  detailsRules,
  dropdownRules,
  fitSize,
  linkHoverRules,
  markerRules,
  mirror,
  mirrorStyle,
  n,
  fin,
  posInt,
  SLOT_ALIGN,
  checkedDecl,
  ownOf,
  FLIP,
  noRules,
  OWN,
  pick,
  place,
  rowRules,
  withTextStyle,
  wordsOf,
  type CompileKind,
  type Extra,
  type Rules,
  type Variant,
} from './stylesRules.ts'

const DISPLAY = /^[a-z]+(-[a-z]+)*( [a-z]+(-[a-z]+)*)?$/
/** A plug-in kind's display value, written only if it is a display keyword (or two); anything else is `block`. The plug-in is outside code. */
const displayOf = (spec: KindSpec, w: Node) => {
  const d = spec.display(w)
  return typeof d === 'string' && DISPLAY.test(d) ? d : 'block'
}

/**
 * The class-name start for a node id: `p<id>-`, with `.` written `_` and `~` written `-`. An id holds only [a-z0-9], `.` and `~`; any other
 * character is a bug in the caller. The leading `p` and the `-c`, `-k` and `-s` that follow keep names apart from each other and from unprefixed ones.
 */
const classStart = (p: string) => {
  if (p === '') return ''
  if (!/^[a-z0-9.~]+$/.test(p))
    throw new RangeError(
      `compileStyles: prefix ${JSON.stringify(p)} is not a node id`,
    )
  return `p${p.replace(/\./g, '_').replace(/~/g, '-')}-`
}

export function compileStyles(
  t: Node,
  ctx: {
    look: Look
    mode: 'edit' | 'live'
    style: StyleCtx
    styles?: SiteStyles
    dir?: 'rtl'
    prefix?: string
    /** The kinds a registry's plug-ins add; a node of one is styled like any other node. */
    kinds?: ReadonlyMap<string, KindSpec>
  },
): { css: string; rules: string; classOf: Map<string, string> } {
  const classOf = new Map<string, string>()
  const prefix = classStart(ctx.prefix ?? '')
  const rtl = ctx.dir === 'rtl'
  // Stored values are checked again here, as at save: a site's styles that fail fall back to the defaults, and a block's style that fails writes nothing.
  const siteStyles = stylesOf({
    styles: checkSiteStyles(stylesOf(ctx)).styles,
    look: ctx.look,
  })
  const textStyles = siteStyles.text
  // `extra` writes more base rules for the class, right after its own; its `key` puts what they depend on in the dedup key.
  const classes = new Map<
    string,
    {
      cls: string
      kind: CompileKind
      r: Record<Variant, string>
      extra?: Extra
    }
  >()
  const byKind = new Map<CompileKind, string[]>()
  // a code text's colours (Shiki's light one and the dark one): one class per pair the page uses, so a token costs a class name and not an inline style
  const codeColors = new Map<
    string,
    { cls: string; light?: string; dark?: string }
  >()
  // blocks that use grain, textFill and fitWidth: each is one shared rule at the end, so a page pays for it once
  const grainy: string[] = [],
    filled: string[] = [],
    fitted: string[] = []
  // blocks that appear after scrolling, a pinned footer, any tooltip, and any link back to the top of the page: also shared rules
  const appearing = new Map<number, string[]>(),
    revealed: string[] = []
  let tips = false,
    toTop = false
  // the spotlight blocks
  const spotty: string[] = []
  const boxes = new Map<string, Map<string, Box>>()
  const desktopBoxes = new Map<string, Map<string, Box>>()
  const tabletBoxes = new Map<string, Map<string, Box>>()

  const add = (id: string, kind: CompileKind, rules: Rules, extra?: Extra) => {
    const r = Object.fromEntries(
      VARIANTS.map(v => [v, rules[v].join(';')]),
    ) as Record<Variant, string>
    const defaults = Object.hasOwn(KIND_CSS, kind)
    if (!defaults && !extra && VARIANTS.every(v => !r[v])) return
    // Kind is part of the key so each class gets one kind's defaults.
    const key = JSON.stringify([
      kind,
      ...VARIANTS.map(v => r[v]),
      extra?.key ?? '',
    ])
    let e = classes.get(key)
    if (!e) {
      e = { cls: `${prefix}c${classes.size.toString(36)}`, kind, r, extra }
      classes.set(key, e)
      if (defaults) byKind.set(kind, [...(byKind.get(kind) ?? []), e.cls])
    }
    classOf.set(id, e.cls)
  }

  walk(t, (w, p) => {
    const spec = kindSpec(w.kind, ctx.kinds)
    // a kind the core does not know (a plug-in's) has no defaults here: it writes no rules
    if (!spec) return
    const r = noRules()
    const props = w.props ?? {}
    const checked =
      checkStyle(w.kind, withTextStyle(w, textStyles), siteStyles, ctx.kinds)
        .style ?? {}
    const st = (rtl ? mirrorStyle(checked) : checked) ?? {}
    if (w.kind === 'free') {
      r.base.push(cols(n(props.cols, 24)))
      boxes.set(w.id, phoneBoxes(w))
      desktopBoxes.set(w.id, effectiveFreeBoxes(w))
      tabletBoxes.set(w.id, effectiveFreeBoxes(w, 'tablet'))
      if (w.children?.some(child => floating(child) || floating(child, true))) {
        for (const layout of [false, 'tablet', true] as const) {
          const geometry = (
            layout === true ? boxes : layout ? tabletBoxes : desktopBoxes
          ).get(w.id)!
          const rows = Math.max(
            1,
            ...[...geometry.values()].map(b => fin(b.y) + fin(b.h)),
          )
          // Absolute grid children cannot create the row tracks their area references.
          const rule = `grid-template-rows:${w.children.some(child => floating(child, layout)) ? `repeat(${rows},minmax(24px,auto))` : 'none'}`
          if (layout === true) r.phone.push(rule)
          else if (layout === false) r.base.push(rule)
          else if (!r.base.includes(rule)) r.tablet.push(rule)
        }
      }
    }
    if (w.kind === 'grid') {
      r.base.push(cols(n(props.cols, 1)))
      if (posInt(props.tabletCols))
        r.tablet.push(cols(props.tabletCols as number))
      if (posInt(props.phoneCols)) r.phone.push(cols(props.phoneCols as number))
    }
    const marker =
      w.kind === 'list' ? (props.marker ?? w.repeat?.marker) : undefined
    const start = Number.isInteger(props.start)
      ? (props.start as number)
      : undefined
    const reversed = props.reversed === true
    // `expand` runs before compiling, so the children are the real items.
    const count = w.children?.length ?? 0
    if (w.kind === 'embed') {
      const h =
        typeof props.provider === 'string' &&
        Object.hasOwn(EMBEDS, props.provider)
          ? EMBEDS[props.provider].h
          : undefined
      if (h) r.base.push(`aspect-ratio:auto;height:${h}px`)
    }
    if (
      w.kind === 'image' &&
      typeof props.fit === 'string' &&
      KINDS.image.props.fit.options?.includes(props.fit)
    )
      r.base.push(`object-fit:${props.fit}`)
    if (w.kind === 'row') {
      if (props.as === 'nav' || props.as === 'breadcrumb')
        r.phone.push('flex-wrap:wrap')
      else if (!st.phone?.direction) r.phone.push('flex-direction:column')
    }
    const pattern = props.pattern as Pattern | undefined
    if (pattern && w.kind !== 'free')
      r.base.push('position:relative;isolation:isolate')

    if (p?.kind === 'free') {
      const here = place(
        desktopBoxes.get(p.id)!.get(w.id) ?? (w.slot as FreeSlot),
      )
      if (here) r.base.push(here)
      const tb = tabletBoxes.get(p.id)!.get(w.id)
      if (tb && place(tb) !== here) {
        r.tablet.push(place(tb))
      }
      const b = boxes.get(p.id)!.get(w.id)
      if (b) {
        r.phone.push(place(b))
      } else if (!w.hide?.phone) r.phone.push('display:none')
    } else if (p && FLEX.has(p.kind)) {
      const f = w.slot as FlowSlot
      r.base.push('min-width:0')
      const grow = Number.isFinite(f.grow) && f.grow! >= 0 ? f.grow : undefined
      const basis = f.basis
        ? declCss(checkedDecl({ width: f.basis }), ctx.style)
        : ''
      if (grow !== undefined || basis)
        r.base.push(
          `flex:${grow ?? 0} 1 ${basis ? basis.slice('width:'.length) : grow ? '0%' : 'auto'}`,
        )
      const wd = w.style?.base?.width
      if (typeof wd === 'object' && wd.unit === 'px')
        r.base.push('flex-shrink:0')
      if (f.align && SLOT_ALIGN.includes(f.align))
        r.base.push(`align-self:${f.align}`)
    } else if (p?.kind === 'grid') {
      const g = w.slot as GridSlot
      const [gc, gr] = [posInt(g.cols), posInt(g.rows)]
      if (gc) r.base.push(`grid-column:span ${gc}`)
      if (gr) r.base.push(`grid-row:span ${gr}`)
      const pc = posInt(p.props?.phoneCols)
      const tc = posInt(p.props?.tabletCols)
      if (gc && tc && gc > tc) r.tablet.push(`grid-column:span ${tc}`)
      if (gc && pc && gc > pc) r.phone.push(`grid-column:span ${pc}`)
      // A tablet cap would otherwise carry down to a phone with more columns than the tablet.
      else if (gc && pc && tc && gc > tc) r.phone.push(`grid-column:span ${gc}`)
    }
    for (const v of ['base', 'tablet', 'hover', 'dark', 'phone'] as const)
      if (p?.style?.[v]?.snap) r[v].push('scroll-snap-align:start')

    if (w.hide?.desktop || w.hide?.tablet)
      r.phone.push(`display:${displayOf(spec, w)}`)
    for (const v of VARIANTS) {
      if (!OWN(spec, v)) continue
      const d = pick(
        st[v],
        w.kind === 'field'
          ? KINDS.field.styles.filter(k => !STYLE_GROUPS.PAINT.includes(k))
          : spec.styles,
      )
      // The three layouts write z-index themselves, below.
      if (v === 'base' || v === 'tablet' || v === 'phone') delete d.z
      // A transform is one declaration, so a layer that sets any part restates the parts it inherits (state layers and dark take base; phone takes base then tablet).
      if (v !== 'base' && TF.some(k => d[k] !== undefined)) {
        const from = v === 'phone' ? [st.base, st.tablet] : [st.base]
        Object.assign(d, ...from.map(x => pick(x, TF)), pick(st[v], TF))
      }
      // The divider's border is its top edge, so a `sides` list has no meaning there.
      if (w.kind === 'divider' && d.border)
        d.border = { ...d.border, sides: undefined }
      let s = declCss(d, ctx.style, v !== 'base')
      // A divider is one rule: its border is the top edge only, or an hr draws it twice as thick.
      if (w.kind === 'divider')
        s = s.replace(/(^|;)border:/, '$1border:0;border-top:')
      if (s) r[v].push(s)
      // A menu that scrolls sideways (tabs) stays on one line: `wrap` can only turn wrapping on, and a menu wraps by default.
      if (w.kind === 'menu' && st[v]?.overflow === 'scroll-x')
        r[v].push('flex-wrap:nowrap')
      // A button lays its label out as a flex item, so its text alignment moves the label.
      const ta = w.kind === 'button' ? st[v]?.textAlign : undefined
      if (ta)
        r[v].push(
          `justify-content:${ta === 'center' ? 'center' : ta === 'end' ? 'flex-end' : 'flex-start'}`,
        )
    }
    if (st.base?.fitWidth) {
      r.base.push(
        fitSize(
          wordsOf(w).length,
          !!st.base.upper ||
            (/[A-Z]/.test(wordsOf(w)) &&
              wordsOf(w) === wordsOf(w).toUpperCase()),
        ),
      )
      fitted.push(w.id)
    }
    // A list (or a repeating column) laid out as a column and aligned centre or end moves its rows as one block: they share the widest row's width and
    // left edge, instead of each row shrinking to its own text and sitting at its own place (a ragged left edge). One grid column sized to the widest
    // row, never wider than the list, does that; a layout that drops the alignment goes back to the flex column.
    if (w.kind === 'list' || (w.kind === 'column' && w.repeat)) {
      let was = false
      for (const v of ['base', 'tablet', 'phone'] as const) {
        const at = (k: 'align' | 'direction') =>
          (v === 'phone'
            ? (st.phone?.[k] ?? st.tablet?.[k])
            : v === 'tablet'
              ? st.tablet?.[k]
              : undefined) ?? st.base?.[k]
        // `wrap` is no matter in a column (a wrapped row list that folds to a column on a phone is one)
        const align = at('align'),
          block =
            (align === 'center' || align === 'end') && at('direction') !== 'row'
        if (block)
          r[v].push(
            `display:grid;grid-template-columns:minmax(0,max-content);justify-content:${align};align-items:start`,
          )
        else if (was)
          r[v].push('display:flex;align-items:' + (align ?? 'stretch'))
        was = block
      }
    }
    const phoneOrderedBox =
      w.kind === 'box' &&
      w.children?.some(c => c.style?.phone?.order !== undefined)
    const tabletOrderedBox =
      w.kind === 'box' &&
      w.children?.some(c => c.style?.tablet?.order !== undefined)
    // Explicit wrapping establishes a block formatting context, even inside an authored flex/grid group.
    for (const layout of [false, 'tablet', true] as const) {
      const phone = layout === true,
        tablet = layout === 'tablet'
      const target = phone ? r.phone : tablet ? r.tablet : r.base
      // The layout above has already written its rules and the cascade carries them down, so below desktop only differences are written.
      const prev: LayoutFlag = phone ? 'tablet' : false
      const geo = phone ? boxes : tablet ? tabletBoxes : desktopBoxes
      const size = (k: 'width' | 'height') =>
        (phone
          ? (st.phone?.[k] ?? st.tablet?.[k])
          : tablet
            ? st.tablet?.[k]
            : undefined) ?? st.base?.[k]
      if (
        w.children?.some(c => floating(c, layout) && (!tablet || !floating(c)))
      )
        target.push('position:relative;isolation:isolate')
      const wraps = w.children?.some(
        c => wrapping(c, layout) && (!tablet || !wrapping(c)),
      )
      if (
        ((phone && (phoneOrderedBox || tabletOrderedBox)) ||
          (tablet && tabletOrderedBox)) &&
        !wraps
      )
        target.push('display:flex;flex-direction:column')
      if (wraps) target.push('display:flow-root')
      else if (
        layout &&
        !(phone && (phoneOrderedBox || tabletOrderedBox)) &&
        !(tablet && tabletOrderedBox) &&
        w.children?.some(c => wrapping(c, prev) && !wrapping(c, layout))
      )
        target.push(`display:${displayOf(spec, w)}`)
      if (!p || (tablet && !w.placement?.tablet)) continue
      const placement = effectivePlacement(w, layout),
        mode = placement.mode
      if (mode === 'front' || mode === 'behind') {
        const z = p.kind === 'free' ? fin(geo.get(p.id)?.get(w.id)?.z) : 0
        target.push(
          `position:absolute;z-index:${(mode === 'front' ? 20000 : -20000) + z};inset-inline-start:${fin(placement.x)}px;top:${fin(placement.y)}px`,
        )
        if (p.kind === 'free' && !['image', 'video'].includes(w.kind)) {
          if (!size('width')) target.push('width:100%')
          if (!size('height')) target.push('height:100%')
        }
      } else if (mode === 'wrap-start' || mode === 'wrap-end') {
        target.push(
          `position:relative;float:${mode === 'wrap-start' ? 'inline-start' : 'inline-end'};max-width:100%`,
        )
        if (!size('width')) target.push('width:40%')
      }
      if (layout && mode !== effectivePlacement(w, prev).mode) {
        if (!floating(w, layout))
          target.push(
            `position:relative;inset-inline-start:auto;top:auto;z-index:${p.kind === 'free' ? fin(geo.get(p.id)?.get(w.id)?.z) : 'auto'}`,
          )
        if (
          floating(w, prev) &&
          !floating(w, layout) &&
          p.kind === 'free' &&
          !['image', 'video'].includes(w.kind)
        )
          target.push(
            `width:${declCss({ width: size('width') ?? 'fill' }, ctx.style).slice(6)};height:${declCss({ height: size('height') ?? 'fit' }, ctx.style).slice(7)}`,
          )
        if (!wrapping(w, layout)) {
          target.push('float:none')
          if (wrapping(w, prev) && !size('width')) target.push('width:auto')
        }
      }
    }
    // `z` adds to the z-index written above for Free slots and front/behind blocks; with none, it is the z-index and needs a position.
    if (VARIANTS.some(v => st[v]?.z !== undefined)) {
      const zOf = (l: LayoutFlag) =>
        l === true
          ? (st.phone?.z ?? st.tablet?.z ?? st.base?.z)
          : l === 'tablet'
            ? (st.tablet?.z ?? st.base?.z)
            : st.base?.z
      const zBase = (l: LayoutFlag) => {
        const mode = effectivePlacement(w, l).mode
        const slot =
          p?.kind === 'free'
            ? ((l === true
                ? boxes
                : l === 'tablet'
                  ? tabletBoxes
                  : desktopBoxes
              )
                .get(p.id)
                ?.get(w.id) ??
              (l === 'tablet' ? desktopBoxes.get(p.id)?.get(w.id) : undefined))
            : undefined
        return mode === 'front' || mode === 'behind'
          ? (mode === 'front' ? 20000 : -20000) + fin(slot?.z)
          : slot
            ? fin(slot.z)
            : undefined
      }
      if (
        zBase(false) === undefined &&
        !VARIANTS.some(v => st[v]?.position || st[v]?.sticky || st[v]?.pin)
      )
        r.base.push('position:relative')
      // A layout that has its own slot or placement rewrites z-index, so each of those gets the sum again.
      let prev: number | undefined
      for (const l of [false, 'tablet', true] as const) {
        if (![st.base, st.tablet, st.phone].some(x => x?.z !== undefined)) break
        const [b, zz] = [zBase(l), zOf(l)]
        const total = zz === undefined ? b : (b ?? 0) + zz
        if (total !== undefined && (b !== undefined || prev !== total))
          (l === true ? r.phone : l === 'tablet' ? r.tablet : r.base).push(
            `z-index:${total}`,
          )
        prev = total
      }
    }
    // Visibility wins over wrapping's display changes, including inherited phone visibility.
    if (st.base?.hidden) r.base.push('display:none')
    // Hidden in the base and shown in dark (the dark half of a light/dark pair): the dark layer restates the display.
    if (st.base?.hidden && st.dark?.hidden === false)
      r.dark.push(`display:${displayOf(spec, w)}`)
    // (the base rule already hides it at every width, so no phone copy that would beat the dark show rule)
    if (
      st.phone?.hidden ??
      (st.dark?.hidden === false ? undefined : st.base?.hidden)
    )
      r.phone.push('display:none')
    else if (
      st.phone?.hidden === false &&
      (st.tablet?.hidden ?? st.base?.hidden)
    )
      r.phone.push(
        `display:${w.children?.some(c => wrapping(c, true)) ? 'flow-root' : phoneOrderedBox || tabletOrderedBox ? 'flex' : displayOf(spec, w)}`,
      )
    // The editor shows a layer in place, but a pinned one that a click opens (the phone menu's sheet, the full-screen menu) would sit open over the
    // canvas in every view; it stays out of the canvas until a visitor opens it. Its contents are still in the Layers tree.
    if (ctx.mode === 'edit' && props.layer === 'popover-auto' && st.base?.pin)
      r.base.push('display:none')
    if (w.hide?.desktop) r.base.push('display:none')
    if (w.hide?.tablet) r.tablet.push('display:none')
    if (w.hide?.phone) r.phone.push('display:none')
    // Layers that react to a state. A name or value that fails the grammar writes nothing, even if a tree skipped the save check.
    const whenRules = (
      keys: readonly (keyof Decl)[],
      shows: boolean,
    ): { at: string; css: string; late?: true }[] =>
      (Array.isArray(st.when) ? st.when : []).flatMap(x => {
        if (!x || !stateNameOk(x.state) || !STATE_NAME.test(x.is)) return []
        const d = pick(x.decl, keys)
        delete d.z
        const vis = shows ? d.hidden : undefined
        delete d.hidden
        // Like a state layer, a layer that sets part of a transform restates the parts it inherits from base.
        if (TF.some(k => d[k] !== undefined))
          Object.assign(d, pick(st.base, TF), pick(x.decl, TF))
        const css = declCss(d, ctx.style, true),
          at = `[data-s-${x.state}="${x.is}"]`
        // Showing and hiding go after the phone block, so a state hides or shows on every layout.
        return [
          ...(css ? [{ at, css }] : []),
          ...(vis === undefined
            ? []
            : [
                {
                  at,
                  css: vis ? 'display:none' : `display:${displayOf(spec, w)}`,
                  late: true as const,
                },
              ]),
        ]
      })
    const whens = whenRules(
      w.kind === 'field'
        ? KINDS.field.styles.filter(k => !STYLE_GROUPS.PAINT.includes(k))
        : spec.styles,
      true,
    )
    // `:where()` keeps both forms at 0,1,0: the block inside the holder, and the holder itself.
    const whenFn = (list: typeof whens, late: boolean) => {
      const own = list.filter(x => !!x.late === late)
      return own.length
        ? (cls: string) =>
            own
              .map(
                x => `:where(${x.at}) .${cls},.${cls}:where(${x.at}){${x.css}}`,
              )
              .join('')
        : undefined
    }
    // a breadcrumb draws its "/" between items, so a screen reader does not say "slash"; hidden items are not in the page, so no stray slash
    const slashes = w.kind === 'row' && props.as === 'breadcrumb'
    const currentMark =
      w.kind === 'menu' &&
      (props.currentMark === 'arrow' ||
        props.currentMark === 'brackets' ||
        props.currentMark === 'dot')
        ? props.currentMark
        : undefined
    const rows = w.kind === 'menu' && props.rows === 'lines'
    const own0 = MARKERS.has(marker)
      ? {
          key: `${marker}|${start}|${reversed}|${count}`,
          rules: markerRules(marker as string, start, reversed, count, prefix),
        }
      : currentMark
        ? {
            key: `mark|${currentMark}|${rtl}`,
            rules: currentMarkRules(currentMark, rtl),
          }
        : slashes
          ? {
              key: 'slashes',
              rules: (cls: string) =>
                `.${cls}>*+*::before{content:"/";content:"/" / "";margin-inline-end:8px;color:var(--s-muted)}`,
            }
          : undefined
    const own1 = rows
      ? {
          key: `${own0?.key ?? ''}|rows`,
          rules: (cls: string) => (own0?.rules(cls) ?? '') + rowRules(cls),
        }
      : own0
    // `numbers: on` counts the entries 01, 02 ... before each link; the number has no spoken alternative, so a screen reader hears the page names only.
    const own2 =
      w.kind === 'menu' && props.numbers === 'on'
        ? {
            key: `${own1?.key ?? ''}|numbers`,
            rules: (cls: string) =>
              (own1?.rules(cls) ?? '') +
              `.${cls}{counter-reset:n}.${cls} a{counter-increment:n}.${cls} a::before{content:counter(n,decimal-leading-zero);content:counter(n,decimal-leading-zero) / "";margin-inline-end:.6em;font-size:.7em;vertical-align:.3em;opacity:.8}`,
          }
        : own1
    // `links: inherit` makes the entries wear the menu's own text colour, so a menu on a dark bar reads (the links are the brand colour otherwise).
    const own3 =
      w.kind === 'menu' && props.links === 'inherit'
        ? {
            key: `${own2?.key ?? ''}|inherit`,
            rules: (cls: string) =>
              (own2?.rules(cls) ?? '') + `.${cls} a{color:inherit}`,
          }
        : own2
    const own4 =
      w.kind === 'menu' && props.icons === 'on'
        ? {
            key: `${own3?.key ?? ''}|icons`,
            rules: (cls: string) =>
              (own3?.rules(cls) ?? '') +
              `.${cls} a{display:inline-flex;flex-direction:column;align-items:center;gap:3px}.${cls} a svg{width:1.5em;height:1.5em}`,
          }
        : own3
    const own = own4
    // More rules written for the class: a details marker or fold, a menu's dropdown and its links' hover, each keyed by what it depends on.
    const more: { key: string; rules: (cls: string) => string }[] = []
    if (w.kind === 'details') {
      const mk =
        props.marker === 'plus' || props.marker === 'chevron'
          ? props.marker
          : undefined
      const ms =
        typeof props.markerMs === 'number' &&
        Number.isInteger(props.markerMs) &&
        props.markerMs >= 0 &&
        props.markerMs <= 1000
          ? props.markerMs
          : 0
      const fold =
        props.foldOn === 'phone' || props.foldOn === 'never'
          ? props.foldOn
          : undefined
      if (mk || fold)
        more.push({
          key: `details|${mk}|${ms}|${fold}`,
          rules: detailsRules(mk, ms, fold),
        })
    }
    if (w.kind === 'menu' && props.as === 'dropdown')
      more.push({ key: 'dropdown', rules: dropdownRules })
    const lh =
      w.kind === 'menu' ? declsOf(st).flatMap(d => d.linkHover ?? []) : []
    if (lh.length)
      more.push({
        key: `linkhover|${lh.some(x => x.radius !== undefined || x.pill)}|${lh.some(x => x.pill)}|${lh.some(x => x.lift !== undefined)}|${lh.some(x => x.ms !== undefined)}|${lh.some(x => x.bg)}|${lh.some(x => x.color)}|${lh.some(x => x.underline !== undefined)}`,
        rules: linkHoverRules(lh),
      })
    const ownAll = more.reduce<typeof own>(
      (acc, x) => ({
        key: `${acc?.key ?? ''}|${x.key}`,
        rules: (cls: string) => (acc?.rules(cls) ?? '') + x.rules(cls),
      }),
      own,
    )
    const extra: Extra | undefined =
      ownAll || whens.length
        ? {
            key: `${ownAll?.key ?? ''}|${JSON.stringify(whens)}`,
            base: ownAll?.rules,
            when: whenFn(whens, false),
            show: whenFn(whens, true),
          }
        : undefined
    const isCode = w.kind === 'text' && props.level === 'code'
    if (isCode)
      for (const run of (Array.isArray(props.runs)
        ? props.runs
        : []) as Run[]) {
        const light =
            typeof run?.style?.color === 'string' &&
            CODE_HEX.test(run.style.color)
              ? run.style.color
              : undefined,
          dark =
            typeof run?.dark === 'string' && CODE_HEX.test(run.dark)
              ? run.dark
              : undefined
        const key = `code:${light ?? ''}|${dark ?? ''}`
        if ((light || dark) && !codeColors.has(key)) {
          const cls = `${prefix}k${codeColors.size.toString(36)}`
          codeColors.set(key, { cls, light, dark })
          classOf.set(key, cls)
        }
      }
    add(w.id, isCode ? 'code' : w.kind, r, extra)
    const decls = declsOf(st)
    if (decls.some(d => d.grain !== undefined)) grainy.push(w.id)
    if (st.base?.textFill) filled.push(w.id)
    if (ctx.mode === 'live') {
      if (st.base?.appearAfter !== undefined)
        appearing.set(st.base.appearAfter, [
          ...(appearing.get(st.base.appearAfter) ?? []),
          w.id,
        ])
      if (st.base?.reveal) revealed.push(w.id)
    }
    if (
      typeof props.tip === 'string' &&
      props.tip &&
      Object.hasOwn(spec.props, 'tip')
    )
      tips = true
    if (decls.some(d => d.spotlight)) spotty.push(w.id)
    const goesTop = (l: unknown) =>
      !!l && typeof l === 'object' && (l as { url?: unknown }).url === '#top'
    if (
      goesTop(props.link) ||
      goesTop(props.viewAll) ||
      (Array.isArray(props.runs) &&
        (props.runs as Run[]).some(r => goesTop(r?.link)))
    )
      toTop = true

    if (w.kind === 'field') {
      const control = noRules()
      for (const v of VARIANTS) {
        if (!OWN(spec, v)) continue
        const s = declCss(
          pick(st[v], [...STYLE_GROUPS.PAINT, 'nowrap']),
          ctx.style,
          v !== 'base',
        )
        if (s) control[v].push(s)
      }
      // A field's paint reacts to states on its control.
      const cw = whenRules([...STYLE_GROUPS.PAINT, 'nowrap'], false)
      add(
        `${w.id}:control`,
        'field-control',
        control,
        cw.length
          ? { key: JSON.stringify(cw), when: whenFn(cw, false) }
          : undefined,
      )
    }

    if (pattern) {
      const fade = ownOf(
        FADE,
        (rtl ? ownOf(FLIP, pattern.fade) : undefined) ?? pattern.fade,
      )
      const base = [
        'position:absolute;inset:0;pointer-events:none;z-index:-1',
        `background:${patternBackground(pattern, ctx.look.brand, ctx.look.ink)}`,
      ]
      if (fade) base.push(`-webkit-mask-image:${fade};mask-image:${fade}`)
      // a density runs the whole length of the box, from nearly clear to full strength at the dense side; it takes the place of a fade
      const dense = ownOf(
        DENSITY,
        rtl
          ? (ownOf(FLIP, pattern.density) ?? pattern.density)
          : pattern.density,
      )
      if (dense)
        base.push(
          `-webkit-mask-image:linear-gradient(${dense},rgb(0 0 0/.06),#000);mask-image:linear-gradient(${dense},rgb(0 0 0/.06),#000)`,
        )
      add(`${w.id}:pattern`, 'pattern', { ...noRules(), base })
    }
    if (
      w.kind === 'text' &&
      Array.isArray(props.runs) &&
      props.level !== 'code'
    ) {
      ;(props.runs as Run[]).forEach((run, i) => {
        const safe = run?.style && checkedDecl(run.style)
        const rs = rtl ? mirror(safe) : safe
        const s =
          rs &&
          declCss(pick(rs, [...STYLE_GROUPS.TYPE, 'bg', 'radius']), ctx.style)
        // An explicit phone Text setting wins over only the same run-level typography.
        const override =
          safe &&
          declCss(
            pick(
              st.phone,
              Object.keys(safe).filter(key =>
                STYLE_GROUPS.TYPE.includes(key as keyof Decl),
              ) as (keyof Decl)[],
            ),
            ctx.style,
          )
        if (s || override)
          add(`${w.id}:run${i}`, 'run', {
            ...noRules(),
            base: s ? [s] : [],
            phone: override ? [override] : [],
          })
      })
    }
  })

  const all = [...classes.values()]
  const rules = (v: Variant, sel: (c: string, kind: CompileKind) => string) =>
    all
      .map(
        e =>
          (e.r[v] ? `${sel(e.cls, e.kind)}{${e.r[v]}}` : '') +
          (v === 'base' ? (e.extra?.base?.(e.cls) ?? '') : ''),
      )
      .join('')
  // Every variant selector weighs 0,1,0 like the base, so source order decides: base, the states, dark, tablet, phone.
  let css = ''
  for (const [k, cs] of byKind)
    css += `${cs.map(c => `.${c}`).join(',')}{${KIND_CSS[k]}}`
  const clsOf = (ids: string[]) => [
    ...new Set(ids.flatMap(i => classOf.get(i) ?? [])),
  ]
  // grain sits in a ::before under the content (the block becomes its own stacking context, positioned unless something else positions it: `:where` has no weight)
  if (grainy.length) {
    const g = clsOf(grainy)
    css += `:where(${g.map(c => `.${c}`).join(',')}){position:relative;isolation:isolate}${g.map(c => `.${c}::before`).join(',')}{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;background:${GRAIN};mix-blend-mode:overlay;opacity:var(--s-grain,0)}`
  }
  // the parent of a line that fits its width measures it
  if (fitted.length)
    css += `:has(${clsOf(fitted)
      .map(c => `>.${c}`)
      .join(',')}){container-type:inline-size}`
  css += rules('base', c => `.${c}`)
  // A menu's current layer styles its current link, the one place a menu renders aria-current.
  // A Form field's wrapper is never focused itself: its focus layer applies while the control inside has focus.
  for (const [v, tail] of STATE_SEL)
    css += rules(v, (c, k) =>
      v === 'current' && k === 'menu'
        ? `.${c} ${tail}`
        : v === 'focus' && k === 'field'
          ? `.${c}:where(:focus-within)`
          : `.${c}${tail}`,
    )
  const dark = rules('dark', c => `:where(.s-site.s-scheme-dark) .${c}`)
  if (dark)
    css +=
      dark +
      `@media (prefers-color-scheme: dark){${rules('dark', c => `:where(.s-site.s-scheme-auto) .${c}`)}}`
  if (codeColors.size) {
    const all = [...codeColors.values()]
    css += all
      .filter(c => c.light)
      .map(c => `.${c.cls}{color:${c.light}}`)
      .join('')
    const sel = (scheme: string) =>
      all
        .filter(c => c.dark)
        .map(
          c => `:where(.s-site.s-scheme-${scheme}) .${c.cls}{color:${c.dark}}`,
        )
        .join('')
    css += `${sel('dark')}@media (prefers-color-scheme: dark){${sel('auto')}}`
  }
  // Layers that react to a state come after every state layer and before the tablet and phone blocks.
  css += all.map(e => e.extra?.when?.(e.cls) ?? '').join('')
  const tablet = rules('tablet', c => `:where(.s-site--live) .${c}`)
  if (tablet) css += `@media (max-width: 1024px){${tablet}}`
  const phone = rules('phone', c => `:where(.s-site--live) .${c}`)
  if (phone) css += `@media (max-width: 600px){${phone}}`
  if (ctx.mode === 'edit')
    css +=
      rules('tablet', c => `:where(.s-site--tablet, .s-site--phone) .${c}`) +
      rules('phone', c => `:where(.s-site--phone) .${c}`)
  // A state that shows or hides a block wins on every layout, so it follows the phone blocks.
  css += all.map(e => e.extra?.show?.(e.cls) ?? '').join('')
  // textFill: the gradient (--s-tf, set by the block's layers) is painted into the letters only where the browser can clip a background to text and forced colours are off; elsewhere the plain colour shows. Last, so a colour set by any layer, state or width does not undo the transparent fill. Only a fill set on the base layer paints (a layer alone would leave the letters with nothing to show).
  if (filled.length)
    css += `@supports ((-webkit-background-clip:text) or (background-clip:text)){@media (forced-colors:none){${clsOf(
      filled,
    )
      .map(c => `.${c}`)
      .join(
        ',',
      )}{background-image:var(--s-tf);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}}}`
  // appearAfter: hidden until the page has scrolled that far, only where the browser can tie an animation to the page's scroll and the visitor has not asked for less motion; everywhere else the block simply shows.
  if (appearing.size)
    css += `@media (prefers-reduced-motion: no-preference){@supports (animation-timeline:scroll()){@keyframes s-appear{from{opacity:0;visibility:hidden}to{opacity:1;visibility:visible}}${[
      ...appearing,
    ]
      .map(
        ([vh, ids]) =>
          `${clsOf(ids)
            .map(c => `.${c}`)
            .join(
              ',',
            )}{animation:s-appear linear both;animation-timeline:scroll(root);animation-range:${vh}vh ${vh + 12}vh}`,
      )
      .join('')}}}`
  // reveal: the footer's wrapper stays at the foot of the window and the page, opaque and above it, scrolls off to uncover it. Wide and tall windows only: a footer taller than the window could not be read.
  if (revealed.length)
    css += `@media (min-width:601px) and (min-height:561px){${revealed.map(id => `.s-site:has(.${classOf.get(id)})`).join(',')}{isolation:isolate}${revealed.map(id => `.s-site:has(.${classOf.get(id)})>.s-footer`).join(',')}{position:sticky;bottom:0;z-index:-1;background-color:var(--s-bg)}${revealed.map(id => `.s-site:has(.${classOf.get(id)})>main`).join(',')}{position:relative;background-color:var(--s-bg)}}`
  // spotlight sits in a ::after under the content, as grain does in a ::before (the glow itself is --s-sp, written by the block's layers)
  if (spotty.length) {
    const g = clsOf(spotty)
    css += `:where(${g.map(c => `.${c}`).join(',')}){position:relative;isolation:isolate}${g.map(c => `.${c}::after`).join(',')}{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;background:var(--s-sp)}`
  }
  // tooltips: the words are in data-tip; the bubble shows on hover and keyboard focus, and eases in only for visitors who have not asked for less motion
  if (tips) css += TIP_CSS
  if (toTop && ctx.mode === 'live')
    css +=
      '@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}'
  // Reduced motion always turns motion off; only pages that use a transition carry the rule.
  if (css.includes('transition-property:'))
    css +=
      '@media (prefers-reduced-motion: reduce){:where(.s-site) *{transition:none!important}}'
  const own = escapeCss(css)
  return { css: lookCss(ctx.look, siteStyles, css) + own, rules: own, classOf }
}
