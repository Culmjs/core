import type { Motion } from './motion.ts'

export type LookFamily = string

export type Look = {
  id: string
  name: string
  family: LookFamily
  brand: string
  ink: string
  bg: string
  headingFont: FontRef
  bodyFont: FontRef
  corners: number
  dark: 'auto' | 'light' | 'dark'
  // Optional tokens: absent means today's behaviour.
  /** A second colour; text on it uses ink. */
  accent?: `#${string}`
  /** Dates, venues, menus, buttons. */
  labelFont?: FontRef
  /** Absent: a hairline in the line colour. */
  edge?: { width: 1 | 2 | 3; color?: `#${string}` }
  shadow?:
    | 'soft'
    | 'hard'
    | 'inflated'
    | 'glow'
    | 'pixel'
    | 'bevel'
    | 'press'
    | 'gloss'
    | 'glitch'
  /** CSS only, no image files. */
  texture?:
    | 'dots'
    | 'grain'
    | 'ruled'
    | 'scanlines'
    | 'wash'
    | 'chrome'
    | 'linen'
    | 'halftone'
    | 'grid'
    | 'graph'
    | 'margin'
    | 'stars'
    | 'waves'
    | 'horizon'
    | 'sky'
    | 'aurora'
    | 'spotlight'
    | 'stripes'
  /** How strong the texture's marks are, in percent (2 to 30). Absent: the texture's own strength. */
  textureStrength?: number
  labelCase?: 'caps'
  /** Headings in capitals. Absent: as typed. */
  headingCase?: 'caps'
  /** 100 to 900 in steps of 100. Absent: the browser's bold. */
  headingWeight?: number
  /** Letter spacing of headings in em (-0.1 to 0.3). Absent: normal. */
  headingTracking?: number
  /** Absent: calm. */
  typeScale?: 'compact' | 'large' | 'poster'
  /** Absent: follow the corners. */
  buttonShape?: 'pill'
  /** Set when the person made this look or reworked a library look's colours, fonts or tokens (the Look screen compares them on save). Blocks then take their first look. */
  custom?: true
}

export type CoreKind =
  | 'free'
  | 'box'
  | 'row'
  | 'column'
  | 'grid'
  | 'list'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'text'
  | 'image'
  | 'icon'
  | 'button'
  | 'divider'
  | 'video'
  | 'menu'
  | 'form'
  | 'field'
  | 'details'
  | 'embed'
  | 'instance'
  | 'shape'
/** A core kind, or the name of a kind a plug-in adds. */
export type Kind = CoreKind | (string & {})
export type Size =
  'fit' | 'fill' | { n: number; unit: 'px' | '%' | 'ch' | 'vh' | 'vw' }
/** top, right, bottom, left */
export type SideBorder = {
  width: number
  color: Color
  style?: 'solid' | 'dashed' | 'dotted' | 'double'
}
export type Box4 = number | [number, number, number, number]
export type Color =
  | `#${string}`
  | 'brand'
  | 'ink'
  | 'bg'
  | 'muted'
  | 'line'
  // Look-token hooks the look's accent, falling back to brand, and the text colour on it.
  | 'accent'
  | 'on-accent'
  // The panel colours of a dark box (a terminal): the darker of the look ink and background, and the other one. Unlike ink on bg, they keep a dark look dark.
  | 'deep'
  | 'on-deep'
  // A soft tint for callouts: 12% of the accent over the background, so it follows every Look and stays readable behind ink.
  | 'accentSoft'
  | { style: string }
/** A length in px, or a named step of the site's spacing scale. */
export type Space =
  number | { step: keyof SiteStyles['space'] } | { n: number; unit: '%' }
export type SpaceBox = Space | [Space, Space, Space, Space]
/** Named colours, text styles, spacing steps and shadows kept on the site; every style field can point at them. */
export type SiteStyles = {
  colors: { id: string; name: string; value: `#${string}` }[]
  text: {
    id: string
    name: string
    decl: Pick<
      Decl,
      | 'font'
      | 'size'
      | 'weight'
      | 'lineHeight'
      | 'letterSpacing'
      | 'upper'
      | 'color'
    >
  }[]
  space: {
    xs: number
    s: number
    m: number
    l: number
    xl: number
    '2xl': number
  }
  shadows: {
    id: string
    name: string
    value: Exclude<Decl['shadow'], { style: string } | undefined>
  }[]
  /** Site styles › Motion: absent is Smooth; "off" leaves the default motion out. A block's own motion stays either way. */
  motion?: 'off'
  /** The allowed text size in px: every text size in the document lies inside it. Absent: no size rule. */
  textRange?: {
    min: number
    max: number
    /** Opt-in H1/H2 display scale, with tighter default leading and tracking. */ displayMax?: number
  }
}
/** a FileRef id */
export type AssetId = string
export type FontRef =
  `sys:${'sans' | 'serif' | 'mono'}` | `cat:${string}` | `up:${string}`

export type Edges<T> = { top?: T; right?: T; bottom?: T; left?: T }
export type Track =
  | 'fit'
  | { fr: number }
  | { n: number; unit: 'px' | '%' }
  | { min: Size; max: Size }
export type Point9 =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'
export type Blend =
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference'
export type Ease = 'smooth' | 'out' | 'in-out' | 'spring' | 'linear'
export type Edge = 'top' | 'right' | 'bottom' | 'left'

export type Decl = Partial<{
  width: Size
  minWidth: Size
  maxWidth: Size
  height: Size
  minHeight: Size
  aspect: number
  padding: SpaceBox
  margin: SpaceBox
  place: 'start' | 'center' | 'end'
  gap: Space
  direction: 'row' | 'column'
  wrap: boolean
  justify: 'start' | 'center' | 'end' | 'between' | 'around'
  align: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  bg: Color
  bgImage: AssetId
  color: Color
  border: {
    width: number
    style?: 'solid' | 'dashed' | 'dotted' | 'double'
    color: Color
    sides?: ('top' | 'right' | 'bottom' | 'left')[]
  }
  borderTop: SideBorder
  borderRight: SideBorder
  borderBottom: SideBorder
  borderLeft: SideBorder
  borderWidth: number | [number, number, number, number]
  borderColor: Color
  radius: Box4 | { n: Box4; unit: '%' }
  shadow:
    | 'soft'
    | 'strong'
    | { x: number; y: number; blur: number; spread: number; color: Color }
    | { style: string }
  // `shape` absent: linear. A radial gradient ignores `angle` and sits at `at` (absent: centre). A stop's `alpha` (0 to 1, absent: 1) fades its colour to transparent, so a token colour can melt away.
  gradient: {
    angle: number
    stops: { color: Color; at: number; alpha?: number }[]
    shape?: 'linear' | 'radial'
    at?: Point9
  }
  blur: number
  opacity: number
  font: FontRef
  size: number
  weight: number
  lineHeight: number
  letterSpacing: number
  italic: boolean
  underline: boolean
  upper: boolean
  textAlign: 'start' | 'center' | 'end' | 'justify'
  strike: boolean
  underlineColor: Color
  underlineOffset: number
  baseline: 'super' | 'sub'
  smallCaps: boolean
  nowrap: boolean
  textShadow: { x: number; y: number; blur: number; color: Color }
  // Text and button only. Outlined lettering; `hollow` (absent: true) leaves the fill see-through.
  textStroke: { width: number; color: Color; hollow?: boolean }
  // Text and button only. A gradient painted into the letters, `from` (at `fromAlpha`, 0 to 1) to `to` (at `toAlpha`, 0 to 1); the plain `color` where the browser cannot or forced colours are on.
  textFill: {
    from: Color
    to: Color
    angle: number
    fromAlpha?: number
    toAlpha?: number
  }
  // Text and button only. One line that scales to the width of its parent (CSS only, a close estimate from the number of characters).
  fitWidth: boolean
  // Containers only (box, row, column, grid, free). `grain`: a fine noise over the fill (0 to 1).
  grain: number
  // The footer's top block only, live pages only. The footer is pinned to the bottom of the window behind the page, which scrolls away to uncover it (CSS only).
  reveal: boolean
  // The header's top blocks only, live pages only. At 901 px and wider the header is a left column of this many px (160 to 480) beside the page and footer; narrower it stays a bar on top (CSS only).
  side: number
  order: number
  float: 'start' | 'end'
  sticky: 'top'
  pin: 'top' | 'bottom'
  overflow: 'visible' | 'clip' | 'scroll-x' | 'scroll-y'
  snap: boolean
  hidden: boolean
  position: 'relative' | 'absolute' | 'fixed' | 'sticky'
  inset: Edges<Size>
  z: number
  move: { x: Size; y: Size }
  rotate: number
  scale: number
  skew: { x: number; y: number }
  origin: Point9
  // Mirrors the block (scale -1) across the x and/or y axis, with an optional blur in px: a reflection.
  flip: { x?: boolean; y?: boolean; blur?: number }
  columns: Track[]
  rows: Track[]
  areas: string[][]
  filter: {
    brightness?: number
    contrast?: number
    saturate?: number
    grayscale?: number
    hue?: number
  }
  backdropBlur: number
  blend: Blend
  clip: 'circle' | 'pill' | 'arch' | 'blob'
  fade: Edge
  // A fade of the block's own pixels: `edge` is the side that melts away ("radial": the whole rim), over `strength` percent (5 to 100) of the block. Wins over `fade`.
  mask: { edge: Edge | 'radial'; strength: number }
  // Cut corners (clip-path): `chamfer` slants them, `notch` bites a square out. `size` in px; `corners` (absent: all four) from tl, tr, br, bl.
  cut: {
    shape: 'chamfer' | 'notch'
    size: number
    corners?: ('tl' | 'tr' | 'br' | 'bl')[]
  }
  // Appears only once the page has scrolled this many viewport heights (10 to 400), where the browser supports scroll-driven animation; elsewhere, and for reduced motion, always shown.
  appearAfter: number
  fluidSize: { min: number; max: number; vw?: number }
  textColumns: number
  clampLines: number
  balance: boolean
  transition: {
    what: 'colour' | 'transform' | 'opacity' | 'size' | 'all'
    ms: number
    ease: Ease
    delay?: number
  }
  fit: 'cover' | 'contain'
  focus: { x: number; y: number }
  cursor:
    | 'default'
    | 'pointer'
    | 'text'
    | 'grab'
    | 'move'
    | 'not-allowed'
    | 'zoom-in'
    | 'help'
    | 'crosshair'
  // Look-token hooks label type (dates, venues, menu entries) and a card or button frame from the look.
  label: true
  surface: 'card' | 'button'
  // Menu only. How the links of a menu answer a pointer or the keyboard: a background, a text colour, corners, an underline, a lift in px (up is negative), and how long the change takes. `pill` gives every link room and fully round corners, so the background has a shape to fill.
  linkHover: {
    bg?: Color
    color?: Color
    radius?: number
    underline?: boolean
    pill?: boolean
    lift?: number
    ms?: number
  }
  // `spotlight`, on a container: a soft radial glow of `color` at `strength` (0.05 to 1) and `size` px, centred on the pointer (on the middle without it).
  spotlight: { size: number; color: Color; strength: number }
}>
/** A state a block holds: on or off, or one of a list. Names and values match `^[a-z0-9-]{1,32}$`; `"on-off"` has the values `on` and `off`. */
export type StateDecl = {
  name: string
  values: string[] | 'on-off'
  initial: string
}
export type TriggerEvent =
  'click' | 'hover' | 'enter-view' | 'leave-view' | 'submit'
export type TriggerDo =
  | { set: string; to: string }
  | { toggle: string }
  | { step: string; by: 1 | -1; over: string[] }
  | { scrollTo: string }
  | { goTo: Link }
  | { open: string }
  | { close: string }
  | { play: string }
  | { pause: string }
/** "When this, do that": compiles to `data-s-on` entries and, for click on open/close, the browser's own command attributes. */
export type Trigger = { on: TriggerEvent; do: TriggerDo }
/** A layer that applies while a state held by this block or an ancestor has the value `is`. */
export type When = { state: string; is: string; decl: Decl }

export type Style = {
  when?: When[]
  base?: Decl
  tablet?: Decl
  phone?: Decl
  hover?: Decl
  pressed?: Decl
  focus?: Decl
  current?: Decl
  open?: Decl
  checked?: Decl
  invalid?: Decl
  dark?: Decl
}

/** The named layers of a style: everything but `when`. */
export type StyleLayer = Exclude<keyof Style, 'when'>

export type Box = { x: number; y: number; w: number; h: number; z: number }
export type FreeSlot = Box & { tablet?: Box; phone?: Box }
export type Layout = 'desktop' | 'tablet' | 'phone'
export type FlowSlot = {
  grow?: number
  basis?: Size
  align?: 'start' | 'center' | 'end' | 'stretch'
}
export type GridSlot = { cols?: number; rows?: number }
/** A shape inside a group: its box in the group's `view` units. */
export type ShapeSlot = { x: number; y: number; w: number; h: number }
export type Slot =
  FreeSlot | FlowSlot | GridSlot | ShapeSlot | Record<string, never>

/** `outer: 0` (or omitted) is the current item; 1 is its enclosing item. `site` reads from the values the caller supplies, by dotted field name. */
export type Ref = { from: 'item' | 'site'; field: string; outer?: number }
export type ItemCollectionRef = { from: 'item'; field: string; outer?: number }
export type Repeat = {
  source: string | ItemCollectionRef
  /** A row passes when its field equals `is` (or, for a plain list of values, holds it). `of` takes the value from a field of the enclosing row instead; `is` is then only the fallback. */
  filter?: { field: string; is: string | boolean | number; of?: Ref }
  /** The opposite of `filter`: a row whose field equals `is` is left out. Works with `filter`, which is applied first. */
  exclude?: { field: string; is: string | boolean | number; of?: Ref }
  sort?: { field: string; dir: 'asc' | 'desc' }
  max?: number
  /** The first rows left out, after sorting: a list that shows the first row large and a second one the rest. */
  skip?: number
  group?: { field: string; dir?: 'asc' | 'desc' }
  marker?:
    | 'none'
    | 'disc'
    | 'circle'
    | 'square'
    | 'decimal'
    | 'decimal-leading-zero'
    | 'lower-roman'
    | 'upper-roman'
    | 'lower-alpha'
}

export type Link =
  { page: string } | { file: string } | { url: string } | { email: string }
export type Run = {
  /** `{ br: true }` is a line break and has no other field */
  br?: true
  text?: string
  /** Set by `expand` on a run whose text came from a field, so the editor's canvas can draw it as a chip. Never stored, and never written to the live page. */
  fromData?: true
  /** Set by `expand` on a link that leads off the site (an external post), so the page marks it `rel="noopener nofollow ugc"`. Never stored. */
  external?: true
  bind?: Ref
  link?: Link
  /** resolves to a URL for the run's link */
  bindHref?: Ref
  /** MathML from temml, checked by validation */
  math?: string
  /** The dark-mode `#rrggbb` of a code run; the light colour is `style.color`. */
  dark?: string
  style?: Pick<
    Decl,
    | 'weight'
    | 'italic'
    | 'underline'
    | 'upper'
    | 'color'
    | 'size'
    | 'font'
    | 'letterSpacing'
    | 'bg'
    | 'radius'
    | 'strike'
    | 'baseline'
    | 'smallCaps'
    | 'underlineColor'
    | 'underlineOffset'
    | 'nowrap'
  >
}
export type Pattern = {
  tile?:
    | 'dots'
    | 'grid'
    | 'lines'
    | 'diagonal'
    | 'cross'
    | 'rings'
    | 'checks'
    | 'waves'
    | 'hexagons'
    | 'triangles'
    | 'zigzag'
    | 'scales'
    | 'topography'
    | 'circuit'
    | 'molecules'
    | 'cubes'
    | 'sparkles'
  color: 'brand' | 'ink' | 'gradient'
  /** 0-100 */
  strength: number
  /** tile size in px, 4-96 */
  size?: number
  fade?: 'left' | 'right' | 'bottom'
  cursor?: 'glow' | 'cells'
  /** The side where the tile is densest: the marks fade out towards the opposite side along the whole box. */
  density?: 'top' | 'right' | 'bottom' | 'left'
}
/** The settings of a page-script effect : a small object of plain values. */
export type FxValue = {
  [k: string]: string | number | boolean | string[] | undefined
}
/** A single stop in a shape gradient. `at` is 0 to 100. */
export type ShapeStop = { color: Color; at: number; alpha?: number }
/** What a shape draws (props.geometry). Absent optional fields take the defaults the compiler states. `view` is the proportion (rect, ellipse, line) or the drawing's own size (path, group, scene, chart, diagram, contours, stamp). */
export type ShapeGeometry =
  | {
      type: 'rect'
      radius?: number | [number, number, number, number]
      view?: [number, number]
    }
  | { type: 'ellipse'; view?: [number, number] }
  | { type: 'polygon'; sides: number; rotate?: number }
  | { type: 'star'; points: number; inner: number; rotate?: number }
  | {
      type: 'line'
      from: [number, number]
      to: [number, number]
      view?: [number, number]
    }
  | { type: 'blob'; seed: number; smooth?: number; points?: number }
  | { type: 'path'; d: string; view?: [number, number] }
  | {
      type: 'group'
      view?: [number, number]
      combine?: 'layer' | 'union' | 'subtract'
    }
  | { type: 'scene'; view?: [number, number] }
  | {
      type: 'curve'
      points: [number, number][]
      closed?: boolean
      tension?: number
      view?: [number, number]
    }
  | {
      type: 'arc'
      cx?: number
      cy?: number
      r?: number
      inner?: number
      start: number
      end: number
      view?: [number, number]
    }
  | {
      type: 'wave'
      y?: number
      amp: number
      freq: number
      phase?: number
      closeBottom?: boolean
      view?: [number, number]
    }
  | {
      type: 'chart'
      chart: 'bar' | 'line' | 'area' | 'spark' | 'donut'
      series: { name?: string; values: number[]; color?: Color }[]
      labels?: string[]
      view?: [number, number]
      grid?: boolean
      legend?: boolean
    }
  | {
      type: 'diagram'
      dir?: 'LR' | 'TB'
      nodes: {
        id: string
        label: string
        sub?: string
        col?: number
        row?: number
        fill?: Color
      }[]
      edges: [string, string, string?][]
      view?: [number, number]
    }
  | {
      type: 'contours'
      seed: number
      bands?: number
      scale?: number
      view?: [number, number]
    }
  | {
      type: 'stamp'
      text: string
      center?: string
      rings?: 1 | 2
      teeth?: number
      rotate?: number
      view?: [number, number]
    }
export type ShapePaint =
  | Color
  | {
      from?: Color
      to?: Color
      stops?: ShapeStop[]
      angle?: number
      radial?: [number, number, number]
    }
  | 'none'
export type ShapeStroke = {
  color: Color
  width: number
  dash?: [number, number]
}
export type MarkRepeat = {
  count: number
  step?: [number, number]
  rotate?: number | [number, number, number]
  scale?: number
  opacity?: [number, number]
}
export type SceneMark = {
  rect?: [number, number, number, number, number?]
  circle?: [number, number, number]
  ellipse?: [number, number, number, number]
  line?: [number, number, number, number]
  curve?: {
    points: [number, number][]
    closed?: boolean
    tension?: number
  }
  arc?: {
    cx: number
    cy: number
    r: number
    inner?: number
    start: number
    end: number
  }
  wave?: {
    y?: number
    amp: number
    freq: number
    phase?: number
    closeBottom?: boolean
  }
  grid?: { cols: number; rows: number }
  path?: string
  label?: string
  at?: [number, number]
  anchor?: 'start' | 'middle' | 'end'
  size?: number
  weight?: number
  font?: FontRef
  fill?: ShapePaint
  stroke?: ShapeStroke
  opacity?: number
  blur?: number
  rotate?: number | [number, number, number]
  repeat?: MarkRepeat
}
export type PropValue =
  | ShapeGeometry
  | ShapePaint
  | ShapeStroke
  | SceneMark[]
  | string
  | number
  | boolean
  | string[]
  | number[]
  | Run[]
  | Link
  | Pattern
  | FxValue
  | Color
export type Props = Record<string, PropValue>

export type PlacementMode =
  'normal' | 'front' | 'behind' | 'wrap-start' | 'wrap-end'
export type PlacementValue = { mode: PlacementMode; x?: number; y?: number }
/** Pixel offsets apply only to front/behind. Phone overrides inherit omitted values. */
export type Placement = PlacementValue & {
  tablet?: Partial<PlacementValue>
  phone?: Partial<PlacementValue>
}
export type ControlField =
  | 'text'
  | 'label'
  | 'link'
  | 'asset'
  | 'alt'
  | 'fallback'
  | 'color'
  | 'background'
  | 'fontSize'
  | 'gap'
  | 'padding'
  | 'hidden'
  | 'limit'

export type Node = {
  id: string
  kind: Kind
  name: string
  slot: Slot
  props?: Props
  style?: Style
  children?: Node[]
  repeat?: Repeat
  bind?: Record<string, Ref>
  showIf?: Ref
  /** More fields besides `showIf`: the block shows when `showIf` or ANY of these has a value (2 to 8 fields). With none set, it is always shown. */
  showIfAny?: Ref[]
  hide?: { desktop?: true; tablet?: true; phone?: true }
  /** Editor only: can't be picked or dragged on the canvas. The compiler ignores it. */
  locked?: true
  origin?: { block: string; version: number; look: string }
  placement?: Placement
  /** Instance only: the Component it follows, the values it sets, and its changes to single parts. `bind` maps component props to data; `children` fill the slot. */
  component?: string
  set?: Record<string, PropValue>
  overrides?: Record<string, Override>
  state?: StateDecl[]
  on?: Trigger[]
  motion?: Motion
  /**
   * This node must stay in the site: it is not hidden, and operations refuse to remove it. A `form` and a `field` count as required unless marked `false`.
   * Unrelated to the `required` setting of a `field` node (in `props`), which makes the input mandatory for a visitor. Both can be present.
   */
  required?: boolean
}

/** A change to one part of a component: used by looks, and by an instance for its own overrides. */
export type Override = Pick<Node, 'style' | 'props' | 'hide'>
export type ComponentProp = {
  key: string
  label: string
  type:
    | 'text'
    | 'image'
    | 'link'
    | 'toggle'
    | 'choice'
    | 'slot'
    | 'color'
    | 'number'
  /** The master part the prop writes to (the container for a slot). */
  part?: string
  field?: ControlField
  /** Text and link only: the one run of the part's text this property sets or binds, so a line with several runs can have several properties. */
  run?: number
  /** Choice only: the looks. The default is `default`, or the first. */
  options?: string[]
  default?: PropValue
}
/** One master tree with properties and looks; part ids are plain, and an instance unrolls them as `<instanceId>.<partId>`. */
export type Component = {
  id: string
  name: string
  root: Node
  props: ComponentProp[]
  variants: { when: Record<string, string>; patch: Record<string, Override> }[]
}

export type Page = {
  id: string
  title: string
  slug: string
  icon: string
  on: boolean
  inMenu: boolean
  inFooter: boolean
  root: Node
}

export type Language = { code: string; dir?: 'rtl' }

export type SiteDocument = {
  schemaVersion: number
  name: string
  pages: Page[]
  header: Node
  footer: Node
  components: Component[]
  fonts: FontRef[]
  styles?: SiteStyles
  look: Look
  languages?: Language[]
  /** True: a block with a max width and no slot align of its own centres in its parent (like `margin-inline:auto`). Absent: it sits at the start, as sites made before it do. */
  centreMaxWidth?: boolean
}
