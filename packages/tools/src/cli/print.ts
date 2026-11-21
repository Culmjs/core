import type { Problem } from '@culmjs/core'
import type { Finding } from '@culmjs/core/measure'

type Where = { file?: string; line?: number; column?: number }

/** `file:line:column code-or-check message`, and the allowed values on the next line. A part the problem lacks is left out. */
export function formatLocated(p: (Problem | Finding) & Where): string {
  const at = [p.file, p.line, p.column].filter(x => x !== undefined).join(':')
  const what = 'code' in p ? p.code : p.check
  const allowed = 'allowed' in p && p.allowed?.length ? p.allowed : undefined
  return (
    `${[at, what, p.message].filter(Boolean).join(' ')}` +
    (allowed ? `\n  allowed: ${allowed.join(', ')}` : '')
  )
}
