import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ICON_LICENCES,
  ICON_NAME_RE,
  siteIcon,
} from '../../src/compile/siteIcon.ts'

const wrap = (body: string, vb = '0 0 24 24') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`
const GOOD =
  '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16v16H4z"/><circle cx="12" cy="12" r="3"/></g>'

test('a lucide file gives its viewBox and a body written again from its tokens', () => {
  const r = siteIcon(wrap(GOOD))
  assert.deepEqual(r, { viewBox: '0 0 24 24', body: GOOD })
  // whitespace and a closing tag pair are normalised
  assert.equal(
    siteIcon(wrap('\n <path d="M0 0h1"  ></path>\n'))?.body,
    '<path d="M0 0h1"/>',
  )
})

test('script, foreignObject, an on* attribute, href, url(#a), a fill of #f00, an unclosed tag and 20,001 characters each give undefined', () => {
  const bad = [
    '<script>alert(1)</script>',
    '<path d="M0 0"/><script/>',
    '<foreignObject><div/></foreignObject>',
    '<path d="M0 0" onload="alert(1)"/>',
    '<path d="M0 0" onclick="x"/>',
    '<path d="M0 0" href="https://evil.example/x"/>',
    '<path d="M0 0" xlink:href="#a"/>',
    '<path d="M0 0" fill="url(#a)"/>',
    '<path d="M0 0" style="fill:url(#a)"/>',
    '<path d="M0 0" style="fill:red"/>',
    '<path d="M0 0" fill="#f00"/>',
    '<path d="M0 0" fill="red"/>',
    '<path d="M0 0" stroke="#000"/>',
    '<g><path d="M0 0"/>',
    '<path d="M0 0"',
    '<path d="M0 0"/>text',
    '<path d="M0 0" d="M1 1"/>',
    '<!-- c --><path d="M0 0"/>',
    '<image href="data:image/png;base64,AAAA"/>',
    '<path d="M0 0&quot;"/>',
    '<path d="M0 0" opacity=\'1\'/>',
    '',
  ]
  for (const b of bad) assert.equal(siteIcon(wrap(b)), undefined, b)
  assert.equal(siteIcon(wrap(`<path d="${'M0 0 '.repeat(4000)}"/>`)), undefined)
  assert.equal(siteIcon('x'.repeat(20001)), undefined)
  // the svg's own attributes
  assert.equal(
    siteIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="x"><path d="M0 0"/></svg>',
    ),
    undefined,
  )
  assert.equal(siteIcon(wrap(GOOD, '0 0 24 <x>')), undefined)
  assert.equal(siteIcon(`<?xml version="1.0"?>${wrap(GOOD)}`), undefined)
})

test('names and licences', () => {
  assert.ok(ICON_NAME_RE.test('lucide:camera'))
  assert.ok(ICON_NAME_RE.test('fa6-brands:github'))
  assert.ok(!ICON_NAME_RE.test('star'))
  assert.ok(!ICON_NAME_RE.test('a:b:c'))
  assert.ok(!ICON_NAME_RE.test('Lucide:camera'))
  assert.deepEqual(ICON_LICENCES, [
    'MIT',
    'Apache-2.0',
    'ISC',
    'CC-BY-3.0',
    'CC-BY-4.0',
  ])
})
