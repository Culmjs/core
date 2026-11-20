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
