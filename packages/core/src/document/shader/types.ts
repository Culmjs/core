/** Ceilings apply to authored UTF-8 text and one invocation of shade(). */
export const SHADER_LIMITS = Object.freeze({
  bytes: 4096,
  passes: 64,
  reads: 16,
  ops: 512,
  nesting: 32,
  settings: 16,
})

export type ShaderSettings = Record<
  string,
  | { type: 'number'; min: number; max: number; default: number }
  | { type: 'color'; default: string }
>
export type Work = { passes: number; reads: number; ops: number }
export type ShaderCost = Work & { bytes: number }
type Refusal = {
  ok: false
  rule: string
  line: number
  measured: number | string
  limit: number | string
}
export type ShaderCheck = { ok: true; cost: ShaderCost } | Refusal

/** Internal early exit. Only checker refusals are converted into public results. */
export class ShaderRefusal {
  constructor(readonly result: Refusal) {}
}
export function refuse(
  rule: string,
  line: number,
  measured: number | string,
  limit: number | string,
): never {
  throw new ShaderRefusal({
    ok: false,
    rule: `shader.${rule}`,
    line,
    measured,
    limit,
  })
}

export type Value = 'bool' | 'int' | 'float' | 'vec2' | 'vec3' | 'vec4'
export type Type = Value | 'sampler2D'
export const isValue = (s: string): s is Value =>
  ['bool', 'int', 'float', 'vec2', 'vec3', 'vec4'].includes(s)
export const width = (t: Type) =>
  t === 'vec4' ? 4 : t === 'vec3' ? 3 : t === 'vec2' ? 2 : 1
const floating = (t: Type) => t === 'float' || width(t) > 1
const numeric = (t: Type) => t === 'int' || floating(t)

export function binaryType(op: string, a: Type, b: Type): Value | undefined {
  if (op === '&&' || op === '||')
    return a === 'bool' && a === b ? 'bool' : undefined
  if (op === '==' || op === '!=')
    return a === b && isValue(a) ? 'bool' : undefined
  if (['<', '<=', '>', '>='].includes(op))
    return a === b && (a === 'float' || a === 'int') ? 'bool' : undefined
  if (op === '%') return a === 'int' && a === b ? 'int' : undefined
  if (a === b && isValue(a) && numeric(a)) return a
  if (a === 'float' && isValue(b) && floating(b)) return b
  if (b === 'float' && isValue(a) && floating(a)) return a
}

/** Scalar conversions; vector splat or component packing (no unused arguments). */
export function constructs(t: Value, args: Type[]): boolean {
  if (!args.length || !args.every(isValue)) return false
  if (width(t) === 1) return args.length === 1 && width(args[0]) === 1
  if (args.length === 1 && width(args[0]) === 1) return true
  const components = args.reduce((n, arg) => n + width(arg), 0)
  return (
    components >= width(t) &&
    components - width(args[args.length - 1]) < width(t)
  )
}

export function builtinType(name: string, args: Type[]): Type | undefined {
  const [a, b, c] = args
  const n = args.length
  if (name === 'texture')
    return n === 2 && a === 'sampler2D' && b === 'vec2' ? 'vec4' : undefined
  if (!a || !numeric(a)) return
  // The vector/scalar overloads use float scalar bounds or interpolation factors.
  const scalarOrSame = (t: Type) => t === a || (width(a) > 1 && t === 'float')
  switch (name) {
    case 'abs':
      return n === 1 ? a : undefined
    case 'sin':
    case 'cos':
      return n === 1 && floating(a) ? a : undefined
    case 'length':
      return n === 1 && floating(a) ? 'float' : undefined
    case 'dot':
      return n === 2 && floating(a) && b === a ? 'float' : undefined
    case 'min':
    case 'max':
      return n === 2 && scalarOrSame(b) ? a : undefined
    case 'clamp':
      return n === 3 && scalarOrSame(b) && c === b ? a : undefined
    case 'mix':
      return n === 3 && floating(a) && b === a && scalarOrSame(c)
        ? a
        : undefined
    case 'smoothstep':
      return n === 3 &&
        floating(a) &&
        b === a &&
        floating(c) &&
        (a === c || a === 'float')
        ? c
        : undefined
  }
}
