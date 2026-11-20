import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeHtml, writeHtml } from '../../src/compile/index.ts'
import { VOID } from '../../src/compile/html.ts'

const h = writeHtml
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

test('escapeHtml escapes the five characters and nothing else', () => {
  assert.equal(
    escapeHtml(`a & b <i> "q" 'r' é €`),
    `a &amp; b &lt;i&gt; &quot;q&quot; &#39;r&#39; é €`,
  )
  assert.equal(escapeHtml('plain'), 'plain')
})

test('text is escaped', () =>
  assert.equal(
    h({ tag: 'p', children: [`a & b <i>`] }),
    `<p>a &amp; b &lt;i&gt;</p>`,
  ))

test('attribute values are escaped, in double quotes', () =>
  assert.equal(
    h({ tag: 'a', attrs: { title: `a&b "c" <d> 'e'` } }),
    `<a title="a&amp;b &quot;c&quot; &lt;d&gt; &#39;e&#39;"></a>`,
  ))

test('an attribute value cannot close its tag', () =>
  assert.equal(
    h({ tag: 'img', attrs: { alt: `"><script>x()</script>` } }),
    `<img alt="&quot;&gt;&lt;script&gt;x()&lt;/script&gt;">`,
  ))

test('true writes a bare attribute; false and undefined write nothing; numbers are written', () =>
  assert.equal(
    h({
      tag: 'input',
      attrs: { disabled: true, hidden: false, name: undefined, size: 3 },
    }),
    `<input disabled size="3">`,
  ))

test('void elements have no end tag, every one of them', () => {
  for (const tag of VOID) assert.equal(h({ tag }), `<${tag}>`)
})

test('a void element with children throws', () =>
  assert.throws(() => h({ tag: 'br', children: ['x'] })))

test('nested elements and strings are written in order', () =>
  assert.equal(
    h({
      tag: 'ul',
      children: [
        { tag: 'li', children: ['a'] },
        { tag: 'li', children: ['b', { tag: 'b', children: ['c'] }] },
      ],
    }),
    '<ul><li>a</li><li>b<b>c</b></li></ul>',
  ))

test('raw style is written as given', () =>
  assert.equal(
    h({ tag: 'style', raw: { kind: 'style', content: '.c0>a{color:red}' } }),
    '<style>.c0>a{color:red}</style>',
  ))

test('raw JSON escapes < > & and both line separators, and still parses to the same value', () => {
  const v = { t: `</script><b>&${LS}${PS}` }
  const out = h({
    tag: 'script',
    attrs: { type: 'application/json' },
    raw: { kind: 'json', content: JSON.stringify(v) },
  })
  const body = out.slice(out.indexOf('>') + 1, out.lastIndexOf('</script>'))
  for (const c of ['<', '>', '&', LS, PS]) assert.ok(!body.includes(c))
  assert.deepEqual(JSON.parse(body), v)
})

test('raw script and raw icon are written as given', () => {
  assert.equal(
    h({ tag: 'script', raw: { kind: 'script', content: 'a<b&&c()' } }),
    '<script>a<b&&c()</script>',
  )
  assert.equal(
    h({
      tag: 'svg',
      attrs: { viewBox: '0 0 24 24' },
      raw: { kind: 'icon', content: `<path d="M0 0"/>` },
    }),
    `<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`,
  )
})

test('raw with the wrong tag, or with children, throws', () => {
  assert.throws(() => h({ tag: 'div', raw: { kind: 'script', content: 'x' } }))
  assert.throws(() =>
    h({
      tag: 'style',
      raw: { kind: 'style', content: 'x' },
      children: ['y'],
    }),
  )
})

test('a tag or attribute name that is not a plain name throws', () => {
  assert.throws(() => h({ tag: 'p onclick=x' }))
  assert.throws(() => h({ tag: 'p', attrs: { 'on click': 'x' } }))
  assert.throws(() => h({ tag: 'p', attrs: { 'x"y': '1' } }))
})

test('a bare string is escaped as text', () =>
  assert.equal(h('<b>'), '&lt;b&gt;'))

test('script and style without raw throw, even with text children', () => {
  assert.throws(() => h({ tag: 'script', children: ['alert(1)'] }))
  assert.throws(() => h({ tag: 'style', children: ['a{b:c}'] }))
  assert.throws(() => h({ tag: 'script' }))
})

test('tag names are lowercase only', () => {
  assert.throws(() => h({ tag: 'BR' }))
  assert.throws(() =>
    h({ tag: 'SCRIPT', raw: { kind: 'script', content: '' } }),
  )
  assert.equal(h({ tag: 'h1', children: ['x'] }), '<h1>x</h1>')
  assert.equal(h({ tag: 'my-el' }), '<my-el></my-el>')
})

test('attribute names starting with on throw, in any case', () => {
  assert.throws(() => h({ tag: 'p', attrs: { onclick: 'x()' } }))
  assert.throws(() => h({ tag: 'p', attrs: { OnLoad: 'x()' } }))
  assert.equal(h({ tag: 'p', attrs: { open: true } }), '<p open></p>')
})

test('raw content that would close its element throws', () => {
  assert.throws(() =>
    h({ tag: 'style', raw: { kind: 'style', content: 'a{}</STYLE><b>' } }),
  )
  assert.throws(() =>
    h({ tag: 'script', raw: { kind: 'script', content: 'x</Script>' } }),
  )
})

test('a void element with raw throws', () =>
  assert.throws(() =>
    h({ tag: 'br', raw: { kind: 'icon', content: 'x' } } as never),
  ))
