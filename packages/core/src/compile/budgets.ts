import type { Problem } from '../document/index.ts'
import { WASM_LIMITS } from '../registry/gpu.ts'

export const BUDGETS = {
  sharedScripts: 20_000,
  baseScript: 10_000,
  statesScript: 6_193,
  timelineScript: 8_192,
  gpuHostScript: 6_144,
  ...WASM_LIMITS,
  css: 16_000,
  elements: 2_000,
  depth: 12,
} as const

export type PageStats = {
  bytes: number
  styleBytes: number
  scriptBytes: {
    base: number
    states: number
    timeline?: number
    gpuLoader?: number
    gpuHost?: number
  }
  /** Inert data, once per used definition. The two module counts describe the same bytes. */
  gpuData?: {
    shaderBytes: number
    wasmBytes: number
    wasmTransportBytes: number
  }
  elements: number
  depth: number
}

const encoder = new TextEncoder()
/** UTF-8 bytes; core has no Buffer. */
export const byteLength = (s: string): number => encoder.encode(s).length

/** One problem per ceiling passed, path = the key in BUDGETS. Exactly at a ceiling passes. */
export function checkBudgets(stats: PageStats): Problem[] {
  const {
    base,
    states,
    timeline = 0,
    gpuLoader = 0,
    gpuHost = 0,
  } = stats.scriptBytes
  const measured: [keyof typeof BUDGETS, number][] = [
    ['css', stats.styleBytes],
    ['baseScript', base],
    ['statesScript', states],
    ['timelineScript', timeline],
    ['gpuHostScript', gpuHost],
    ['sharedScripts', base + states + timeline + gpuLoader + gpuHost],
    ['elements', stats.elements],
    ['depth', stats.depth],
  ]
  return measured
    .filter(([key, n]) => n > BUDGETS[key])
    .map(([key, n]) => ({
      code: 'RESOURCE_LIMIT_EXCEEDED',
      path: key,
      message: `${key} is ${n}, the ceiling is ${BUDGETS[key]}`,
    }))
}
