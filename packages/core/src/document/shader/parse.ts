import { branch, builtinOps, plus, repeat, work } from './cost.ts'
import {
  binaryType,
  builtinType,
  constructs,
  isValue,
  refuse,
  SHADER_LIMITS,
  width,
  type Work,
  type Value,
  type Type,
} from './types.ts'

type Token = { text: string; line: number }
const end = '<end>'
const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/
const decimalInt = /^(?:0|[1-9][0-9]*)$/
const intMax = 2147483647
const maxTokenChars = 1024 // WebGL 2.0: Maximum GLSL Token Size

/** The byte gate runs first. Normalize line endings only for parsing, not pricing. */
function tokenize(source: string): Token[] {
  const s = source.replace(/\r\n?/g, '\n')
  // These can change where a driver sees tokens/newlines, even inside a comment.
  const ambiguous = /\0|\\(?:\n|$)/.exec(s)
  if (ambiguous)
    refuse(
      'syntax',
      s.slice(0, ambiguous.index).split('\n').length,
      ambiguous[0][0],
      'ordinary source character',
    )
  const tokens: Token[] = []
  const lex =
    /[A-Za-z_][A-Za-z_0-9]*|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|\+\+|--|&&|\|\||\^\^|<<=?|>>=?|[+\-*/%<>=!&|^]=|./y
  let i = 0,
    line = 1
  while (i < s.length) {
    if (s[i] === '\n') {
      i++
      line++
      continue
    }
    if (s[i] === ' ' || s[i] === '\t') {
      i++
      continue
    }
    if (s.startsWith('//', i)) {
      const j = s.indexOf('\n', i + 2)
      i = j < 0 ? s.length : j
      continue
    }
    if (s.startsWith('/*', i)) {
      const j = s.indexOf('*/', i + 2)
      if (j < 0) refuse('syntax', line, '/*', '*/')
      for (; i < j + 2; i++) if (s[i] === '\n') line++
      continue
    }
    lex.lastIndex = i
    const text = lex.exec(s)?.[0] ?? s[i]
    if (text.length > maxTokenChars)
      refuse('token', line, text.length, maxTokenChars)
    if (text === '#') refuse('directive', line, text, 'no directives')
    tokens.push({ text, line })
    i += text.length
  }
  tokens.push({ text: end, line })
  return tokens
}

// Source is handed to GLSL ES 3.00 verbatim. Keep its keywords, reserved words
// and standard functions out of authored bindings, including unused helpers.
const reserved = new Set(
  `
attribute const uniform varying buffer shared coherent volatile restrict readonly writeonly
atomic_uint layout centroid flat smooth noperspective patch sample break continue do for while
switch case default if else subroutine in out inout float double int void bool true false
invariant precise discard return struct lowp mediump highp precision uint
common partition active asm class union enum typedef template this resource goto inline noinline
public static extern external interface long short half fixed unsigned superp input output
namespace using sizeof cast filter row_major packed main shade defined
radians degrees tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2
sqrt inversesqrt sign floor trunc round roundEven ceil fract mod modf step isnan isinf
floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat packSnorm2x16 unpackSnorm2x16
packUnorm2x16 unpackUnorm2x16 packHalf2x16 unpackHalf2x16 distance cross normalize
faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse
lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not
textureSize textureProj textureLod textureOffset texelFetch texelFetchOffset textureProjOffset
textureLodOffset textureProjLod textureProjLodOffset textureGrad textureGradOffset
textureProjGrad textureProjGradOffset dFdx dFdy fwidth
`
    .trim()
    .split(/\s+/),
)
const reservedName = (s: string) =>
  reserved.has(s) ||
  builtinOps.has(s) ||
  isValue(s) ||
  s.includes('__') ||
  /^(?:gl_|GL_|_?webgl_|u_|[iu]?(?:sampler|image(?:1D|2D|3D|Cube|Buffer))|[bdhiuf]?vec[234]$|[dhf]?mat[234](?:x[234])?$)/.test(
    s,
  )

const bands = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
]
const precedence = new Map(
  bands.flatMap((ops, i) => ops.map(op => [op, i + 1] as const)),
)
type Binding = { type: Type; counter?: boolean }
type Target = { token: Token; access: 'writable' | 'readonly' | 'counter' }
type Expr = { type: Type; cost: Work; target?: Target }
type Flow = { cost: Work; returns?: boolean }
type Helper = { type: Value; params: Value[]; cost: Work }
const matchType = (t: Token, got: Type, want: Type) => {
  if (got !== want) refuse('type', t.line, got, want)
}
function rejectCounterWrite(target?: Target) {
  if (target?.access === 'counter')
    refuse('loop', target.token.line, target.token.text, 'read-only counter')
}
const writes = new Set([
  '=',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '<<=',
  '>>=',
  '&=',
  '|=',
  '^=',
])

/** Recursive descent over bounded syntax, folding types and work as we parse.
 * Only completed definitions enter `helpers`: a call graph never needs expanding. */
class Parser {
  private at = 0
  private depth = 0
  private scopes: Map<string, Binding>[] = []
  private helpers = new Map<string, Helper>()
  private current = ''
  private result: Value = 'float'

  constructor(
    private tokens: Token[],
    private inputs: Map<string, Type>,
  ) {}
  private get token() {
    return this.tokens[this.at]
  }
  private eat(s: string) {
    if (this.token.text !== s) return false
    this.at++
    return true
  }
  private want(s: string, rule = 'syntax') {
    const t = this.token
    if (!this.eat(s)) refuse(rule, t.line, t.text, s)
    return t
  }
  private name() {
    const t = this.token
    if (!identifier.test(t.text)) refuse('syntax', t.line, t.text, 'identifier')
    this.at++
    return t
  }
  private valueType() {
    const t = this.token
    if (!isValue(t.text)) refuse('syntax', t.line, t.text, 'value type')
    this.at++
    return t.text
  }
  private nested<T>(t: Token, fn: () => T): T {
    if (this.depth === SHADER_LIMITS.nesting)
      refuse('nesting', t.line, this.depth + 1, SHADER_LIMITS.nesting)
    this.depth++
    const value = fn()
    this.depth--
    return value
  }
  private scoped<T>(fn: () => T): T {
    this.scopes.push(new Map())
    const value = fn()
    this.scopes.pop()
    return value
  }
  private local(name: string) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const value = this.scopes[i].get(name)
      if (value) return value
    }
  }
  private bind(t: Token, value: Binding) {
    const prior = this.local(t.text)
    if (prior?.counter) refuse('loop', t.line, t.text, 'read-only counter')
    if (
      prior ||
      reservedName(t.text) ||
      this.helpers.has(t.text) ||
      t.text === this.current
    )
      refuse('name', t.line, t.text, 'fresh local name')
    this.scopes[this.scopes.length - 1].set(t.text, value)
  }

  program(): Work {
    while (this.token.text !== end) this.definition()
    const shade = this.helpers.get('shade')
    if (!shade) refuse('entry', this.token.line, end, 'vec4 shade(vec2)')
    return shade.cost
  }
  private definition() {
    const start = this.token
    if (['uniform', 'in', 'out', 'varying', 'attribute'].includes(start.text))
      refuse('input', start.line, start.text, 'host declarations only')
    this.result = this.valueType()
    const name = this.name()
    this.current = name.text
    if (
      this.helpers.has(name.text) ||
      builtinOps.has(name.text) ||
      isValue(name.text)
    )
      refuse('call', name.line, name.text, 'unique function')
    const entry = name.text === 'shade'
    if (
      !entry &&
      (reservedName(name.text) || ['uv', 'color'].includes(name.text))
    )
      refuse('name', name.line, name.text, 'fresh helper name')
    this.want('(')
    this.scoped(() => {
      const params: Value[] = []
      if (!this.eat(')')) {
        do {
          this.eat('in')
          const type = this.valueType()
          this.bind(this.name(), { type })
          params.push(type)
        } while (this.eat(','))
        this.want(')')
      }
      if (
        entry &&
        !(this.result === 'vec4' && params.length === 1 && params[0] === 'vec2')
      )
        refuse(
          'entry',
          name.line,
          `${this.result} shade(${params.join(',')})`,
          'vec4 shade(vec2)',
        )
      const body = this.block(entry)
      if (!body.returns)
        refuse('return', name.line, name.text, 'return on all paths')
      this.helpers.set(name.text, {
        type: this.result,
        params,
        cost: body.cost,
      })
    })
  }
  private block(entry = false): Flow {
    const open = this.want('{')
    return this.nested(open, () =>
      this.scoped(() => {
        let cost = work(),
          returns = false
        while (!this.eat('}')) {
          const t = this.token
          if (t.text === end) refuse('syntax', t.line, end, '}')
          const s = this.statement()
          cost = plus(cost, s.cost)
          returns ||= !!s.returns
          if (entry) {
            for (const k of ['passes', 'reads', 'ops'] as const)
              if (cost[k] > SHADER_LIMITS[k])
                refuse(k, t.line, cost[k], SHADER_LIMITS[k])
          }
        }
        return { cost, returns }
      }),
    )
  }
  private statement(): Flow {
    const t = this.token
    if (this.eat(';')) return { cost: work() }
    if (t.text === '{') return this.block()
    if (this.eat('if'))
      return this.nested(t, () => {
        this.want('(')
        const first = this.token
        const cond = this.expr()
        matchType(first, cond.type, 'bool')
        this.want(')')
        const yes = this.scoped(() => this.statement())
        const no = this.eat('else')
          ? this.scoped(() => this.statement())
          : { cost: work() }
        return {
          cost: branch(cond.cost, yes.cost, no.cost),
          returns: yes.returns && no.returns,
        }
      })
    if (this.eat('for'))
      return this.nested(t, () => this.scoped(() => this.loop()))
    if (this.eat('return')) {
      const first = this.token
      const value = this.expr()
      matchType(first, value.type, this.result)
      this.want(';')
      return { cost: value.cost, returns: true }
    }
    if (isValue(t.text) && this.tokens[this.at + 1].text !== '(') {
      const type = this.valueType()
      const name = this.name()
      let cost = work()
      if (this.eat('=')) {
        const first = this.token
        const init = this.expr()
        matchType(first, init.type, type)
        cost = plus(work(1), init.cost)
      }
      this.bind(name, { type })
      this.want(';')
      return { cost }
    }
    const lhs = this.expr()
    let cost = lhs.cost
    if (this.eat('=')) {
      if (lhs.target?.access !== 'writable') {
        const at = lhs.target?.token ?? t
        refuse('assignment', at.line, at.text, 'writable local')
      }
      const first = this.token
      const rhs = this.expr()
      matchType(first, rhs.type, lhs.type)
      cost = plus(plus(cost, rhs.cost), work(1))
    } else if (!isValue(lhs.type))
      refuse('type', t.line, lhs.type, 'value type')
    this.want(';')
    return { cost }
  }
  private loop(): Flow {
    this.want('(', 'loop')
    this.want('int', 'loop')
    const i = this.name()
    this.bind(i, { type: 'int', counter: true })
    for (const s of ['=', '0', ';', i.text, '<']) this.want(s, 'loop')
    const n = this.token
    if (!decimalInt.test(n.text) || Number(n.text) > intMax)
      refuse('loop', n.line, n.text, 'nonnegative decimal int literal')
    this.at++
    for (const s of [';', i.text, '++', ')']) this.want(s, 'loop')
    return { cost: repeat(Number(n.text), this.statement().cost) }
  }

  private expr(): Expr {
    const cond = this.binary(1)
    const t = this.token
    if (!this.eat('?')) return cond
    matchType(t, cond.type, 'bool')
    return this.nested(t, () => {
      const yes = this.expr()
      this.want(':')
      const first = this.token
      const no = this.expr()
      matchType(first, no.type, yes.type)
      if (!isValue(yes.type)) refuse('type', t.line, yes.type, 'value type')
      return { type: yes.type, cost: branch(cond.cost, yes.cost, no.cost) }
    })
  }
  // Only strictly higher precedence recurses; a long left-associative sum is flat.
  private binary(min: number): Expr {
    let left = this.unary()
    for (;;) {
      const t = this.token,
        p = precedence.get(t.text)
      if (!p || p < min) return left
      this.at++
      const right = this.binary(p + 1)
      const type = binaryType(t.text, left.type, right.type)
      if (!type)
        refuse(
          'type',
          t.line,
          `${left.type} ${t.text} ${right.type}`,
          'compatible operands',
        )
      left = { type, cost: plus(plus(left.cost, right.cost), work(1)) }
    }
  }
  private unary(): Expr {
    const t = this.token
    if (['+', '-', '!', '++', '--'].includes(t.text)) {
      this.at++
      return this.nested(t, () => {
        const e = this.unary()
        if (t.text === '++' || t.text === '--') {
          rejectCounterWrite(e.target)
          refuse('syntax', t.line, t.text, 'simple assignment')
        }
        if (t.text === '!') matchType(t, e.type, 'bool')
        else if (!isValue(e.type) || e.type === 'bool')
          refuse('type', t.line, e.type, 'numeric operand')
        return { type: e.type, cost: plus(e.cost, work(1)) }
      })
    }
    let e = this.primary()
    while (this.eat('.')) {
      const field = this.name()
      const s = field.text,
        w = width(e.type)
      if (
        w === 1 ||
        s.length > 4 ||
        !['xyzw', 'rgba', 'stpq'].some(group =>
          [...s].every(c => group.slice(0, w).includes(c)),
        )
      )
        refuse('type', field.line, s, 'valid vector selection')
      const type = (['float', 'vec2', 'vec3', 'vec4'] as const)[s.length - 1]
      e = {
        type,
        cost: plus(e.cost, work(1)),
        target:
          e.target && new Set(s).size !== s.length
            ? { token: e.target.token, access: 'readonly' }
            : e.target,
      }
    }
    if (writes.has(this.token.text)) rejectCounterWrite(e.target)
    return e
  }
  private primary(): Expr {
    const t = this.token
    if (this.eat('('))
      return this.nested(t, () => {
        const e = this.expr()
        this.want(')')
        return e
      })
    if (/^[0-9.]/.test(t.text) && t.text !== '.') {
      this.at++
      const integer = !/[.eE]/.test(t.text)
      if (
        integer
          ? !decimalInt.test(t.text) || Number(t.text) > intMax
          : !Number.isFinite(Math.fround(Number(t.text)))
      )
        refuse(
          'literal',
          t.line,
          t.text,
          integer ? 'decimal int32' : 'finite float',
        )
      return { type: integer ? 'int' : 'float', cost: work() }
    }
    if (this.eat('true') || this.eat('false'))
      return { type: 'bool', cost: work() }
    const name = this.name()
    if (this.eat('(')) return this.nested(name, () => this.call(name))
    const local = this.local(name.text)
    const type = local?.type ?? this.inputs.get(name.text)
    if (!type) {
      if (name.text.startsWith('u_'))
        refuse('input', name.line, name.text, 'declared input')
      refuse('name', name.line, name.text, 'declared variable')
    }
    return {
      type,
      cost: work(),
      target: {
        token: name,
        access: local?.counter ? 'counter' : local ? 'writable' : 'readonly',
      },
    }
  }
  private call(t: Token): Expr {
    const args: Type[] = []
    let cost = work()
    if (!this.eat(')')) {
      do {
        const arg = this.expr()
        cost = plus(cost, arg.cost)
        args.push(arg.type)
      } while (this.eat(','))
      this.want(')')
    }
    const name = t.text
    if (isValue(name) && constructs(name, args))
      return { type: name, cost: plus(cost, work(1)) }
    const ops = builtinOps.get(name)
    if (ops !== undefined) {
      const type = builtinType(name, args)
      if (type)
        return { type, cost: plus(cost, work(ops, name === 'texture' ? 1 : 0)) }
    }
    const helper = this.helpers.get(name)
    if (name === this.current)
      refuse('call', t.line, name, 'nonrecursive helper')
    if (
      helper &&
      name !== 'shade' &&
      args.length === helper.params.length &&
      args.every((v, i) => v === helper.params[i])
    )
      return { type: helper.type, cost: plus(plus(cost, work(1)), helper.cost) }
    if (!helper && ops === undefined && !isValue(name))
      refuse('call', t.line, name, 'defined helper or builtin')
    refuse('type', t.line, `${name}(${args.join(',')})`, 'supported signature')
  }
}

export const parse = (source: string, inputs: Map<string, Type>): Work =>
  new Parser(tokenize(source), inputs).program()
