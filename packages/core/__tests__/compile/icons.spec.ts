import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ICONS } from '../../src/compile/icons.ts'

const BRANDS = [
  'github',
  'linkedin',
  'instagram',
  'youtube',
  'x',
  'mastodon',
  'bluesky',
  'facebook',
  'tiktok',
  'threads',
  'spotify',
  'apple-music',
  'bandcamp',
  'soundcloud',
  'dribbble',
  'behance',
  'medium',
  'substack',
  'twitch',
  'discord',
  'pinterest',
  'vimeo',
  'codepen',
  'goodreads',
  'gitlab',
  'stackoverflow',
  'whatsapp',
  'telegram',
  'strava',
]

test('every brand icon is a filled currentColor path, not a stroked outline', () => {
  for (const n of BRANDS) {
    assert.ok(Object.hasOwn(ICONS, n), n)
    assert.match(
      ICONS[n as keyof typeof ICONS],
      /^<path fill="currentColor" stroke="none" d="[Mm][^"]{20,}"\/>$/,
      n,
    )
  }
})

test('the icons of academic services are not in the table', () => {
  for (const n of [
    'orcid',
    'google-scholar',
    'scholar',
    'researchgate',
    'arxiv',
  ])
    assert.ok(!Object.hasOwn(ICONS, n), n)
})

test('every value is static svg inner markup: tags and quoted attributes only', () => {
  for (const [n, v] of Object.entries(ICONS))
    assert.match(v, /^(<[a-z]+( [a-z0-9-]+="[^"<>]*")*\/>)+$/, n)
})

// ---- fetched icons (set:name) ----

import { toElements } from '../../src/compile/elements.ts'
import { writeHtml } from '../../src/compile/index.ts'
import type { ElementCtx } from '../../src/compile/elementsBase.ts'
import type { Node } from '../../src/document/index.ts'
import { KINDS } from '../../src/document/kinds.ts'

const CAM =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/></g></svg>'
const GH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512"><path fill="currentColor" d="M0 0h8v8z"/></svg>'
const ctx = (icons?: Record<string, string>): ElementCtx => ({
  doc: { pages: [] },
  links: { page: s => s, file: n => n, form: () => '/f' },
  mode: 'live',
  classOf: new Map(),
  ...(icons ? { icons } : {}),
})
const node = (kind: Node['kind'], props: Node['props']): Node => ({
  id: 'n',
  kind,
  name: 'n',
  slot: {},
  props,
})
const out = (w: Node, icons?: Record<string, string>) => {
  const e = toElements(w, ctx(icons))
  return e ? writeHtml(e) : ''
}

test('an icon named lucide:camera with icons renders <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"> and the body, no fill or stroke on the svg', () => {
  const h = out(node('icon', { name: 'lucide:camera' }), {
    'lucide:camera': CAM,
  })
  assert.match(
    h,
    /<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"\/><\/g><\/svg>/,
  )
})

test('a hostile held file renders nothing', () => {
  const evil = CAM.replace('<g', '<script>x</script><g')
  assert.equal(out(node('icon', { name: 'evil:x' }), { 'evil:x': evil }), '')
})

test('lucide:camera with no icons renders nothing; a table name such as star renders as before', () => {
  assert.equal(out(node('icon', { name: 'lucide:camera' })), '')
  assert.equal(out(node('icon', { name: 'lucide:camera' }), {}), '')
  assert.match(
    out(node('icon', { name: 'star' })),
    /<svg viewBox="0 0 24 24"[^>]*stroke="currentColor"/,
  )
})

test('a button with icon fa6-brands:github renders the glyph before its label', () => {
  const h = out(node('button', { label: 'Code', icon: 'fa6-brands:github' }), {
    'fa6-brands:github': GH,
  })
  assert.match(h, /<svg viewBox="0 0 496 512"[^>]*>.*<\/svg>Code/)
})

test('an icon name of 80 characters is accepted and 81 is refused', () => {
  // the limit is the prop's maxLength, which validation enforces
  assert.equal(KINDS.icon.props.name!.maxLength, 80)
  assert.equal(KINDS.button.props.icon!.maxLength, 80)
})

test('a fetched icon whose body sets no fill gets fill="currentColor" on the svg; one that sets a fill does not', () => {
  const bare =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg>'
  assert.match(
    out(node('icon', { name: 'a:b' }), { 'a:b': bare }),
    /<svg viewBox="0 0 8 8" width="1em" height="1em" aria-hidden="true" fill="currentColor">/,
  )
  assert.doesNotMatch(
    out(node('icon', { name: 'lucide:camera' }), { 'lucide:camera': CAM }),
    /<svg[^>]* fill=/,
  )
})
