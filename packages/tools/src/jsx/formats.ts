// Alternative, data-only front ends. All three produce the same located elements;
// none inject HTML, run JavaScript, or install components in the generated site.
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { isObj } from '../shared.ts'
import {
  JsxError,
  MAX_EL_DEPTH,
  MAX_JSX_CHARS,
  parseJsx,
  type El,
} from './parse.ts'
import { htmlElements } from './html.ts'
import { nameOf } from './tree.ts'
import type { Warning } from './normalise.ts'

export type Source = {
  jsx?: string
  html?: string
  css?: string
  json?: unknown
}
export const start = { line: 1, col: 1 }

export function safeData(value: unknown, path: string, depth = 0) {
  if (depth > 2 * MAX_EL_DEPTH + 24)
    throw new JsxError('Data is nested too deep.', start, path)
  if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (['constructor', '__proto__', 'prototype'].includes(k))
        throw new JsxError(`"${k}" is not an allowed field.`, start, path)
      safeData(v, `${path}.${k}`, depth + 1)
    }
}

export function sourceElements(
  a: Source,
  errs: JsxError[],
  warnings: Warning[],
): El[] {
  const formats = ['jsx', 'html', 'json'] as const
  if (formats.filter(k => a[k] !== undefined).length !== 1)
    throw new JsxError('Provide one source: html, jsx, or json.', start)
  if (
    a.css !== undefined &&
    (typeof a.css !== 'string' || a.html === undefined)
  )
    throw new JsxError(
      'css is a stylesheet string accompanying html.',
      start,
      'css',
    )
  if (a.jsx !== undefined) {
    if (typeof a.jsx !== 'string')
      throw new JsxError('jsx must be a text.', start, 'jsx')
    return parseJsx(a.jsx)
  }
  if (a.html !== undefined) {
    if (
      typeof a.html !== 'string' ||
      a.html.length + (a.css?.length ?? 0) > MAX_JSX_CHARS
    )
      throw new JsxError(
        `html and css must be text within ${MAX_JSX_CHARS} characters.`,
        start,
        'html',
      )
    return htmlElements(a.html, a.css, errs, warnings)
  }
  let value = a.json
  if (
    (typeof value === 'string' ? value : JSON.stringify(value)).length >
    MAX_JSX_CHARS
  )
    throw new JsxError('JSON exceeds the write size limit.', start, 'json')
  if (typeof value === 'string') {
    const errors: ParseError[] = []
    const parsed: unknown = parse(value, errors, { allowTrailingComma: true })
    if (errors.length) {
      const e = errors[0]!,
        lines = value.slice(0, e.offset).split('\n')
      throw new JsxError(
        printParseErrorCode(e.error),
        { line: lines.length, col: lines.at(-1)!.length + 1 },
        'json',
      )
    }
    value = parsed
  }
  safeData(value, 'json')
  const node = (v: unknown, path: string, depth: number): El[] => {
    const bad = (m: string) => errs.push(new JsxError(m, start, path))
    if (depth > MAX_EL_DEPTH) {
      bad('The elements are nested too deep.')
      return []
    }
    if (!isObj(v) || typeof (v.kind ?? v.type) !== 'string') {
      bad('Expected a node such as {kind:"text", text:"Hello"}.')
      return []
    }
    const kind = (v.kind ?? v.type) as string
    if (!/^[a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*$/.test(kind)) {
      bad('A node needs an element name such as "text".')
      return []
    }
    const name = nameOf(kind)
    const el: El = {
      name,
      sourcePath: path,
      at: start,
      attrs: new Map(),
      children: [],
    }
    const attr = (k: string, val: unknown) =>
      el.attrs.set(k, { at: start, value: val })
    for (const [k, val] of Object.entries(v)) {
      if (k === 'kind' || k === 'type') continue
      if (k === 'text' || (k === 'children' && typeof val === 'string')) {
        if (typeof val === 'string' && el.text === undefined) el.text = val
        else bad('Give text once, as a string.')
      } else if (k === 'children') {
        if (!Array.isArray(val))
          bad('children must be an array of nodes or text.')
        else
          el.children = val.flatMap((c, i) =>
            node(c, `${path}.children[${i}]`, depth + 1),
          )
      } else if (
        k === 'style' &&
        isObj(val) &&
        Object.keys(val).some(l =>
          ['base', 'phone', 'tablet', 'dark', 'hover'].includes(l),
        )
      ) {
        for (const [layer, d] of Object.entries(val))
          attr(layer === 'base' ? 'style' : layer, d)
      } else attr(k, val)
    }
    return [el]
  }
  return Array.isArray(value)
    ? value.flatMap((v, i) => node(v, `json[${i}]`, 0))
    : node(value, 'json', 0)
}
