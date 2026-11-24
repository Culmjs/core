// Optional ordered inserts and field edits. Project onto a detached document
// for later ids; the caller commits the entire operation list exactly once.
import {
  find,
  type Registry,
  type SiteDocument,
  type Problem,
} from '@culmjs/core'
import { projectOps } from '@culmjs/core/internal/projection'
import { isObj } from '../shared.ts'
import { safeData, start, type Source } from './formats.ts'
import { JsxError, MAX_JSX_CHARS } from './parse.ts'
import { linkValue, normalise, type FontNeed } from './normalise.ts'
import type { Want } from './tree.ts'
import { buildWrite, locate, previewOps, type Built } from './write.ts'

type Obj = Record<string, unknown>
type Input = Parameters<typeof buildWrite>[2] & {
  insert?: unknown
  patch?: unknown
  ops?: unknown
}
type Good = Extract<Built, { ok: true }>
const bad = (path: string, message: string): Problem => ({
  code: 'INVALID_OPERATION',
  path,
  message,
})
export function buildRequest(
  doc: SiteDocument,
  registry: Registry,
  a: Input,
): Built {
  const hasSource =
    a.jsx !== undefined || a.json !== undefined || a.html !== undefined
  const ordered = a.ops !== undefined
  if (
    ordered &&
    (!Array.isArray(a.ops) ||
      a.ops.length < 1 ||
      a.ops.length > 32 ||
      [a.insert, a.patch, a.theme].some(x => x !== undefined))
  )
    return {
      ok: false,
      problems: [
        bad(
          'ops',
          'Supply 1–32 ordered JSON edits in ops, without insert, patch or theme alongside them.',
        ),
      ],
    }
  const batched = ordered || a.insert !== undefined || a.patch !== undefined
  if (!batched && (hasSource || a.theme === undefined))
    return buildWrite(doc, registry, a)
  if (!batched) {
    if (a.target !== undefined || a.append || a.css !== undefined)
      return {
        ok: false,
        problems: [
          bad('theme', 'A theme alone cannot append or replace a node.'),
        ],
      }
    return buildWrite(doc, registry, { jsx: '', theme: a.theme })
  }
  if (
    hasSource ||
    a.target !== undefined ||
    a.append !== undefined ||
    a.css !== undefined
  )
    return {
      ok: false,
      problems: [
        bad(
          'insert',
          'Place html, json or jsx inside insert items when batching; target and append belong to a single-source write.',
        ),
      ],
    }
  const out: Good = {
    ok: true,
    ops: [],
    trees: [],
    plan: { entries: [], byId: new Map(), kinds: new Map() },
    offset: 0,
    errors: [],
    warnings: [],
  }
  const page = a.page ?? 'home',
    tree = { page }
  const error = (path: string, message: string) =>
    out.errors.push(bad(path, message))
  for (const [k, v] of [
    ['insert', a.insert],
    ['patch', a.patch],
  ] as const)
    if (v !== undefined && (!Array.isArray(v) || v.length > 128))
      error(k, `${k} takes an array of at most 128 items.`)
  if (out.errors.length) return { ok: false, problems: out.errors }
  const inserts = (a.insert ?? []) as unknown[],
    patches = (a.patch ?? []) as unknown[]
  const edits = (a.ops ?? []) as unknown[]
  if (
    !edits.length &&
    !inserts.length &&
    !patches.length &&
    a.theme === undefined
  )
    return { ok: false, problems: [bad('insert', 'No edits supplied.')] }
  const values = [a.theme, inserts, patches, edits]
  if (JSON.stringify(values).length > MAX_JSX_CHARS)
    return {
      ok: false,
      problems: [bad('insert', 'Batch exceeds the write size limit.')],
    }
  try {
    safeData(values, 'write')
  } catch (e) {
    if (e instanceof JsxError)
      return { ok: false, problems: [bad(e.path ?? 'write', e.message)] }
    throw e
  }
  const project = (ops: Obj[], path: string, b?: Good) => {
    if (!ops.length) return
    const r = projectOps(doc, registry, {
      site: 'x',
      key: 'x',
      baseRevision: 0,
      ops: previewOps(ops) as never,
    })
    if (!r.ok) {
      out.errors.push(
        ...r.problems.map(p => ({
          ...(b ? locate(b, p) : p),
          path: path + (p.path ? '.' + p.path : ''),
        })),
      )
      return
    }
    doc = r.doc
    out.ops.push(...ops)
    out.plan.entries.push(
      ...(b?.plan.entries ?? ops.map(op => ({ op }))).map(e => ({
        ...e,
        editPath: path,
      })),
    )
    b?.plan.byId.forEach((v, k) => out.plan.byId.set(k, v))
    b?.plan.kinds.forEach((v, k) => out.plan.kinds.set(k, v))
  }
  const add = (input: Parameters<typeof buildWrite>[2], path: string) => {
    const b = buildWrite(doc, registry, input)
    if (!b.ok) {
      out.errors.push(...b.problems.map(p => ({ ...p, path })))
      return
    }
    out.warnings.push(...b.warnings)
    out.errors.push(...b.errors.map(p => ({ ...p, path })))
    project(b.ops, path, b)
  }
  if (a.theme !== undefined) add({ jsx: '', theme: a.theme }, 'theme')
  const root = () => doc.pages.find(p => p.id === page)?.root
  const fromEdit = (index: number, emit: () => void) => {
    const firstEntry = out.plan.entries.length
    const firstError = out.errors.length
    emit()
    for (const e of out.plan.entries.slice(firstEntry)) e.editIndex = index
    for (const p of out.errors.slice(firstError)) p.op = index
  }
  const firstInsert = edits.findIndex(e => isObj(e) && e.op === 'insert')
  if (!root() && (inserts.length || firstInsert !== -1)) {
    const addPage = () =>
      project(
        [
          {
            op: 'addPage',
            page,
            title: a.title ?? page,
            slug: a.path ?? (page === 'home' ? '/' : `/${page}`),
            inMenu: true,
          },
        ],
        'page',
      )
    // A new page is projected before the batch, on behalf of its first insert.
    if (firstInsert !== -1) fromEdit(firstInsert, addPage)
    else addPage()
  }
  const fields = (item: Obj, allowed: string[], path: string) => {
    for (const k of Object.keys(item))
      if (!allowed.includes(k))
        error(
          `${path}.${k}`,
          `Unknown field "${k}". Expected ${allowed.join(', ')}.`,
        )
  }
  const settings = (block: string | undefined, v: unknown, path: string) => {
    if (v === undefined) return {}
    if (!isObj(v)) {
      error(path, 'set must be an object.')
      return {}
    }
    return Object.fromEntries(
      Object.entries(v).map(([k, value]) => [
        k,
        block &&
        registry.block(block)?.settings.find(s => s.key === k)?.type === 'link'
          ? linkValue(value)
          : value,
      ]),
    )
  }
  inserts.forEach((item, i) => {
    const path = `insert[${i}]`
    if (!isObj(item)) {
      error(path, 'Expected {html}, {json}, {jsx}, or {use,id}.')
      return
    }
    if (item.use !== undefined) {
      fields(item, ['use', 'look', 'id', 'set'], path)
      const b = typeof item.use === 'string' && registry.block(item.use)
      if (!b) {
        error(
          `${path}.use`,
          `Unknown block "${String(item.use)}". Supply html, json or jsx to create a custom section.`,
        )
        return
      }
      const r = root()
      if (!r) return
      project(
        [
          {
            op: 'insertBlock',
            tree,
            parent: r.id,
            index: r.children?.length ?? 0,
            block: item.use,
            look: item.look ?? b.looks[0]?.id,
            ...(item.id !== undefined ? { id: item.id } : {}),
            settings: settings(b.id, item.set, path + '.set'),
          },
        ],
        path,
      )
    } else {
      fields(item, ['html', 'css', 'jsx', 'json'], path)
      add({ ...(item as Source), page, append: true }, path)
    }
  })
  const patchItem = (p: unknown, path: string) => {
    if (!isObj(p) || typeof p.id !== 'string') {
      error(path + '.id', 'Name the node to change.')
      return
    }
    fields(
      p,
      [
        'id',
        'props',
        'motion',
        'text',
        'set',
        'style',
        'phone',
        'tablet',
        'dark',
        'hover',
      ],
      path,
    )
    const r = root(),
      n =
        r &&
        (find(r, p.id) ??
          (p.id.endsWith('.root') ? find(r, p.id.slice(0, -5)) : undefined))
    if (!n) {
      error(
        path + '.id',
        `No node "${p.id}" on "${page}". Use find for its id.`,
      )
      return
    }
    const scope = { tree, id: n.id }
    const w: Want = {
      id: n.id,
      kind: n.kind,
      at: start,
      path,
      props: {},
      layers: {},
      extras: {},
      children: [],
    }
    for (const k of ['props', 'style', 'phone', 'tablet', 'dark', 'hover'])
      if (p[k] !== undefined) {
        if (!isObj(p[k])) {
          error(`${path}.${k}`, `${k} must be an object.`)
          continue
        }
        if (k === 'props') w.props = { ...p[k] }
        else w.layers[k === 'style' ? 'base' : k] = { ...p[k] }
      }
    const needs = new Map<string, FontNeed | 'cat'>()
    const inheritedLevel =
      w.props.level === undefined && n.props?.level !== undefined
    if (inheritedLevel) w.props.level = n.props!.level
    normalise([w], { doc, siteRefs: new Set(), needs, warns: out.warnings })
    if (inheritedLevel) delete w.props.level
    const ops: Obj[] = []
    if (needs.size)
      ops.push({
        op: 'setFonts',
        fonts: [
          ...doc.fonts,
          ...[...needs].map(([ref, v]) =>
            v === 'cat' ? ref : { google: v.family, weights: [...v.weights] },
          ),
        ],
      })
    for (const [key, value] of Object.entries(
      settings(n.origin?.block, p.set, path + '.set'),
    ))
      ops.push({ op: 'setBlockSetting', ...scope, key, value })
    if (p.text !== undefined)
      ops.push(
        n.kind === 'button'
          ? { op: 'setProps', ...scope, props: { label: p.text } }
          : { op: 'setText', ...scope, text: p.text },
      )
    if (Object.keys(w.props).length)
      ops.push({ op: 'setProps', ...scope, props: w.props })
    if (p.motion !== undefined)
      ops.push({ op: 'setMotion', ...scope, motion: p.motion })
    for (const [layer, decl] of Object.entries(w.layers))
      if (isObj(decl) && Object.keys(decl).length)
        ops.push({ op: 'setStyle', ...scope, layer, decl })
    if (w.extras.slot)
      ops.push({
        op: 'setSlot',
        ...scope,
        slot: { ...n.slot, ...(w.extras.slot as Obj) },
      })
    project(ops, path)
  }
  patches.forEach((p, i) => patchItem(p, `patch[${i}]`))
  const orderedItem = (edit: unknown, path: string) => {
    if (!isObj(edit))
      return void error(path, 'Expected a JSON operation object.')
    switch (edit.op) {
      case 'insert': {
        fields(edit, ['op', 'node'], path)
        if (
          !isObj(edit.node) ||
          ['site', 'header', 'footer', 'page', 'instance'].includes(
            String(edit.node.kind ?? edit.node.type).toLowerCase(),
          )
        )
          return void error(
            `${path}.node`,
            'Insert takes one custom JSON node with optional children.',
          )
        add({ page, append: true, json: edit.node }, path)
        break
      }
      case 'update': {
        const p = { ...edit }
        delete p.op
        patchItem(p, path)
        break
      }
      case 'theme':
        fields(edit, ['op', 'value'], path)
        if (!isObj(edit.value))
          return void error(`${path}.value`, 'Expected theme fields.')
        add({ jsx: '', theme: edit.value }, path)
        break
      case 'move':
      case 'remove': {
        const move = edit.op === 'move'
        fields(
          edit,
          move ? ['op', 'id', 'parent', 'index'] : ['op', 'id'],
          path,
        )
        project(
          [
            {
              op: edit.op,
              tree,
              id: edit.id,
              ...(move
                ? { parent: edit.parent ?? root()?.id, index: edit.index }
                : {}),
            },
          ],
          path,
        )
        break
      }
      default:
        error(`${path}.op`, 'Use insert, update, move, remove or theme.')
    }
  }
  edits.forEach((edit, i) => fromEdit(i, () => orderedItem(edit, `ops[${i}]`)))
  out.trees.push(tree)
  return out.errors.length ? { ok: false, problems: out.errors } : out
}
