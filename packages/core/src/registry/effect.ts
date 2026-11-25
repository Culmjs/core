import type { Step } from '../document/motion.ts'
import { checkSteps, stepsTier, type Say } from '../document/motionSteps.ts'
import { isObj, isNum, UNSAFE_FIELDS } from '../document/rules.ts'
import type { GpuEffectDef } from './gpu.ts'

export type EffectDef = {
  name: string
  tier: 1 | 2
  settings: Record<string, { min: number; max: number; default: number }>
  steps(settings: Readonly<Record<string, number>>): Step[]
}
export type RegisteredEffect = EffectDef | GpuEffectDef

// Catalogue reads registration's checked snapshot. Discovery never runs a factory.
const defaults = new WeakMap<EffectDef, Step[]>()
export const defaultEffectSteps = (d: EffectDef) => defaults.get(d)

/** One isolated snapshot: the checked data is what callers receive, never a second call to the factory. */
export function resolveEffect(
  definition: RegisteredEffect | undefined,
  settings: unknown,
  say: Say,
): Step[] | undefined {
  if (definition?.tier === 3) {
    say('A GPU effect needs a GPU attachment.', 'motion.effect')
    return
  }
  const d = definition
  let ok = true
  const bad: Say = (msg, path) => {
    ok = false
    say(msg, path)
  }
  const values: Record<string, number> = Object.create(null)
  for (const [k, s] of Object.entries(d?.settings ?? {})) values[k] = s.default
  if (settings !== undefined) {
    if (!isObj(settings))
      bad('Effect settings must be an object of numbers.', 'motion.settings')
    else
      for (const [k, v] of Object.entries(settings)) {
        const at = `motion.settings.${k.slice(0, 40)}`
        if (typeof v !== 'number' || !Number.isFinite(v))
          bad('An effect setting must be a finite number.', at)
        else if (d && !Object.hasOwn(d.settings, k))
          bad('This effect has no setting with that name.', at)
        else if (d && !isNum(v, d.settings[k].min, d.settings[k].max))
          bad('This effect setting is outside its declared range.', at)
        else values[k] = v
      }
  }
  if (!d) {
    bad('This motion effect is not registered.', 'motion.effect')
    return
  }
  if (!ok) return
  let steps: Step[]
  try {
    steps = structuredClone(d.steps(Object.freeze(values)))
  } catch {
    bad('The effect did not return motion data.', 'motion.effect')
    return
  }
  checkSteps(steps, bad)
  if (ok && d.tier === 1 && stepsTier(steps) === 2)
    bad('This effect requires tier 2.', 'motion.effect')
  if (ok) return steps
}

const nameOk = (s: unknown) =>
  typeof s === 'string' &&
  /^[a-z][a-z0-9_-]{0,63}$/i.test(s) &&
  !UNSAFE_FIELDS.includes(s)

/** Stage a definition and check its defaults before making any part of the plug-in visible. */
export function checkedEffect(input: EffectDef): EffectDef {
  if (
    !input ||
    !nameOk(input.name) ||
    (input.tier !== 1 && input.tier !== 2) ||
    'wasm' in input ||
    !isObj(input.settings) ||
    typeof input.steps !== 'function'
  )
    throw new Error('Invalid motion effect definition.')
  const settings: EffectDef['settings'] = Object.create(null)
  for (const [k, s] of Object.entries(input.settings)) {
    if (
      !nameOk(k) ||
      !isObj(s) ||
      !Number.isFinite(s.min) ||
      !Number.isFinite(s.max) ||
      !isNum(s.default, s.min, s.max) ||
      Object.keys(s).some(key => !['min', 'max', 'default'].includes(key))
    )
      throw new Error(`Invalid setting in effect "${input.name}".`)
    settings[k] = Object.freeze({ min: s.min, max: s.max, default: s.default })
  }
  const d = Object.freeze({
    name: input.name,
    tier: input.tier,
    settings: Object.freeze(settings),
    steps: input.steps,
  })
  const steps = resolveEffect(d, undefined, (msg, path) => {
    throw new Error(`Effect "${d.name}" at ${path}: ${msg}`)
  })
  defaults.set(d, steps!)
  return d
}

export const rise = checkedEffect({
  name: 'rise',
  tier: 1,
  settings: { distance: { min: 0, max: 100, default: 16 } },
  steps: ({ distance }) => [
    {
      target: 'self',
      from: { opacity: 0, yPx: distance },
      to: { opacity: 1, yPx: 0 },
      durationMs: 400,
      ease: 'ease-out',
    },
  ],
})
