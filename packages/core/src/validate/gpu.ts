import {
  checkShader,
  type CustomEffect,
  type GpuMotion,
  type Look,
  type Node,
  type Problem,
  type Run,
  type ShaderSettings,
} from '../document/index.ts'
import { checkKeys } from '../document/motionSteps.ts'
import { fieldsOf, isNum, isRecord } from '../document/rules.ts'
import { dropSamples } from '../document/samples.ts'
import { templateIndex } from '../document/tree.ts'
import { customKeys, gpuName, shaderSnapshot } from '../registry/gpu.ts'
import type { Registry } from '../registry/index.ts'
import { layoutDisplays } from '../layout/display.ts'
import { add, type Ctx } from './common.ts'
import { visibleText } from './required.ts'

/** A fresh site-local namespace. Never stage document data in the registry. */
export function checkCustomEffects(
  input: unknown,
  registry: Registry,
  out: Problem[],
) {
  const defs = new Map<string, CustomEffect>()
  if (input === undefined) return defs
  const bad = (
    path: string,
    message: string,
    code: Problem['code'] = 'INVALID_DOCUMENT',
  ) => void out.push({ path, message, code })
  if (!Array.isArray(input) || input.length > 32) {
    bad(
      'customEffects',
      'Custom effects must be a list of at most 32 definitions.',
    )
    return defs
  }
  if (input.length && !registry.gpu?.enabled)
    bad(
      'customEffects',
      'Custom effects require GPU support.',
      'UNSUPPORTED_CAPABILITY',
    )
  const seen = new Set<string>()
  for (const [i, d] of input.entries()) {
    const at = `customEffects.${i}`
    if (!isRecord(d)) {
      bad(at, 'A custom effect must be an object.')
      continue
    }
    const before = out.length
    for (const k of Object.keys(d))
      if (!customKeys.has(k))
        bad(
          `${at}.${k.slice(0, 40)}`,
          'This custom effect field is not supported.',
        )
    const name = d.name
    if (!Object.hasOwn(d, 'name') || !gpuName(name))
      bad(
        `${at}.name`,
        'Use a safe lowercase effect name of at most 32 characters.',
      )
    else if (seen.has(name) || registry.effect(name))
      bad(`${at}.name`, 'This effect name is already in use.')
    else seen.add(name)
    const source = (Object.hasOwn(d, 'source') ? d.source : undefined) as string
    const settings = (
      Object.hasOwn(d, 'settings') ? d.settings : undefined
    ) as ShaderSettings
    const check = checkShader(source, settings)
    if (!check.ok) {
      const { rule, line: shaderLine, measured, limit } = check
      out.push({
        code: 'INVALID_DOCUMENT',
        rule,
        shaderLine,
        measured,
        limit,
        path: `${at}.${rule === 'shader.settings' ? 'settings' : 'source'}`,
        message: `GPU effect refused by ${rule} at shader line ${shaderLine}: ${measured} (limit: ${limit}).`,
      })
    } else if (before === out.length && typeof name === 'string')
      defs.set(name, shaderSnapshot({ name, source, settings }))
  }
  return defs
}

const attachmentKeys = fieldsOf<GpuMotion>({
  gpu: true,
  trigger: true,
  settings: true,
  poster: true,
})
export function checkGpuMotion(c: Ctx, w: Node, m: Record<string, unknown>) {
  const say = (message: string, path: string) => add(c, w, message, path)
  checkKeys(m, attachmentKeys, 'motion', say)
  if (m.trigger !== 'enter-view')
    say('A GPU attachment needs an enter-view trigger.', 'motion.trigger')
  if (
    m.poster !== undefined &&
    !(
      typeof m.poster === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(m.poster)
    )
  )
    say('A GPU poster must be one local asset id.', 'motion.poster')
  if (!c.reg.gpu?.enabled)
    return add(
      c,
      w,
      'GPU attachments require GPU support.',
      'motion.gpu',
      'UNSUPPORTED_CAPABILITY',
    )
  const name = m.gpu
  const registered = gpuName(name) ? c.reg.effect(name) : undefined
  const def =
    registered?.tier === 3
      ? registered
      : typeof name === 'string'
        ? c.customEffects.get(name)
        : undefined
  if (!def)
    return say(
      'No GPU effect with that name is defined for this site.',
      'motion.gpu',
    )
  if (m.settings === undefined) return
  if (!isRecord(m.settings))
    return say('GPU settings must be an object.', 'motion.settings')
  for (const [k, value] of Object.entries(m.settings)) {
    const at = `motion.settings.${k.slice(0, 40)}`
    if (!Object.hasOwn(def.settings, k))
      say('This GPU effect has no such setting.', at)
    else {
      const s = def.settings[k]
      if (
        s.type === 'color'
          ? typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)
          : !isNum(value, s.min, s.max)
      )
        say(
          s.type === 'color'
            ? 'Use a #rrggbb colour.'
            : 'Use a finite number in the declared range.',
          at,
        )
    }
  }
}

const layouts = new Set(['free', 'box', 'row', 'column', 'grid'])
/** Containers, decoration, empty media plates and a poster aren't authored fallback content. */
function content(w: Node): boolean {
  const p = w.props
  switch (w.kind) {
    case 'text':
      return (
        Array.isArray(p?.runs) &&
        (p.runs as Run[]).some(r => !r.bind && visibleText(r.text))
      )
    case 'image':
      return (
        (!w.bind?.src && (visibleText(p?.src) || visibleText(p?.assetId))) ||
        (!w.bind?.fallback && visibleText(p?.fallback))
      )
    case 'video':
      return visibleText(p?.assetId)
    case 'button':
      return !w.bind?.label && p?.sample !== true && visibleText(p?.label)
    case 'icon':
      return !!p?.link && visibleText(p?.label) && visibleText(p?.name)
    case 'shape':
      return visibleText(p?.label)
    case 'details':
      return !w.bind?.summary && p?.sample !== true && visibleText(p?.summary)
    case 'embed':
      return true
    default:
      return false
  }
}

/** Called on the same bounded unroll as the other motion checks. Summarise each subtree
 * once even for nested owners. Form membership uses the full composition, including hidden nodes. */
export function gpuOwnerProblems(tree: Node, scheme: Look['dark']) {
  const problems = new Map<Node, string>()
  const bearing = new Set<string>()
  const live = dropSamples(tree, 'before-data')
  // Intersect visibility down each branch: two descendants shown on different layouts
  // cannot vouch for each other. The fallback doesn't depend on a hover or script.
  const visible = (w: Node, dark: boolean, parent: number): number => {
    const at = layoutDisplays(w, dark)
    const mask =
      parent &
      (Number(at.desktop) | (Number(at.tablet) << 1) | (Number(at.phone) << 2))
    let found = content(w) ? mask : 0
    const template = w.repeat ? templateIndex(w) : Infinity
    for (const [i, k] of (w.children ?? []).entries()) {
      const contents = visible(k, dark, mask)
      // An optional child or a zero-row repeat cannot supply its parent's only fallback.
      if (!k.showIf && !k.showIfAny?.length && i < template) found |= contents
    }
    if (found) bearing.add(w.id)
    return found
  }
  for (const dark of scheme === 'auto' ? [false, true] : [scheme === 'dark'])
    visible(live, dark, 7)
  const scan = (w: Node, inForm: boolean): boolean => {
    const form = w.kind === 'form' || w.kind === 'field'
    let containsForm = form
    for (const k of w.children ?? [])
      if (scan(k, inForm || form)) containsForm = true
    if (w.motion && 'gpu' in w.motion) {
      if (inForm || containsForm)
        problems.set(
          w,
          'A GPU effect cannot be on, inside or around a form or field.',
        )
      else if (!layouts.has(w.kind) || !bearing.has(w.id))
        problems.set(
          w,
          'A GPU effect needs a layout container with real static content.',
        )
    }
    return containsForm
  }
  scan(tree, false)
  return problems
}
