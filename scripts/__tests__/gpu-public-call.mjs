import assert from 'node:assert/strict'

// Exercise installed and source entry points with the same visibility event.
export function publicCall(root, scripts) {
  assert.equal(root.hostGpu, scripts.hostGpu)
  const owner = {},
    data = {},
    appended = []
  let callback,
    observed = 0
  const win = {
    navigator: {},
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    IntersectionObserver: class {
      constructor(fn) {
        callback = fn
      }
      observe(el) {
        assert.equal(el, owner)
        observed++
      }
      disconnect() {}
    },
  }
  const doc = {
    getElementById: () => null,
    querySelector: () => ({}),
    querySelectorAll: () => [owner],
    createElement: () => ({}),
    head: { append: el => appended.push(el) },
  }
  root.hostGpu(doc, win)
  assert.equal(callback, undefined)
  doc.getElementById = () => data
  scripts.hostGpu(doc, win)
  root.hostGpu(doc, win)
  assert.equal(observed, 1)
  assert.deepEqual(appended, [])
  callback([
    { isIntersecting: true, boundingClientRect: { width: 320, height: 120 } },
  ])
  assert.deepEqual(appended, [
    { src: '/' + root.GPU_HOST_PATH, integrity: root.GPU_HOST_INTEGRITY },
  ])
}
