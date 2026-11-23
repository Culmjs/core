/** A fetched icon: 'set:name' -> the text of its .svg file in the site's folder. */
export type SiteIcons = Record<string, string>

export const ICON_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/
/** The Iconify licences a site may hold (SPDX ids). */
export const ICON_LICENCES: readonly string[] = [
  'MIT',
  'Apache-2.0',
  'ISC',
  'CC-BY-3.0',
  'CC-BY-4.0',
]

const MAX = 20000
const ELEMENTS = new Set([
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
])
const ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'fill-rule',
  'clip-rule',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
])
const VALUE = /^[-0-9.,eE a-zA-Z%()#]*$/
const VIEWBOX = /^-?[0-9.]+ -?[0-9.]+ [0-9.]+ [0-9.]+$/
const HEAD = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="([^"]*)">/
const TAG = /^<(\/?)([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*(\/?)>/
const ATTR = /\s+([a-z-]+)="([^"]*)"/g

/**
 * Reads an svg file as Culm draws it: the viewBox and a body written again from its tokens. Only the elements and attributes above
 * pass, and a fill or stroke is `currentColor` or `none`; anything else (a script, a handler, a link, a url(), a colour, text, a
 * comment) gives undefined, so nothing unparsed reaches a page.
 */
export function siteIcon(
  svg: string,
): { viewBox: string; body: string } | undefined {
  if (typeof svg !== 'string' || svg.length > MAX) return undefined
  const s = svg.trim()
  const head = HEAD.exec(s)
  if (!head || !VIEWBOX.test(head[1]!) || !s.endsWith('</svg>'))
    return undefined
  let rest = s.slice(head[0].length, s.length - '</svg>'.length)
  let body = ''
  const open: string[] = []
  for (;;) {
    rest = rest.trimStart()
    if (!rest) break
    const m = TAG.exec(rest)
    if (!m) return undefined
    rest = rest.slice(m[0].length)
    const [, closing, tag, attrText, self] = m as unknown as [
      string,
      string,
      string,
      string,
      string,
    ]
    if (!ELEMENTS.has(tag)) return undefined
    if (closing) {
      if (attrText || self || open.pop() !== tag) return undefined
      body += `</${tag}>`
      continue
    }
    if (open.length && open[open.length - 1] !== 'g') return undefined
    const seen = new Set<string>()
    let out = ''
    for (const [, k, v] of attrText.matchAll(ATTR)) {
      if (!ATTRS.has(k!) || seen.has(k!) || !VALUE.test(v!)) return undefined
      if (/url\s*\(/i.test(v!)) return undefined
      if (
        (k === 'fill' || k === 'stroke') &&
        v !== 'currentColor' &&
        v !== 'none'
      )
        return undefined
      seen.add(k!)
      out += ` ${k}="${v}"`
    }
    if (self) body += `<${tag}${out}/>`
    else {
      body += `<${tag}${out}>`
      open.push(tag)
    }
  }
  // a `<path ...></path>` pair, written again as one self-closing tag; `g` keeps its pair
  body = body.replace(/<(?!g\b)([a-z]+)((?: [^<>]*)?)><\/\1>/g, '<$1$2/>')
  if (open.length || !body) return undefined
  return { viewBox: head[1]!, body }
}
