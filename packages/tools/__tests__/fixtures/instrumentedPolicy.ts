import { createHash } from 'node:crypto'
import { policyMeta } from '@culmjs/core'

/** The two offline motion suites add their own audit script and sometimes replace
 * the timeline with a preview build. Name exactly those final inline JS bytes. */
export function instrumentedPolicy(html: string) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
  )
  return html.replace(
    /<meta http-equiv="Content-Security-Policy" content="[^"]+">/,
    () => policyMeta(`script-src ${hashes.join(' ')}; worker-src 'none'`),
  )
}
