import { parseDocument } from 'htmlparser2'
import { createHash } from 'node:crypto'
import postcss, { type Container, type Declaration } from 'postcss'
import {
  JsxError,
  linkOf,
  MAX_EL_DEPTH,
  type El,
  type Loc,
  type Part,
} from './parse.ts'
import type { Warning } from './normalise.ts'
import { ID_RE } from '../shared.ts'
import { layoutDecl } from './css-layout.ts'

type Child = ReturnType<typeof parseDocument>['children'][number]
type Tag = Extract<Child, { attribs: unknown }>
type Decl = Record<string, string>
const tag = (c: Child): c is Tag => 'attribs' in c
const text = (c: Child) => (c.type === 'text' ? c.data : '')
const mark: Record<string, Record<string, unknown>> = {
  span: {},
  a: {},
  b: { weight: 700 },
  strong: { weight: 700 },
  i: { italic: true },
  em: { italic: true },
  u: { underline: true },
  s: { strike: true },
}
const element = (
  name: string,
  at: Loc,
  props: Record<string, unknown> = {},
  children: El[] = [],
): El => ({
  name,
  at,
  children,
  attrs: new Map(Object.entries(props).map(([k, value]) => [k, { at, value }])),
})

/** CSS is resolved against this fragment at write time, never forwarded to the compiler as raw code. */
export function htmlElements(
  src: string,
  css: string | undefined,
  errors: JsxError[],
  warnings: Warning[],
): El[] {
  const doc = parseDocument(src, {
    withStartIndices: true,
    recognizeSelfClosing: true,
  })
  const document = doc.children.find(c => tag(c) && c.name === 'html')
  // A fragment is still painted inside html/body in a browser. Give CSS
  // those ancestors for matching and inheritance, without inserting two
  // wrapper nodes (section ids, source locations and page structure stay put).
  let canvas: Tag | undefined
  if (!document) {
    const virtual = parseDocument('<html><body></body></html>').children[0]
    if (virtual && tag(virtual)) {
      const b = virtual.children[0]
      if (b && tag(b)) {
        canvas = b
        b.children = doc.children
        for (const c of b.children) c.parent = b
      }
    }
  }
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  function loc(c: Child): Loc {
    const pos = c.startIndex ?? 0
    let lo = 0,
      hi = starts.length
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1
      if (starts[mid]! <= pos) lo = mid
      else hi = mid
    }
    return { line: lo + 1, col: pos - starts[lo]! + 1 }
  }
  const bad = (m: string, at: Loc, path = 'html') =>
    errors.push(new JsxError(m, at, path))
  const warn = (m: string, at: Loc) =>
    warnings.push({
      message: m,
      jsx: { path: 'html', line: at.line, column: at.col },
    })
  type Rule = {
    parts: string[][]
    rank: number
    layer: string
    decls: Declaration[]
  }
  const rules: Rule[] = []
  const parseCss = (s: string, at: Loc) => {
    try {
      return postcss.parse(s, { from: undefined })
    } catch (e) {
      if (e instanceof postcss.CssSyntaxError) {
        bad(
          e.reason,
          { line: at.line + (e.line ?? 1) - 1, col: e.column ?? 1 },
          'css',
        )
        return
      }
      throw e
    }
  }
  const decls = (r: Container, at: Loc) =>
    (r.nodes ?? []).flatMap(n => {
      if (n.type === 'decl') return [n]
      if (n.type !== 'comment')
        bad('Expected CSS declarations here.', at, 'css')
      return []
    })
  function sheet(r: Container, at: Loc, layer = 'style') {
    for (const n of r.nodes ?? []) {
      if (n.type === 'comment') continue
      if (n.type === 'atrule' && n.name === 'media' && layer === 'style') {
        const width = /^\(\s*max-width\s*:\s*(\d+)px\s*\)$/i.exec(n.params)
        if (width) {
          const phone = +width[1]! <= 768,
            px = phone ? 600 : 1024
          if (px !== +width[1]!)
            warn(`@media ${n.params} uses the ${px}px layout breakpoint.`, at)
          sheet(n, at, phone ? 'phone' : 'tablet')
          continue
        }
      }
      if (n.type !== 'rule') {
        bad(
          `Unsupported CSS rule ${n.type === 'atrule' ? '@' + n.name : n.type}. Use selectors or @media (max-width: …px).`,
          at,
          'css',
        )
        continue
      }
      const ds = decls(n, at)
      for (const selector of n.selectors) {
        const parts = selector.trim().split(/\s+/)
        if (
          !parts.every(
            s => s && /^(?:[a-z][\w-]*|\*)?(?:[.#][\w-]+)*$/i.test(s),
          )
        ) {
          bad(
            `Unsupported selector "${selector}". Use tags, .classes, #ids, compounds or descendants.`,
            at,
            'css',
          )
          continue
        }
        rules.push({
          parts: parts.map(s => s.match(/[.#][\w-]+|^[\w*-]+/g)!),
          rank:
            (selector.match(/#/g)?.length ?? 0) * 10000 +
            (selector.match(/\./g)?.length ?? 0) * 100 +
            parts.filter(s => /^[a-z]/i.test(s)).length,
          layer,
          decls: ds,
        })
      }
    }
  }
  const tags: Tag[] = []
  function scan(nodes: Child[], depth: number) {
    if (depth > MAX_EL_DEPTH)
      throw new JsxError(
        'HTML is nested too deep.',
        loc(nodes[0] ?? doc),
        'html',
      )
    for (const c of nodes)
      if (tag(c)) {
        tags.push(c)
        if (c.name === 'style') {
          if (Object.keys(c.attribs).length)
            bad('Use a plain <style> with media rules inside.', loc(c))
          const r = parseCss(c.children.map(text).join(''), loc(c))
          if (r) sheet(r, loc(c))
        } else scan(c.children, depth + 1)
      }
  }
  scan(doc.children, 0)
  if (css) {
    const r = parseCss(css, { line: 1, col: 1 })
    if (r) sheet(r, { line: 1, col: 1 })
  }
  if (tags.length * Math.max(1, rules.length) > 2_000_000)
    throw new JsxError(
      'Stylesheet has too many element/selector combinations. Split the write by section.',
      { line: 1, col: 1 },
      'css',
    )
  type Cascaded = Map<
    string,
    { rank: number; value: string; inherited?: boolean }
  >
  const cascades = new WeakMap<Tag, Cascaded>()
  const cascade = (c: Tag): Cascaded => {
    const cached = cascades.get(c)
    if (cached) return cached
    const ds: Cascaded = new Map()
    const sides = ['top', 'right', 'bottom', 'left']
    const add = (layer: string, rank: number, d: Declaration) => {
      if (['__proto__', 'prototype', 'constructor'].includes(d.prop)) {
        bad('Invalid CSS property.', loc(c), 'css')
        return
      }
      rank += d.important ? 1e9 : 0
      let declarations = [[d.prop, d.value]]
      if (d.prop === 'box-sizing' && d.value === 'border-box') return // built into every Culm page
      if (d.prop === 'margin' || d.prop === 'padding') {
        const v = d.value.trim().split(/\s+/)
        if (v.length <= 4 && !d.value.includes('(')) {
          const [top, right = top, bottom = top, left = right] = v
          declarations = sides.map((s, i) => [
            d.prop + '-' + s,
            [top, right, bottom, left][i]!,
          ])
        }
      }
      for (const l of layer === 'style'
        ? ['style', 'tablet', 'phone']
        : layer === 'tablet'
          ? ['tablet', 'phone']
          : ['phone']) {
        for (const [prop, value] of declarations) {
          const key = l + ':' + prop
          if ((ds.get(key)?.rank ?? -1) <= rank)
            ds.set(key, { rank, value: value! })
        }
      }
    }
    const matches = (t: Tag, parts: string[]) =>
      parts.every(s =>
        s[0] === '#'
          ? t.attribs.id === s.slice(1)
          : s[0] === '.'
            ? t.attribs.class?.split(/\s+/).includes(s.slice(1))
            : s === '*' || s.toLowerCase() === t.name,
      )
    for (const r of rules) {
      let i = r.parts.length - 1
      if (!matches(c, r.parts[i]!)) continue
      for (let p = c.parent; --i >= 0;) {
        while (p && !(tag(p) && matches(p, r.parts[i]!))) p = p.parent
        if (!p) break
        p = p.parent
      }
      if (i < 0) for (const d of r.decls) add(r.layer, r.rank, d)
    }
    if (c.attribs.style) {
      const r = parseCss(c.attribs.style, loc(c))
      if (r) for (const d of decls(r, loc(c))) add('style', 1e7, d)
    }
    if (c.parent && tag(c.parent)) {
      const parent = cascade(c.parent)
      for (const l of ['style', 'tablet', 'phone']) {
        // Unlike Culm headings and links, ordinary HTML inherits its font
        // family and text colour. Materialize the resolved values, including
        // across a CSS grid that has no native foreground style of its own.
        for (const k of ['color', 'font-family']) {
          const key = `${l}:${k}`,
            inherited = parent.get(key)
          if (inherited && (!ds.has(key) || ds.get(key)?.value === 'inherit'))
            ds.set(key, { ...inherited, inherited: !ds.has(key) })
        }
        if (
          c.parent === canvas &&
          !['background', 'background-color'].some(k => ds.has(`${l}:${k}`))
        ) {
          for (const k of ['background', 'background-color']) {
            const key = `${l}:${k}`,
              back = parent.get(key)
            if (back) ds.set(key, back)
          }
        }
      }
    }
    for (const l of ['style', 'tablet', 'phone'])
      for (const k of ['padding', 'margin']) {
        const vals = sides.map(s => ds.get(`${l}:${k}-${s}`))
        if (vals.some(Boolean) && !ds.has(`${l}:${k}`)) {
          ds.set(`${l}:${k}`, {
            rank: 0,
            value: vals.map(v => v?.value ?? '0').join(' '),
          })
          sides.forEach(s => ds.delete(`${l}:${k}-${s}`))
        }
      }
    cascades.set(c, ds)
    return ds
  }
  const styles = (c: Tag) => {
    const ds = cascade(c)
    const layers: Record<string, Decl> = {}
    for (const [key, { value, inherited }] of ds) {
      const [l, k] = key.split(':') as [string, string]
      if (
        inherited &&
        c.parent !== canvas &&
        !(
          c.parent &&
          tag(c.parent) &&
          cascade(c.parent).get('style:display')?.value === 'grid'
        ) &&
        !(k === 'font-family' && /^h[1-6]$/.test(c.name))
      )
        continue
      if (
        l !== 'style' &&
        ds.get((l === 'phone' ? 'tablet' : 'style') + ':' + k)?.value === value
      )
        continue
      ;(layers[l] ??= Object.create(null) as Decl)[k] = value
    }
    return layers
  }
  // Node ids have a narrower alphabet than HTML. Keep links and stable edits
  // pointing at the same node across independent appends and target writes.
  const nodeId = (s: string) =>
    ID_RE.test(s)
      ? s
      : 'id' + createHash('sha256').update(s).digest('hex').slice(0, 16)
  const anchor = (s: string) =>
    linkOf(s.startsWith('#') && s.length > 1 ? '#' + nodeId(s.slice(1)) : s)
  const seenIds = new Set<string>()
  for (const t of tags) {
    const id = t.attribs.id
    if (!id) continue
    if (seenIds.has(nodeId(id))) bad(`Duplicate HTML id "${id}".`, loc(t))
    else if (id !== nodeId(id))
      warn(`HTML id "${id}" is stored as "${nodeId(id)}".`, loc(t))
    seenIds.add(nodeId(id))
  }
  function attrs(c: Tag, allowed: string[]) {
    for (const k of Object.keys(c.attribs))
      if (!['id', 'class', 'style', ...allowed].includes(k)) {
        if (/^on/i.test(k))
          bad(
            `Event attribute "${k}" cannot be compiled as static content.`,
            loc(c),
          )
        else warn(`<${c.name}> attribute "${k}" was not imported.`, loc(c))
      }
  }
  function runs(
    nodes: Child[],
    style: Record<string, unknown> = {},
    link?: Record<string, string>,
  ): Part[] {
    return nodes.flatMap((c): Part[] => {
      if (!tag(c))
        return c.type === 'text'
          ? [
              {
                text: c.data.replace(/\s+/g, ' '),
                ...(Object.keys(style).length ? { style } : {}),
                ...(link ? { link } : {}),
              },
            ]
          : []
      if (c.name === 'br') return [{ br: true }]
      if (!Object.hasOwn(mark, c.name)) {
        bad(`<${c.name}> cannot be placed inside paragraph text.`, loc(c))
        return []
      }
      attrs(c, c.name === 'a' ? ['href'] : [])
      const s = styles(c)
      if (s.phone || s.tablet || c.attribs.id)
        bad(
          'An inline mark cannot hold an id or responsive style. Put it on the paragraph.',
          loc(c),
        )
      return runs(
        c.children,
        { ...style, ...mark[c.name], ...s.style },
        c.name === 'a' && c.attribs.href ? anchor(c.attribs.href) : link,
      )
    })
  }
  const body = (nodes: Child[]): El[] =>
    nodes.flatMap((c): El[] => {
      if (!tag(c))
        return text(c).trim()
          ? [{ ...element('Text', loc(c)), text: text(c).trim() }]
          : []
      const n = c.name,
        at = loc(c)
      if (n === 'style') return []
      const ls = styles(c),
        base = ls.style ?? {}
      const p: Record<string, unknown> = {
        ...(c.attribs.id ? { id: nodeId(c.attribs.id) } : {}),
        ...ls,
      }
      if (
        /^h[1-6]$/.test(n) ||
        ['p', 'span', 'a', 'strong', 'em', 'b', 'i', 'u', 's'].includes(n)
      ) {
        attrs(c, n === 'a' ? ['href'] : [])
        for (const [l, d] of Object.entries(ls)) p[l] = layoutDecl(d)
        const el = element('Text', at, {
          ...p,
          level: n === 'p' || n[0] === 'h' ? n : 'span',
        })
        el.parts = runs(
          c.children,
          mark[n],
          n === 'a' && c.attribs.href ? anchor(c.attribs.href) : undefined,
        )
        return [el]
      }
      if (n === 'img' || n === 'hr' || n === 'button') {
        attrs(c, n === 'img' ? ['src', 'alt'] : [])
        for (const [l, d] of Object.entries(ls)) p[l] = layoutDecl(d)
        if (n === 'img')
          return [
            element('Image', at, {
              ...p,
              src: c.attribs.src,
              alt: c.attribs.alt ?? '',
            }),
          ]
        if (n === 'hr') return [element('Divider', at, p)]
        if (c.children.some(tag)) bad('A button takes a plain text label.', at)
        return [
          element('Button', at, {
            ...p,
            label: c.children.map(text).join('').trim(),
          }),
        ]
      }
      if (
        ![
          'section',
          'article',
          'aside',
          'main',
          'div',
          'nav',
          'header',
          'footer',
          'body',
          'ul',
          'ol',
          'li',
        ].includes(n)
      ) {
        bad(
          `Unsupported HTML element <${n}>. Use a semantic section, heading, paragraph, list, link, image or button.`,
          at,
        )
        return []
      }
      attrs(c, [])
      const display = base.display
      let kind =
        n === 'ul' || n === 'ol'
          ? 'List'
          : display === 'grid'
            ? 'Grid'
            : display === 'flex' || n === 'nav'
              ? 'Row'
              : 'Column'
      if (kind === 'Row' && base['flex-direction'] === 'column' && n !== 'nav')
        kind = 'Column'
      if (display && !['block', 'flex', 'grid'].includes(display))
        warn(`display:${display} on <${n}> uses ${kind} layout.`, at)
      if (display !== 'none') delete base.display
      for (const l of ['tablet', 'phone']) {
        const d = ls[l]
        if (
          d?.display === 'block' &&
          ['Row', 'Column', 'Grid'].includes(kind)
        ) {
          // Block flow on narrow screens: stack children and drop desktop flex/grid gaps.
          if (kind === 'Grid') p[`${l}Cols`] = 1
          else {
            d['flex-direction'] = 'column'
            d['align-items'] = 'stretch'
            d['justify-content'] = 'start'
          }
          d.gap = '0'
          delete d.display
        }
      }
      if (['section', 'article', 'aside'].includes(n) && kind === 'Column')
        p.as = n
      if (n === 'nav' && kind === 'Row') p.as = n
      if (kind === 'List') p.marker = n === 'ol' ? 'decimal' : 'disc'
      if (kind === 'Grid') {
        for (const [l, d] of Object.entries(ls)) {
          const v = d['grid-template-columns']
          if (!v) continue
          const m =
            /^repeat\(\s*(\d+)\s*,\s*(?:1fr|minmax\(\s*0\s*,\s*1fr\s*\))\s*\)$/i.exec(
              v,
            )
          const count = m
            ? Number(m[1])
            : /^(?:1fr\s+)*1fr$/.test(v)
              ? v.split(/\s+/).length
              : 0
          if (count) {
            p[l === 'style' ? 'cols' : `${l}Cols`] = count
            delete d['grid-template-columns']
          }
        }
      }
      for (const [l, d] of Object.entries(ls)) p[l] = layoutDecl(d)
      return [element(kind, at, p, body(c.children))]
    })
  if (document && tag(document)) {
    const h = document.children.find(c => tag(c) && c.name === 'head')
    const b = document.children.find(c => tag(c) && c.name === 'body')
    let title: string | undefined
    if (h && tag(h))
      for (const c of h.children)
        if (tag(c)) {
          if (c.name === 'title') title = c.children.map(text).join('')
          else if (!['meta', 'style'].includes(c.name))
            bad(
              `Unsupported <${c.name}> in <head>. Supply CSS in <style> or css.`,
              loc(c),
            )
        }
    if (!b || !tag(b)) {
      bad('An HTML document needs a body.', loc(document))
      return []
    }
    attrs(b, [])
    const part = (n: string) => b.children.filter(c => tag(c) && c.name === n)
    const content = b.children.filter(
      c => !(tag(c) && ['header', 'footer'].includes(c.name)),
    )
    const page = body(content),
      ls = styles(b)
    if (
      Object.keys(ls).length &&
      (part('header').length || part('footer').length)
    )
      warn(
        'Body styles apply to the page content; put shared header and footer styles on those elements.',
        loc(b),
      )
    return [
      element('Header', loc(b), {}, body(part('header'))),
      element('Footer', loc(b), {}, body(part('footer'))),
      element(
        'Page',
        loc(b),
        title ? { title } : {},
        Object.keys(ls).length ? [element('Column', loc(b), ls, page)] : page,
      ),
    ]
  }
  const fragment = body(doc.children)
  if (!fragment.length && (src.trim() || css?.trim()) && !errors.length)
    bad(
      'No HTML content to write. Include the elements styled by this stylesheet, or send an empty fragment to clear the tree.',
      { line: 1, col: 1 },
    )
  return fragment
}
