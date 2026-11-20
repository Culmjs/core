const CYCLE = '[Circular]'

// Copies a value with keys sorted at every depth. A reference back to an object
// that is still being copied becomes "[Circular]", so a cyclic value never throws.
function sorted(v: unknown, path: object[]): unknown {
  if (v === null || typeof v !== 'object') return v
  const j = (v as { toJSON?: () => unknown }).toJSON
  if (typeof j === 'function') return sorted(j.call(v), path)
  if (path.includes(v)) return CYCLE
  const next = [...path, v]
  if (Array.isArray(v)) return v.map(x => sorted(x, next))
  return Object.fromEntries(
    Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => [k, sorted(x, next)]),
  )
}

/** JSON with keys sorted at every depth and no whitespace. Follows JSON.stringify for undefined, functions and NaN; a top-level one gives "null". */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value, [])) ?? 'null'
}

/** Lower-case hex SHA-256 of the UTF-8 text. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest), b =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
