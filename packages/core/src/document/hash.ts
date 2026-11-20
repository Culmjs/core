/**
 * JSON with keys sorted at every depth and no whitespace. Keys sort by code unit, except that integer-like keys come first in numeric order,
 * because that is how JavaScript orders own keys; the text is deterministic for equal values. Follows JSON.stringify for undefined, functions and NaN;
 * a top-level undefined or function gives "null". Throws only for a value no JSON text can produce (a cycle, a BigInt) or nested past
 * the stack limit of JSON.stringify with a replacer (about 5,000 levels); a caller that takes outside input catches it.
 */
export function canonicalJson(value: unknown): string {
  // The replacer copies each object, which hides a cycle from JSON.stringify; the plain pass throws the TypeError for it.
  JSON.stringify(value)
  return (
    JSON.stringify(value, (_k, x: unknown) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(
            Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          )
        : x,
    ) ?? 'null'
  )
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
