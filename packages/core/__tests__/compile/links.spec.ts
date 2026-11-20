import assert from 'node:assert/strict'
import { test } from 'node:test'
import { urlOk } from '../../src/document/rules.ts'
import { type Links } from '../../src/compile/index.ts'
import { href, linkProps, mailParts } from '../../src/compile/links.ts'

const links: Links = {
  page: s => s,
  file: id => (id === 'a1' ? '/f/cv.pdf' : undefined),
}
const doc = {
  pages: [
    { slug: '/about', on: true },
    { slug: '/off', on: false },
  ],
} as never

test('only safe schemes pass', () => {
  for (const ok of [
    'https://x.org',
    'http://x.org',
    'mailto:a@b.c',
    '/about',
    '#top',
  ])
    assert.ok(urlOk(ok), ok)
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,x',
    '//evil.com',
    'vbscript:x',
    ' javascript:x',
    '/\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    'JaVaScRiPt:alert(1)',
  ])
    assert.ok(!urlOk(bad), bad)
})

test('links resolve per kind and unsafe ones vanish', () => {
  assert.equal(href({ page: '/about' }, doc, links), '/about')
  assert.equal(href({ page: '/gone' }, doc, links), undefined)
  assert.equal(href({ page: '/off' }, doc, links), undefined)
  assert.equal(href({ file: 'a1' }, doc, links), '/f/cv.pdf')
  assert.equal(href({ file: 'missing' }, doc, links), undefined)
  assert.equal(href({ email: 'a@b.c' }, doc, links), 'mailto:a@b.c')
  assert.equal(
    href({ url: 'ada@example.org' }, doc, links),
    'mailto:ada@example.org',
  )
  assert.equal(href('javascript:alert(1)', doc, links), undefined)
  assert.equal(href('https://x.org', doc, links), 'https://x.org')
})

test('javascript:, data:, vbscript: and protocol-relative addresses are refused; a url link that fails urlOk gives no href', () => {
  for (const u of [
    'javascript:alert(1)',
    'JaVaScRiPt:x',
    'data:text/html,x',
    'vbscript:x',
    '//evil.example',
    '/\\evil.example',
    'https://a.b\n',
  ]) {
    assert.equal(urlOk(u), false, u)
    assert.equal(href({ url: u }, doc, links), undefined, u)
  }
})

test('a page link resolves through links.page; a link to a missing page gives no href', () => {
  const l: Links = { ...links, page: s => `/en${s}` }
  assert.equal(href({ page: '/about' }, doc, l), '/en/about')
  assert.equal(href({ page: '/nope' }, doc, l), undefined)
})

test('a file link takes its address from links.file; no address gives no href', () => {
  assert.equal(href({ file: 'a1' }, doc, links), '/f/cv.pdf')
  assert.equal(
    href({ file: 'a1' }, doc, { ...links, file: () => 'javascript:x' }),
    undefined,
  )
})

test('mailParts and linkProps hide a plain mailto address only when asked', () => {
  assert.deepEqual(mailParts('mailto:ada@x.org'), { u: 'ada', d: 'x.org' })
  assert.equal(mailParts('https://x.org'), null)
  assert.deepEqual(linkProps('mailto:ada@x.org', undefined, 'ada@x.org'), {
    props: { href: 'mailto:ada@x.org' },
    text: 'ada@x.org',
  })
  const mail = { used: false }
  assert.deepEqual(linkProps('mailto:ada@x.org', mail, 'ada@x.org'), {
    props: { href: '#', 'data-u': 'ada', 'data-d': 'x.org' },
    text: 'ada [at] x.org',
  })
  assert.equal(mail.used, true)
})
