import {
  type Component,
  type ComponentProp,
  type Kind,
  type KindSpec,
  type Node,
} from '../document/index.ts'
import { MAX_ROWS } from '../document/kinds.ts'
import {
  BIND_KEY,
  CONTROL_FIELDS,
  changeFor,
  runChange,
} from '../document/components.ts'
import { resolvePart } from '../document/tree.ts'
import { type ControlField } from '../document/types.ts'
import { isObj } from '../document/rules.ts'
import {
  bad,
  isInt,
  isNum,
  isStr,
  oneOf,
  only,
  specOf,
  type Bad,
  type Checks,
  type Ctx,
  type Entry,
  type Obj,
  type Refs,
  type Tree,
} from './common.ts'
import { hideOk, linkBad, propBad, styleBad } from './tree.ts'
import { lookup, refsFor } from './data.ts'

/** The ids of components that use themselves, or use one that does. One search over the list, so a check never repeats work per use. */
export function cyclicComponents(components: Component[]): Set<string> {
  const refs = new Map<string, string[]>()
  for (const comp of components) {
    const r: string[] = []
    const seen = new Set<unknown>()
    const stack: unknown[] = isObj(comp) && isObj(comp.root) ? [comp.root] : []
    while (stack.length) {
      const w = stack.pop()
      if (!isObj(w) || seen.has(w)) continue
      seen.add(w)
      if (w.kind === 'instance' && typeof w.component === 'string')
        r.push(w.component)
      if (Array.isArray(w.children)) for (const k of w.children) stack.push(k)
    }
    refs.set(comp.id, r)
  }
  const state = new Map<string, 1 | 2>()
  const found = new Set<string>()
  const visit = (id: string): boolean => {
    if (found.has(id) || state.get(id) === 1) return true
    if (state.get(id) === 2 || !refs.has(id)) return false
    state.set(id, 1)
    let b = false
    for (const next of refs.get(id)!) if (visit(next)) b = true
    state.set(id, 2)
    if (b) found.add(id)
    return b
  }
  for (const id of refs.keys()) visit(id)
  return found
}

export const PROP_TYPE_CONTROL = {
  text: 'text',
  image: 'asset',
  link: 'link',
  toggle: 'switch',
  color: 'color',
  number: 'number',
} as const
export const PROP_KEY = /^[a-z0-9-]{1,32}$/

export function controlApplies(c: Ctx, w: Node, field: unknown): boolean {
  if (typeof field !== 'string' || !Object.hasOwn(CONTROL_FIELDS, field))
    return false
  const spec = specOf(c, w.kind)
  if (!spec) return false
  const path = CONTROL_FIELDS[field as ControlField].path
  if (path[0] === 'repeat')
    return !!w.repeat && (w.kind === 'list' || w.kind === 'table')
  if (path[0] === 'props') return Object.hasOwn(spec.props, path[1])
  return (spec.styles as string[]).includes(path[2])
}

export function partsOf(c: Ctx, comp: Component): Map<string, Node> {
  const known = c.partMemo.get(comp.id)
  if (known) return known
  const m = new Map<string, Node>()
  for (const e of c.compTrees.get(comp.id)?.entries ?? [])
    if (!m.has(e.w.id)) m.set(e.w.id, e.w)
  c.partMemo.set(comp.id, m)
  return m
}

/** The component's properties that are objects; anything else in the list is reported by `componentBad`. */
const propsOf = (comp: Component): ComponentProp[] =>
  (comp.props as unknown[]).filter(isObj) as unknown as ComponentProp[]

/** The container that takes an instance's children, as the component's slot property names it. */
export function slotPart(c: Ctx, comp: Component): Node | undefined {
  const parts = partsOf(c, comp)
  for (const p of propsOf(comp)) {
    const x = p.type === 'slot' && p.part ? parts.get(p.part) : undefined
    if (x && specOf(c, x.kind)?.role === 'container') return x
  }
}

/** A change to one part, as a look or an instance holds it. */
export function overrideBad(
  c: Checks,
  o: unknown,
  kind: Kind,
  refs: Refs,
): string | null {
  const spec = specOf(c, kind)
  if (!spec) return 'is for a part this site does not know.'
  if (!isObj(o) || !only(o, ['style', 'props', 'hide']))
    return 'has a change that is not a style, setting or hide.'
  if (o.props !== undefined) {
    if (!isObj(o.props)) return 'has settings that are not an object.'
    for (const [k, v] of Object.entries(o.props)) {
      const f = Object.hasOwn(spec.props, k) ? spec.props[k] : undefined
      const p = f
        ? propBad(c, f, v, k, refs)
        : bad('is not a setting this part has.')
      if (p) return `has a ${k} that ${p.message}`
    }
  }
  if (o.style !== undefined) {
    const p = styleBad(c, kind, o.style)
    if (p.length) return `has a style that is not allowed: ${p[0].message}`
  }
  if (o.hide !== undefined && !hideOk(o.hide))
    return 'has a hide setting that is not valid.'
  return null
}

/** The save check for one change to a part of a kind, for a caller with no document (render-time data binding): a reason, or null. `kinds` are the plug-in kinds; core kinds are always known. Any reference shape that validation accepts passes. */
export function overrideProblem(
  o: unknown,
  kind: Kind,
  env: {
    fonts: readonly string[]
    styles: Checks['styles']
    kinds?: ReadonlyMap<string, KindSpec>
  },
): string | null {
  return overrideBad(
    {
      kinds: env.kinds ?? new Map(),
      styles: env.styles,
      fonts: new Set(env.fonts),
    },
    o,
    kind,
    r => (lookup(r, []) === 'shape' ? 'shape' : 'ok'),
  )
}

export function valueBad(
  c: Ctx,
  type: string,
  v: unknown,
  refs: Refs,
): string | null {
  switch (type) {
    case 'text':
      return typeof v === 'string'
        ? v.length <= 5000
          ? null
          : 'is too long.'
        : (propBad(
            c,
            { type: 'list', max: 50, maxLength: 5000 },
            v,
            'runs',
            refs,
          )?.message ?? null)
    case 'image':
      return isStr(v) && v ? null : 'does not name a file.'
    case 'link':
      return linkBad(v)
    case 'toggle':
      return typeof v === 'boolean' ? null : 'must be on or off.'
    // A colour or a number is held to the part's own limits next.
    case 'color':
      return typeof v === 'string' || (isObj(v) && typeof v.style === 'string')
        ? null
        : 'is not a colour.'
    case 'number':
      return isNum(v, -100000, 100000) ? null : 'is not a number.'
    case 'choice':
      return typeof v === 'string' ? null : 'is not a look name.'
    default:
      return 'is not a setting an instance can set.'
  }
}

/** What a value does to the part it is set on: held to the part's own limits (its colours, sizes and spacing, its label's length, its link). */
export function onPart(
  c: Ctx,
  p: ComponentProp,
  part: Node,
  v: unknown,
  refs: Refs,
): string | null {
  if (p.field === 'limit')
    return isInt(v, 1, MAX_ROWS)
      ? null
      : `is not a whole number from 1 to ${MAX_ROWS}.`
  const change =
    p.run !== undefined
      ? runChange(part.props?.runs, p.run, p.field!, v)
      : changeFor(p.field!, v, true)
  return change ? overrideBad(c, change, part.kind, refs) : null
}

/** A layer in a component used inside a repeat: the hazards the direct rules guard against, found through the master and any nested ones. */
export function layerBad(
  c: Ctx,
  comp: Component,
  parentKind: Kind | undefined,
): string | null {
  const key = `${comp.id}|${parentKind}`
  if (c.layerMemo.has(key)) return c.layerMemo.get(key)!
  c.layerMemo.set(key, null)
  let found: string | null = null
  for (const e of c.compTrees.get(comp.id)?.entries ?? []) {
    const x = e.w
    const up = e.parent ? e.parent.w.kind : parentKind
    const props = isObj(x.props) ? x.props : {}
    if (props.layer !== undefined && props.open === true)
      found ??= "A layer inside a list can't start open."
    if (props.layer === 'dialog' && up === 'list')
      found ??=
        'Nest the dialog inside the list item; a direct list child must render as li.'
    const inner =
      x.kind === 'instance' ? c.comps.get(x.component as string) : undefined
    if (inner) found ??= layerBad(c, inner, up)
  }
  c.layerMemo.set(key, found)
  return found
}

export function instanceBad(c: Ctx, e: Entry, refs: Refs): Bad | null {
  const w = e.w
  const comp =
    typeof w.component === 'string' ? c.comps.get(w.component) : undefined
  if (!comp)
    return bad(
      'Its component is not one this site has.',
      'UNKNOWN_COMPONENT',
      'component',
    )
  if (c.cyclic.has(comp.id))
    return bad("A component can't contain itself.", undefined, 'component')
  if (w.style !== undefined)
    return bad(
      'Its changes to the component go in its overrides.',
      undefined,
      'style',
    )
  if (w.origin !== undefined)
    return bad("A component use can't be a block.", undefined, 'origin')
  const parts = partsOf(c, comp)
  if (w.set !== undefined) {
    if (!isObj(w.set))
      return bad('Its values are not an object.', undefined, 'set')
    for (const [k, v] of Object.entries(w.set)) {
      const p = propsOf(comp).find(x => x.key === k)
      if (!p)
        return bad(
          `Its value "${k.slice(0, 40)}" is not a property of the component.`,
          undefined,
          `set.${k.slice(0, 40)}`,
        )
      const m =
        valueBad(c, p.type, v, refs) ??
        // a look the component lacks would be dropped for the default when the page renders
        (p.type === 'choice' && !(p.options ?? []).includes(v as string)
          ? 'is not one of the looks.'
          : null)
      if (m) return bad(`Its ${k} ${m}`, undefined, `set.${k}`)
      // The part has limits of its own (a label's length, an alt's): refuse what render would drop.
      const part =
        p &&
        p.type !== 'choice' &&
        p.type !== 'slot' &&
        p.part &&
        typeof p.field === 'string' &&
        Object.hasOwn(CONTROL_FIELDS, p.field)
          ? parts.get(p.part)
          : undefined
      const over = p && part && onPart(c, p, part, v, refs)
      if (over)
        return bad(`Its value for "${k}" ${over}`, undefined, `set.${k}`)
    }
  }
  if (w.overrides !== undefined) {
    if (!isObj(w.overrides))
      return bad('Its overrides are not an object.', undefined, 'overrides')
    for (const [id, o] of Object.entries(w.overrides)) {
      // A part the master has lost is dropped when the page renders, so only the shape is checked.
      const part = resolvePart(c.comps, comp, id)
      const m = part
        ? overrideBad(c, o, part.kind, refs)
        : 'names a part the component does not have.'
      if (m)
        return bad(
          `Its change to "${id.slice(0, 40)}" ${m}`,
          undefined,
          `overrides.${id.slice(0, 40)}`,
        )
    }
  }
  let repeated = false
  for (let a = e.parent; a; a = a.parent)
    if (a.w.repeat !== undefined) repeated = true
  const layer = repeated ? layerBad(c, comp, e.parent?.w.kind) : null
  if (layer) return bad(layer)
  if (w.children?.length && !slotPart(c, comp))
    return bad(
      'Its component has no place for nodes inside it.',
      undefined,
      'children',
    )
  return null
}

/** Whether `bind` may carry this key: a kind's own bindable fields, or for an instance a property of its component that writes to a bindable field. */
export function bindAllowed(
  c: Ctx,
  w: Node,
  spec: KindSpec,
  k: string,
): boolean {
  // A key a kind lists but has no prop of (a text's `text` and `link`, which bind through its runs) would validate and then be dropped.
  if (w.kind !== 'instance')
    return spec.bindable.includes(k) && Object.hasOwn(spec.props, k)
  const comp = c.comps.get(w.component as string)
  const p = comp && propsOf(comp).find(x => x.key === k)
  if (
    !comp ||
    !p ||
    typeof p.field !== 'string' ||
    p.type === 'choice' ||
    p.type === 'slot'
  )
    return false
  const part = p.part ? partsOf(c, comp).get(p.part) : undefined
  const ps = part && specOf(c, part.kind)
  if (!ps) return false
  // A text or link property of one run binds that run; a show-or-hide property binds the part's show condition.
  if (p.field === 'hidden') return p.type === 'toggle'
  if (p.run !== undefined || p.field === 'text')
    return ps.bindable.includes('text')
  const key = BIND_KEY[p.field]
  return !!key && ps.bindable.includes(key)
}

/** A component's own properties and looks, checked against its master tree. */
export function componentBad(c: Ctx, t: Tree): Bad[] {
  const comp = t.comp!
  const out: Bad[] = []
  const refs = refsFor([])
  const parts = new Map<string, Node>()
  for (const e of t.entries) if (!parts.has(e.w.id)) parts.set(e.w.id, e.w)
  const inRepeat = new Set<string>()
  for (const e of t.entries)
    for (let a = e.parent; a; a = a.parent)
      if (a.w.repeat !== undefined) {
        inRepeat.add(e.w.id)
        break
      }
  const push = (message: string, path: string) =>
    void out.push(bad(message, undefined, path))
  const props = comp.props as unknown[]
  if (props.filter(p => isObj(p) && p.type === 'slot').length > 1)
    push('A component can have only one slot.', 'props')
  const keys = new Set<string>()
  for (const raw of props) {
    const p = raw as Obj
    const part =
      isObj(p) && typeof p.part === 'string' ? parts.get(p.part) : undefined
    if (
      !isObj(p) ||
      !only(p, [
        'key',
        'label',
        'type',
        'part',
        'field',
        'run',
        'options',
        'default',
      ]) ||
      typeof p.key !== 'string' ||
      !PROP_KEY.test(p.key) ||
      keys.has(p.key) ||
      !isStr(p.label, 80) ||
      !p.label.trim()
    ) {
      push(
        'A property has a name or label that is not valid, or is used twice.',
        'props',
      )
      continue
    }
    keys.add(p.key)
    if (typeof p.part === 'string' && inRepeat.has(p.part)) {
      push("A property can't point inside a repeating list.", 'props')
      continue
    }
    const cp = p as unknown as ComponentProp
    if (p.type === 'choice') {
      const o = p.options
      if (
        !Array.isArray(o) ||
        !o.length ||
        o.length > 16 ||
        !o.every(x => typeof x === 'string' && PROP_KEY.test(x)) ||
        new Set(o).size !== o.length ||
        (p.default !== undefined && !o.includes(p.default))
      )
        push(`The look choice "${p.key}" is not valid.`, 'props')
    } else if (p.type === 'slot') {
      if (!part || specOf(c, part.kind)?.role !== 'container')
        push(
          `The slot "${p.key}" must point at a container in the component.`,
          'props',
        )
    } else if (p.run !== undefined) {
      if (!(
        oneOf(p.type, ['text', 'link']) &&
        p.type === p.field &&
        part &&
        controlApplies(c, part, 'text') &&
        isInt(p.run, 0, 49) &&
        Array.isArray(part.props?.runs) &&
        p.run < part.props.runs.length
      ))
        push(
          `The property "${p.key}" does not fit the text run it points at.`,
          'props',
        )
      else if (p.default !== undefined) {
        const m = valueBad(c, p.type as string, p.default, refs)
        if (m) push(`The default of "${p.key}" ${m}`, 'props')
      }
    } else if (
      !oneOf(p.type, Object.keys(PROP_TYPE_CONTROL)) ||
      !part ||
      typeof p.field !== 'string' ||
      !Object.hasOwn(CONTROL_FIELDS, p.field) ||
      CONTROL_FIELDS[p.field as ControlField].type !==
        PROP_TYPE_CONTROL[p.type as keyof typeof PROP_TYPE_CONTROL] ||
      !controlApplies(c, part, p.field)
    )
      push(
        `The property "${p.key}" does not fit the part it points at.`,
        'props',
      )
    else if (p.default !== undefined) {
      const m =
        valueBad(c, p.type as string, p.default, refs) ??
        onPart(c, cp, part, p.default, refs)
      if (m) push(`The default of "${p.key}" ${m}`, 'props')
    }
  }
  for (const v of comp.variants as unknown[]) {
    if (
      !isObj(v) ||
      !only(v, ['when', 'patch']) ||
      !isObj(v.when) ||
      !isObj(v.patch)
    ) {
      push('A look is not valid.', 'variants')
      continue
    }
    for (const [k, val] of Object.entries(v.when)) {
      const p = props.find(x => isObj(x) && x.key === k) as Obj | undefined
      if (
        p?.type !== 'choice' ||
        !(Array.isArray(p.options) && p.options.includes(val))
      )
        push(
          `A look depends on "${k.slice(0, 40)}", which is not one of the choices.`,
          'variants',
        )
    }
    for (const [id, o] of Object.entries(v.patch)) {
      const part = parts.get(id)
      const m = part
        ? overrideBad(c, o, part.kind, refs)
        : 'is not a part of the component.'
      if (m) push(`A look's change to "${id.slice(0, 40)}" ${m}`, 'variants')
    }
  }
  return out
}
