/**
 * JSON with keys sorted at every depth and no whitespace. Keys sort by code unit, except that integer-like keys come first in numeric order,
 * because that is how JavaScript orders own keys; the text is deterministic for equal values. Follows JSON.stringify for undefined, functions and NaN;
 * a top-level undefined or function gives "null". If the native stack runs out, plain data up to 8,192 levels is supported.
 */
export function canonicalJson(value: unknown): string {
  // The replacer copies each object, which hides a cycle from JSON.stringify; the plain pass throws the TypeError for it.
  try {
    JSON.stringify(value)
    return (
      JSON.stringify(value, (_k, x: unknown) =>
        x && typeof x === 'object' && !Array.isArray(x)
          ? Object.fromEntries(
              Object.entries(x).sort(([a], [b]) =>
                a < b ? -1 : a > b ? 1 : 0,
              ),
            )
          : x,
      ) ?? 'null'
    )
  } catch (e) {
    if (!(e instanceof RangeError)) throw e
    // Native stringify depth varies across supported Node versions. Keep the
    // same ordering for deep plain JSON without recursively calling stringify.
    type Frame =
      | { kind: 'value'; v: unknown }
      | { kind: 'text'; s: string }
      | { kind: 'close'; v: object; s: string }
    const stack: Frame[] = [{ kind: 'value', v: value }],
      chunks: string[] = [],
      ancestors = new Set<object>()
    while (stack.length) {
      const f = stack.pop()!
      if (f.kind === 'text') {
        chunks.push(f.s)
        continue
      }
      if (f.kind === 'close') {
        ancestors.delete(f.v)
        chunks.push(f.s)
        continue
      }
      const v = f.v
      if (v === null || typeof v !== 'object') {
        chunks.push(JSON.stringify(v) ?? 'null')
        continue
      }
      if (typeof (v as { toJSON?: unknown }).toJSON === 'function') throw e // not plain data; preserve its original error
      if (ancestors.has(v)) throw new TypeError('Circular value in JSON')
      if (ancestors.size >= 8192)
        throw new RangeError('JSON nesting exceeds the supported depth')
      ancestors.add(v)
      const array = Array.isArray(v)
      chunks.push(array ? '[' : '{')
      stack.push({ kind: 'close', v, s: array ? ']' : '}' })
      const keys = array
        ? Array.from({ length: v.length }, (_, i) => String(i))
        : Object.keys(
            Object.fromEntries(
              Object.keys(v)
                .sort()
                .map(k => [k, true]),
            ),
          )
      let last = true
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i]!,
          item = (v as Record<string, unknown>)[key]
        if (
          !array &&
          (item === undefined ||
            typeof item === 'function' ||
            typeof item === 'symbol')
        )
          continue
        if (!last) stack.push({ kind: 'text', s: ',' })
        stack.push({ kind: 'value', v: item })
        if (!array) stack.push({ kind: 'text', s: JSON.stringify(key) + ':' })
        last = false
      }
    }
    return chunks.join('')
  }
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
