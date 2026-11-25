import { SHADER_LIMITS, type Work } from './types.ts'

/** Mirrors docs/gpu/limits.md. Builtins additionally evaluate every argument. */
export const builtinOps = new Map(
  Object.entries({
    abs: 1,
    min: 1,
    max: 1,
    clamp: 2,
    mix: 3,
    sin: 4,
    cos: 4,
    dot: 4,
    length: 5,
    smoothstep: 6,
    texture: 8,
  }),
)
export const work = (ops = 0, reads = 0, passes = 0): Work => ({
  ops: Math.min(ops, SHADER_LIMITS.ops + 1),
  reads: Math.min(reads, SHADER_LIMITS.reads + 1),
  passes: Math.min(passes, SHADER_LIMITS.passes + 1),
})
export const plus = (a: Work, b: Work) =>
  work(a.ops + b.ops, a.reads + b.reads, a.passes + b.passes)
export const branch = (cond: Work, a: Work, b: Work) =>
  plus(
    cond,
    work(
      Math.max(a.ops, b.ops),
      Math.max(a.reads, b.reads),
      Math.max(a.passes, b.passes),
    ),
  )
// N is an int32 literal. Products of N and saturated costs are exact JS integers.
export const repeat = (n: number, body: Work) =>
  work(2 + n * (2 + body.ops), n * body.reads, n * (1 + body.passes))
