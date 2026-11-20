import type { Problem } from '../document/index.ts'
import { refuse } from './types.ts'

/** The most characters of JSON one reply of the layer may hold. */
export const READ_CAP = 16000

/**
 * Takes rows from the cursor's offset while `JSON.stringify(wrap(rows, cut, cursor)).length <= READ_CAP`, where `cut` and the next
 * `cursor` are what that reply would carry: `cut` true and a cursor when rows remain, else `cut` false and no cursor.
 * A cursor is `"<revision>:<offset>"`. One of another revision is refused with REVISION_CONFLICT; one that is not of that form, or
 * whose offset is past the end, with INVALID_OPERATION at `cursor`.
 *
 * It always makes progress: if even ONE row does not fit it still returns that row, and never zero rows with `cut: true`.
 * The caller keeps single rows small.
 *
 * The count is found by doubling and then bisecting, so a long list costs about 2 log2(n) stringifications, each of about
 * one reply, instead of one per row.
 */
export function paged<R, T>(
  rows: readonly R[],
  revision: number,
  cursor: string | undefined,
  wrap: (rows: R[], cut: boolean, cursor?: string) => T,
): T | { ok: false; problems: Problem[] } {
  let from = 0
  if (cursor !== undefined) {
    const m = typeof cursor === 'string' ? /^(\d+):(\d+)$/.exec(cursor) : null
    const rev = m ? Number(m[1]) : NaN
    from = m ? Number(m[2]) : NaN
    if (!m || !Number.isSafeInteger(rev) || !Number.isSafeInteger(from))
      return refuse(
        'INVALID_OPERATION',
        'Cursor must be "<revision>:<offset>".',
        {
          path: 'cursor',
        },
      )
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
      cut ? `${revision}:${from + k}` : undefined,
    )
  }
  const fits = (k: number) => JSON.stringify(reply(k)).length <= READ_CAP
  if (left === 0 || fits(left)) return reply(left)
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
