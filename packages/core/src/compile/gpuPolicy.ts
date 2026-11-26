import {
  BASE_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  PLAYBACK_TIMELINE_SCRIPT,
  INLINE_HASHES,
  GPU_HOST_INTEGRITY,
} from '../scripts/scriptsMin.ts'
import { writeHtml } from './html.ts'

export type PageScript = {
  name: 'base' | 'states' | 'timeline' | 'gpuLoader'
  code: string
  worker?: true
}
const bases = [
  BASE_SCRIPT,
  BASE_SCRIPT + OPEN_SCRIPT,
  BASE_SCRIPT + EMAIL_SCRIPT,
  BASE_SCRIPT + OPEN_SCRIPT + EMAIL_SCRIPT,
]

/** Hash addresses from the same finite script selection used by gen:scripts. */
export function executableHashes(scripts: PageScript[]): string[] {
  if (!scripts.length) return []
  const base = bases.indexOf(scripts[0].code)
  if (base < 0) throw new Error('Unknown base script.')
  const has = (name: PageScript['name']) => scripts.some(s => s.name === name)
  const gpu = has('gpuLoader')
  const playback = scripts.some(
    s => s.name === 'timeline' && s.code === PLAYBACK_TIMELINE_SCRIPT,
  )
  const hash =
    INLINE_HASHES[
      base +
        (has('states') ? 4 : 0) +
        (playback ? 32 : has('timeline') ? 8 : 0) +
        (gpu ? (playback ? 8 : 16) : 0)
    ]
  return gpu ? [hash, GPU_HOST_INTEGRITY] : [hash]
}

export function scriptPolicy(
  hashes: Iterable<string>,
  worker = false,
  wasm = false,
) {
  const sources = [...new Set(hashes)].map(h => `'${h}'`)
  if (wasm) sources.push("'wasm-unsafe-eval'")
  return `script-src ${sources.join(' ') || "'none'"}; worker-src ${worker ? 'blob:' : "'none'"}`
}

export const policyMeta = (content: string) =>
  writeHtml({
    tag: 'meta',
    attrs: { 'http-equiv': 'Content-Security-Policy', content },
  })
export const pageScriptPolicy = (scripts: PageScript[], wasm = false) =>
  scriptPolicy(
    executableHashes(scripts),
    scripts.some(s => s.worker),
    wasm,
  )

/** Insert only in the compiler-owned opening head, before any page-controlled content. */
export const withPolicy = (html: string, policy: string) =>
  html.replace('<head><meta charset="utf-8">', m => m + policyMeta(policy))
