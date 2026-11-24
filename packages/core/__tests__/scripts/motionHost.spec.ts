import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BASE_SCRIPT,
  OPEN_SCRIPT,
  EMAIL_SCRIPT,
  STATES_SCRIPT,
  TIMELINE_SCRIPT,
  hostMotion,
} from '../../src/scripts/index.ts'
import { BUDGETS } from '../../src/compile/budgets.ts'
import { Script } from 'node:vm'

test('the complete invoked timeline is standalone, local, and within its raw ceiling', () => {
  assert.ok(TIMELINE_SCRIPT.length)
  assert.doesNotThrow(() => new Script(TIMELINE_SCRIPT))
  assert.doesNotMatch(
    TIMELINE_SCRIPT,
    /\b(?:import|export|fetch|XMLHttpRequest|WebSocket|eval|Function|localStorage|sessionStorage)\b/,
  )
  assert.ok(Buffer.byteLength(TIMELINE_SCRIPT) <= BUDGETS.timelineScript)
  assert.deepEqual(
    [BASE_SCRIPT, OPEN_SCRIPT, EMAIL_SCRIPT, STATES_SCRIPT].map(s =>
      Buffer.byteLength(s),
    ),
    [304, 105, 277, 1963],
  )
})

test('preference changes and abort restore the document; an entered owner never replays', () => {
  let plays = 0,
    cancels = 0,
    ends = 0,
    mark = false
  const enter = new Set<() => void>()
  const media = Object.assign(new EventTarget(), { matches: false })
  const win = {
    matchMedia: () => media,
    AbortController,
    IntersectionObserver: class {
      enter: () => void
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        this.enter = () => cb([{ isIntersecting: true }])
      }
      observe() {
        enter.add(this.enter)
      }
      disconnect() {
        enter.delete(this.enter)
      }
    },
  } as unknown as Window
  const owner = {
    getAttribute: () =>
      JSON.stringify({
        trigger: 'enter-view',
        duration: 100,
        tracks: [
          [[[0, 0]], [{ opacity: 0 }, { opacity: 1 }], { duration: 100 }],
        ],
      }),
    setAttribute() {
      mark = true
    },
    removeAttribute() {
      mark = false
    },
    animate() {
      plays++
      return {
        cancel() {
          cancels++
        },
        finish() {
          ends++
        },
      }
    },
  }
  const doc = {
    querySelectorAll: () => [owner],
    timeline: { currentTime: 10 },
  } as unknown as Document
  const controller = new AbortController()
  for (let i = 0; i < 2; i++) hostMotion(doc, win, controller.signal)
  assert.equal(enter.size, 1)
  for (const hit of enter) hit()
  assert.deepEqual([plays, mark, enter.size], [1, true, 0])
  media.matches = true
  media.dispatchEvent(new Event('change'))
  assert.deepEqual([cancels, mark], [1, false])
  media.matches = false
  media.dispatchEvent(new Event('change'))
  assert.deepEqual([ends, enter.size], [1, 0])
  controller.abort()
  assert.deepEqual([cancels, mark], [2, false])
  media.dispatchEvent(new Event('change'))
  assert.equal(plays, 2)
  hostMotion(doc, win)
  assert.equal(enter.size, 1)
})

test('aborting an active press preview cancels its tracks and detaches both input sources', () => {
  let plays = 0,
    stops = 0
  const owner = Object.assign(new EventTarget(), {
    getAttribute: () =>
      JSON.stringify({
        trigger: 'press',
        tracks: [
          [[[0, 0]], [{ opacity: 0 }, { opacity: 1 }], { duration: 100 }],
        ],
      }),
    setAttribute() {},
    removeAttribute() {},
    animate() {
      plays++
      return {
        cancel() {
          stops++
        },
      }
    },
  })
  const realm = Object.assign(new EventTarget(), {
    AbortController,
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  })
  const doc = {
    querySelectorAll: () => [owner],
    timeline: { currentTime: 0 },
  } as unknown as Document
  const controller = new AbortController()
  hostMotion(doc, realm as unknown as Window, controller.signal)
  const hold = () => {
    owner.dispatchEvent(
      Object.assign(new Event('pointerdown'), { button: 0, pointerId: 8 }),
    )
    owner.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
  }
  hold()
  assert.deepEqual([plays, stops], [1, 0])
  controller.abort()
  hold()
  assert.deepEqual([plays, stops], [1, 1])
})
