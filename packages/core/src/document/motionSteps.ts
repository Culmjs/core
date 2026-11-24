import type { Frame, MotionTarget, Step } from './motion.ts'
import { ID_RE } from './kinds.ts'
import { fieldsOf, isInt, isNum, isObj, oneOf } from './rules.ts'

export type Say = (message: string, path: string) => void
const stepKeys = fieldsOf<Step>({
  target: true,
  from: true,
  to: true,
  durationMs: true,
  delayMs: true,
  staggerMs: true,
  ease: true,
  mask: true,
})
const targetKeys = fieldsOf<Exclude<MotionTarget, string>>({
  id: true,
  part: true,
})
const bounds = {
  opacity: [0, 1],
  xPx: [-2000, 2000],
  yPx: [-2000, 2000],
  xPercent: [-200, 200],
  scale: [0, 8],
  scaleX: [0, 8],
  rotateDeg: [-360, 360],
  draw: [0, 1],
} satisfies Record<keyof Frame, [number, number]>
export const split = ['lines', 'words', 'letters'] as const

export function checkKeys(
  o: Record<string, unknown>,
  keys: ReadonlySet<string>,
  path: string,
  say: Say,
) {
  for (const k of Object.keys(o))
    if (!keys.has(k))
      say('This motion field is not supported.', `${path}.${k.slice(0, 40)}`)
}

function checkFrame(v: unknown, path: string, say: Say) {
  if (!isObj(v) || !Object.keys(v).length)
    return say('A frame needs at least one motion property.', path)
  for (const [k, n] of Object.entries(v)) {
    const at = `${path}.${k.slice(0, 40)}`
    if (!Object.hasOwn(bounds, k)) say('This is not a motion property.', at)
    else {
      const [lo, hi] = bounds[k as keyof Frame]
      if (!isNum(n, lo, hi))
        say(`This value must be a finite number from ${lo} to ${hi}.`, at)
    }
  }
  if (('xPx' in v && 'xPercent' in v) || ('scale' in v && 'scaleX' in v))
    say('Use one horizontal translation and one scale per frame.', path)
}

function isTarget(v: unknown): v is MotionTarget {
  if (!isObj(v)) return oneOf(v, ['self', 'children', 'path', ...split])
  if (
    !Object.keys(v).every(k => targetKeys.has(k)) ||
    typeof v.id !== 'string' ||
    v.id.length > 41 ||
    (Object.hasOwn(v, 'part') && v.part !== 'path')
  )
    return false
  const parts = v.id.split('.')
  return parts.length <= 2 && parts.every(x => ID_RE.test(x))
}

/** The same data grammar for authored steps, registration probes and actual factory results. */
export function checkSteps(steps: unknown, say: Say) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 16)
    return say('A motion sequence needs 1 to 16 steps.', 'motion.steps')
  for (const [i, s] of steps.entries()) {
    const path = `motion.steps.${i}`
    if (!isObj(s)) {
      say('A step must be an object.', path)
      continue
    }
    checkKeys(s, stepKeys, path, say)
    checkFrame(s.from, `${path}.from`, say)
    checkFrame(s.to, `${path}.to`, say)
    const { from, to } = s
    if (isObj(from) && isObj(to)) {
      const keys = Object.keys(from)
      if (
        keys.length !== Object.keys(to).length ||
        keys.some(k => !Object.hasOwn(to, k))
      )
        say('Both frames must have the same motion properties.', `${path}.to`)
    }
    for (const [k, lo, hi] of [
      ['durationMs', 1, 10000],
      ['delayMs', 0, 10000],
      ['staggerMs', 0, 1000],
    ] as const)
      if ((k === 'durationMs' || s[k] !== undefined) && !isInt(s[k], lo, hi))
        say(
          `Use a whole number from ${lo} to ${hi} milliseconds.`,
          `${path}.${k}`,
        )
    if (
      s.ease !== undefined &&
      !oneOf(s.ease, ['linear', 'ease-out', 'expo-out'])
    )
      say('Use linear, ease-out or expo-out.', `${path}.ease`)
    if (
      s.mask !== undefined &&
      (typeof s.mask !== 'boolean' || !oneOf(s.target, split))
    )
      say('Mask is a switch for split text only.', `${path}.mask`)
    if (!isTarget(s.target))
      say('This motion target is not valid.', `${path}.target`)
    else if (
      isObj(from) &&
      'draw' in from &&
      s.target !== 'path' &&
      !(typeof s.target === 'object' && s.target.part === 'path')
    )
      say('Drawing a stroke needs an explicit path target.', `${path}.target`)
  }
}

/** Inherent capabilities, independent of the trigger the author attaches. */
export function stepsTier(steps: Step[]): 1 | 2 {
  const first = steps[0].target
  return steps.some(
    ({ target: t, staggerMs }) =>
      !!staggerMs ||
      (typeof t === 'object'
        ? t.part === 'path' || typeof first !== 'object' || first.id !== t.id
        : (t !== 'self' && t !== 'children') || first !== t),
  )
    ? 2
    : 1
}
