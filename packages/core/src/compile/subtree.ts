import { find, type Problem, type SiteDocument } from '../document/index.ts'
import { BASE_CSS } from '../style/baseCss.ts'
import { fontFaceCss } from '../style/fonts.ts'
import { writeHtml, type HtmlNode } from './html.ts'
import {
  cutProblems,
  failed,
  fontsOf,
  prepare,
  refusals,
  siteElement,
  type CompileOptions,
} from './page.ts'

const refused = (problems: Problem[]) => ({ ok: false as const, problems })

/** The topmost elements drawn for a stored node: its id, or its id with a `~n` per repeat, in document order. */
function elementsFor(e: HtmlNode | string, id: string, out: HtmlNode[] = []) {
  if (typeof e === 'string') return out
  const at = e.attrs?.['data-id']
  if (typeof at === 'string' && (at === id || at.startsWith(`${id}~`)))
    out.push(e)
  else for (const c of e.children ?? []) elementsFor(c, id, out)
  return out
}

function classesOf(e: HtmlNode | string, into = new Set<string>()) {
  if (typeof e === 'string') return into
  const c = e.attrs?.class
  if (typeof c === 'string') for (const x of c.split(' ')) if (x) into.add(x)
  for (const k of e.children ?? []) classesOf(k, into)
  return into
}

/** Splits the top-level rules of a stylesheet, reading through quoted strings; an at-rule with a block keeps its inner rules apart. */
function ruleList(css: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = []
  let depth = 0
  let start = 0
  let open = 0
  let quote = ''
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') {
      if (depth++ === 0) open = i
    } else if (ch === '}' && --depth === 0) {
      out.push({ head: css.slice(start, open), body: css.slice(open + 1, i) })
      start = i + 1
    }
  }
  return out
}

/** True when `text` names `name` as a whole word, so `s-a-c1` does not find `s-a-c10`. */
const mentions = (text: string, name: string) =>
  new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text)

/**
 * The rules of a sheet that name one of `used` (`named`) or that name none of them, in the order given, with the at-rules around them kept.
 * Named: an `@keyframes` is kept, in the block it was written in, when the rules kept name it, so an appearAfter block still plays.
 * Not named: the rules for the page as a whole, and every `@keyframes`. A block with nothing left is dropped.
 */
function split(css: string, used: Set<string>, named: boolean): string {
  const classes = [...used].map(c => `.${c}`)
  const hits = (sel: string) =>
    classes.some(n => {
      for (let i = sel.indexOf(n); i >= 0; i = sel.indexOf(n, i + 1))
        if (!/[\w-]/.test(sel[i + n.length] ?? '')) return true
      return false
    })
  /** `frames` is the text of the rules already kept: named keyframes are written only when it is given. */
  const pass = (sheet: string, frames?: string): string =>
    ruleList(sheet)
      .map(({ head, body }) => {
        if (head.startsWith('@media') || head.startsWith('@supports'))
          return pass(body) && `${head}{${pass(body, frames)}}`
        const frame = /^@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(head)
        if (frame)
          return !named || (frames !== undefined && mentions(frames, frame[1]))
            ? `${head}{${body}}`
            : ''
        if (head.startsWith('@')) return named ? '' : `${head}{${body}}`
        return hits(head) === named ? `${head}{${body}}` : ''
      })
      .join('')
  const rules = pass(css)
  return named && css.includes('keyframes') ? pass(css, rules) : rules
}

/**
 * The CSS the page needs whatever node changed, as `compilePage` writes it: the font faces, the base rules, the look, and the rules of the
 * stylesheet that name no node class (a tooltip, the reduced-motion rule, keyframes). In the page's own order, so it equals `compilePage`'s
 * CSS without the rules for node classes.
 */
function pageWideCss(doc: SiteDocument, p: ReturnType<typeof prepare>): string {
  // `compileStyles` writes the look first and the rules last: the look is what comes before them
  if (!p.css.endsWith(p.rules))
    throw new Error('the page css does not end with its rules')
  const look = p.css.slice(0, p.css.length - p.rules.length)
  return (
    fontFaceCss(fontsOf(doc, p.shell), p.fontBase) +
    BASE_CSS +
    look +
    split(p.rules, new Set(p.classOf.values()), false)
  )
}

export type CompiledSubtree =
  | {
      ok: true
      html: string
      css: string
      pageCss: string
      /** Holds the element-limit problem when the page was cut, as `compilePage` reports it. */
      problems: Problem[]
    }
  | { ok: false; problems: Problem[] }

/**
 * One node of the page, the header or the footer as stored, for the editor: its HTML in edit mode and the CSS for the classes it uses.
 * The whole page is compiled as `compilePage` does in edit mode, so the node has its real parent (a list item is an `li`, a child of a free
 * area keeps its place). Its classes are prefixed with the node id, so they cannot meet another subtree's. A node inside a list or table
 * template is drawn once per row; all of them come back, in order.
 * `pageCss` is the part of the page's CSS that no node class owns (see `pageWideCss`): an edit can change it, for example by naming a font
 * the page did not use or by adding its first tooltip. An editor keeps the `compilePage` sheet as it is, a second style element after it
 * that holds the latest `pageCss` (its text replaced when `pageCss` differs), and one style element per swapped subtree. `pageCss` repeats
 * rules the first sheet already has, and the keyframes that are also in the node's own `css`. Both repeats are harmless.
 */
// ponytail: compiles the whole page; compile only the chain of ancestors when an editor's profile shows the need
export function compileSubtree(
  doc: SiteDocument,
  pageId: string,
  nodeId: string,
  options: CompileOptions,
): CompiledSubtree {
  try {
    const problems = refusals(doc, options)
    if (problems.length) return refused(problems)
    const page = doc.pages.find(p => p.id === pageId)
    if (!page)
      return refused([
        {
          code: 'INVALID_DOCUMENT',
          message: `There is no page "${pageId}".`,
          path: 'pages',
        },
      ])
    if (![page.root, doc.header, doc.footer].some(root => find(root, nodeId)))
      return refused([
        {
          code: 'INVALID_NODE',
          message: `Page "${pageId}", its header and its footer have no node "${nodeId}".`,
          nodeId,
        },
      ])
    const p = prepare(
      doc,
      [page.root, doc.header, doc.footer],
      { ...options, mode: 'edit' },
      nodeId,
    )
    const found = elementsFor(
      siteElement(doc, page, p, { used: false }),
      nodeId,
    )
    const used = new Set<string>()
    for (const e of found) classesOf(e, used)
    return {
      ok: true,
      html: found.map(writeHtml).join(''),
      css: split(p.rules, used, true),
      pageCss: pageWideCss(doc, p),
      problems: cutProblems(p.over),
    }
  } catch (e) {
    return refused(failed(pageId, e))
  }
}
