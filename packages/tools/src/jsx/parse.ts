// A hand-written parser for the JSX subset of `write`. It reads text and builds plain data: no eval, no `new Function`, no identifiers.
// The only values are literals: strings, numbers, true, false, null, arrays and objects of them.

export type Loc = { line: number; col: number }
export type Attr = { value: unknown; at: Loc }
export type El = {
  name: string
  sourcePath?: string
  at: Loc
  attrs: Map<string, Attr>
  /** The text between the tags (raw pieces collapsed, `{"..."}` pieces as written); undefined when there is none. */
  text?: string
  /** Words with line breaks or marks (<b>, <a href>): runs of a Text. Set instead of `text` when a <br /> or a mark is there. */
  parts?: Part[]
  children: El[]
}
/** A piece of a Text's words: plain, or marked (style and link, as a core run holds them), or a line break. */
export type Part =
  | {
      text: string
      style?: Record<string, unknown>
      link?: Record<string, string>
    }
  | { br: true }
type Marks = { style?: Record<string, unknown>; link?: Record<string, string> }
/** The marks a Text may hold between its words, and the style each one stands for. */
const INLINE: Record<string, Record<string, unknown>> = {
  b: { weight: 700 },
  strong: { weight: 700 },
  i: { italic: true },
  em: { italic: true },
  u: { underline: true },
  s: { strike: true },
  span: {},
  a: {},
}
/** An `href` as a core link: `/about` a page, `mailto:` an email, anything else a web address. */
export const linkOf = (h: string): Record<string, string> =>
  /^mailto:[^?]+$/i.test(h)
    ? { email: h.slice(7) }
    : /^[^@\s:/?#]+@[^@\s:/?#]+$/.test(h)
      ? { email: h }
      : /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(h)
        ? { page: h }
        : { url: h }

export class JsxError extends Error {
  constructor(
    message: string,
    readonly at: Loc,
    /** The element path the error belongs to, when known (set by the tree builder). */
    readonly path?: string,
  ) {
    super(message)
  }
}

export const MAX_JSX_CHARS = 400_000
const MAX_VALUE_DEPTH = 24
export const MAX_EL_DEPTH = 40
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype'])
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
}
const ESC: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '/': '/',
  '\\': '\\',
  '"': '"',
  "'": "'",
  '`': '`',
}

export function parseJsx(src: string): El[] {
  if (src.length > MAX_JSX_CHARS)
    throw new JsxError(`The JSX is over ${MAX_JSX_CHARS} characters.`, {
      line: 1,
      col: 1,
    })
  let i = 0
  const loc = (at = i): Loc => {
    let line = 1
    let col = 1
    for (let k = 0; k < at && k < src.length; k++)
      if (src[k] === '\n') {
        line++
        col = 1
      } else col++
    return { line, col }
  }
  const fail = (message: string, at = i): never => {
    throw new JsxError(message, loc(at))
  }
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++
      if (src.startsWith('/*', i)) {
        const e = src.indexOf('*/', i + 2)
        if (e < 0) fail('A comment is not closed.')
        i = e + 2
      } else return
    }
  }
  const ident = () =>
    /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i, i + 80))?.[0]

  function str(): string {
    const q = src[i]!
    const start = i
    i++
    let out = ''
    for (;;) {
      if (i >= src.length) fail('A string is not closed.', start)
      const c = src[i]!
      if (c === q) {
        i++
        return out
      }
      if (q === '`' && c === '$' && src[i + 1] === '{')
        fail('Template strings with ${ are not allowed; write a plain string.')
      if (c === '\\') {
        const n = src[i + 1] ?? ''
        if (n === 'u') {
          const h = src.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('Bad \\u escape.')
          out += String.fromCharCode(parseInt(h, 16))
          i += 6
        } else if (n in ESC) {
          out += ESC[n]
          i += 2
        } else fail(`Unknown escape \\${n}.`)
      } else if (c === '\n' && q !== '`')
        fail('A string cannot run over a line; use \\n.', start)
      else {
        out += c
        i++
      }
    }
  }

  function value(depth = 0): unknown {
    if (depth > MAX_VALUE_DEPTH) fail('The value is nested too deep.')
    ws()
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') return str()
    if (c === '[') {
      i++
      const out: unknown[] = []
      for (;;) {
        ws()
        if (src[i] === ']') {
          i++
          return out
        }
        if (src.startsWith('...', i))
          fail('Spread is not allowed; write the values out.')
        out.push(value(depth + 1))
        ws()
        if (src[i] === ',') i++
        else if (src[i] !== ']') fail('Expected "," or "]".')
      }
    }
    if (c === '{') {
      i++
      const out = Object.create(null) as Record<string, unknown>
      for (;;) {
        ws()
        if (src[i] === '}') {
          i++
          return { ...out }
        }
        if (src.startsWith('...', i))
          fail('Spread is not allowed; write the values out.')
        const at = i
        let key: string
        if (src[i] === '"' || src[i] === "'") key = str()
        else if (src[i] === '[') return fail('Computed keys are not allowed.')
        else {
          const m = /^(?:[A-Za-z_$][A-Za-z0-9_$]*|-?\d+)/.exec(
            src.slice(i, i + 80),
          )
          if (!m) return fail('Expected a property name.')
          key = m[0]
          i += key.length
        }
        if (UNSAFE.has(key)) fail(`"${key}" is not an allowed key.`, at)
        ws()
        if (src[i] !== ':')
          fail(
            src[i] === ',' || src[i] === '}'
              ? `"${key}" has no value; identifiers and shorthand are not allowed, only literals.`
              : src[i] === '('
                ? 'Methods are not allowed.'
                : 'Expected ":".',
          )
        i++
        out[key] = value(depth + 1)
        ws()
        if (src[i] === ',') i++
        else if (src[i] !== '}') fail('Expected "," or "}".')
      }
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      src.slice(i, i + 40),
    )
    if (num) {
      i += num[0].length
      return Number(num[0])
    }
    const id = ident()
    if (id) {
      if (id === 'true' || id === 'false' || id === 'null') {
        i += id.length
        return id === 'null' ? null : id === 'true'
      }
      const after = src.slice(i + id.length).match(/^\s*(.)/)?.[1]
      fail(
        after === '('
          ? `"${id}(...)" is a call; calls are not allowed, only literals.`
          : `"${id}" is an identifier; only literals are allowed (strings, numbers, true, false, null, arrays, objects).`,
      )
    }
    if (c === '(' || c === '<' || c === '+' || c === '!' || c === '`')
      fail(
        `An expression starting with "${c}" is not allowed; write a literal.`,
      )
    return fail(
      c === undefined ? 'The JSX ends too soon.' : `Unexpected "${c}".`,
    )
  }

  function attrs(): Map<string, Attr> {
    const out = new Map<string, Attr>()
    for (;;) {
      ws()
      if (src[i] === '/' || src[i] === '>') return out
      if (src.startsWith('{...', i) || src.startsWith('{ ...', i))
        fail('Spread is not allowed; write each attribute out.')
      const at = i
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 80))
      if (!m) return fail(`Unexpected "${src[i] ?? 'end'}" in a tag.`)
      const name = m[0]
      i += name.length
      if (out.has(name)) fail(`"${name}" is given twice.`, at)
      let v: unknown = true
      if (src[i] === '=') {
        i++
        if (src[i] === '{') {
          i++
          v = value()
          ws()
          if (src[i] !== '}') fail('Expected "}" after the value.')
          i++
        } else if (src[i] === '"' || src[i] === "'") v = str()
        else fail('An attribute value is a string or {a literal}.')
      }
      out.set(name, { value: v, at: loc(at) })
    }
  }

  function element(depth: number): El {
    if (depth > MAX_EL_DEPTH) fail('The elements are nested too deep.')
    const start = i
    i++ // <
    const m = /^[A-Z][A-Za-z0-9]*/.exec(src.slice(i, i + 40))
    if (!m)
      return fail(
        src[i] === '>' || src[i] === '/'
          ? 'Fragments are not allowed; use a Column.'
          : 'An element name is PascalCase (Row, Text, Button).',
      )
    const name = m[0]
    i += name.length
    const el: El = { name, at: loc(start), attrs: attrs(), children: [] }
    if (src[i] === '/') {
      if (src[i + 1] !== '>') fail('Expected "/>".')
      i += 2
      return el
    }
    i++ // >
    const pieces: {
      text: string
      raw: boolean
      br?: true
      marks?: Marks
    }[] = []
    // the words between <tag> and </tag>; inside a mark (b, i, a ...) only more marks, words and breaks may stand
    const body = (tag: string, marks: Marks | undefined, depth2: number) => {
      for (;;) {
        if (i >= src.length) fail(`<${tag}> is not closed.`, start)
        const c = src[i]!
        if (c === '<') {
          const br = /^<br\s*\/?>/.exec(src.slice(i, i + 12))
          if (br) {
            i += br[0].length
            pieces.push({ text: '', raw: false, br: true })
          } else if (src[i + 1] === '/') {
            const close = new RegExp(`^</${tag}\\s*>`).exec(
              src.slice(i, i + 60),
            )
            if (!close) fail(`Expected </${tag}>.`)
            i += close![0].length
            return
          } else if (/[a-z]/.test(src[i + 1] ?? '')) {
            if (depth2 > 8) fail('The marks are nested too deep.')
            const at = i
            i++
            const nm = /^[a-z][a-z0-9]*/.exec(src.slice(i, i + 20))![0]
            i += nm.length
            if (!Object.hasOwn(INLINE, nm))
              fail(
                `<${nm}> is not a mark. Marks inside a Text: ${Object.keys(INLINE).join(', ')}.`,
                at,
              )
            const as = attrs()
            let style: Record<string, unknown> | undefined
            let link: Record<string, string> | undefined
            for (const [k, v] of as) {
              if (
                k === 'style' &&
                v.value &&
                typeof v.value === 'object' &&
                !Array.isArray(v.value)
              )
                style = v.value as Record<string, unknown>
              else if (
                k === 'href' &&
                nm === 'a' &&
                typeof v.value === 'string'
              )
                link = linkOf(v.value)
              else
                fail(
                  nm === 'a'
                    ? `<a> takes href="..." and style={{...}}; "${k}" is not one.`
                    : `<${nm}> takes style={{...}}; "${k}" is not one.`,
                  at,
                )
            }
            if (nm === 'a' && !link) fail('<a> needs href="...".', at)
            if (src[i] === '/')
              fail(`<${nm}> holds words; write <${nm}>...</${nm}>.`, at)
            i++ // >
            const m: Marks = {
              style: { ...marks?.style, ...INLINE[nm], ...style },
              link: link ?? marks?.link,
            }
            if (!Object.keys(m.style!).length) delete m.style
            if (!m.link) delete m.link
            body(nm, m, depth2 + 1)
          } else if (tag !== name || marks)
            fail('A mark holds words, not elements; close it first.')
          else el.children.push(element(depth + 1))
        } else if (c === '{') {
          i++
          ws()
          if (src[i] === '}') {
            i++
            continue
          }
          const v = value()
          ws()
          if (src[i] !== '}') fail('Expected "}" after the value.')
          i++
          if (typeof v === 'string') pieces.push({ text: v, raw: false, marks })
          else if (typeof v === 'number')
            pieces.push({ text: String(v), raw: false, marks })
          else fail('Only a string or a number may stand between tags.', i)
        } else {
          const s = i
          while (i < src.length && src[i] !== '<' && src[i] !== '{') i++
          const raw = src
            .slice(s, i)
            .replace(/&(#?\w+);/g, (a, e: string) => ENTITIES[e] ?? a)
          pieces.push({ text: raw.replace(/\s+/g, ' '), raw: true, marks })
        }
      }
    }
    body(name, undefined, 0)
    if (pieces.some(p => p.br || p.marks)) {
      // words with line breaks or marks: spaces next to a break or the ends go, as in a browser
      const parts: Part[] = []
      pieces.forEach((p, k) => {
        if (p.br) return void parts.push({ br: true })
        let t = p.text
        if (p.raw && (k === 0 || pieces[k - 1]!.br)) t = t.trimStart()
        if (p.raw && (k === pieces.length - 1 || pieces[k + 1]!.br))
          t = t.trimEnd()
        if (t !== '')
          parts.push({
            text: t,
            ...(p.marks?.style ? { style: p.marks.style } : {}),
            ...(p.marks?.link ? { link: p.marks.link } : {}),
          })
      })
      el.parts = parts
      return el
    }
    const joined = pieces.map(p => p.text).join('')
    const text = pieces.some(p => !p.raw) ? joined : joined.trim()
    if (text !== '') el.text = text
    return el
  }

  const out: El[] = []
  for (;;) {
    ws()
    if (i >= src.length) return out
    if (src[i] !== '<')
      fail(
        'Write elements only: <Row>...</Row>. Text and expressions go inside one.',
      )
    out.push(element(0))
  }
}
