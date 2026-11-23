import { createHash } from 'node:crypto'
import { isObj } from '../shared.ts'
import { MAX_JSX_CHARS } from '../jsx/parse.ts'

type Obj = Record<string, unknown>
/** Session-local refused arguments. JSON Patch replace operations address
 * fields, not snippets that the caller must reproduce verbatim. */
export function writeDrafts() {
  const saved = new Map<string, string>()
  function remember(input: Obj) {
    const text = JSON.stringify(input)
    if (text.length > MAX_JSX_CHARS) return {}
    const draft = createHash('sha256').update(text).digest('hex').slice(0, 24)
    saved.set(draft, text)
    if (saved.size > 8) saved.delete(saved.keys().next().value!)
    return { draft }
  }
  function amend(a: Obj): { input: Obj } | { error: string } {
    if (
      Object.keys(a).some(k => !['baseRevision', 'draft', 'edits'].includes(k))
    )
      return { error: 'With draft, give only baseRevision and edits.' }
    const text = typeof a.draft === 'string' && saved.get(a.draft)
    if (!text)
      return {
        error: 'Unknown or expired draft. Send the source or section again.',
      }
    const input = JSON.parse(text) as Obj
    if (input.baseRevision !== a.baseRevision)
      return { error: 'A draft belongs to its original baseRevision.' }
    if (
      !Array.isArray(a.edits) ||
      !a.edits.length ||
      a.edits.length > 32 ||
      JSON.stringify(a.edits).length > MAX_JSX_CHARS
    )
      return {
        error: 'Give 1–32 JSON Patch replacements within the write size limit.',
      }
    for (const [i, e] of a.edits.entries()) {
      const error = `edits[${i}] must replace an existing source field, e.g. {op:"replace",path:"/patch/0/id",value:"intro"}.`
      if (
        !isObj(e) ||
        e.op !== 'replace' ||
        typeof e.path !== 'string' ||
        !Object.hasOwn(e, 'value') ||
        !e.path.startsWith('/')
      )
        return { error }
      const path = e.path
        .slice(1)
        .split('/')
        .map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'))
      if (
        ![
          'jsx',
          'html',
          'json',
          'css',
          'insert',
          'theme',
          'patch',
          'target',
          'page',
          'title',
          'path',
        ].includes(path[0]!) ||
        path.some(k => ['__proto__', 'prototype', 'constructor'].includes(k))
      )
        return { error }
      let parent: unknown = input
      for (const [j, k] of path.entries()) {
        if (
          !parent ||
          typeof parent !== 'object' ||
          !Object.hasOwn(parent, k) ||
          (Array.isArray(parent) && !/^(0|[1-9]\d*)$/.test(k))
        )
          return { error }
        if (j === path.length - 1) (parent as Obj)[k] = e.value
        else parent = (parent as Obj)[k]
      }
    }
    if (JSON.stringify(input).length > MAX_JSX_CHARS)
      return { error: 'Amended draft exceeds the write size limit.' }
    return { input }
  }
  return { remember, amend }
}
