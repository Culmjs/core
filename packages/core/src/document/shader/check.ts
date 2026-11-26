import { isRecord, UNSAFE_FIELDS } from '../rules.ts'
import { parse } from './parse.ts'
import {
  refuse,
  SHADER_LIMITS,
  ShaderRefusal,
  type ShaderSettings,
  type ShaderCheck,
  type Type,
} from './types.ts'

/** Stop at the first excess byte, without allocating an encoding of arbitrary input. */
function byteCount(source: string) {
  let n = 0,
    line = 1,
    cr = false
  for (const c of source) {
    const u = c.codePointAt(0)!
    n += u < 0x80 ? 1 : u < 0x800 ? 2 : u < 0x10000 ? 3 : 4
    if (n > SHADER_LIMITS.bytes)
      refuse('bytes', line, SHADER_LIMITS.bytes + 1, SHADER_LIMITS.bytes)
    if (c === '\r' || (c === '\n' && !cr)) line++
    cr = c === '\r'
  }
  return n
}

function exactFields(obj: object, fields: readonly string[]) {
  for (const key in obj)
    if (Object.hasOwn(obj, key) && !fields.includes(key)) return false
  return fields.every(key => Object.hasOwn(obj, key))
}

function inputs(settings: ShaderSettings, allowField = false) {
  if (!isRecord(settings)) refuse('settings', 1, 'settings', 'setting map')
  let count = 0
  for (const key in settings)
    if (Object.hasOwn(settings, key) && ++count > SHADER_LIMITS.settings)
      refuse('settings', 1, count, SHADER_LIMITS.settings)
  const env = new Map<string, Type>([
    ['u_time', 'float'],
    ['u_scroll', 'float'],
    ['u_resolution', 'vec2'],
    ['u_pointer', 'vec2'],
    ['u_noise', 'sampler2D'],
  ])
  if (allowField) env.set('u_field', 'sampler2D')
  for (const key in settings) {
    if (!Object.hasOwn(settings, key)) continue
    if (
      !/^[a-z][a-z0-9_]{0,31}$/.test(key) ||
      key.includes('__') ||
      UNSAFE_FIELDS.includes(key)
    )
      refuse('settings', 1, key, 'safe setting key')
    const s = settings[key]
    if (
      isRecord(s) &&
      s.type === 'number' &&
      exactFields(s, ['type', 'min', 'max', 'default']) &&
      [s.min, s.max, s.default].every(Number.isFinite) &&
      s.min <= s.default &&
      s.default <= s.max
    )
      env.set(`u_set_${key}`, 'float')
    else if (
      isRecord(s) &&
      s.type === 'color' &&
      exactFields(s, ['type', 'default']) &&
      typeof s.default === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(s.default)
    )
      env.set(`u_set_${key}`, 'vec3')
    else refuse('settings', 1, key, 'finite range/default or #rrggbb')
  }
  return env
}

/** Checked effect validation. `allowField` exposes private `u_field` to approved WASM effects only. */
export function checkEffectShader(
  source: string,
  settings: ShaderSettings,
  allowField = false,
): ShaderCheck {
  try {
    if (typeof source !== 'string') refuse('source', 1, typeof source, 'string')
    const bytes = byteCount(source)
    return {
      ok: true,
      cost: { bytes, ...parse(source, inputs(settings, allowField)) },
    }
  } catch (e) {
    if (e instanceof ShaderRefusal) return e.result
    throw e
  }
}

/** Standalone check of authored fragment source. No prelude or driver is involved. */
export function checkShader(
  source: string,
  settings: ShaderSettings,
): ShaderCheck {
  return checkEffectShader(source, settings, false)
}
