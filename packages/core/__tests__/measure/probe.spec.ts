import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROBE_SCRIPT } from '../../src/measure/probeMin.ts'
import { measureNodes, pixelsUnder } from '../../src/measure/probe.ts'

type Rect = { left: number; top: number; right: number; bottom: number }
const rect = (l: number, t: number, w: number, h: number): Rect => ({
  left: l,
  top: t,
  right: l + w,
  bottom: t + h,
})
const TEXT = 99 // not the browser's 3: the probe must read the window's Node

type Style = Record<string, string>
class El {
  tagName: string
  parentElement: El | null = null
  children: El[] = []
  childNodes: unknown[] = []
  visible = true
  style: Style = {}
  classes: string[] = []
  constructor(
    tag: string,
    public attrs: Record<string, string>,
    public r: Rect,
    parent?: El,
    public text = '',
  ) {
    this.tagName = tag.toUpperCase()
    if (parent) {
      this.parentElement = parent
      parent.children.push(this)
    }
    if (text) this.childNodes = [{ nodeType: TEXT, nodeValue: text }]
  }
  get textContent(): string {
    return this.text + this.children.map(c => c.textContent).join('')
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null
  }
  getBoundingClientRect() {
    return {
      ...this.r,
      width: this.r.right - this.r.left,
      height: this.r.bottom - this.r.top,
    }
  }
  getClientRects() {
    return this.visible ? [this.r] : []
  }
  checkVisibility() {
    return this.visible
  }
  matches(sel: string) {
    return sel.split(',').includes(this.tagName.toLowerCase())
  }
  querySelector(sel: string) {
    return this.all().find(e => e.matches(sel)) ?? null
  }
  querySelectorAll(sel: string) {
    return this.all().filter(e => (sel === '*' ? true : e.matches(sel)))
  }
  all(): El[] {
    return this.children.flatMap(c => [c, ...c.all()])
  }
  get classList() {
    return { contains: (c: string) => this.classes.includes(c) }
  }
}

/** A document of `[data-id]` elements; every character of a text is 10 wide, 20 tall, and wraps after `perLine` characters. */
function page(build: (root: El) => void, perLine = 100, scrollY = 0) {
  const root = new El('html', {}, rect(0, 0, 1000, 5000))
  build(root)
  const all = root.all()
  const doc = {
    documentElement: { scrollWidth: 1000 },
    querySelectorAll: (sel: string) =>
      sel === '[data-id]' ? all.filter(e => e.attrs['data-id']) : all,
    createRange() {
      let node: { nodeValue: string } | null = null
      let i = 0
      return {
        setStart(n: { nodeValue: string }, o: number) {
          node = n
          i = o
        },
        setEnd() {},
        getClientRects() {
          const s = node!.nodeValue
          if (s[i] === ' ') return [{ width: 0, top: 0, height: 20 }]
          const owner = all.find(e => e.childNodes.includes(node))!
          return [
            {
              width: 10,
              height: 20,
              top: owner.r.top + Math.floor(i / perLine) * 20,
            },
          ]
        },
      }
    },
  }
  const win = {
    scrollX: 0,
    scrollY,
    Node: { TEXT_NODE: TEXT },
    getComputedStyle: (e: El) => ({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      overflowX: 'visible',
      overflowY: 'visible',
      position: 'static',
      fontSize: '16px',
      fontWeight: '400',
      getPropertyValue: (k: string) =>
        k.endsWith('-style') ? 'none' : k.endsWith('-width') ? '0px' : '',
      ...e.style,
    }),
  }
  return { doc: doc as unknown as Document, win: win as unknown as Window, all }
}

test('measureNodes reads box, tag, background, clip and position from the window', () => {
  const { doc, win } = page(
    root => {
      const a = new El(
        'section',
        { 'data-id': 'a' },
        rect(10, 20, 300, 100),
        root,
      )
      a.style = {
        backgroundColor: 'rgb(255, 0, 16)',
        overflowX: 'hidden',
        position: 'sticky',
      }
    },
    100,
    40,
  )
  const raw = measureNodes(doc, win, 1000)
  assert.equal(raw.width, 1000)
  assert.equal(raw.docWidth, 1000)
  assert.deepEqual(raw.nodes, [
    {
      id: 'a',
      tag: 'section',
      box: { x: 10, y: 60, w: 300, h: 100 },
      visible: true,
      bg: '#ff0010',
      clip: true,
      fixedOrSticky: true,
    },
  ])
  assert.deepEqual(raw.wide, [])
})

test('an element the page does not render has a null box and paints nothing', () => {
  const { doc, win } = page(root => {
    const a = new El('div', { 'data-id': 'a' }, rect(0, 0, 50, 50), root, 'hi')
    a.visible = false
  })
  const [n] = measureNodes(doc, win, 1000).nodes
  assert.equal(n.box, null)
  assert.equal(n.visible, false)
  assert.equal(n.text, undefined)
})

test('direct text gives the rendered lines and the longest one, read through the window Node', () => {
  const { doc, win } = page(root => {
    new El('p', { 'data-id': 'p' }, rect(0, 100, 200, 60), root, 'abcde fgh')
  }, 5)
  const [n] = measureNodes(doc, win, 1000).nodes
  assert.equal(n.visible, true)
  assert.deepEqual(n.text, { lines: 2, longest: 5, size: 16, weight: 400 })
})

test('a link or a button reports its tap size', () => {
  const { doc, win } = page(root => {
    new El('a', { 'data-id': 'l' }, rect(0, 0, 30, 20), root, 'go')
    new El('button', { 'data-id': 'b' }, rect(0, 30, 50, 40), root, 'ok')
    new El('div', { 'data-id': 'd' }, rect(0, 80, 50, 40), root, 'no')
  })
  const taps = measureNodes(doc, win, 1000).nodes.map(n => n.tap)
  assert.deepEqual(taps, [{ w: 30, h: 20 }, { w: 50, h: 40 }, undefined])
})

test('repeated rows roll up to their list id as the union of their boxes', () => {
  const { doc, win } = page(root => {
    new El('li', { 'data-id': 'list~1' }, rect(0, 0, 100, 50), root, 'one')
    new El('li', { 'data-id': 'list~2' }, rect(0, 60, 80, 50), root, 'two')
  })
  const raw = measureNodes(doc, win, 1000)
  assert.equal(raw.nodes.length, 1)
  assert.equal(raw.nodes[0].id, 'list')
  assert.equal(raw.nodes[0].merged, true)
  assert.deepEqual(raw.nodes[0].box, { x: 0, y: 0, w: 100, h: 110 })
})

test('merged rows keep the first background, the longer text and the first tap, and any clip', () => {
  const { doc, win } = page(root => {
    const a = new El('a', { 'data-id': 'l~1' }, rect(0, 0, 100, 20), root, 'ab')
    a.style = { backgroundColor: 'rgb(0, 0, 0)' }
    const b = new El(
      'a',
      { 'data-id': 'l~2' },
      rect(0, 30, 90, 20),
      root,
      'abcd',
    )
    b.style = { backgroundColor: 'rgb(255, 255, 255)', overflowY: 'clip' }
  })
  const [n] = measureNodes(doc, win, 1000).nodes
  assert.equal(n.bg, '#000000')
  assert.equal(n.clip, true)
  assert.deepEqual(n.tap, { w: 100, h: 20 })
  assert.equal(n.text?.longest, 4)
})

test('background formats: color(srgb), transparent alpha and unread formats', () => {
  const { doc, win } = page(root => {
    const bgs = [
      'color(srgb 1 0.5 0)',
      'rgba(10, 20, 30, 0)',
      'oklch(0.5 0.1 200)',
    ]
    bgs.forEach((c, i) => {
      const e = new El(
        'div',
        { 'data-id': 'n' + i },
        rect(0, i * 30, 50, 20),
        root,
      )
      e.style = { backgroundColor: c }
    })
  })
  assert.deepEqual(
    measureNodes(doc, win, 1000).nodes.map(n => n.bg),
    ['#ff8000', null, 'unreadable'],
  )
})

test('wide lists what reaches past the window, unless fixed or cut by a clipping ancestor', () => {
  const { doc, win } = page(root => {
    new El('div', { 'data-id': 'out' }, rect(100, 0, 1000, 20), root) // right = 1100
    new El('div', { 'data-id': 'ok' }, rect(0, 30, 1000, 20), root)
    const f = new El('div', { 'data-id': 'fixed' }, rect(0, 60, 1500, 20), root)
    f.style = { position: 'fixed' }
    const box = new El('div', { 'data-id': 'box' }, rect(0, 90, 500, 20), root)
    box.style = { overflowX: 'hidden' }
    new El('div', { 'data-id': 'inner' }, rect(0, 90, 900, 20), box)
  })
  assert.deepEqual(measureNodes(doc, win, 1000).wide, [{ id: 'out', by: 100 }])
})

test('PROBE_SCRIPT is measureNodes shipped as a function of (document, window, width)', () => {
  const { doc, win } = page(root => {
    new El('p', { 'data-id': 'p' }, rect(0, 0, 1200, 20), root, 'abc')
  })
  const shipped = new Function(`return (${PROBE_SCRIPT})`)()
  assert.deepEqual(shipped(doc, win, 1000), measureNodes(doc, win, 1000))
})

test('pixelsUnder gives the distinct colours of a 9 by 3 grid under each rect', async () => {
  const g = globalThis as unknown as Record<string, unknown>
  const was: Record<string, unknown> = {}
  for (const k of ['fetch', 'createImageBitmap', 'OffscreenCanvas'])
    if (k in g) was[k] = g[k]
  const absent = ['fetch', 'createImageBitmap', 'OffscreenCanvas'].filter(
    k => !(k in was),
  )
  const asked: string[] = []
  g.fetch = async (u: string) => {
    asked.push(u)
    return { blob: async () => 'blob' }
  }
  g.createImageBitmap = async () => ({ width: 100, height: 30 })
  g.OffscreenCanvas = class {
    getContext() {
      return {
        drawImage() {},
        // left half red, right half blue
        getImageData: (x: number) => ({
          data: x < 50 ? [255, 0, 0, 255] : [0, 0, 255, 255],
        }),
      }
    }
  }
  try {
    const out = await pixelsUnder({
      b64: 'AAAA',
      rects: [
        [0, 0, 40, 30],
        [0, 0, 100, 30],
        [200, 0, 300, 30], // clamped to the last column
      ],
    })
    assert.deepEqual(asked, ['data:image/png;base64,AAAA'])
    assert.deepEqual(out, [['#ff0000'], ['#ff0000', '#0000ff'], ['#0000ff']])
  } finally {
    for (const k of absent) delete g[k]
    Object.assign(g, was)
  }
})
