import { type Problem } from '../document/index.ts'
import { isObj } from '../document/rules.ts'

export type FieldType =
  'text' | 'number' | 'boolean' | 'list' | { rows: Record<string, FieldType> }
export type Row = Record<string, unknown>
export type DataSource = {
  name: string
  fields: Record<string, FieldType>
  sample: readonly Row[]
  /** A short note on what the source holds; at most 500 characters. */
  guide?: string
}

function checkRow(
  fields: Record<string, FieldType>,
  row: unknown,
  path: string,
  out: Problem[],
): void {
  if (!isObj(row)) {
    out.push({
      code: 'INVALID_DOCUMENT',
      message: 'Row must be an object.',
      path,
    })
    return
  }
  for (const [key, value] of Object.entries(row)) {
    const at = `${path}.${key}`
    const type = Object.hasOwn(fields, key) ? fields[key] : undefined
    if (type === undefined)
      out.push({
        code: 'INVALID_DOCUMENT',
        message: `Field "${key}" is not in the source.`,
        path: at,
      })
    else if (value == null) continue
    else if (typeof type === 'object') {
      if (!Array.isArray(value))
        out.push({
          code: 'INVALID_DOCUMENT',
          message: 'Expected a list of rows.',
          path: at,
        })
      else if (!isObj(type.rows as unknown))
        out.push({
          code: 'INVALID_DOCUMENT',
          message: 'The source needs a rows object for this field.',
          path: at,
        })
      else value.forEach((r, i) => checkRow(type.rows, r, `${at}.${i}`, out))
    } else if (type === 'list') {
      if (!Array.isArray(value))
        out.push({
          code: 'INVALID_DOCUMENT',
          message: 'Expected a list.',
          path: at,
        })
    } else if (typeof value !== (type === 'text' ? 'string' : type))
      out.push({
        code: 'INVALID_DOCUMENT',
        message: `Expected ${type}.`,
        path: at,
      })
  }
}

export function checkRows(source: DataSource, rows: unknown): Problem[] {
  const out: Problem[] = []
  const name = isObj(source) ? source.name : undefined
  if (!isObj(source) || !isObj(source.fields as unknown))
    return [
      {
        code: 'INVALID_DOCUMENT',
        message: 'The source needs a fields object.',
        path: name,
      },
    ]
  if (!Array.isArray(rows))
    return [
      {
        code: 'INVALID_DOCUMENT',
        message: 'Rows must be a list.',
        path: source.name,
      },
    ]
  rows.forEach((row, i) =>
    checkRow(source.fields, row, `${source.name}.${i}`, out),
  )
  return out
}
