import {
  BASE_SCRIPT,
  EMAIL_SCRIPT,
  OPEN_SCRIPT,
  INLINE_HASHES,
  GPU_HOST_INTEGRITY,
} from '../scripts/scriptsMin.ts'
import { writeHtml } from './html.ts'

export type PageScript = {
  name: 'base' | 'states' | 'timeline' | 'gpuLoader'
  code: string
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
  const hash =
    INLINE_HASHES[
      base +
        (has('states') ? 4 : 0) +
        (has('timeline') ? 8 : 0) +
        (gpu ? 16 : 0)
    ]
  return gpu ? [hash, GPU_HOST_INTEGRITY] : [hash]
}

export function scriptPolicy(hashes: Iterable<string>) {
  const sources = [...new Set(hashes)].map(h => `'${h}'`).join(' ') || "'none'"
  // The delivered host does not yet start a worker or execute modules.
  return `script-src ${sources}; worker-src 'none'`
}

export const policyMeta = (content: string) =>
  writeHtml({
    tag: 'meta',
    attrs: { 'http-equiv': 'Content-Security-Policy', content },
  })
export const pageScriptPolicy = (scripts: PageScript[]) =>
  scriptPolicy(executableHashes(scripts))

/** Insert only in the compiler-owned opening head, before any page-controlled content. */
export const withPolicy = (html: string, policy: string) =>
  html.replace('<head><meta charset="utf-8">', m => m + policyMeta(policy))
