import ts from 'typescript'
import { transformSync } from 'esbuild'

/**
 * esbuild shortens locals but deliberately preserves DOM property names.
 * Pay once for frequently repeated ones: e.g. `const k="parentElement"; e[k]`.
 * Only rewrite accesses on the existing receiver and expression literals.
 * The output is ordinary ES2017, including every key and every call.
 */
export function shareScriptKeys(code: string): string {
  const file = ts.createSourceFile(
    'host.js',
    code,
    ts.ScriptTarget.ES2017,
    true,
    ts.ScriptKind.JS,
  )
  const first = file.statements[0]
  if (
    file.statements.length !== 1 ||
    !ts.isExpressionStatement(first) ||
    !ts.isCallExpression(first.expression)
  )
    return code
  const callee = first.expression.expression
  if (
    !ts.isParenthesizedExpression(callee) ||
    !ts.isArrowFunction(callee.expression) ||
    !ts.isBlock(callee.expression.body)
  )
    return code
  const body = callee.expression.body
  let start = body.getStart(file) + 1
  // Keep any directive prologue first.
  for (const s of body.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break
    start = s.end
  }
  type Ref = { lo: number; hi: number; property: boolean }
  const refs = new Map<string, Ref[]>()
  function visit(n: ts.Node) {
    let key: string | undefined,
      lo = n.pos,
      property = false
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.name) &&
      !n.questionDotToken
    ) {
      key = n.name.text
      lo = n.expression.end
      property = true
    } else if (
      ts.isStringLiteral(n) &&
      (ts.isCallExpression(n.parent) ||
        ts.isNewExpression(n.parent) ||
        ts.isElementAccessExpression(n.parent) ||
        ts.isBinaryExpression(n.parent) ||
        ts.isArrayLiteralExpression(n.parent) ||
        ts.isConditionalExpression(n.parent))
    ) {
      key = n.text
      lo = n.getStart(file)
    }
    if (key && key.length > 3 && key.length <= 64) {
      let sites = refs.get(key)
      if (!sites) refs.set(key, (sites = []))
      sites.push({ lo, hi: n.end, property })
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  let prefix = '$culmKey'
  while (code.includes(prefix)) prefix += '$'
  const defs: string[] = [],
    edits: [number, number, string][] = []
  for (const [key, sites] of refs) {
    const quoted = JSON.stringify(key)
    // Estimate using two-byte minified local names; accept by actual size below.
    const saving = sites.reduce(
      (n, r) => n + r.hi - r.lo - (r.property ? 4 : 2),
      0,
    )
    if (saving <= quoted.length + 4) continue
    const name = prefix + defs.length
    defs.push(`${name}=${quoted}`)
    for (const { lo, hi, property } of sites)
      // A quoted literal may be adjacent to a word operator (`"key"in obj`).
      edits.push([lo, hi, property ? `[${name}]` : ` ${name} `])
  }
  if (!defs.length) return code
  edits.push([start, start, `var ${defs.join(',')};`])
  let out = '',
    tail = 0
  for (const [lo, hi, value] of edits.sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  )) {
    out += code.slice(tail, lo) + value
    tail = hi
  }
  out = transformSync(out + code.slice(tail), {
    target: 'es2017',
    minify: true,
  }).code.trim()
  return Buffer.byteLength(out) < Buffer.byteLength(code) ? out : code
}
