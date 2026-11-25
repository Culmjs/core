import {
  checkShader,
  type CustomEffect,
  type ShaderSettings,
} from '../document/index.ts'
import { fieldsOf, isRecord, UNSAFE_FIELDS } from '../document/rules.ts'
import { contours } from './gpuBuiltins.ts'

export type GpuEffectDef = CustomEffect & {
  tier: 3
  wasm?: { bytesBase64: string; abi: 'field-v1' }
}

type PluginId = { name: string; version: number }
export type GpuOptions = {
  enabled: true
  approvedWasmPlugins?: readonly PluginId[]
  reviewed?: readonly CustomEffect[]
}
export type GpuCapability = {
  readonly enabled: true
  /** Match the checked declaration, not its invocation overrides or its module. */
  readonly isReviewed: (d: CustomEffect) => boolean
}
export const customKeys = fieldsOf<CustomEffect>({
  name: true,
  source: true,
  settings: true,
})
const registeredKeys = new Set([...customKeys, 'tier', 'wasm'])
export const gpuName = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-z][a-z0-9_]{0,31}$/.test(v) &&
  !UNSAFE_FIELDS.includes(v)

/** A copy of checked JSON fields only; never carries the caller's module or permissions. */
export function shaderSnapshot({
  name,
  source,
  settings,
}: CustomEffect): CustomEffect {
  return Object.freeze({
    name,
    source,
    settings: Object.freeze(
      Object.fromEntries(
        Object.entries(settings).map(([key, s]) => [
          key,
          Object.freeze({ ...s }),
        ]),
      ),
    ),
  })
}

function sameSettings(a: ShaderSettings, b: ShaderSettings) {
  return (
    isRecord(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([k, s]) => {
      if (!Object.hasOwn(b, k)) return false
      const t: unknown = b[k]
      return (
        isRecord(t) &&
        Object.keys(s).length === Object.keys(t).length &&
        Object.entries(s).every(
          ([field, value]) =>
            Object.hasOwn(t, field) && Object.is(t[field], value),
        )
      )
    })
  )
}

// These price transfer of a single module; ABI and executable validation precede any future runtime.
export const WASM_LIMITS = { wasmBytes: 512, wasmTransportBytes: 684 } as const
export const moduleBytes = (b: string) =>
  (b.length / 4) * 3 - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0)
export function moduleSnapshot(wasm: NonNullable<GpuEffectDef['wasm']>) {
  if (
    !isRecord(wasm) ||
    !Object.hasOwn(wasm, 'abi') ||
    !Object.hasOwn(wasm, 'bytesBase64') ||
    Object.keys(wasm).some(k => k !== 'abi' && k !== 'bytesBase64')
  )
    throw new Error('Invalid GPU module envelope.')
  const { abi, bytesBase64: b } = wasm
  if (
    abi !== 'field-v1' ||
    typeof b !== 'string' ||
    !b.length ||
    b.length > WASM_LIMITS.wasmTransportBytes ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      b,
    ) ||
    moduleBytes(b) > WASM_LIMITS.wasmBytes
  )
    throw new Error('Invalid GPU module ABI, base64 or byte length.')
  return Object.freeze({ abi, bytesBase64: b })
}

function checkedSnapshot(input: CustomEffect, keys: ReadonlySet<string>) {
  if (
    !isRecord(input) ||
    !gpuName(input.name) ||
    [...customKeys].some(k => !Object.hasOwn(input, k)) ||
    Object.keys(input).some(k => !keys.has(k))
  )
    throw new Error('Invalid GPU effect declaration.')
  // Check the original language (cloning could turn a non-record into a record).
  const { name, source, settings } = input
  const result = checkShader(source, settings)
  if (!result.ok)
    throw new Error(
      `GPU effect "${name}": ${result.rule} at shader line ${result.line}.`,
    )
  return shaderSnapshot({ name, source, settings })
}

/** Only predicates leave the closure. The host's arrays and declarations may change independently. */
export function gpuAuthority(options?: GpuOptions) {
  if (options?.enabled !== true) return
  const approved = (options.approvedWasmPlugins ?? []).map(
    ({ name, version }) => ({ name, version }),
  )
  const reviewed = [
    contours,
    ...(options.reviewed ?? []).map(d => checkedSnapshot(d, customKeys)),
  ]
  return {
    capability: Object.freeze({
      enabled: true as const,
      isReviewed: (d: CustomEffect) =>
        reviewed.some(
          r =>
            r.name === d.name &&
            r.source === d.source &&
            sameSettings(r.settings, d.settings),
        ),
    }),
    register(input: GpuEffectDef, name: string, version: number): GpuEffectDef {
      const wasm = input.wasm
      if (
        wasm !== undefined &&
        !approved.some(p => p.name === name && p.version === version)
      )
        throw new Error(
          'This plug-in and version are not approved for GPU modules.',
        )
      return Object.freeze({
        ...checkedSnapshot(input, registeredKeys),
        tier: 3,
        ...(wasm !== undefined && { wasm: moduleSnapshot(wasm) }),
      })
    },
  }
}
