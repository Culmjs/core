import { kindSpec, type Link, type Run } from '../document/index.ts'
import { COMMANDS } from '../document/kinds.ts'
import { isObj, urlOk } from '../document/rules.ts'
import { MATH_ATTRS, MATH_TAG, MATH_TAGS, mathOk } from '../validate/tree.ts'
import {
  SAFE_ID,
  TAGS,
  str,
  domId,
  el,
  glyph,
  invoker,
  nativeCommand,
  type Attrs,
  type Build,
} from './elementsBase.ts'
import { type HtmlNode } from './html.ts'
import { href, linkProps } from './links.ts'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Text with its character references resolved (the writer escapes it again), or null for a reference it does not know. */
function decode(s: string): string | null {
  let ok = true
  const out = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, e: string) => {
    const code =
      e[0] === '#'
        ? e[1] === 'x' || e[1] === 'X'
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10)
        : NaN
    const bad =
      e[0] === '#'
        ? !(code >= 1 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff))
        : !Object.hasOwn(ENTITIES, e)
    if (bad) ok = false
    return bad ? '' : e[0] === '#' ? String.fromCodePoint(code) : ENTITIES[e]
  })
  return ok ? out : null
}

/**
 * MathML from temml that `mathOk` passed, as elements. Every `<` opens a tag from the same allow-list, so nothing else can appear;
 * tags that do not nest, or a character reference outside the five and the numeric ones, write nothing.
 */
export function parseMath(src: string): HtmlNode[] | null {
  const root: HtmlNode = { tag: 'math-root', children: [] }
  const open: HtmlNode[] = [root]
  const top = () => open[open.length - 1].children!
  for (let i = 0; i < src.length;) {
    const lt = src.indexOf('<', i)
    const chunk = src.slice(i, lt < 0 ? undefined : lt)
    if (chunk) {
      const t = decode(chunk)
      if (t === null) return null
      top().push(t)
    }
    if (lt < 0) break
    const m = MATH_TAG.exec(src.slice(lt, lt + 2000))
    if (!m || !MATH_TAGS.has(m[2])) return null
    i = lt + m[0].length
    if (m[1]) {
      if (open.pop()?.tag !== m[2] || !open.length) return null
      continue
    }
    const attrs: Attrs = {}
    for (const a of m[3].matchAll(/([A-Za-z]+)=(?:"([^"<>]*)"|'([^'<>]*)')/g)) {
      const v = decode(a[2] ?? a[3])
      if (v === null || !MATH_ATTRS.has(a[1])) return null
      attrs[a[1]] = v
    }
    const e: HtmlNode = { tag: m[2], attrs, children: [] }
    top().push(e)
    if (!m[4]) open.push(e)
  }
  return open.length === 1 ? (root.children as HtmlNode[]) : null
}

function runs(b: Build): (HtmlNode | string)[] {
  const { w, p, ctx } = b
  const list = Array.isArray(p.runs) ? (p.runs as Run[]) : []
  const code = p.level === 'code'
  const out: (HtmlNode | string | null)[] = list.map((r, i) => {
    if (!isObj(r)) return null
    if (r?.br === true) return { tag: 'br' }
    // MathML is written as elements, but only after the same allow-list check the editor ran at save.
    if (typeof r?.math === 'string') {
      const m = mathOk(r.math) ? parseMath(r.math) : null
      return m && el('span', {}, m)
    }
    const words = typeof r?.text === 'string' ? r.text : null
    // Code: a run's colours are a class the page's CSS defines once, not a style on every token.
    if (code) {
      const c = ctx.classOf.get(
        `code:${typeof r.style?.color === 'string' ? r.style.color : ''}|${typeof r.dark === 'string' ? r.dark : ''}`,
      )
      return c ? el('span', { class: c }, [words]) : words
    }
    // In the editor a run that came from a field is drawn as a chip; the live page has no mark.
    const cls =
      [
        ctx.classOf.get(`${w.id}:run${i}`),
        ctx.mode === 'edit' && r.fromData && 's-field',
      ]
        .filter(Boolean)
        .join(' ') || undefined
    const to = r.link ? href(r.link, ctx.doc, ctx.links) : undefined
    if (to !== undefined) {
      const a = linkProps(to, ctx.mail, r.text)
      return el(
        'a',
        {
          class: cls,
          ...a.props,
          ...(r.external ? { rel: 'noopener nofollow ugc' } : {}),
        },
        [a.text],
      )
    }
    return cls ? el('span', { class: cls }, [words]) : words
  })
  return out.filter((e): e is HtmlNode | string => e !== null)
}

/** A file's address; `resolve` has already held it to the address check. */
const fileOf = (b: Build, id: unknown) =>
  typeof id === 'string' ? b.ctx.links.file(id) : undefined

/** The kinds that draw their own content: text, image, icon, video and button. */
export function textElement(b: Build): HtmlNode | null {
  const { w, p, ctx, attrs, parent, grand } = b
  switch (w.kind) {
    case 'text': {
      const body = runs(b)
      const tag = kindSpec('text')!.tag(parent, w, grand)
      const safe = TAGS.has(tag) ? tag : 'div'
      return el(
        safe,
        { ...attrs, 'aria-current': p.current === true ? 'page' : undefined },
        p.level === 'code' ? [el('code', {}, body)] : body,
      )
    }
    case 'image': {
      const f = fileOf(b, p.assetId)
      const src =
        typeof p.src === 'string' ? (urlOk(p.src) ? p.src : undefined) : f
      if (!src) {
        if (typeof p.fallback === 'string' && p.fallback)
          return el(
            'span',
            {
              ...attrs,
              role: 'img',
              'aria-label': str(p.alt) || str(p.fallback),
            },
            [p.fallback],
          )
        return b.plate('photo')
      }
      return { tag: 'img', attrs: { ...attrs, src, alt: str(p.alt) } }
    }
    case 'video': {
      const f = fileOf(b, p.assetId)
      if (!f) return b.plate('video')
      return {
        tag: 'video',
        attrs: {
          ...attrs,
          src: f,
          poster: fileOf(b, p.poster),
          controls: p.controls ? '' : undefined,
          loop: p.loop ? '' : undefined,
          muted: p.muted ? '' : undefined,
          playsinline: '',
        },
      }
    }
    case 'icon': {
      const name = str(p.name)
      const g = glyph(name, {}, ctx.icons)
      if (!g) return null
      // A linked icon is a link named by its label (else its tooltip, else the icon's own name); a link that points nowhere leaves a plain icon.
      const to =
        p.link && typeof p.link === 'object'
          ? href(p.link as Link, ctx.doc, ctx.links)
          : undefined
      if (to === undefined) return el('span', attrs, [g])
      const mail = linkProps(to, ctx.mail)
      return el(
        'a',
        {
          ...attrs,
          ...mail.props,
          'aria-label': str(p.label) || str(p.tip) || name,
        },
        [g],
      )
    }
    default:
      return button(b)
  }
}

function button(b: Build): HtmlNode {
  const { w, p, ctx, attrs, parent } = b
  const { mode } = ctx
  const name = str(p.label)
  const disabled = mode === 'edit' ? '' : undefined
  const only = p.iconOnly === true
  const svg = glyph(
    p.icon,
    only
      ? {}
      : {
          style: `${p.iconAfter === true ? 'margin-inline-start' : 'margin-inline-end'}:0.5em;flex:none`,
        },
    ctx.icons,
  )
  // An icon sits before the label; with `iconOnly` the label stays for assistive technology only.
  const words: HtmlNode | string =
    only && svg ? el('span', { class: 's-vh' }, [name]) : name
  // Shapes behind the label are written first, inside the same element.
  const shapes = w.children?.length ? b.kids() : []
  const label: (HtmlNode | string)[] = [
    ...shapes,
    ...(svg ? (p.iconAfter === true ? [words, svg] : [svg, words]) : [name]),
  ]
  const real = (more: Attrs = {}) =>
    el('button', { ...attrs, ...more, type: 'button', disabled }, label)
  if (ctx.tabs?.get(w.id)?.role === 'tab') return real()
  // A command button needs a target in the same document: the browser does the rest.
  const cmd =
    typeof p.command === 'string' &&
    COMMANDS.includes(p.command) &&
    typeof p.opens === 'string' &&
    SAFE_ID.test(p.opens)
      ? invoker(domId(p.opens), p.command)
      : nativeCommand(w, ctx)
  if (cmd) return real(cmd)
  // A button that changes a state or scrolls is a real button, so the keyboard reaches it and a screen reader announces it.
  if (
    !p.link &&
    (Array.isArray(w.on) ? w.on : []).some(
      t => isObj(t) && t.on === 'click' && isObj(t.do) && !('goTo' in t.do),
    )
  )
    return real()
  // A form's ordinary button submits it, which an `a` can't.
  if (parent === 'form')
    return el('button', { ...attrs, type: 'submit', disabled }, label)
  const link =
    p.link && typeof p.link === 'object'
      ? href(p.link as Link, ctx.doc, ctx.links)
      : undefined
  // `{address}` in a mailto link is where the shared page's address would go; `Links` has no origin, so it is empty (REFERENCE.md)
  const to = link?.startsWith('mailto:') ? link.replace('{address}', '') : link
  // A button in a list row that links to the open page (a repeated row's id has a `~`) marks it, so its `current` layer can dress it, as a menu entry does.
  const here =
    to && w.id.includes('~') && ctx.current !== undefined
      ? ctx.doc.pages.find(pg => pg.id === ctx.current)
      : undefined
  const mail = linkProps(to, ctx.mail, name)
  return el(
    'a',
    {
      ...attrs,
      ...mail.props,
      download: p.download ? '' : undefined,
      'aria-current':
        here && to === ctx.links.page(here.slug) ? 'page' : undefined,
    },
    mail.text !== undefined && mail.text !== name
      ? [...shapes, mail.text]
      : label,
  )
}
