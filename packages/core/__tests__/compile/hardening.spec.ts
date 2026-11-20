import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compilePage,
  compileSubtree,
  writeHtml,
} from '../../src/compile/index.ts'
import { createRegistry } from '../../src/registry/index.ts'
import type { Node } from '../../src/document/index.ts'
import { DEMO_PLUGIN, node, siteWith, text } from '../kit.ts'

const oddRegistry = (over: { tag?: () => string; display?: () => string }) => {
  const reg = createRegistry()
  reg.use({
    ...DEMO_PLUGIN,
    kinds: {
      odd: {
        role: 'container',
        parents: 'any',
        tag: over.tag ?? (() => 'div'),
        display: over.display ?? (() => 'block'),
        props: {},
        styles: [],
        states: [],
        bindable: [],
        repeatable: true,
        label: 'Odd',
        icon: 'x',
      },
    },
  })
  return reg
}
const odd = (more: Partial<Node> = {}) =>
  ({ ...node('o', 'odd' as never, [text('in', 'hi')]), ...more }) as Node

test('a plug-in display() value is written only when it is a display keyword', () => {
  const evil = 'block}body{background:url(https://evil.test/x)'
  const registry = oddRegistry({ display: () => evil })
  for (const more of [
    { hide: { desktop: true } },
    { hide: { tablet: true } },
    { hide: { phone: true } },
  ] as Partial<Node>[]) {
    const doc = siteWith([odd(more)])
    const page = compilePage(doc, 'home', { registry })
    assert.ok(page.ok)
    assert.doesNotMatch(page.css, /evil/)
    const sub = compileSubtree(doc, 'home', 'o', { registry })
    assert.ok(sub.ok)
    assert.doesNotMatch(sub.css, /evil/)
  }
  const doc = siteWith([odd({ hide: { desktop: true } })])
  const ok = (display: string) => {
    const r = compilePage(doc, 'home', {
      registry: oddRegistry({ display: () => display }),
    })
    assert.ok(r.ok)
    return r.css
  }
  assert.match(ok('inline-flex'), /display:inline-flex/)
  assert.match(ok('inline flow-root'), /display:inline flow-root/)
  assert.doesNotMatch(ok('block;x'), /block;x/)
})

test('a plug-in tag is written only if core writes it for containers and text', () => {
  for (const tag of [
    'textarea',
    'title',
    'select',
    'object',
    'noembed',
    'frameset',
    'a',
    'form',
  ]) {
    const registry = oddRegistry({ tag: () => tag })
    const r = compilePage(siteWith([odd()]), 'home', { registry })
    assert.ok(r.ok)
    const main = /<main[\s\S]*<\/main>/.exec(r.html)![0]
    assert.doesNotMatch(main, new RegExp(`<${tag}[ >]`), tag)
    assert.match(main, /<div[^>]*>/, tag)
  }
  const r = compilePage(siteWith([odd()]), 'home', {
    registry: oddRegistry({ tag: () => 'section' }),
  })
  assert.ok(r.ok)
  assert.match(r.html, /<section/)
})

test('the writer refuses a missing tag and a child that is not a string or an element', () => {
  assert.throws(() => writeHtml({ tag: undefined } as never))
  assert.throws(() => writeHtml({ tag: 5 } as never))
  assert.throws(() => writeHtml({ tag: 'p', children: [5] } as never))
  assert.throws(() => writeHtml({ tag: 'p', children: [null] } as never))
  assert.equal(
    writeHtml({ tag: 'p', children: ['a', { tag: 'b' }] }),
    '<p>a<b></b></p>',
  )
})

test('a file address that fails the address check is not written', () => {
  const links = { page: (s: string) => s, file: () => 'javascript:a' }
  const img = {
    id: 'im',
    kind: 'image',
    name: 'im',
    slot: {},
    props: { assetId: 'a1' },
  }
  const video = {
    id: 'vi',
    kind: 'video',
    name: 'vi',
    slot: {},
    props: { assetId: 'a1', poster: 'a2' },
  }
  const r = compilePage(siteWith([img as Node, video as Node]), 'home', {
    registry: oddRegistry({}),
    links,
  })
  assert.ok(r.ok)
  assert.doesNotMatch(r.html, /javascript/)
  const good = compilePage(siteWith([img as Node]), 'home', {
    registry: oddRegistry({}),
    links: { page: (s: string) => s, file: () => '/files/a.png' },
  })
  assert.ok(good.ok)
  assert.match(good.html, /<img[^>]*src="\/files\/a\.png"/)
})

test('a background image takes its file address through the same check', () => {
  const box = (id: string): Node =>
    ({
      id: 'b',
      kind: 'box',
      name: 'b',
      slot: {},
      style: { base: { bgImage: id } },
    }) as unknown as Node
  for (const bad of ['//evil.test/x', 'data:text/html,x']) {
    const r = compilePage(siteWith([box('a1')]), 'home', {
      registry: oddRegistry({}),
      links: { page: (s: string) => s, file: () => bad },
    })
    assert.ok(r.ok)
    assert.doesNotMatch(r.html, /evil|data:text/)
  }
  const good = compilePage(siteWith([box('a1')]), 'home', {
    registry: oddRegistry({}),
    links: { page: (s: string) => s, file: () => '/files/a.png' },
  })
  assert.ok(good.ok)
  assert.match(good.html, /background-image:url\("\/files\/a\.png"\)/)
})

test('a Links that is a class instance, with methods that use this, compiles', () => {
  class L {
    tag = 'k'
    page(s: string) {
      return `/${this.tag}${s}`
    }
    file() {
      return `/${this.tag}/a.png`
    }
    form() {
      return `/${this.tag}/post`
    }
  }
  const img = {
    id: 'im',
    kind: 'image',
    name: 'im',
    slot: {},
    props: { assetId: 'a1' },
  }
  const link = text('t', 'x', {
    props: { level: 'p', runs: [{ text: 'go', link: { page: '/' } }] },
  } as Partial<Node>)
  const form = { id: 'fm', kind: 'form', name: 'fm', slot: {} }
  const r = compilePage(siteWith([img, link, form] as Node[]), 'home', {
    registry: oddRegistry({}),
    links: new L(),
  })
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems))
  assert.match(r.html, /src="\/k\/a\.png"/)
  assert.match(r.html, /href="\/k\/"/)
  assert.match(r.html, /action="\/k\/post"/)
})
