import test from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { measureScripts, renderPrototype } from '../motion-spike.ts'

test('accounts for both joins and UTF-8', () => {
  const r = measureScripts('A', 'é', 'BC')
  assert.deepEqual(
    [r.baseMax, r.states, r.joins, r.timelinePrototype, r.total, r.headroom],
    [1, 2, 2, 2, 7, 19_993],
  )
})

test('minified slice splits, staggers, seeks in both directions and detaches', () => {
  class El {
    style: Record<string, string> = {}
    children: El[] = []
    private text = ''
    get textContent(): string {
      return this.text + this.children.map(el => el.textContent).join('')
    }
    set textContent(s: string) {
      this.text = s
      this.children = []
    }
    append(el: El) {
      this.children.push(el)
    }
  }
  const heading = new El()
  heading.textContent = 'Reed'
  const marks = [new El(), new El()]
  marks[0]!.style.transform = 'rotate(5deg)'
  const document = {
    querySelector: (s: string) =>
      s === '[data-spike-heading]' ? heading : null,
    querySelectorAll: (s: string) => (s === '[data-spike-mark]' ? marks : []),
    createElement: () => new El(),
    documentElement: { scrollHeight: 1600 },
  }
  const window = Object.assign(new EventTarget(), {
    scrollY: 0,
    innerHeight: 600,
  })
  new Function('document', 'window', renderPrototype())(document, window)
  const letters = heading.children.map(mask => mask.children[0]!)
  assert.deepEqual(
    letters.map(el => el.textContent),
    [...'Reed'],
  )
  const positions = () => marks.map(m => m.style.transform)
  const seek = (y: number) => {
    window.scrollY = y
    window.dispatchEvent(new Event('scroll'))
  }
  assert.deepEqual(positions(), ['translateX(0px)', 'translateX(0px)'])
  assert.equal(letters[0]!.style.transform, 'translateX(105%)')
  seek(500)
  assert.deepEqual(positions(), ['translateX(300px)', 'translateX(200px)'])
  assert.equal(letters[0]!.style.transform, 'translateX(42%)')
  seek(1000)
  assert.deepEqual(positions(), ['translateX(500px)', 'translateX(500px)'])
  assert.ok(letters.every(el => el.style.transform === 'translateX(0%)'))
  seek(500)
  assert.deepEqual(positions(), ['translateX(300px)', 'translateX(200px)'])
  window.innerHeight = 1100
  window.dispatchEvent(new Event('resize'))
  assert.deepEqual(positions(), ['translateX(500px)', 'translateX(500px)'])
  window.dispatchEvent(new Event('pagehide'))
  for (const name of ['scroll', 'resize', 'pagehide'])
    assert.equal(getEventListeners(window, name).length, 0, name)
  assert.equal(heading.textContent, 'Reed')
  assert.equal(heading.children.length, 0)
  assert.equal(marks[0]!.style.transform, 'rotate(5deg)')
})
