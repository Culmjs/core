import { canonicalJson } from '../document/hash.ts'
import type { Problem } from '../document/index.ts'
import { refuse } from './types.ts'

/** The most characters of JSON one reply of the layer may hold. */
export const READ_CAP = 16000

/**
 * A short, deterministic tag of what a read asked for: FNV-1a (32 bits) over the canonical JSON of `parts`, in base 36. No `crypto`, so a read
 * stays synchronous. It binds a cursor to its read and its options; it is a guard against mix-ups (a cursor of `search` handed to
 * `pageOutline`, or to the same read with another depth), not a proof: two different inputs can share a tag.
 */
export function tagOf(...parts: unknown[]): string {
  const text = canonicalJson(parts)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** The message of the refusal for a cursor that another read, or the same read with other options, made. */
export const FOREIGN_CURSOR =
  'This cursor belongs to another read, or to the same read with other options. Start again without a cursor.'

/**
 * Takes rows from the cursor's offset while `JSON.stringify(wrap(rows, cut, cursor)).length <= READ_CAP`, where `cut` and the next
 * `cursor` are what that reply would carry: `cut` true and a cursor when rows remain, else `cut` false and no cursor.
 * A cursor is `"<revision>:<offset>:<tag>"`, where `tag` is `tagOf` of the read's name and the options that select its rows. One whose
 * tag is not `tag` was made by another read, or by this one with other options, and is refused with INVALID_OPERATION at `cursor`; so
 * is one that is not of that form, or whose offset is past the end. One of another revision is refused with REVISION_CONFLICT.
 *
 * It always makes progress: if even ONE row does not fit it still returns that row, and never zero rows with `cut: true`.
 * The caller keeps single rows small. Precondition: a reply never gets shorter when a row is added.
 * Apart from that one-row case a reply is never over READ_CAP, also when no rows are left.
 *
 * The count is found by doubling and then bisecting, so a long list costs about 2 log2(n) stringifications, each of about
 * one reply, instead of one per row.
 */
export function paged<R, T>(
  rows: readonly R[],
  revision: number,
  cursor: string | undefined,
  tag: string,
  wrap: (rows: R[], cut: boolean, cursor?: string) => T,
): T | { ok: false; problems: Problem[] } {
  let from = 0
  if (cursor !== undefined) {
    const m =
      typeof cursor === 'string'
        ? /^(\d+):(\d+):([0-9a-z]+)$/.exec(cursor)
        : null
    const rev = m ? Number(m[1]) : NaN
    from = m ? Number(m[2]) : NaN
    if (!m || !Number.isSafeInteger(rev) || !Number.isSafeInteger(from))
      return refuse(
        'INVALID_OPERATION',
        'Cursor must be "<revision>:<offset>:<tag>".',
        { path: 'cursor' },
      )
    if (m[3] !== tag)
      return refuse('INVALID_OPERATION', FOREIGN_CURSOR, { path: 'cursor' })
    if (rev !== revision)
      return refuse(
        'REVISION_CONFLICT',
        `The cursor was made for revision ${rev}, not ${revision}.`,
        { path: 'cursor' },
      )
    if (from > rows.length)
      return refuse('INVALID_OPERATION', 'The cursor is past the end.', {
        path: 'cursor',
      })
  }
  const left = rows.length - from
  const reply = (k: number) => {
    const cut = k < left
    return wrap(
      rows.slice(from, from + k),
      cut,
      cut ? `${revision}:${from + k}:${tag}` : undefined,
    )
  }
  const fits = (k: number) => JSON.stringify(reply(k)).length <= READ_CAP
  if (fits(left)) return reply(left)
  // fits(lo) holds (or lo is 1, which is always taken); fits(hi) does not.
  let lo = 1
  let hi = 2
  while (hi < left && fits(hi)) {
    lo = hi
    hi *= 2
  }
  hi = Math.min(hi, left)
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return reply(lo)
}
