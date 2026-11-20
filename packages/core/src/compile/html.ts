export type Raw = {
  kind: 'style' | 'json' | 'script' | 'icon'
  content: string
}
export type HtmlNode = {
  tag: string
  attrs?: Record<string, string | number | boolean | undefined>
  children?: (HtmlNode | string)[]
  raw?: Raw
}

export const VOID: ReadonlySet<string> = new Set(
  'area base br col embed hr img input link meta source track wbr'.split(' '),
)

const ENTITIES: Record<string, string> = {
  '"': '&quot;',
  "'": '&#39;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

// ponytail: regex replace; vuejs/core's charCode loop (shared/src/escapeHtml.ts) if a profile shows this hot
export function escapeHtml(s: string): string {
  return s.replace(/["'&<>]/g, c => ENTITIES[c]!)
}

const TAG = /^[a-z][a-z0-9-]*$/
const NAME = /^[a-zA-Z][a-zA-Z0-9:-]*$/
const RAW_TAG = {
  style: 'style',
  json: 'script',
  script: 'script',
  icon: 'svg',
}
const JSON_CHARS = new RegExp('[<>&\\u2028\\u2029]', 'g')
const JSON_UNSAFE: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

// Throws on input only Culm's own code can produce wrongly; documents never reach these checks.
export function writeHtml(el: HtmlNode | string): string {
  if (typeof el === 'string') return escapeHtml(el)
  const { tag, attrs, children, raw } = el
  if (typeof tag !== 'string' || !TAG.test(tag))
    throw new Error(`Invalid tag name: ${tag}`)
  let open = `<${tag}`
  for (const [name, v] of Object.entries(attrs ?? {})) {
    if (!NAME.test(name) || /^on/i.test(name))
      throw new Error(`Invalid attribute name: ${name}`)
    if (v === true) open += ` ${name}`
    else if (v !== false && v !== undefined)
      open += ` ${name}="${escapeHtml(String(v))}"`
  }
  open += '>'
  if (VOID.has(tag)) {
    if (children?.length || raw) throw new Error(`<${tag}> is void`)
    return open
  }
  if (raw) {
    if (RAW_TAG[raw.kind] !== tag || children?.length)
      throw new Error(`Raw ${raw.kind} does not fit <${tag}>`)
    const body =
      raw.kind === 'json'
        ? raw.content.replace(JSON_CHARS, c => JSON_UNSAFE[c]!)
        : raw.content
    if (raw.kind !== 'icon' && body.toLowerCase().includes(`</${tag}`))
      throw new Error(`Raw ${raw.kind} closes its <${tag}>`)
    return `${open}${body}</${tag}>`
  }
  if (tag === 'script' || tag === 'style')
    throw new Error(`<${tag}> needs raw content`)
  for (const c of children ?? [])
    if (typeof c !== 'string' && (typeof c !== 'object' || c === null))
      throw new Error('A child must be a string or an element')
  return `${open}${(children ?? []).map(writeHtml).join('')}</${tag}>`
}
