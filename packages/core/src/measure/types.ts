import type { Layout } from '../document/types.ts'
import type { Problem } from '../document/problems.ts'

export type MeasuredBox = { x: number; y: number; w: number; h: number }

export type NodeRaw = {
  id: string
  tag: string
  box: MeasuredBox | null
  /** false when the element paints nothing: no text, no picture, no background or border */
  visible: boolean
  /** computed background as #rrggbb; null when transparent; "unreadable" when painted in a colour format that is not read (oklch and the like) */
  bg: string | null
  /** overflow is hidden or clip on either axis */
  clip: boolean
  fixedOrSticky: boolean
  /** the box is the union of several elements: a list's repeated rows, rolled up to one id */
  merged?: boolean
  text?: {
    lines: number
    longest: number
    last: number
    /** a word has letters on two lines */
    broken?: boolean
    /** the left and right edge of the letters, in page coordinates */
    x0?: number
    x1?: number
    size: number
    weight: number
  }
  tap?: { w: number; h: number }
}

export type LayoutRaw = {
  layout: Layout
  width: number
  docWidth: number
  nodes: NodeRaw[]
  wide: { id: string; by: number }[]
}

/** What the in-page probe returns: the runner adds `layout`. */
export type ProbeRaw = Omit<LayoutRaw, 'layout'>

export type ContrastRaw = {
  id: string
  scheme: 'light' | 'dark'
  width: number
  ratio: number
  large: boolean
  sampled: boolean
}

export type Profile = {
  version: number
  widths: number[]
  themes: ('light' | 'dark')[]
  directions: ('ltr' | 'rtl')[]
}

export type Cell = {
  page: string
  width: number
  theme: 'light' | 'dark'
  dir: 'ltr' | 'rtl'
}

export type Finding = Cell & {
  check: string
  class: 1 | 2 | 3
  revision: number
  nodes: string[]
  state: 'default'
  fonts: boolean
  assets: boolean
  observed: number | string
  expected: string
  cause?: string
  /** advice for a class 2 finding */
  fix?: string
  message: string
  key: string
}

export type Report = {
  revision: number
  build: string
  profile: number
  browser: string
  findings: Finding[]
  measured: Cell[]
  /** each problem has the code MEASUREMENT_INCOMPLETE */
  incomplete: (Partial<Cell> & { page: string; problem: Problem })[]
  /** requests the bundle could not answer */
  blocked: string[]
  /** what the profile does not cover, e.g. 'state:tab=second' */
  skipped: string[]
}

export type FindingStatus = 'fixed' | 'present' | 'unobservable' | 'unchecked'
