import {
  CODES,
  SCHEMA_VERSION,
  type Component,
  type Language,
  type Look,
  type Page,
  type Problem,
  type SiteDocument,
  type SiteStyles,
} from '../document/index.ts'
import { ID_RE } from '../document/kinds.ts'
import { isObj, SLUG_RE } from '../document/rules.ts'
import { type Registry } from '../registry/index.ts'
import { FONTS, checkLook, checkSiteStyles } from '../style/index.ts'
import { isFontRef } from '../style/fonts.ts'
import { diagnosticId, fieldsOf, isStr, oneOf } from './common.ts'
import { checkShown } from './required.ts'
import { checkTrees } from './tree.ts'
import { checkCustomEffects, checkedRegistrations } from './gpu.ts'

export const TOP_KEYS = fieldsOf<SiteDocument>({
  schemaVersion: true,
  name: true,
  pages: true,
  header: true,
  footer: true,
  components: true,
  customEffects: true,
  fonts: true,
  styles: true,
  look: true,
  languages: true,
  centreMaxWidth: true,
})
export const PAGE_KEYS = fieldsOf<Page>({
  id: true,
  title: true,
  slug: true,
  icon: true,
  on: true,
  inMenu: true,
  inFooter: true,
  root: true,
})
export const LOOK_KEYS = fieldsOf<Look>({
  id: true,
  name: true,
  family: true,
  brand: true,
  ink: true,
  bg: true,
  headingFont: true,
  bodyFont: true,
  corners: true,
  dark: true,
  accent: true,
  labelFont: true,
  edge: true,
  shadow: true,
  texture: true,
  textureStrength: true,
  labelCase: true,
  headingCase: true,
  headingWeight: true,
  headingTracking: true,
  typeScale: true,
  buttonShape: true,
  custom: true,
})
export const SPACE_KEYS = fieldsOf<SiteStyles['space']>({
  xs: true,
  s: true,
  m: true,
  l: true,
  xl: true,
  '2xl': true,
})
/** The fields a site-style entry may hold, by list. */
export const STYLE_ENTRY_KEYS = {
  colors: fieldsOf<SiteStyles['colors'][number]>({
    id: true,
    name: true,
    value: true,
  }),
  text: fieldsOf<SiteStyles['text'][number]>({
    id: true,
    name: true,
    decl: true,
  }),
  shadows: fieldsOf<SiteStyles['shadows'][number]>({
    id: true,
    name: true,
    value: true,
  }),
}

export const LANGUAGE_KEYS = fieldsOf<Language>({ code: true, dir: true })
export const COMPONENT_KEYS = fieldsOf<Component>({
  id: true,
  name: true,
  root: true,
  props: true,
  variants: true,
})

export const MAX_COMPONENTS = 100
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** Checks a site document against the registry and returns every problem found. Never throws and never changes `doc`. */
export function validateSite(doc: unknown, registry: Registry): Problem[] {
  return checkedSite(doc, registry).problems
}

/** Build consumes this private projection instead of running a checked factory again after expansion. */
export function checkedSite(doc: unknown, registry: Registry) {
  const out: Problem[] = []
  try {
    return { ...checkDocument(doc, registry, out), problems: out }
  } catch {
    out.push({
      code: 'INVALID_DOCUMENT',
      message: 'The document could not be checked.',
    })
  }
  return { doc: undefined, problems: out }
}

export function checkDocument(
  doc: unknown,
  registry: Registry,
  out: Problem[],
) {
  const effects = checkedRegistrations(registry, out)
  const beforeDocument = out.length
  const bad = (message: string, path?: string) =>
    void out.push({
      code: 'INVALID_DOCUMENT',
      message,
      ...(path === undefined ? {} : { path }),
    })
  if (!isObj(doc)) return bad('The document must be an object.')
  for (const k of Object.keys(doc))
    if (!TOP_KEYS.has(k))
      bad(
        `The document has a field this version does not know: ${k.slice(0, 40)}.`,
        k,
      )
  const v = doc.schemaVersion
  if (v !== SCHEMA_VERSION)
    return bad(
      typeof v === 'number' && v > SCHEMA_VERSION
        ? `The document is from a newer schema version (${v}) than this one (${SCHEMA_VERSION}).`
        : 'The document has no valid schemaVersion.',
      'schemaVersion',
    )
  if (!isStr(doc.name, 200)) bad('The name must be text.', 'name')

  if (!Array.isArray(doc.pages)) bad('The pages must be a list.', 'pages')
  else {
    const ids = new Set<unknown>(),
      slugs = new Set<unknown>()
    doc.pages.forEach((p: unknown, i) => {
      const at = `pages.${i}`
      if (!isObj(p)) return bad('A page must be an object.', at)
      for (const k of Object.keys(p))
        if (!PAGE_KEYS.has(k))
          bad(
            `A page has a field this version does not know: ${k.slice(0, 40)}.`,
            `${at}.${k}`,
          )
      for (const k of ['title', 'icon'] as const)
        if (!isStr(p[k])) bad(`A page ${k} must be text.`, `${at}.${k}`)
      for (const k of ['on', 'inMenu', 'inFooter'] as const)
        if (typeof p[k] !== 'boolean')
          bad(`A page ${k} must be on or off.`, `${at}.${k}`)
      if (!isStr(p.id, 100) || !p.id) bad('A page id must be text.', `${at}.id`)
      else if (ids.has(p.id)) bad('Two pages have the same id.', `${at}.id`)
      else ids.add(p.id)
      if (!isStr(p.slug, 200) || !SLUG_RE.test(p.slug))
        bad(
          'A page slug is a path beginning with a slash, like / or /about/team, with no trailing slash.',
          `${at}.slug`,
        )
      else if (slugs.has(p.slug))
        bad('Two pages have the same slug.', `${at}.slug`)
      else slugs.add(p.slug)
      if (!isObj(p.root)) bad('A page needs a top block.', `${at}.root`)
    })
  }
  for (const k of ['header', 'footer'] as const)
    if (!isObj(doc[k])) bad(`The ${k} must be a block.`, k)
  if (!Array.isArray(doc.components) || doc.components.length > MAX_COMPONENTS)
    bad(
      `The components must be a list of at most ${MAX_COMPONENTS}.`,
      'components',
    )
  else {
    const cids = new Set<unknown>()
    doc.components.forEach((k: unknown, i) => {
      const at = `components.${i}`
      if (!isObj(k)) return bad('A component must be an object.', at)
      for (const key of Object.keys(k))
        if (!COMPONENT_KEYS.has(key))
          bad(
            `A component has a field this version does not know: ${key.slice(0, 40)}.`,
            `${at}.${key}`,
          )
      if (typeof k.id !== 'string' || !ID_RE.test(k.id) || cids.has(k.id))
        bad(
          'A component id must be 1 to 20 lowercase letters and digits, and used once.',
          `${at}.id`,
        )
      else cids.add(k.id)
      if (!isStr(k.name, 100) || !k.name.trim())
        bad('A component needs a name.', `${at}.name`)
      if (!isObj(k.root)) bad('A component needs a top block.', `${at}.root`)
      for (const key of ['props', 'variants'] as const)
        if (!Array.isArray(k[key]) || k[key].length > 32)
          bad(
            `A component's ${key} must be a list of at most 32.`,
            `${at}.${key}`,
          )
    })
  }

  if (!Array.isArray(doc.fonts)) bad('The fonts must be a list.', 'fonts')
  else
    doc.fonts.forEach((f: unknown, i) => {
      if (
        !isFontRef(f) ||
        (f.startsWith('cat:') && !Object.hasOwn(FONTS, f.slice(4)))
      )
        bad(
          'A font must be a system, catalogue or held font (up:<name>); a folder site names a Google family as {google}.',
          `fonts.${i}`,
        )
    })
  const look = doc.look
  if (!isObj(look)) bad('The look must be an object.', 'look')
  else if (
    !isFontRef(look.headingFont) ||
    !isFontRef(look.bodyFont) ||
    ['id', 'name', 'family', 'brand', 'ink', 'bg', 'dark'].some(
      k => typeof look[k] !== 'string',
    ) ||
    typeof look.corners !== 'number'
  )
    bad('The look is missing a colour, a font or its corners.', 'look')
  else {
    for (const k of Object.keys(look))
      if (!LOOK_KEYS.has(k))
        bad(
          `The look has a field this version does not know: ${k.slice(0, 40)}.`,
          `look.${k.slice(0, 40)}`,
        )
    if (look.dark !== 'light' && look.dark !== 'dark' && look.dark !== 'auto')
      bad('The look dark scheme must be light, dark or auto.', 'look.dark')
    if (
      !Number.isFinite(look.corners) ||
      look.corners < 0 ||
      look.corners > 200
    )
      bad('The look corners must be a number from 0 to 200.', 'look.corners')
    if (look.custom !== undefined && look.custom !== true)
      bad('The look custom flag must be true.', 'look.custom')
    const docFonts = new Set(Array.isArray(doc.fonts) ? doc.fonts : [])
    for (const fk of ['headingFont', 'bodyFont', 'labelFont'] as const) {
      const f = look[fk]
      if (f === undefined) continue
      if (
        !isFontRef(f) ||
        (f.startsWith('cat:') && !Object.hasOwn(FONTS, f.slice(4))) ||
        (f.startsWith('up:') && !docFonts.has(f))
      )
        bad(
          `The look ${fk} uses a font that is invalid or missing from fonts.`,
          `look.${fk}`,
        )
    }
    for (const m of checkLook(look as Look)) bad(m, 'look')
  }
  if (doc.styles !== undefined) {
    unknownStyleFields(doc.styles, bad)
    for (const m of checkSiteStyles(doc.styles).problems) bad(m, 'styles')
  }
  if (
    doc.centreMaxWidth !== undefined &&
    typeof doc.centreMaxWidth !== 'boolean'
  )
    bad('centreMaxWidth must be true or false.', 'centreMaxWidth')
  if (doc.languages !== undefined) {
    if (!Array.isArray(doc.languages) || doc.languages.length > 50)
      bad('The languages must be a list of at most 50.', 'languages')
    else {
      const codes = new Set<unknown>()
      doc.languages.forEach((l: unknown, i) => {
        const at = `languages.${i}`
        if (
          !isObj(l) ||
          Object.keys(l).some(k => !LANGUAGE_KEYS.has(k)) ||
          typeof l.code !== 'string' ||
          !LANG_RE.test(l.code) ||
          (l.dir !== undefined && l.dir !== 'rtl')
        )
          bad('A language is a code, and may read right to left.', at)
        else if (codes.has(l.code)) bad('A language is listed twice.', at)
        else codes.add(l.code)
      })
    }
  }
  const hasSiteShape = out.length === beforeDocument
  const custom = checkCustomEffects(doc.customEffects, registry, out)
  if (!hasSiteShape) return
  for (const [name, d] of custom) effects.set(name, d)
  const definitionsOk = !out.length
  const projected = checkTrees(
    doc as unknown as SiteDocument,
    registry,
    out,
    new Map([...effects].map(([name, d]) => [name, d.settings])),
  )
  // Even when a definition was refused, the attachment reports on its authored owner.
  if (!definitionsOk) return
  // The two checks below assume a well-formed tree.
  if (!out.length) {
    out.push(...checkShown(doc as unknown as SiteDocument, registry))
  }
  runRules(doc as unknown as SiteDocument, registry, out)
  if (projected)
    return {
      doc:
        doc.customEffects !== undefined
          ? { ...projected, customEffects: [...custom.values()] }
          : projected,
      effects,
    }
}

/** A rule's problem, copied field by field: a rule is outside code, so only the known fields, short and of the right type, reach the result. */
const known = (p: Problem, rule: string): Problem => ({
  code: p.code,
  message: p.message.slice(0, 500),
  ...(typeof p.nodeId === 'string' ? { nodeId: diagnosticId(p.nodeId) } : {}),
  ...(typeof p.path === 'string' ? { path: p.path.slice(0, 200) } : {}),
  ...(Array.isArray(p.allowed) &&
  p.allowed.length <= 50 &&
  p.allowed.every(a => typeof a === 'string')
    ? { allowed: p.allowed.map(a => a.slice(0, 40)) }
    : {}),
  rule,
})

/** Each rule gets its own copy of the document, and its problems are stamped with its name. */
export function runRules(doc: SiteDocument, reg: Registry, out: Problem[]) {
  for (const rule of reg.rules()) {
    try {
      const found: unknown = rule.check(structuredClone(doc))
      if (
        !Array.isArray(found) ||
        !found.every(
          p =>
            isObj(p) && oneOf(p.code, CODES) && typeof p.message === 'string',
        )
      )
        throw new Error('not problems')
      for (const p of found as Problem[]) out.push(known(p, rule.name))
    } catch {
      out.push({
        code: 'POLICY_VIOLATION',
        message: `The rule "${rule.name}" could not be applied.`,
        rule: rule.name,
      })
    }
  }
}

/** A field in a site-style entry or in the spacing scale that this version does not know. */
function unknownStyleFields(
  styles: unknown,
  bad: (message: string, path?: string) => void,
) {
  if (!isObj(styles)) return
  for (const [list, keys] of Object.entries(STYLE_ENTRY_KEYS)) {
    const entries = styles[list]
    if (Array.isArray(entries))
      entries.forEach((e: unknown, i) => {
        if (isObj(e))
          for (const k of Object.keys(e))
            if (!keys.has(k))
              bad(
                `A site style has a field this version does not know: ${k.slice(0, 40)}.`,
                `styles.${list}.${i}.${k.slice(0, 40)}`,
              )
      })
  }
  if (isObj(styles.space))
    for (const k of Object.keys(styles.space))
      if (!SPACE_KEYS.has(k))
        bad(
          `The spacing scale has a step this version does not know: ${k.slice(0, 40)}.`,
          `styles.space.${k.slice(0, 40)}`,
        )
}
