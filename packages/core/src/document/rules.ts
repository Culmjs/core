/** Rules several layers share, each written once here, in the lowest layer that needs it. */

/** A plain object: not null, not an array. */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const fieldsOf = <T>(all: Record<keyof T, true>) =>
  new Set(Object.keys(all))
export const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
export const isNum = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
export const oneOf = (v: unknown, list: readonly string[]): v is string =>
  typeof v === 'string' && list.includes(v)

/** Field names that must never be read from or written to by a path from outside. */
export const UNSAFE_FIELDS: readonly string[] = [
  '__proto__',
  'constructor',
  'prototype',
]

export const hasControl = (v: string) =>
  [...v].some(ch => ch.charCodeAt(0) < 32 || ch === '\x7f')

/** Safe address schemes only; a leading `//`, a backslash or a control character can escape to another host. Used before an address is saved and before it is written. */
export const urlOk = (v: string) =>
  !hasControl(v) &&
  !v.includes('\\') &&
  /^(https?:|mailto:|#|\/(?!\/))/i.test(v)

/** A site path: `/` for the home page, else `/a` or `/a/b`; segments of lower-case letters, digits and dashes (the page-link characters), so no two slugs name one file and every slug can be linked. */
export const SLUG_RE = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/

/** The name that groups details elements so only one is open. */
export const DETAILS_NAME = /^[a-z0-9-]{1,32}$/
