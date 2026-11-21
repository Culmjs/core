import { createHash } from 'node:crypto'
import type { JsonPath } from './jsonc.ts'

/** 'x' + 12 base-36 characters of a hash of file and path; fits core's id rule and never meets core's `n` ids. */
export function derivedId(file: string, path: JsonPath): string {
  const h = createHash('sha256')
    .update(JSON.stringify([file, path]))
    .digest('hex')
  const n = BigInt('0x' + h.slice(0, 16)) % 36n ** 12n
  return 'x' + n.toString(36).padStart(12, '0')
}
