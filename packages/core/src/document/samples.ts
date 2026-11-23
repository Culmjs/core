import type { Node } from './types.ts'

/**
 * Untouched sample text, by provenance and never by wording.
 *
 * A block is built with `props.sample: true` on every text a visitor would otherwise read as a placeholder ("Write the days and times.",
 * "Book title"). The editor changes it to `false` the moment the words of that text are edited (`applySetting`), so the mark says
 * "nobody has written here yet" and nothing else. `props.chrome: true` is the block's own wording (a heading, a label): it is not the
 * owner's, so it never keeps an empty block on the page, and the first edit to it removes the mark.
 *
 * The published page leaves out:
 * - every text still marked `sample: true`, and
 * - a container (a block, or a group inside one) that has a sample in it and nothing else a person put there.
 * What counts as put there: a text with `sample: false`, a text that is not marked at all (older documents, and anything typed in later) and
 * is not empty, an image with a file or a connected value, and every control (button, form, embed, video, menu...). Nothing is ever
 * decided by comparing words, so an owner's text that happens to equal a sample line is kept, and so is a text the owner edited.
 * A document with no marks comes back as the very same tree.
 */
export const isSampleText = (w: Node): boolean =>
  w.kind === 'text' && w.props?.sample === true
/** A button's label or an expandable's summary can be a sample too (a new Tabs block, a Dark or light switch): the mark is the same, cleared when that wording is written (`touched`). */
export const isSample = (w: Node): boolean =>
  (w.kind === 'text' || w.kind === 'button' || w.kind === 'details') &&
  w.props?.sample === true

const STRUCTURE = new Set([
  'box',
  'row',
  'column',
  'grid',
  'list',
  'free',
  'divider',
  'icon',
  'shape',
  'table',
  'table-row',
  'table-cell',
])
/** Containers that are controls too: the browser's details (a Questions answer sits in one) and a form. They keep their block, and the samples inside them go. */
const CONTROLS = new Set(['details', 'form'])
const blank = (w: Node): boolean =>
  !(
    Array.isArray(w.props?.runs)
      ? (w.props.runs as { br?: true; text?: string }[])
      : []
  ).some(r => !r.br && (r.text ?? '').trim() !== '')

/**
 * Whether a widget shows on desktop, tablet and phone: the base layer, the tablet and phone layers (a phone inherits the tablet's) and the per-layout hide.
 * Not the same rule as `shownOn` in `layout/placement.ts`: there a desktop hide also hides the block on tablet; here the tablet is decided by its own layer and its own hide.
 * The two differ on purpose for now: changing either changes published output, so they are to be settled together.
 */
type L3 = [boolean, boolean, boolean]
const shownOn = (w: Node): L3 => {
  // a layer that shows it again while a state holds (a panel a button opens) means it can be seen: it counts as shown everywhere
  if (w.style?.when?.some(x => x.decl?.hidden === false))
    return [true, true, true]
  const b = w.style?.base?.hidden,
    t = w.style?.tablet?.hidden ?? b,
    p = w.style?.phone?.hidden ?? t
  return [!b && !w.hide?.desktop, !t && !w.hide?.tablet, !p && !w.hide?.phone]
}
const none: L3 = [false, false, false]
const and = (a: L3, b: L3): L3 => [a[0] && b[0], a[1] && b[1], a[2] && b[2]]
const or = (a: L3, b: L3): L3 => [a[0] || b[0], a[1] || b[1], a[2] || b[2]]
const any = (v: L3) => v.some(Boolean)

/**
 * The tree without its untouched samples. `root` itself always stays.
 * Visibility is worked out per layout: a sample is always taken out, but it counts toward emptying a block only where it shows, and a person's
 * content keeps a block when it shows on any layout (a line hidden on desktop and shown on phones still keeps its block).
 * A copy of a repeated row (its id has a `~`) is data and counts for its block; it is taken out only when it holds nothing but samples. A `details` or a form keeps its block and loses only the samples inside it.
 * Owner text that a state reveals (a `when` layer that unhides it) counts as shown, so a block holding it is never dropped.
 */
export function dropSamples(root: Node): Node {
  // [the widget or null, where a sample shows in here, where a person's content shows in here]
  const go = (w: Node, top: boolean, vis: L3): [Node | null, L3, L3] => {
    const here = and(vis, shownOn(w))
    if (w.kind === 'text') {
      if (w.props?.sample === true) return [null, here, none]
      if (w.props?.sample === false) return [w, none, here]
      return [w, none, w.props?.chrome !== true && !blank(w) ? here : none]
    }
    // A button still wearing its default label (a tab, a slider button) is a control: it counts as neither a sample nor the owner's, so it goes with its block while
    // everything else in the block is still sample, and stays once the owner has written anything in the block.
    if (w.kind === 'button' && w.props?.sample === true) return [w, none, none]
    if (w.kind === 'image')
      return [w, none, w.props?.assetId || w.props?.src ? here : none]
    if (!STRUCTURE.has(w.kind) && !CONTROLS.has(w.kind)) return [w, none, here]
    let sample = none,
      own = none,
      changed = false
    const kids = (w.children ?? []).flatMap(k => {
      const [out, s, o] = go(k, false, here)
      sample = or(sample, s)
      own = or(own, o)
      changed ||= out !== k
      return out ? [out] : []
    })
    // an expandable whose summary is a sample goes with its samples when nothing the owner wrote is inside it
    if (w.kind === 'details' && w.props?.sample === true && !any(own))
      return [null, or(sample, here), none]
    if (CONTROLS.has(w.kind))
      return [
        changed ? { ...w, children: kids } : w,
        sample,
        w.kind === 'details' && w.props?.sample === true ? own : or(own, here),
      ]
    // A copy of a repeated row is data: it counts for its block. It is taken out when it holds nothing but samples (an empty row), and only its samples go otherwise.
    const copy = w.id.includes('~')
    if (!top && any(sample) && !any(own))
      return [null, sample, copy ? here : none]
    if (copy) own = or(own, here)
    return [changed ? { ...w, children: kids } : w, sample, own]
  }
  return go(root, true, [true, true, true])[0] ?? root
}

/**
 * The props of a text whose words were just changed by a person: a sample becomes the owner's (`sample: false`, so its block can tell a filled value
 * from the block's own wording) and the block's own wording becomes theirs too. Every place that writes `runs` goes through this, not through a comparison of words.
 */
export function touched<T extends object>(props: T): T {
  const out = { ...props } as Record<string, unknown>
  if (out.sample === true) out.sample = false
  delete out.chrome
  return out as T
}
