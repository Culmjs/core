import { EMBED_PROVIDERS } from './embed.ts'
import type { CoreKind, Decl, Kind, Node, StyleLayer } from './types.ts'

export const MAX_NODES = 2000
export const MAX_DEPTH = 12
/** Deepest nesting expanded, plain and through instances together. Far above `MAX_DEPTH`; past it nothing more is added and `over` is set, so no input can overflow the stack. */
export const DEPTH_GUARD = 64
/** The most rows one list shows: `rowsOf` stops here, so validation refuses a `repeat.max` or component `limit` above it. */
export const MAX_ROWS = 200
/** What a shape may hold: parts in a group, depth of groups in groups, characters of path data. */
export const SHAPE_LIMITS = { children: 32, depth: 4, path: 8000 } as const
/** No `~` or `.`, so an id can't collide with an expanded copy (`<id>~<n>`), a block copy (`<rootId>.<localId>`) or an unrolled component part (`<instanceId>.<partId>`). */
export const ID_RE = /^[a-z0-9]{1,20}$/

export const STYLE_GROUPS: Record<
  | 'LAYOUT'
  | 'BOX'
  | 'PAINT'
  | 'TYPE'
  | 'TYPE_MORE'
  | 'TEXT_FX'
  | 'BOX_FX'
  | 'POSITION'
  | 'TRANSFORM'
  | 'EFFECTS'
  | 'MOTION',
  readonly (keyof Decl)[]
> = {
  LAYOUT: ['direction', 'wrap', 'justify', 'align', 'gap'],
  BOX: [
    'width',
    'minWidth',
    'maxWidth',
    'height',
    'minHeight',
    'aspect',
    'padding',
    'margin',
    'place',
    'order',
    'hidden',
    'float',
    'sticky',
    'pin',
    'overflow',
    'snap',
    'opacity',
  ],
  PAINT: [
    'bg',
    'bgImage',
    'border',
    'borderTop',
    'borderRight',
    'borderBottom',
    'borderLeft',
    'borderWidth',
    'borderColor',
    'radius',
    'shadow',
    'gradient',
    'blur',
    'surface',
  ],
  TYPE: [
    'color',
    'font',
    'size',
    'weight',
    'lineHeight',
    'letterSpacing',
    'italic',
    'underline',
    'upper',
    'textAlign',
    'strike',
    'underlineColor',
    'underlineOffset',
    'baseline',
    'smallCaps',
    'nowrap',
    'textShadow',
    'label',
  ],
  // Kept apart from TYPE so a run's own style (a span inside text) can't carry them.
  TYPE_MORE: ['fluidSize', 'textColumns', 'clampLines', 'balance'],
  // Lettering effects, for a text and a button only (not for the containers that hold TYPE_MORE).
  TEXT_FX: ['textStroke', 'textFill', 'fitWidth'],
  // Surface effects, for the layout containers only.
  BOX_FX: ['grain', 'reveal', 'side', 'spotlight'],
  POSITION: ['position', 'inset', 'z'],
  TRANSFORM: ['move', 'rotate', 'scale', 'skew', 'flip', 'origin'],
  EFFECTS: [
    'filter',
    'backdropBlur',
    'blend',
    'clip',
    'cut',
    'fade',
    'mask',
    'appearAfter',
  ],
  MOTION: ['transition'],
}

export type PropField = {
  type:
    | 'number'
    | 'switch'
    | 'select'
    | 'url'
    | 'text'
    | 'textarea'
    | 'date'
    | 'list'
    | 'asset'
    | 'link'
    | 'id'
    | 'pattern'
    | 'geometry'
    | 'paint'
    | 'stroke'
    | 'marks'
  min?: number
  max?: number
  int?: boolean
  maxLength?: number
  options?: string[]
  required?: boolean
  /** The grammar of a setting whose value is an object, shown by `catalogue kinds id=<kind>`. At most 300 characters. */
  hint?: string
}

export type KindSpec = {
  role: 'container' | 'leaf'
  parents: Kind[] | 'any'
  children?: { min: number; max: number; kinds?: Kind[] }
  tag(parent: Kind | null, w: Node, grand: Kind | null): string
  display(w: Node): string
  inner?: string[]
  props: Record<string, PropField>
  styles: (keyof Decl)[]
  /** Interaction layers beyond base, tablet, phone, hover and dark that this kind may style. */
  states: StyleLayer[]
  bindable: string[]
  repeatable: boolean
  label: string
  icon: string
}

const {
  LAYOUT,
  BOX,
  PAINT,
  TYPE,
  TYPE_MORE,
  TEXT_FX,
  BOX_FX,
  POSITION,
  TRANSFORM,
  EFFECTS,
  MOTION,
} = STYLE_GROUPS
/** What opens first, by kind: Position, Transform, Effects and Motion; `cursor` goes with every kind. */
const FX = [
  ...POSITION,
  ...TRANSFORM,
  ...EFFECTS,
  ...MOTION,
  'cursor',
] as (keyof Decl)[]
const prop = (w: Node, k: string) => w.props?.[k]
const sel = (options: string[]): PropField => ({ type: 'select', options })
const pattern: PropField = { type: 'pattern' }
const ANY = { min: 0, max: Infinity }
const AS = ['div', 'section', 'article', 'aside']

export const LAYERS = ['popover-auto', 'popover-manual', 'dialog']
export const COMMANDS = [
  'toggle-popover',
  'show-popover',
  'hide-popover',
  'show-modal',
  'close',
]
/** Native layers: `layer` makes a container a popover or a `dialog`; `open` shows a popover when the page loads (a cookie bar). */
const LAYER_PROPS: Record<string, PropField> = {
  layer: sel(LAYERS),
  open: { type: 'switch' },
}
const isDialog = (w: Node) => prop(w, 'layer') === 'dialog'

/** A flow container: its tag comes from `as`, or `layer: dialog`, and a List's item is an `li`. */
const flowTag = (parent: Kind | null, w: Node) =>
  parent === 'list'
    ? 'li'
    : isDialog(w)
      ? 'dialog'
      : String(prop(w, 'as') ?? 'div')

const leaf = (
  o: Omit<KindSpec, 'role' | 'parents' | 'repeatable' | 'states'> &
    Partial<Pick<KindSpec, 'parents' | 'repeatable' | 'states'>>,
): KindSpec => ({
  role: 'leaf',
  parents: 'any',
  repeatable: true,
  states: [],
  ...o,
})
const container = (
  o: Omit<KindSpec, 'role' | 'parents' | 'repeatable' | 'children' | 'states'> &
    Partial<Pick<KindSpec, 'parents' | 'children' | 'repeatable' | 'states'>>,
): KindSpec => ({
  role: 'container',
  parents: 'any',
  children: ANY,
  repeatable: true,
  states: [],
  ...o,
})

/** Every other module reads what a kind allows from this one table. */
export const KINDS: Record<CoreKind, KindSpec> = {
  free: container({
    parents: [
      'free',
      'box',
      'row',
      'column',
      'grid',
      'list',
      'table-cell',
      'form',
      'details',
    ],
    tag: (p, w) => (p === 'list' ? 'li' : isDialog(w) ? 'dialog' : 'div'),
    display: () => 'grid',
    props: {
      cols: { type: 'number', min: 1, max: 24 },
      pattern,
      ...LAYER_PROPS,
    },
    styles: [...BOX, ...PAINT, ...EFFECTS, ...MOTION, 'cursor', ...BOX_FX],
    states: ['open'],
    bindable: [],
    label: 'Free',
    icon: 'layout',
  }),
  box: container({
    tag: flowTag,
    display: () => 'block',
    // `content: "item"` marks the box that holds a page's body; the compiler fills it.
    props: {
      as: sel(AS),
      pattern,
      content: sel(['item']),
      tabs: sel(['list', 'panel']),
      labelledBy: { type: 'id' },
      ...LAYER_PROPS,
    },
    styles: [...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE, ...BOX_FX],
    states: ['open'],
    bindable: [],
    label: 'Box',
    icon: 'square',
  }),
  row: container({
    tag: (p, w) =>
      p === 'list'
        ? 'li'
        : isDialog(w)
          ? 'dialog'
          : ['nav', 'breadcrumb'].includes(String(prop(w, 'as')))
            ? 'nav'
            : 'div',
    display: () => 'flex',
    // `breadcrumb` is a nav named "Breadcrumb" in the page's language, with a "/" drawn between its items
    props: {
      as: sel(['div', 'nav', 'breadcrumb']),
      divide: { type: 'switch' },
      pattern,
      tabs: sel(['list', 'panel']),
      labelledBy: { type: 'id' },
      ...LAYER_PROPS,
    },
    styles: [
      ...LAYOUT,
      ...BOX,
      ...PAINT,
      ...TYPE,
      ...FX,
      ...TYPE_MORE,
      ...BOX_FX,
    ],
    states: ['open'],
    bindable: [],
    label: 'Side by side',
    icon: 'columns',
  }),
  column: container({
    tag: flowTag,
    display: () => 'flex',
    props: {
      as: sel(AS),
      side: sel(['left']),
      divide: { type: 'switch' },
      pattern,
      tabs: sel(['list', 'panel']),
      labelledBy: { type: 'id' },
      ...LAYER_PROPS,
    },
    styles: [
      ...LAYOUT,
      ...BOX,
      ...PAINT,
      ...TYPE,
      ...FX,
      ...TYPE_MORE,
      ...BOX_FX,
    ],
    states: ['open'],
    bindable: [],
    label: 'Stack',
    icon: 'rows',
  }),
  grid: container({
    tag: p => (p === 'list' ? 'li' : 'div'),
    display: () => 'grid',
    props: {
      cols: { type: 'number', min: 1, max: 12 },
      tabletCols: { type: 'number', min: 1, max: 12 },
      phoneCols: { type: 'number', min: 1, max: 12 },
      // a thin line between the items (`--s-line`), where they touch
      divide: { type: 'switch' },
    },
    styles: [
      'gap',
      ...BOX,
      ...PAINT,
      ...POSITION,
      ...EFFECTS,
      ...MOTION,
      'cursor',
      'columns',
      'rows',
      'areas',
      ...BOX_FX,
    ],
    bindable: [],
    label: 'Grid',
    icon: 'grid',
  }),
  list: container({
    // One template child when it repeats, up to 200 static ones otherwise; validation checks which.
    children: { min: 1, max: 200, kinds: ['box', 'row', 'column', 'grid'] },
    tag: (_p, w) => {
      const m = w.props?.marker ?? w.repeat?.marker
      return m === 'decimal' ||
        m === 'decimal-leading-zero' ||
        m === 'lower-roman' ||
        m === 'upper-roman' ||
        m === 'lower-alpha'
        ? 'ol'
        : 'ul'
    },
    display: () => 'flex',
    props: {
      marker: sel([
        'none',
        'disc',
        'circle',
        'square',
        'decimal',
        'decimal-leading-zero',
        'lower-roman',
        'upper-roman',
        'lower-alpha',
      ]),
      reversed: { type: 'switch' },
      start: { type: 'number', min: 1, max: 9999, int: true },
      divide: { type: 'switch' },
    },
    styles: [...LAYOUT, ...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE],
    bindable: [],
    label: 'List',
    icon: 'list',
  }),
  table: container({
    children: { min: 0, max: Infinity, kinds: ['table-row'] },
    tag: () => 'table',
    display: () => 'table',
    inner: ['tbody'],
    props: { header: { type: 'switch' } },
    styles: [...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE],
    bindable: [],
    label: 'Table',
    icon: 'table',
  }),
  'table-row': container({
    parents: ['table'],
    children: { min: 0, max: Infinity, kinds: ['table-cell'] },
    tag: () => 'tr',
    display: () => 'table-row',
    props: {},
    styles: [...PAINT, 'cursor'],
    bindable: [],
    label: 'Table row',
    icon: 'rows',
  }),
  'table-cell': container({
    parents: ['table-row'],
    // `th` in a header row needs the table and row index, which the renderer decides.
    tag: () => 'td',
    display: () => 'table-cell',
    props: { span: { type: 'number', min: 1, max: 12 } },
    styles: [...BOX, ...PAINT, ...TYPE, ...TYPE_MORE, 'cursor'],
    bindable: [],
    label: 'Table cell',
    icon: 'square',
  }),
  text: leaf({
    tag: (_p, w) =>
      prop(w, 'level') === 'code' ? 'pre' : String(prop(w, 'level') ?? 'p'),
    display: w => (prop(w, 'level') === 'span' ? 'inline' : 'block'),
    // `current` marks the item that is the open page (aria-current="page"), the last crumb of a trail
    props: {
      level: sel(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'code']),
      runs: { type: 'list', max: 50, maxLength: 5000 },
      textStyle: { type: 'text', maxLength: 32 },
      current: { type: 'switch' },
      // Provenance (`sample` is true until the words are edited and false after; `chrome` is the block's own wording).
      sample: { type: 'switch' },
      chrome: { type: 'switch' },
    },
    styles: [...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE, ...TEXT_FX],
    bindable: ['text', 'link'],
    label: 'Text',
    icon: 'type',
  }),
  image: leaf({
    tag: () => 'img',
    display: () => 'block',
    props: {
      assetId: { type: 'asset' },
      src: { type: 'url' },
      alt: { type: 'text', maxLength: 300 },
      fallback: { type: 'text', maxLength: 300 },
      fit: sel(['cover', 'contain']),
      width: { type: 'number', min: 1, max: 8192, int: true },
      height: { type: 'number', min: 1, max: 8192, int: true },
    },
    styles: [...BOX, ...PAINT, ...FX, 'fit', 'focus'],
    bindable: ['src', 'alt', 'fallback'],
    label: 'Image',
    icon: 'image',
  }),
  icon: leaf({
    // With a `link` (set, or bound to a field) the icon is an `a`, named by `label`; without one it is a plain, decorative span.
    tag: (_p, w) =>
      prop(w, 'link') !== undefined || w.bind?.link !== undefined
        ? 'a'
        : 'span',
    display: () => 'inline-flex',
    inner: ['svg'],
    props: {
      name: {
        type: 'text',
        maxLength: 80,
        hint: 'a built-in name (star) or an Iconify set:name (lucide:camera)',
      },
      link: { type: 'link' },
      label: { type: 'text', maxLength: 120 },
    },
    styles: [...BOX, ...PAINT, 'color', 'size', ...FX],
    states: ['focus', 'pressed'],
    bindable: ['link'],
    label: 'Icon',
    icon: 'star',
  }),
  button: leaf({
    tag: () => 'a',
    display: () => 'inline-flex',
    props: {
      link: { type: 'link' },
      label: { type: 'text', maxLength: 120 },
      download: { type: 'switch' },
      opens: { type: 'id' },
      command: sel(COMMANDS),
      tabs: sel(['tab']),
      icon: { type: 'text', maxLength: 80 },
      iconOnly: { type: 'switch' },
      iconAfter: { type: 'switch' },
      // Provenance (a default label the owner has not written over yet).
      sample: { type: 'switch' },
    },
    // Up to 4 shapes drawn behind the label (each `behind` at every layout).
    children: { min: 0, max: 4, kinds: ['shape'] },
    styles: [...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE, ...TEXT_FX],
    states: ['pressed', 'focus', 'current'],
    bindable: ['label', 'link'],
    label: 'Button',
    icon: 'mouse-pointer',
  }),
  divider: leaf({
    tag: () => 'hr',
    display: () => 'block',
    props: {},
    styles: [...BOX, 'border', ...FX],
    bindable: [],
    label: 'Divider',
    icon: 'minus',
  }),
  embed: leaf({
    tag: () => 'div',
    display: () => 'block',
    repeatable: false,
    props: {
      provider: { ...sel(EMBED_PROVIDERS), required: true },
      id: { type: 'text', maxLength: 120, required: true },
    },
    styles: [...BOX, ...PAINT, ...FX],
    bindable: [],
    label: 'Embed',
    icon: 'video',
  }),
  video: leaf({
    tag: () => 'video',
    display: () => 'block',
    props: {
      assetId: { type: 'asset' },
      poster: { type: 'asset' },
      controls: { type: 'switch' },
      loop: { type: 'switch' },
      muted: { type: 'switch' },
    },
    styles: [...BOX, ...PAINT, ...FX, 'fit', 'focus'],
    bindable: [],
    label: 'Video',
    icon: 'video',
  }),
  menu: leaf({
    tag: () => 'nav',
    display: () => 'flex',
    inner: ['a'],
    // `currentMark` draws the open page's entry: an arrow or a dot before it, or brackets round it; `rows: lines` sets each entry on its own ruled row
    props: {
      which: sel(['menu', 'footer']),
      half: sel(['first', 'second']),
      currentMark: sel(['arrow', 'brackets', 'dot']),
      rows: sel(['lines']),
      numbers: sel(['on']),
      links: sel(['inherit']),
      icons: sel(['on']),
      // `limit` shows the first N links; `viewAll` ends the list with one more link (named by `viewAllLabel`, else the page's title). `as: dropdown` folds the links into a native disclosure that opens `down` (absent) or `up`.
      limit: { type: 'number', min: 1, max: 50, int: true },
      viewAll: { type: 'link' },
      viewAllLabel: { type: 'text', maxLength: 60 },
      as: sel(['dropdown']),
      drop: sel(['down', 'up']),
      // `foldOn: phone` folds the links behind a menu button on phone (it always renders the dropdown markup); from the tablet width up they show in a row
      foldOn: sel(['phone']),
      // the folded menu's button: the glyph alone (`icon`), on a grey square (`box`) or in an outlined square (`outline`); the word "Menu" stays for screen readers
      toggle: sel(['icon', 'box', 'outline']),
    },
    styles: [...LAYOUT, ...BOX, ...TYPE, ...FX, ...TYPE_MORE, 'linkHover'],
    states: ['current'],
    bindable: [],
    label: 'Menu',
    icon: 'menu',
  }),
  form: container({
    children: {
      min: 0,
      max: Infinity,
      kinds: [
        'field',
        'button',
        'text',
        'free',
        'row',
        'column',
        'grid',
        'box',
      ],
    },
    tag: () => 'form',
    display: () => 'flex',
    inner: ['input'],
    props: {
      formId: { type: 'text', maxLength: 60 },
    },
    styles: [...LAYOUT, ...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE],
    bindable: [],
    label: 'Form',
    icon: 'mail',
  }),
  field: leaf({
    // a row, column, grid or box may group fields (Name and Email side by side), but some form above must hold them: see validate/tree.ts
    parents: ['form', 'row', 'column', 'grid', 'box'],
    tag: () => 'label',
    display: () => 'flex',
    inner: ['input', 'textarea'],
    props: {
      name: sel(['name', 'email', 'subject', 'message']),
      label: { type: 'text', maxLength: 80 },
      placeholder: { type: 'text', maxLength: 80 },
      required: { type: 'switch' },
    },
    styles: [...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE],
    states: ['focus', 'checked', 'invalid'],
    bindable: [],
    label: 'Field',
    icon: 'text-cursor',
  }),
  details: container({
    tag: () => 'details',
    display: () => 'block',
    inner: ['summary'],
    props: {
      name: { type: 'text', maxLength: 32 },
      open: { type: 'switch' },
      summary: { type: 'text', maxLength: 200 },
      marker: sel(['default', 'none', 'chevron-end', 'chevron', 'plus']),
      markerMs: { type: 'number', min: 0, max: 1000, int: true },
      foldOn: sel(['phone', 'always', 'never']),
      sample: { type: 'switch' },
    },
    styles: [...BOX, ...PAINT, ...TYPE, ...FX, ...TYPE_MORE],
    states: ['open'],
    bindable: ['summary'],
    label: 'Details',
    icon: 'chevron-down',
  }),
  // A vector drawing, SVG-like. A leaf that may hold only shapes (a group's parts). Never text, never a tip.
  shape: leaf({
    tag: () => 'svg',
    display: () => 'block',
    children: { min: 0, max: SHAPE_LIMITS.children, kinds: ['shape'] },
    props: {
      geometry: {
        type: 'geometry',
        required: true,
        hint: 'rect|ellipse|polygon|star|line|blob|path|group|scene|curve{points}|arc{start,end,inner?}|wave{amp,freq}|chart{chart,series,labels?}|diagram{nodes,edges,dir?}|contours{seed,bands?}|stamp{text,center?}',
      },
      fill: {
        type: 'paint',
        hint: 'Site colour, #rrggbb, {from,to,angle?,radial?:[cx,cy,r]}, {stops:[{color,at,alpha?}],angle?,radial?}, or "none".',
      },
      stroke: {
        type: 'stroke',
        hint: '{color, width 0-200, dash?:[on,off]}',
      },
      marks: {
        type: 'marks',
        hint: 'Compact marks [{rect|circle|ellipse|line|curve|arc|wave|grid|path|label, fill?, stroke?, opacity?, blur?, rotate?, repeat?}] (max 256 expanded).',
      },
      blur: { type: 'number', min: 0, max: 40 },
      grain: { type: 'number', min: 0, max: 1 },
      opacity: { type: 'number', min: 0, max: 1 },
      shadow: { type: 'text', maxLength: 32 },
      fit: sel(['contain', 'cover', 'stretch']),
      label: { type: 'text', maxLength: 120 },
    },
    styles: [...BOX, ...FX],
    bindable: [],
    label: 'Shape',
    icon: 'shapes',
  }),
  // Stands in for its component's tree; expand() unrolls it, so nothing renders it.
  instance: container({
    tag: () => 'div',
    display: () => 'block',
    props: {},
    styles: [],
    repeatable: false,
    bindable: [],
    label: 'Component',
    icon: 'package',
  }),
}

/** Any block that draws a box can carry a tooltip. Not those drawn as a void element (image, video, divider), which cannot hold the tip, nor a table row or the stand-in for a component. */
for (const k of Object.keys(KINDS) as CoreKind[])
  if (
    !['image', 'video', 'divider', 'table-row', 'instance', 'shape'].includes(k)
  )
    KINDS[k].props = {
      ...KINDS[k].props,
      tip: { type: 'text', maxLength: 120 },
    }

/**
 * Freezes everything reachable from `v`. Shared objects (ANY, the option lists) are met more than once and
 * frozen once; functions are left alone. `sel()` keeps the array it is given, so LAYERS, COMMANDS and
 * EMBED_PROVIDERS are frozen too, as a side effect: they are read-only for every importer. An object that
 * was already frozen is still searched, so nothing below it stays open.
 */
function deepFreeze(v: unknown, seen = new Set<unknown>()): void {
  if (typeof v !== 'object' || v === null || seen.has(v)) return
  seen.add(v)
  Object.freeze(v)
  for (const x of Object.values(v)) deepFreeze(x, seen)
}
deepFreeze(KINDS)

/** The spec of a core kind, or of a kind the caller's plug-ins add (`extra`); undefined for any other name. */
export function kindSpec(
  kind: Kind,
  extra?: ReadonlyMap<string, KindSpec>,
): KindSpec | undefined {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind as CoreKind] : extra?.get(kind)
}
