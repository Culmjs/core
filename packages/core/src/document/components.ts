import { isObj } from './rules.ts'
import type { ControlField } from './types.ts'

export type ControlType =
  'text' | 'link' | 'asset' | 'color' | 'number' | 'switch'
/** Stored controls use these identifiers, never arbitrary object paths. */
export const CONTROL_FIELDS: Record<
  ControlField,
  { type: ControlType; path: readonly string[] }
> = {
  text: { type: 'text', path: ['props', 'runs'] },
  label: { type: 'text', path: ['props', 'label'] },
  link: { type: 'link', path: ['props', 'link'] },
  asset: { type: 'asset', path: ['props', 'assetId'] },
  alt: { type: 'text', path: ['props', 'alt'] },
  fallback: { type: 'text', path: ['props', 'fallback'] },
  color: { type: 'color', path: ['style', 'base', 'color'] },
  background: { type: 'color', path: ['style', 'base', 'bg'] },
  fontSize: { type: 'number', path: ['style', 'base', 'size'] },
  gap: { type: 'number', path: ['style', 'base', 'gap'] },
  padding: { type: 'number', path: ['style', 'base', 'padding'] },
  hidden: { type: 'switch', path: ['style', 'base', 'hidden'] },
  limit: { type: 'number', path: ['repeat', 'max'] },
}
/** Which `bind` key carries data for a component property that writes each field; `text` binds through its runs instead. */
export const BIND_KEY: Partial<Record<ControlField, string>> = {
  label: 'label',
  link: 'link',
  alt: 'alt',
  fallback: 'fallback',
  asset: 'src',
}
/** The change a value for `field` makes to a part, shaped like an override, so one check holds it to the part's own limits. */
export function changeFor(
  field: ControlField,
  value: unknown,
  asText = false,
): Record<string, unknown> {
  // An on/off property means "shown", so it writes the opposite of `hidden`.
  const path = CONTROL_FIELDS[field].path
  const val =
    field === 'text' && asText && typeof value === 'string'
      ? [{ text: value }]
      : field === 'hidden'
        ? typeof value === 'boolean'
          ? !value
          : value
        : value
  const change: Record<string, unknown> = {}
  let at = change
  for (const k of path.slice(0, -1)) at = at[k] = {} as Record<string, unknown>
  at[path[path.length - 1]] = val
  return change
}

/** The change a value makes to ONE run of a part's text (its words for a text property, its link for a link one); null if there is no such run. */
export function runChange(
  runs: unknown,
  run: number,
  field: ControlField,
  value: unknown,
): Record<string, unknown> | null {
  const at = Array.isArray(runs) ? runs[run] : undefined
  if (!isObj(at)) return null
  const copy = (runs as Record<string, unknown>[]).map(r => ({ ...r }))
  const line = { ...copy[run] }
  delete line.bind
  delete line.bindHref
  copy[run] =
    field === 'text' ? { ...line, text: value } : { ...copy[run], link: value }
  return { props: { runs: copy } }
}
