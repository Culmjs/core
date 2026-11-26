import ts from 'typescript'
import { transformSync } from 'esbuild'

const GLOBALS = new Set([
  'Math',
  'Object',
  'Array',
  'JSON',
  'Uint8Array',
  'WebAssembly',
  'URL',
  'Blob',
  'Worker',
  'AbortController',
  'IntersectionObserver',
  'ResizeObserver',
  'MutationObserver',
  'getComputedStyle',
  'setTimeout',
  'clearTimeout',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'postMessage',
  'parseFloat',
  'isFinite',
  'Intl',
  'Element',
  'document',
  'window',
  'decodeURIComponent',
  'Map',
  'Set',
])

export type ShareMode = 'args' | 'defaults' | 'vars'

function isExprString(n: ts.StringLiteral, body: ts.Block) {
  const p = n.parent
  if (ts.isExpressionStatement(p) && p.parent === body) return false
  if (ts.isPropertyAssignment(p) && p.name === n) return false
  if (
    ts.isImportDeclaration(p) ||
    ts.isExportDeclaration(p) ||
    ts.isLiteralTypeNode(p)
  )
    return false
  return true
}

function collectInternSites(code: string) {
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
    return null
  const call = first.expression
  const callee = call.expression
  if (
    !ts.isParenthesizedExpression(callee) ||
    (!ts.isArrowFunction(callee.expression) &&
      !ts.isFunctionExpression(callee.expression)) ||
    !ts.isBlock(callee.expression.body)
  )
    return null
  const fn = callee.expression
  const isArrow = ts.isArrowFunction(fn)
  const body = fn.body as ts.Block
  let start = body.getStart(file) + 1
  for (const s of body.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break
    start = s.end
  }
  const hasUseStrict = start > body.getStart(file) + 1
  const declared = new Set<string>()
  function collectDecl(n: ts.Node) {
    if (
      (ts.isVariableDeclaration(n) ||
        ts.isParameter(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isClassDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    )
      declared.add(n.name.text)
    ts.forEachChild(n, collectDecl)
  }
  collectDecl(fn)

  type Site = { lo: number; hi: number; mode: 'prop' | 'str' | 'objkey' }
  const refs = new Map<
    string,
    { id: string; kind: 'str' | 'glob' | 'num'; sites: Site[] }
  >()
  const addRef = (id: string, kind: 'str' | 'glob' | 'num', site: Site) => {
    let e = refs.get(id)
    if (!e) refs.set(id, (e = { id, kind, sites: [] }))
    e.sites.push(site)
  }
  function visit(n: ts.Node) {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.name) &&
      !n.questionDotToken
    ) {
      if (n.name.text.length >= 2 && n.name.text.length <= 200)
        addRef('S:' + n.name.text, 'str', {
          lo: n.expression.end,
          hi: n.end,
          mode: 'prop',
        })
    } else if (
      ts.isPropertyAssignment(n) &&
      (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) &&
      n.name.text.length >= 3
    ) {
      addRef('S:' + n.name.text, 'str', {
        lo: n.name.getStart(file),
        hi: n.name.end,
        mode: 'objkey',
      })
    } else if (
      ts.isStringLiteral(n) &&
      n.text.length >= 2 &&
      n.text.length <= 320 &&
      isExprString(n, body)
    ) {
      addRef('S:' + n.text, 'str', {
        lo: n.getStart(file),
        hi: n.end,
        mode: 'str',
      })
    } else if (ts.isNumericLiteral(n)) {
      const raw = code.slice(n.getStart(file), n.end)
      if (
        raw.length >= 4 &&
        !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)
      )
        addRef('N:' + raw, 'num', {
          lo: n.getStart(file),
          hi: n.end,
          mode: 'str',
        })
    } else if (n.kind === ts.SyntaxKind.NullKeyword) {
      addRef('K:null', 'num', { lo: n.getStart(file), hi: n.end, mode: 'str' })
    } else if (
      ts.isIdentifier(n) &&
      GLOBALS.has(n.text) &&
      !declared.has(n.text) &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
      !(ts.isPropertyAssignment(n.parent) && n.parent.name === n) &&
      !ts.isShorthandPropertyAssignment(n.parent)
    ) {
      addRef('G:' + n.text, 'glob', {
        lo: n.getStart(file),
        hi: n.end,
        mode: 'str',
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(body)

  let prefix = '$culmK'
  while (code.includes(prefix)) prefix += '$'
  const cands = [...refs.values()]
    .map(e => {
      const valExpr =
        e.kind === 'str' ? JSON.stringify(e.id.slice(2)) : e.id.slice(2)
      const gain =
        e.sites.reduce(
          (n, r) => n + (r.hi - r.lo) - (r.mode === 'str' ? 1 : 3),
          0,
        ) -
        (valExpr.length + 2)
      return { ...e, valExpr, gain }
    })
    .filter(c => c.sites.length > 1 && c.gain > -6)
    .sort((a, b) => b.gain - a.gain)

  return { file, call, fn, isArrow, body, start, hasUseStrict, prefix, cands }
}

function finishJs(js: string, noBackticks: boolean) {
  let res = transformSync(js, { target: 'es2017', minify: true })
    .code.trim()
    .replace(/;$/, '')
  if (noBackticks)
    res = res.replace(/`([^`$\\]*)\n([^`$\\]*)`/g, (_, a: string, b: string) =>
      JSON.stringify(a + '\n' + b),
    )
  return res
}

function emitChosen(
  code: string,
  ctx: NonNullable<ReturnType<typeof collectInternSites>>,
  chosen: typeof ctx.cands,
  mode: ShareMode,
  noBackticks: boolean,
) {
  if (!chosen.length) return finishJs(code, noBackticks)
  const { file, call, fn, isArrow, body, start, hasUseStrict, prefix } = ctx
  const effMode: ShareMode = mode === 'defaults' && hasUseStrict ? 'vars' : mode
  const edits: [number, number, string][] = []
  const params: string[] = []
  const args: string[] = []
  chosen.forEach((ch, idx) => {
    const name = prefix + idx
    params.push(name)
    args.push(ch.valExpr)
    for (const s of ch.sites)
      edits.push([s.lo, s.hi, s.mode === 'str' ? ` ${name} ` : `[${name}]`])
  })
  const defs = params.map((p, i) => `${p}=${args[i]}`).join(',')
  if (effMode === 'args' && isArrow && call.arguments.length === 0) {
    edits.push([
      fn.getStart(file),
      body.getStart(file),
      `(${params.join(',')})=>`,
    ])
    edits.push([call.end - 1, call.end, `${args.join(',')})`])
  } else if (
    effMode === 'args' &&
    fn.parameters.length > 0 &&
    call.arguments.length === fn.parameters.length
  ) {
    const pEnd = fn.parameters[fn.parameters.length - 1].end
    const aEnd = call.arguments[call.arguments.length - 1].end
    edits.push([pEnd, pEnd, `,${params.join(',')}`])
    edits.push([aEnd, aEnd, `,${args.join(',')}`])
  } else if (effMode === 'defaults' && fn.parameters.length > 0) {
    const pEnd = fn.parameters[fn.parameters.length - 1].end
    edits.push([pEnd, pEnd, `,${defs}`])
  } else if (effMode === 'defaults' && isArrow && call.arguments.length === 0) {
    edits.push([fn.getStart(file), body.getStart(file), `(${defs})=>`])
  } else {
    edits.push([start, start, `var ${defs};`])
  }
  let out = ''
  let tail = 0
  for (const [lo, hi, v] of edits.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    out += code.slice(tail, lo) + v
    tail = hi
  }
  return finishJs(out + code.slice(tail), noBackticks)
}

function fastIntern(code: string, mode: ShareMode, noBackticks: boolean) {
  const ctx = collectInternSites(code)
  if (!ctx) return code
  const good = ctx.cands.filter(c => c.gain >= 0)
  return emitChosen(code, ctx, good, mode, noBackticks)
}

function internAll(code: string, modes: ShareMode[], noBackticks = false) {
  const ctx = collectInternSites(code)
  if (!ctx) return code
  let overallBest = finishJs(code, noBackticks)
  for (const mode of modes) {
    let best = finishJs(code, noBackticks)
    let bestLen = Buffer.byteLength(best)
    let chosen: typeof ctx.cands = []
    for (const c of ctx.cands.slice(0, 145)) {
      chosen.push(c)
      const out = emitChosen(code, ctx, chosen, mode, noBackticks)
      const len = Buffer.byteLength(out)
      if (len < bestLen) {
        best = out
        bestLen = len
      } else chosen.pop()
    }
    for (const c of ctx.cands.slice(0, 145)) {
      if (chosen.includes(c)) continue
      chosen.push(c)
      const out = emitChosen(code, ctx, chosen, mode, noBackticks)
      const len = Buffer.byteLength(out)
      if (len < bestLen) {
        best = out
        bestLen = len
      } else chosen.pop()
    }
    for (let i = chosen.length - 1; i >= 0; i--) {
      const next = chosen.filter((_, j) => j !== i)
      const out = emitChosen(code, ctx, next, mode, noBackticks)
      const len = Buffer.byteLength(out)
      if (len <= bestLen) {
        chosen = next
        best = out
        bestLen = len
      }
    }
    if (Buffer.byteLength(best) < Buffer.byteLength(overallBest))
      overallBest = best
  }
  return overallBest
}

function shareWithStems(
  rawCode: string,
  mode: ShareMode,
  noBackticks = false,
  minInterior = 5,
  maxWhole = 3,
  protect = 'u_O=K==2?',
) {
  const file = ts.createSourceFile(
    'host.js',
    rawCode,
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
    return rawCode
  const callee = first.expression.expression
  if (
    !ts.isParenthesizedExpression(callee) ||
    (!ts.isArrowFunction(callee.expression) &&
      !ts.isFunctionExpression(callee.expression)) ||
    !ts.isBlock(callee.expression.body)
  )
    return rawCode
  const body = callee.expression.body

  type Tok = {
    lo: number
    hi: number
    text: string
    mode: 'prop' | 'str' | 'objkey'
  }
  const tokens: Tok[] = []
  const wholeCounts = new Map<string, number>()
  function visit(n: ts.Node) {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.name) &&
      !n.questionDotToken
    ) {
      if (n.name.text.length >= 4) {
        tokens.push({
          lo: n.expression.end,
          hi: n.end,
          text: n.name.text,
          mode: 'prop',
        })
        wholeCounts.set(n.name.text, (wholeCounts.get(n.name.text) || 0) + 1)
      }
    } else if (
      ts.isPropertyAssignment(n) &&
      (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) &&
      n.name.text.length >= 4
    ) {
      tokens.push({
        lo: n.name.getStart(file),
        hi: n.name.end,
        text: n.name.text,
        mode: 'objkey',
      })
      wholeCounts.set(n.name.text, (wholeCounts.get(n.name.text) || 0) + 1)
    } else if (
      ts.isStringLiteral(n) &&
      n.text.length >= 4 &&
      n.text.length <= 320 &&
      isExprString(n, body)
    ) {
      tokens.push({
        lo: n.getStart(file),
        hi: n.end,
        text: n.text,
        mode: 'str',
      })
      wholeCounts.set(n.text, (wholeCounts.get(n.text) || 0) + 1)
    }
    ts.forEachChild(n, visit)
  }
  visit(body)

  const subDistinct = new Map<string, number>()
  for (const [txt, wCnt] of wholeCounts.entries()) {
    const safeTxt = txt.includes(protect)
      ? txt.slice(0, txt.indexOf(protect))
      : txt
    const maxL = Math.min(28, safeTxt.length)
    const seen = new Set<string>()
    for (let len = 3; len <= maxL; len++) {
      for (let i = 0; i + len <= safeTxt.length; i++) {
        if (len === 3 && i !== 0 && i + len !== safeTxt.length) continue
        const sub = safeTxt.slice(i, i + len)
        if (seen.has(sub)) continue
        seen.add(sub)
        if (wCnt >= maxWhole && sub !== txt) continue
        let occ = 0
        let pos = 0
        while ((pos = safeTxt.indexOf(sub, pos)) !== -1) {
          occ++
          pos += len
        }
        subDistinct.set(sub, (subDistinct.get(sub) || 0) + occ)
      }
    }
  }

  const rawCands = [...subDistinct.entries()]
    .filter(
      ([sub, cnt]) =>
        cnt >= 3 && cnt * (sub.length - 2) - (sub.length + 3) >= -3,
    )
    .sort((a, b) => b[0].length - a[0].length)
  const maximal: [string, number][] = []
  for (const [sub, cnt] of rawCands) {
    if (maximal.some(([sup, supCnt]) => supCnt >= cnt && sup.includes(sub)))
      continue
    maximal.push([sub, cnt])
  }
  const stemCands = maximal
    .map(([sub, cnt]) => ({
      sub,
      cnt,
      est: cnt * (sub.length - 2) - (sub.length + 3),
    }))
    .sort((a, b) => b.est - a.est)
    .slice(0, 150)

  const applyStems = (stems: string[]) => {
    if (!stems.length) return rawCode
    const sorted = [...stems].sort((a, b) => b.length - a.length)
    const splitStr = (
      str: string,
      smode: 'prop' | 'str' | 'objkey',
    ): string[] | null => {
      if (sorted.includes(str))
        return smode !== 'str' && (wholeCounts.get(str) || 0) === 1
          ? [JSON.stringify(str)]
          : null
      if ((wholeCounts.get(str) || 0) >= maxWhole) return null
      const pIdx = str.indexOf(protect)
      const head = pIdx === -1 ? str : str.slice(0, pIdx)
      const tail = pIdx === -1 ? '' : str.slice(pIdx)
      const parts: string[] = []
      let i = 0
      let used = false
      while (i < head.length) {
        let hit: { s: string; pos: number } | undefined
        for (const s of sorted) {
          let searchFrom = i
          while (searchFrom <= head.length - s.length) {
            const p = head.indexOf(s, searchFrom)
            if (p === -1) break
            const atEdge = p === i || (p + s.length === head.length && !tail)
            if (atEdge || s.length >= minInterior) {
              if (
                !hit ||
                p < hit.pos ||
                (p === hit.pos && s.length > hit.s.length)
              )
                hit = { s, pos: p }
              break
            }
            searchFrom = p + 1
          }
        }
        if (!hit) {
          parts.push(JSON.stringify(head.slice(i) + tail))
          if (tail) i = head.length
          break
        }
        if (hit.pos > i) parts.push(JSON.stringify(head.slice(i, hit.pos)))
        parts.push(JSON.stringify(hit.s))
        used = true
        i = hit.pos + hit.s.length
        if (i === head.length && tail) parts.push(JSON.stringify(tail))
      }
      return used ? parts : null
    }
    const edits: [number, number, string][] = []
    for (const t of tokens) {
      const parts = splitStr(t.text, t.mode)
      if (!parts) continue
      const expr = parts.join('+')
      edits.push([
        t.lo,
        t.hi,
        t.mode !== 'str' ? `[${expr}]` : parts.length > 1 ? `(${expr})` : expr,
      ])
    }
    if (!edits.length) return rawCode
    let out = ''
    let tail = 0
    for (const [lo, hi, v] of edits.sort(
      (a, b) => a[0] - b[0] || a[1] - b[1],
    )) {
      out += rawCode.slice(tail, lo) + v
      tail = hi
    }
    return out + rawCode.slice(tail)
  }

  let fastBestLen = Buffer.byteLength(fastIntern(rawCode, mode, noBackticks))
  const chosen: string[] = []
  for (let pass = 0; pass < 2; pass++) {
    for (const c of stemCands) {
      if (chosen.includes(c.sub)) continue
      chosen.push(c.sub)
      const preSplit = applyStems(chosen)
      if (preSplit === rawCode) {
        chosen.pop()
        continue
      }
      const len = Buffer.byteLength(fastIntern(preSplit, mode, noBackticks))
      if (len < fastBestLen) fastBestLen = len
      else chosen.pop()
    }
  }
  for (let i = chosen.length - 1; i >= 0; i--) {
    const next = chosen.filter((_, j) => j !== i)
    const len = Buffer.byteLength(
      fastIntern(applyStems(next), mode, noBackticks),
    )
    if (len <= fastBestLen) {
      chosen.splice(i, 1)
      fastBestLen = len
    }
  }
  return chosen.length ? applyStems(chosen) : rawCode
}

export function shareScriptKeys(
  raw: string,
  modes: ShareMode[] = ['args', 'defaults', 'vars'],
  noBackticks = false,
): string {
  let best = internAll(raw, modes, noBackticks)
  const stemMode = modes[0]
  const candidates = new Set<string>()
  for (const mi of [3, 4, 5, 7]) {
    for (const mw of [2, 3, 4]) {
      const pre = shareWithStems(raw, stemMode, noBackticks, mi, mw)
      if (pre !== raw) candidates.add(pre)
    }
  }
  for (const pre of candidates) {
    const out = internAll(pre, modes, noBackticks)
    if (Buffer.byteLength(out) < Buffer.byteLength(best)) best = out
  }
  return best
}
