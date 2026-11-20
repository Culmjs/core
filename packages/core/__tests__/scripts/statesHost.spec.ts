import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STATES_SCRIPT } from '../../src/scripts/scriptsMin.ts'
import { hostStates } from '../../src/scripts/statesHost.ts'

type Fn = (e?: unknown) => void
const All: El[] = []
const inside = (e: El, a: El) => {
  for (let x = e.parent; x; x = x.parent) if (x === a) return true
  return false
}
class El {
  attrs = new Map<string, string>()
  ls = new Map<string, Fn[]>()
  calls: string[] = []
  constructor(
    public parent?: El,
    a: Record<string, string> = {},
  ) {
    for (const k in a) this.attrs.set(k, a[k])
    All.push(this)
  }
  querySelectorAll(sel: string) {
    return All.filter(e => e.matches(sel) && inside(e, this))
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v)
  }
  addEventListener(t: string, f: Fn) {
    this.ls.set(t, [...(this.ls.get(t) ?? []), f])
  }
  closest(sel: string): El | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- a DOM stub walks its own parent chain
    for (let e: El | undefined = this; e; e = e.parent)
      if (e.matches(sel)) return e
    return null
  }
  matches(sel: string) {
    const [k, v] = sel.slice(1, -1).split('=')
    return v === undefined ? this.attrs.has(k) : this.attrs.get(k) === v
  }
  fire(t: string, e?: unknown) {
    ;(this.ls.get(t) ?? []).forEach(f => f(e))
  }
  focus() {
    this.calls.push('focus')
  }
  click() {
    this.calls.push('click')
    this.fire('click')
  }
  scrollIntoView(o: { behavior: string }) {
    this.calls.push(`scroll:${o.behavior}`)
  }
  play() {
    this.calls.push('play')
    return Promise.resolve()
  }
  pause() {
    this.calls.push('pause')
  }
  remove() {
    this.calls.push('remove')
  }
}

function run(els: El[], o: { reduce?: boolean; times?: number } = {}) {
  const byId = new Map<string, El>()

  let cb: (e: unknown[]) => void = () => {}
  const w: Record<string, unknown> = {
    matchMedia: () => ({ matches: !!o.reduce }),
    location: { href: 'https://x.test/here' },
    IntersectionObserver: class {
      constructor(f: typeof cb) {
        cb = f
      }
      observe() {}
      unobserve() {}
    },
  }
  const d = {
    querySelectorAll: (s: string) => els.filter(e => e.matches(s)),
    getElementById: (id: string) => byId.get(id) ?? null,
  }
  for (let i = 0; i < (o.times ?? 1); i++)
    new Function('document', 'window', STATES_SCRIPT)(d, w)
  return {
    byId,
    w,
    see: (el: El, isIntersecting: boolean) =>
      cb([{ target: el, isIntersecting }]),
  }
}

test('click sets data-s-tab on the nearest holder', () => {
  const holder = new El(undefined, { 'data-s-tab': 'papers' })
  const btn = new El(holder, { 'data-s-on': 'click:set:tab:talks' })
  run([btn])
  btn.fire('click')
  assert.equal(holder.getAttribute('data-s-tab'), 'talks')
})

test('toggle flips an on-off state', () => {
  const holder = new El(undefined, { 'data-s-menu': 'off' })
  const btn = new El(holder, { 'data-s-on': 'click:toggle:menu' })
  run([btn])
  btn.fire('click')
  assert.equal(holder.getAttribute('data-s-menu'), 'on')
  btn.fire('click')
  assert.equal(holder.getAttribute('data-s-menu'), 'off')
})

test('hover also fires on focus and undoes on leave or blur', () => {
  const holder = new El(undefined, { 'data-s-tab': 'papers' })
  const a = new El(holder, { 'data-s-on': 'hover:set:tab:talks' })
  run([a])
  a.fire('focusin')
  assert.equal(holder.getAttribute('data-s-tab'), 'talks')
  a.fire('focusout')
  assert.equal(holder.getAttribute('data-s-tab'), 'papers')
  a.fire('mouseenter')
  assert.equal(holder.getAttribute('data-s-tab'), 'talks')
  a.fire('mouseleave')
  assert.equal(holder.getAttribute('data-s-tab'), 'papers')
})

test('scrollTo is smooth unless motion is reduced; goTo decodes; play and pause reach the video', () => {
  for (const reduce of [false, true]) {
    const target = new El(),
      video = new El()
    const a = new El(undefined, {
      'data-s-on':
        'click:scrollTo:w-go click:goTo:%2Fabout%3Fa%3D1 click:play:w-v click:pause:w-v',
    })
    const r = run([a], { reduce })
    r.byId.set('w-go', target)
    r.byId.set('w-v', video)
    a.fire('click')
    assert.deepEqual(target.calls, [reduce ? 'scroll:auto' : 'scroll:smooth'])
    assert.equal(
      (r.w.location as { href: string }).href,
      'https://x.test/about?a=1',
    )
    assert.deepEqual(video.calls, ['play', 'pause'])
  }
})

test('a verb outside the list does nothing', () => {
  const t = new El(),
    a = new El(undefined, { 'data-s-on': 'click:remove:w-t' })
  const r = run([a])
  r.byId.set('w-t', t)
  a.fire('click')
  assert.deepEqual(t.calls, [])
})

test('reduced motion keeps state changes', () => {
  const holder = new El(undefined, { 'data-s-tab': 'papers' })
  const e = new El(holder, { 'data-s-on': 'click:set:tab:talks' })
  run([e], { reduce: true })
  e.fire('click')
  assert.equal(holder.getAttribute('data-s-tab'), 'talks')
})

test('enter-view and leave-view fire from the one observer; leave only after entering', () => {
  const holder = new El(undefined, { 'data-s-tab': 'papers' })
  const a = new El(holder, {
    'data-s-on': 'enter-view:set:tab:talks leave-view:set:tab:papers',
  })
  const r = run([a])
  r.see(a, false)
  assert.equal(holder.getAttribute('data-s-tab'), 'papers')
  r.see(a, true)
  assert.equal(holder.getAttribute('data-s-tab'), 'talks')
  holder.setAttribute('data-s-tab', 'x')
  r.see(a, false)
  assert.equal(holder.getAttribute('data-s-tab'), 'papers')
})

test('goTo only navigates to http, https or mailto, and a bad value never throws', () => {
  for (const [to, want] of [
    ['javascript%3Aalert(1)', 'https://x.test/here'],
    ['data%3Atext%2Fhtml%2Cx', 'https://x.test/here'],
    ['%E0%A4%A', 'https://x.test/here'],
    ['mailto%3Aa%40b.c', 'mailto:a@b.c'],
    ['%23top', 'https://x.test/here#top'],
    ['https%3A%2F%2Fy.org%2F', 'https://y.org/'],
  ]) {
    const a = new El(undefined, { 'data-s-on': `click:goTo:${to}` })
    const r = run([a])
    a.fire('click')
    assert.equal((r.w.location as { href: string }).href, want, to)
  }
})

test('hover leave restores only while the value is still the one hover set', () => {
  const holder = new El(undefined, { 'data-s-tab': 'papers' })
  const a = new El(holder, { 'data-s-on': 'hover:set:tab:talks' })
  run([a])
  a.fire('mouseenter')
  holder.setAttribute('data-s-tab', 'news')
  a.fire('mouseleave')
  assert.equal(holder.getAttribute('data-s-tab'), 'news')
})

test("hostStates wires every listener with the caller's signal, and the shipped text is that function", () => {
  const seen: unknown[] = []
  const btn = Object.assign(
    new El(undefined, {
      'data-s-on': 'click:set:tab:talks hover:set:tab:papers',
    }),
    {
      addEventListener: (_t: string, _f: Fn, o?: unknown) => {
        seen.push(o)
      },
    },
  )
  const ac = new AbortController()
  hostStates(
    {
      querySelectorAll: (s: string) =>
        (s == '[data-s-on]' ? [btn] : []) as never,
      getElementById: () => null,
    },
    { location: { href: 'https://x.test/' } },
    ac.signal,
  )
  assert.equal(seen.length, 5, 'click plus the four hover listeners')
  assert.ok(
    seen.every(o => (o as { signal: AbortSignal }).signal === ac.signal),
  )
  assert.ok(
    STATES_SCRIPT.startsWith('(function(') &&
      STATES_SCRIPT.endsWith(')(document,window)'),
  )
})

function tabsPage() {
  const holder = new El(undefined, { 'data-s-tab': 'a' }),
    list = new El(holder, { role: 'tablist' })
  const tab = (v: string, sel: boolean) =>
    new El(list, {
      role: 'tab',
      'aria-selected': String(sel),
      'data-s-on': `click:set:tab:${v}`,
    })
  const ts = [tab('a', true), tab('b', false), tab('c', false)]
  run(ts)
  return {
    holder,
    ts,
    state: () => ts.map(t => `${t.getAttribute('aria-selected')}`),
  }
}

test('choosing a tab moves aria-selected', () => {
  const p = tabsPage()
  p.ts[2].fire('click')
  assert.equal(p.holder.getAttribute('data-s-tab'), 'c')
  assert.deepEqual(p.state(), ['false', 'false', 'true'])
})

test('hover undo puts aria-selected back', () => {
  const holder = new El(undefined, { 'data-s-tab': 'a' })
  const t1 = new El(holder, {
    role: 'tab',
    'aria-selected': 'true',
    'data-s-on': 'click:set:tab:a',
  })
  const t2 = new El(holder, {
    role: 'tab',
    'aria-selected': 'false',
    'data-s-on': 'click:set:tab:b hover:set:tab:b',
  })
  run([t1, t2])
  t2.fire('mouseenter')
  assert.deepEqual(
    [t1, t2].map(t => t.getAttribute('aria-selected')),
    ['false', 'true'],
  )
  t2.fire('mouseleave')
  assert.deepEqual(
    [t1, t2].map(t => t.getAttribute('aria-selected')),
    ['true', 'false'],
  )
})

test('the shipped script run twice on the same page wires once', () => {
  const holder = new El(undefined, { 'data-s-menu': 'off', 'data-s-tab': 'a' })
  const sw = new El(holder, { 'data-s-on': 'click:toggle:menu' })
  const nx = new El(holder, { 'data-s-on': 'click:step:tab:1.a.b.c' })
  run([sw, nx], { times: 2 })
  sw.fire('click')
  assert.equal(holder.getAttribute('data-s-menu'), 'on')
  nx.fire('click')
  assert.equal(holder.getAttribute('data-s-tab'), 'b')
})

test('step moves to the next or previous value and wraps round', () => {
  const holder = new El(undefined, { 'data-s-tab': 'a' })
  const next = new El(holder, { 'data-s-on': 'click:step:tab:1.a.b.c' })
  const prev = new El(holder, { 'data-s-on': 'click:step:tab:-1.a.b.c' })
  run([next, prev])
  const seen: (string | null)[] = []
  for (const b of [next, next, next, prev, prev]) {
    b.fire('click')
    seen.push(holder.getAttribute('data-s-tab'))
  }
  assert.deepEqual(seen, ['b', 'c', 'a', 'c', 'b'])
})

test('submit runs its trigger', () => {
  const holder = new El(undefined, { 'data-s-tab': 'a' })
  const form = new El(holder, { 'data-s-on': 'submit:set:tab:b' })
  run([form])
  form.fire('submit')
  assert.equal(holder.getAttribute('data-s-tab'), 'b')
})

test('a toggle sets aria-expanded; Escape closes it and returns the focus to its button', () => {
  const holder = new El(undefined, { 'data-s-menu': 'off' })
  const btn = new El(holder, { 'data-s-on': 'click:toggle:menu' })
  run([btn])
  assert.equal(btn.getAttribute('aria-expanded'), 'false')
  btn.fire('click')
  assert.equal(btn.getAttribute('aria-expanded'), 'true')
  assert.equal(holder.getAttribute('data-s-menu'), 'on')
  holder.fire('keydown', { key: 'a' })
  assert.equal(holder.getAttribute('data-s-menu'), 'on')
  holder.fire('keydown', { key: 'Escape' })
  assert.equal(holder.getAttribute('data-s-menu'), 'off')
  assert.equal(btn.getAttribute('aria-expanded'), 'false')
  assert.deepEqual(btn.calls, ['focus'])
})
