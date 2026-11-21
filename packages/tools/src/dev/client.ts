/** Appears in the served pages and in no file `culm build` writes. */
export const CLIENT_MARKER = 'culm-dev-client'

/**
 * The browser side of `culm dev`: reloads on `reload`, and on `problems` draws an overlay of file:line:column, the message and the allowed values.
 * Every piece of text goes in with textContent, so a message cannot inject HTML.
 */
export const CLIENT_SCRIPT = `/* ${CLIENT_MARKER} */
(function () {
  var box = null
  function clear() {
    if (box) box.remove()
    box = null
  }
  function line(parent, text, css) {
    var d = document.createElement('div')
    d.textContent = text
    d.style.cssText = css || ''
    parent.appendChild(d)
  }
  function draw(problems) {
    clear()
    box = document.createElement('div')
    box.id = 'culm-dev-overlay'
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:24px;background:rgba(20,20,20,.95);color:#fff;font:14px/1.5 ui-monospace,monospace'
    line(box, 'Culm: ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ' (the page shown is the last good one)', 'font-weight:700;margin-bottom:16px')
    problems.forEach(function (p) {
      var item = document.createElement('div')
      item.style.cssText = 'margin-bottom:16px'
      var where = [p.file, p.line, p.column].filter(function (x) { return x !== undefined && x !== null }).join(':')
      if (where) line(item, where, 'color:#fca5a5')
      line(item, String(p.message))
      if (p.allowed && p.allowed.length) line(item, 'Allowed: ' + p.allowed.join(', '), 'color:#a7f3d0')
      box.appendChild(item)
    })
    document.body.appendChild(box)
  }
  var es = new EventSource('/__culm/events')
  es.addEventListener('reload', function () { location.reload() })
  es.addEventListener('problems', function (e) {
    try { draw(JSON.parse(e.data)) } catch (_) {}
  })
})()
`
