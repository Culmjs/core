import { ID_RE } from '../document/kinds.ts'
import { isObj } from '../document/rules.ts'
import type { Page, SiteDocument } from '../document/index.ts'
import { defaultSiteStyles } from '../style/index.ts'
import { nextIds } from './ids.ts'
import {
  bad,
  checkSafe,
  indexOk,
  isRefusal,
  lostRequired,
  merge,
  ref,
  requiredRefusal,
} from './nodes.ts'
import type { OpFn, OpResult } from './types.ts'

type Fields = Record<string, unknown>

const isStr = (v: unknown) => typeof v === 'string'
const isBool = (v: unknown) => typeof v === 'boolean'
const done = (doc: SiteDocument): OpResult => ({
  ok: true,
  doc,
  created: [],
  changed: [],
})

/** The refusal for the first of `fields` that is given and fails its check, else undefined. */
function checkTypes(
  o: Fields,
  fields: Record<string, (v: unknown) => boolean>,
) {
  for (const [k, ok] of Object.entries(fields))
    if (o[k] !== undefined && !ok(o[k]))
      return bad(`${k} has the wrong type.`, { path: k })
  return undefined
}

// A refusal about a page names it by `path: 'page'` and carries no `nodeId`: a page id is not a node id.
const pageOf = (doc: SiteDocument, o: Fields) =>
  doc.pages.find(p => p.id === o.page)

/** The page of the operation, or the refusal. */
function target(doc: SiteDocument, o: Fields) {
  const page = typeof o.page === 'string' ? pageOf(doc, o) : undefined
  return page ?? bad(`No page "${String(o.page)}".`, { path: 'page' })
}

const PAGE_FIELDS = {
  title: isStr,
  slug: isStr,
  on: isBool,
  inMenu: isBool,
  inFooter: isBool,
  icon: isStr,
}

export const addPage: OpFn<'addPage'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  for (const k of ['title', 'slug'])
    if (typeof o[k] !== 'string')
      return bad(`${k} must be a string.`, { path: k })
  const wrong = checkTypes(o, PAGE_FIELDS)
  if (wrong) return wrong
  let id = o.page
  if (id === undefined) {
    const used = new Set(doc.pages.map(p => p.id))
    let k = 1
    while (used.has(`p${k}`)) k++
    id = `p${k}`
  } else if (typeof id !== 'string' || !ID_RE.test(id))
    return bad('The page id must be 1 to 20 lowercase letters or digits.', {
      path: 'page',
    })
  else if (pageOf(doc, o))
    return bad(`The page id "${id}" is already used.`, { path: 'page' })
  const index = o.index === undefined ? doc.pages.length : o.index
  if (!indexOk(index, doc.pages.length))
    return bad(
      'The index must be a whole number from 0 to the number of pages.',
      {
        path: 'index',
      },
    )
  const rootId = nextIds(doc, { page: id as string }, 1)[0]
  const page: Page = {
    id: id as string,
    title: o.title as string,
    slug: o.slug as string,
    icon: (o.icon as string | undefined) ?? '',
    on: (o.on as boolean | undefined) ?? true,
    inMenu: (o.inMenu as boolean | undefined) ?? false,
    inFooter: (o.inFooter as boolean | undefined) ?? false,
    root: { id: rootId, kind: 'column', name: 'Page', slot: {} },
  }
  const pages = doc.pages.slice()
  pages.splice(index, 0, page)
  return {
    ...done({ ...doc, pages }),
    created: [ref({ page: page.id }, rootId)],
  }
}

export const removePage: OpFn<'removePage'> = (doc, _registry, op) => {
  const page = target(doc, op as unknown as Fields)
  if (isRefusal(page)) return page
  if (doc.pages.length === 1)
    return bad('The last page cannot be removed.', { path: 'page' })
  const result = { ...doc, pages: doc.pages.filter(p => p !== page) }
  const lost = lostRequired(doc, result)
  if (lost) return requiredRefusal(lost)
  return done(result)
}

export const setPage: OpFn<'setPage'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  const page = target(doc, o)
  if (isRefusal(page)) return page
  const given = Object.keys(PAGE_FIELDS).filter(k => o[k] !== undefined)
  if (!given.length)
    return bad(`Give at least one of ${Object.keys(PAGE_FIELDS).join(', ')}.`)
  const wrong = checkTypes(o, PAGE_FIELDS)
  if (wrong) return wrong
  const next = { ...page }
  for (const k of given) (next as Fields)[k] = o[k]
  return done({ ...doc, pages: doc.pages.map(p => (p === page ? next : p)) })
}

/** `index` is the place among the pages once this one is out of the list: 0 to the number of pages less one. */
export const movePage: OpFn<'movePage'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  const page = target(doc, o)
  if (isRefusal(page)) return page
  if (!indexOk(o.index, doc.pages.length - 1))
    return bad(
      'The index must be a whole number from 0 to the number of pages less one.',
      { path: 'index' },
    )
  const pages = doc.pages.filter(p => p !== page)
  pages.splice(o.index, 0, page)
  return done({ ...doc, pages })
}

export const setSite: OpFn<'setSite'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  if (o.name === undefined && o.languages === undefined)
    return bad('Give a name, languages, or both.')
  const wrong = checkTypes(o, { name: isStr, languages: Array.isArray })
  if (wrong) return wrong
  const unsafe = checkSafe(o, undefined, ['languages'])
  if (unsafe) return unsafe
  const next = { ...doc } as Fields
  if (o.name !== undefined) next.name = o.name
  if (o.languages !== undefined) next.languages = o.languages
  return done(next as SiteDocument)
}

export const setLook: OpFn<'setLook'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  if (!isObj(o.look)) return bad('look must be an object.', { path: 'look' })
  return (
    checkSafe(o, undefined, ['look']) ??
    done({ ...doc, look: o.look as SiteDocument['look'] })
  )
}

export const setFonts: OpFn<'setFonts'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  if (!Array.isArray(o.fonts))
    return bad('fonts must be a list.', { path: 'fonts' })
  return done({ ...doc, fonts: o.fonts as SiteDocument['fonts'] })
}

const STYLE_KEYS = ['colors', 'text', 'space', 'shadows', 'motion', 'textRange']
const OPTIONAL_STYLE_KEYS = ['motion', 'textRange']

export const setSiteStyles: OpFn<'setSiteStyles'> = (doc, _registry, op) => {
  const o = op as unknown as Fields
  if (!isObj(o.styles))
    return bad('styles must be an object.', { path: 'styles' })
  const unsafe = checkSafe(o, undefined, ['styles'])
  if (unsafe) return unsafe
  const entries = Object.entries(o.styles)
  if (!entries.length)
    return bad('Give at least one key of styles.', { path: 'styles' })
  for (const [k, v] of entries) {
    if (!STYLE_KEYS.includes(k))
      return bad(`"${k}" is not a key of the site styles.`, {
        path: `styles.${k}`,
        allowed: STYLE_KEYS,
      })
    if (v === undefined || (v === null && !OPTIONAL_STYLE_KEYS.includes(k)))
      return bad(`${k} cannot be removed.`, { path: `styles.${k}` })
  }
  return done({
    ...doc,
    styles: merge(
      doc.styles ?? defaultSiteStyles(doc.look),
      o.styles,
    ) as SiteDocument['styles'],
  })
}
