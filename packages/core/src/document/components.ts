import { isObj } from './rules.ts'
import { touched } from './samples.ts'
import type { ControlField, Node, Override } from './types.ts'

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
  if (field === 'text') {
    delete line.bind
    copy[run] = { ...line, text: value }
  } else {
    delete line.bindHref
    copy[run] = { ...line, link: value }
  }
  return { props: { runs: copy } }
}

/** Lays an override (an instance's, or a look's patch) onto a part: props merge, `hide` merges, style layers merge by layer and `when` layers are appended. Words set by it are the owner's. */
export function applyOverride(w: Node, o: Override) {
  if (o.props) w.props = { ...w.props, ...structuredClone(o.props) }
  // Words the owner set on a use are the owner's, whatever the master's text was.
  if (
    o.props &&
    ('runs' in o.props || 'label' in o.props || 'summary' in o.props) &&
    w.props
  )
    w.props = touched(w.props)
  if (o.hide) w.hide = { ...w.hide, ...o.hide }
  if (o.style) {
    const style = (w.style ??= {}) as Record<string, object>
    for (const [layer, decl] of Object.entries(structuredClone(o.style)))
      style[layer] =
        layer === 'when'
          ? ([
              ...((style[layer] as unknown as unknown[]) ?? []),
              ...(decl as unknown as unknown[]),
            ] as never)
          : { ...style[layer], ...decl }
  }
}
